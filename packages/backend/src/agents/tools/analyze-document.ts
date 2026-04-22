import { ConverseCommand, type Message, type ImageFormat } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { bedrockClient, config } from '../../config/aws.js';
import { getDocumentBuffer } from '../../services/s3.js';
import { convertOfficeDocument, isOfficeFormat } from '../../services/file-converter.js';

// Claude rejects PDFs with more than 100 pages. For analysis we only need a
// representative sample, so we extract the first N and last M pages into a
// smaller PDF that the Converse API will accept.
const ANALYSIS_PDF_PAGE_CAP = 80;
const ANALYSIS_PDF_HEAD_PAGES = 60;
const ANALYSIS_PDF_TAIL_PAGES = 20;

async function sampleLargePdf(buffer: Buffer): Promise<{ buffer: Buffer; originalPages: number; sampled: boolean }> {
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const originalPages = src.getPageCount();
    if (originalPages <= ANALYSIS_PDF_PAGE_CAP) {
      return { buffer, originalPages, sampled: false };
    }
    const dst = await PDFDocument.create();
    const headIdx = Array.from({ length: Math.min(ANALYSIS_PDF_HEAD_PAGES, originalPages) }, (_, i) => i);
    const tailStart = Math.max(originalPages - ANALYSIS_PDF_TAIL_PAGES, ANALYSIS_PDF_HEAD_PAGES);
    const tailIdx = Array.from({ length: originalPages - tailStart }, (_, i) => tailStart + i);
    const pageIndices = Array.from(new Set([...headIdx, ...tailIdx]));
    const copied = await dst.copyPages(src, pageIndices);
    copied.forEach((p) => dst.addPage(p));
    const bytes = await dst.save();
    return { buffer: Buffer.from(bytes), originalPages, sampled: true };
  } catch (err) {
    console.warn('[analyzeDocument] PDF sampling failed, falling back to raw buffer:', (err as Error).message);
    return { buffer, originalPages: 0, sampled: false };
  }
}

export interface DocumentAnalysis {
  documentType: string;
  pageCount: number;
  hasTablesDetected: boolean;
  hasFormsDetected: boolean;
  hasImagesDetected: boolean;
  hasHandwriting: boolean;
  languages: string[];
  summary: string;
  extractedText?: string;
}

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

async function resizeImageIfNeeded(buffer: Buffer): Promise<Buffer> {
  if (buffer.length <= MAX_IMAGE_BYTES) return buffer;
  const ratio = Math.sqrt(MAX_IMAGE_BYTES / buffer.length);
  const metadata = await sharp(buffer).metadata();
  const newWidth = Math.round((metadata.width ?? 2000) * ratio);
  return sharp(buffer).resize({ width: newWidth, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

const ANALYSIS_PROMPT = `Analyze this document and return a JSON object with the following fields:
- documentType: string (e.g., "invoice", "contract", "medical_record", "form", "report", "presentation", "spreadsheet")
- pageCount: number (estimated)
- hasTablesDetected: boolean
- hasFormsDetected: boolean
- hasImagesDetected: boolean
- hasHandwriting: boolean
- languages: string[] (detected languages)
- summary: string (detailed 3-5 sentence summary of the document's actual content — what it covers, key topics, main points)

Return ONLY valid JSON, no markdown.`;

export async function analyzeDocument(
  documentId: string,
  s3Uri: string,
): Promise<DocumentAnalysis> {
  try {
    const docBuffer = await getDocumentBuffer(s3Uri);
    const fileName = s3Uri.split('/').pop() ?? 'document';

    let messages: Message[];

    // Office formats: extract text first, then analyze with LLM
    if (isOfficeFormat(fileName)) {
      const converted = await convertOfficeDocument(docBuffer, fileName);
      const textPreview = converted.text.substring(0, 8000);
      messages = [{
        role: 'user',
        content: [{
          text: `Here is the extracted text content from a ${fileName.split('.').pop()?.toUpperCase()} file named "${fileName}":\n\n---\n${textPreview}\n---\n\n${ANALYSIS_PROMPT}`,
        }],
      }];

      // For Office docs, we can return text for context
      const result = await callBedrock(messages);
      result.extractedText = textPreview;
      return result;
    }

    // PDF: send as document. Claude rejects PDFs > 100 pages, so we down-sample
    // large PDFs to a head+tail sample before the Converse call.
    const isPdf = /\.pdf$/i.test(fileName);
    if (isPdf) {
      const { buffer: sampledBuffer, originalPages, sampled } = await sampleLargePdf(docBuffer);
      const prompt = sampled
        ? `${ANALYSIS_PROMPT}\n\nNOTE: This is a SAMPLE of a larger ${originalPages}-page PDF (first ${ANALYSIS_PDF_HEAD_PAGES} and last ${ANALYSIS_PDF_TAIL_PAGES} pages). Set pageCount to ${originalPages}. Analyze confidently based on the sample.`
        : ANALYSIS_PROMPT;
      messages = [{
        role: 'user',
        content: [
          { document: { name: 'document', format: 'pdf', source: { bytes: sampledBuffer } } },
          { text: prompt },
        ],
      }];
      const result = await callBedrock(messages);
      if (sampled && originalPages > 0) {
        result.pageCount = originalPages;
      }
      return result;
    }

    // Image: send as image
    const isImage = /\.(jpg|jpeg|png|gif|webp|tiff|tif|bmp)$/i.test(fileName);
    if (isImage) {
      const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'png';
      const formatMap: Record<string, ImageFormat> = {
        jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp',
        tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg',
      };
      const resized = await resizeImageIfNeeded(docBuffer);
      messages = [{
        role: 'user',
        content: [
          { image: { format: formatMap[ext] ?? 'jpeg', source: { bytes: resized } } },
          { text: ANALYSIS_PROMPT },
        ],
      }];
      return callBedrock(messages);
    }

    // Fallback: send as text
    const textContent = docBuffer.toString('utf-8').substring(0, 8000);
    messages = [{
      role: 'user',
      content: [{ text: `File: ${fileName}\n\n${textContent}\n\n${ANALYSIS_PROMPT}` }],
    }];
    return callBedrock(messages);
  } catch (err) {
    console.error('[analyzeDocument Error]', err);
    return {
      documentType: 'unknown',
      pageCount: 1,
      hasTablesDetected: false,
      hasFormsDetected: false,
      hasImagesDetected: false,
      hasHandwriting: false,
      languages: ['en'],
      summary: 'Unable to analyze document',
    };
  }
}

async function callBedrock(messages: Message[]): Promise<DocumentAnalysis> {
  const command = new ConverseCommand({
    modelId: config.claudeModelId,
    system: [{ text: 'You are a document analysis assistant. Return only valid JSON.' }],
    messages,
    inferenceConfig: { maxTokens: 4096, temperature: 0 },
  });

  const response = await bedrockClient.send(command);
  const text = response.output?.message?.content?.[0]?.text ?? '{}';
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
  return JSON.parse(cleaned) as DocumentAnalysis;
}
