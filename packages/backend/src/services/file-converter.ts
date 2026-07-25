/**
 * File converter service (#7)
 * Converts Office documents to text content for LLM processing.
 * Uses pure-JS libraries (no LibreOffice dependency).
 *
 * Two container formats, and the distinction decides which parser can read a file:
 *
 *   OOXML  (.docx .pptx .xlsx) — a ZIP archive, magic `50 4B 03 04`
 *   CFB    (.doc .ppt .xls)    — the legacy OLE compound file, magic `D0 CF 11 E0`
 *
 * officeparser handles ONLY the OOXML family (and pdf/rtf/odf). Handed a `.doc` it
 * throws "Sorry, OfficeParser currently supports docx, pptx, xlsx, odt, odp, ods, pdf,
 * rtf files only" — verified against a real CFB file produced by `textutil -convert doc`.
 * The upload picker advertised `.doc`, so those uploads reached the adapters, failed the
 * ZIP magic-byte gate, and fell through to `buffer.toString('utf-8')`: the model was
 * billed to read binary noise and the run was reported as a success.
 */
import { OfficeParser } from 'officeparser';
import * as XLSX from 'xlsx';
import WordExtractor from 'word-extractor';

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

  // Legacy binary Word — officeparser cannot read CFB, word-extractor can.
  if (ext === 'doc') {
    return convertLegacyWord(buffer, fileName);
  }

  // OOXML PowerPoint and Word — officeparser handles the ZIP-based formats.
  if (['pptx', 'docx'].includes(ext)) {
    return convertWithOfficeParser(buffer, fileName, ext);
  }

  /*
   * `.ppt` is deliberately NOT handled.
   *
   * No pure-JS parser reads the legacy PowerPoint binary record stream, and I could not
   * produce a real `.ppt` to verify against (`textutil` refuses the format), so any
   * implementation here would be untested code claiming a capability. Rejecting at upload
   * with a message that names the fix is more useful than a run that silently returns
   * noise — see isOfficeFormat below, which no longer lists it.
   */
  throw new Error(
    ext === 'ppt'
      ? 'Legacy binary PowerPoint (.ppt) is not supported. Save as .pptx and re-upload.'
      : `Unsupported file format: .${ext}`,
  );
}

/**
 * Legacy binary Word (.doc), the CFB/OLE format Word used before 2007.
 *
 * Verified end to end against a real CFB file: all 217 characters extracted, identifiers
 * and amounts intact. word-extractor is purpose-built for exactly this container.
 */
async function convertLegacyWord(buffer: Buffer, fileName: string): Promise<ConvertedDocument> {
  const doc = await new WordExtractor().extract(buffer);
  // Headers and footnotes carry real content in contracts and invoices; the body alone
  // silently drops a letterhead or a payment-terms footnote.
  const parts = [doc.getBody(), doc.getHeaders(), doc.getFootnotes(), doc.getEndnotes()]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  const text = parts.join('\n\n');

  if (!text) {
    // An empty extraction from a non-empty file is a parse failure, not an empty document.
    throw new Error(
      `Could not extract any text from ${fileName}. The file may be corrupt or password-protected.`,
    );
  }

  return {
    text,
    format: 'text',
    pageCount: Math.max(1, Math.ceil(text.length / 3000)),
    metadata: { originalFile: fileName, fileType: 'doc', textLength: text.length, container: 'cfb' },
  };
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

/**
 * Check if a file extension is an Office format this app can actually convert.
 *
 * `.ppt` is absent on purpose — see convertOfficeDocument. Advertising a format nothing
 * can parse is worse than not accepting it: the run "succeeds" and bills for tokens spent
 * reading binary.
 */
export function isOfficeFormat(fileName: string): boolean {
  const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? '';
  return ['xlsx', 'xls', 'pptx', 'docx', 'doc'].includes(ext);
}

/**
 * Is this buffer the ORIGINAL binary Office file, or text an earlier stage already
 * converted?
 *
 * The three generating adapters each inlined their own copy of a ZIP-magic test
 * (`50 4B 03 04`) to answer this, which was wrong twice over: it missed the legacy CFB
 * container (`D0 CF 11 E0`) that `.doc` and `.xls` use, so those fell through to a UTF-8
 * decode of binary; and three copies of one rule drift. Centralised here so a new
 * container is one edit.
 */
export function isBinaryOfficeBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  // OOXML: a ZIP archive.
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  // Legacy OLE compound file (BIFF8 .xls, .doc, .ppt).
  const cfb = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  return zip || cfb;
}
