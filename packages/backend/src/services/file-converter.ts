/**
 * File converter service (#7)
 * Converts PPT/XLSX/DOCX to text content for LLM processing.
 * Uses pure-JS libraries (no LibreOffice dependency).
 */
import { OfficeParser } from 'officeparser';
import * as XLSX from 'xlsx';

export interface ConvertedDocument {
  text: string;
  format: 'text' | 'csv' | 'html';
  pageCount: number;
  metadata: Record<string, unknown>;
}

/**
 * Convert Office documents to text for processing.
 * Supports: .xlsx, .xls, .pptx, .ppt, .docx, .doc
 */
export async function convertOfficeDocument(
  buffer: Buffer,
  fileName: string,
): Promise<ConvertedDocument> {
  const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? '';

  // Excel files — use xlsx for structured data
  if (ext === 'xlsx' || ext === 'xls') {
    return convertExcel(buffer, fileName);
  }

  // PowerPoint and Word — use officeparser for text extraction
  if (['pptx', 'ppt', 'docx', 'doc'].includes(ext)) {
    return convertWithOfficeParser(buffer, fileName, ext);
  }

  throw new Error(`Unsupported file format: .${ext}`);
}

function convertExcel(buffer: Buffer, fileName: string): ConvertedDocument {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const html = XLSX.utils.sheet_to_html(sheet);
    sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }

  return {
    text: sheets.join('\n\n'),
    format: 'csv',
    pageCount: workbook.SheetNames.length,
    metadata: {
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length,
      originalFile: fileName,
    },
  };
}

async function convertWithOfficeParser(
  buffer: Buffer,
  fileName: string,
  ext: string,
): Promise<ConvertedDocument> {
  const ast = await OfficeParser.parseOffice(buffer);
  const text = ast.toText();

  // Estimate page count from text length (rough: ~3000 chars per page)
  const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));

  return {
    text,
    format: 'text',
    pageCount: estimatedPages,
    metadata: {
      originalFile: fileName,
      fileType: ext,
      textLength: text.length,
    },
  };
}

/** Check if a file extension is a supported Office format */
export function isOfficeFormat(fileName: string): boolean {
  const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? '';
  return ['xlsx', 'xls', 'pptx', 'ppt', 'docx', 'doc'].includes(ext);
}
