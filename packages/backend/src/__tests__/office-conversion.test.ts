import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as XLSX from 'xlsx';
import {
  convertOfficeDocument,
  isOfficeFormat,
  isBinaryOfficeBuffer,
} from '../services/file-converter.js';
import { getAllAcceptedExtensions, getAllAcceptedMimeTypes, getDocumentType } from '@idp/shared';

/**
 * Office documents come in two containers, and the app was handling only one.
 *
 *   OOXML (.docx .pptx .xlsx) — a ZIP archive,  magic 50 4B 03 04
 *   CFB   (.doc  .ppt  .xls)  — legacy OLE,     magic D0 CF 11 E0
 *
 * All three generating adapters gated conversion on an inlined ZIP magic-byte test, so
 * every legacy CFB file failed the gate and fell through to `buffer.toString('utf-8')`.
 * Measured on a real `.xls`: the model received `"ࡱ..."` — the raw OLE header — and
 * the run was reported as a SUCCESS with real token cost. `.doc` was worse still: the
 * picker advertised it, and officeparser cannot read CFB at all.
 *
 * These tests build REAL binary fixtures rather than asserting on hand-written bytes,
 * because the whole bug was a mismatch between what the format actually is and what the
 * code assumed it was.
 */

/** Real fixtures, generated at test time so they are genuinely the formats claimed. */
function makeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'idp-office-'));
  const body = [
    'QUOTATION QT-2026-0417',
    'Supplier: Daehan Precision Machinery',
    'Item K-1001 Bearing 6204 qty 120 unit 8500',
    'Total 3348400',
  ].join('\n');

  const txt = join(dir, 'src.txt');
  writeFileSync(txt, body);

  /*
   * `textutil` is macOS-only. Where it is missing the .doc/.docx cases are skipped rather
   * than faked: a fabricated CFB file would test the assertion, not the parser.
   */
  let doc: Buffer | null = null;
  let docx: Buffer | null = null;
  try {
    execFileSync('textutil', ['-convert', 'doc', '-output', join(dir, 'f.doc'), txt], { stdio: 'ignore' });
    execFileSync('textutil', ['-convert', 'docx', '-output', join(dir, 'f.docx'), txt], { stdio: 'ignore' });
    doc = readFileSync(join(dir, 'f.doc'));
    docx = readFileSync(join(dir, 'f.docx'));
  } catch { /* not macOS, or textutil unavailable */ }

  // xlsx writes both containers, so the .xls case runs everywhere.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Item', 'Qty', 'Amount'], ['K-1001', 120, 1020000], ['TOTAL', '', 3348400]]),
    'Quote',
  );
  const xls = XLSX.write(wb, { bookType: 'xls', type: 'buffer' }) as Buffer;
  const xlsx = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;

  return { doc, docx, xls, xlsx };
}

const fx = makeFixtures();

describe('binary Office containers are recognised, not decoded as text', () => {
  it('generates fixtures that really are the formats claimed', () => {
    // Guards the whole file: an assertion against a fake fixture proves nothing.
    expect(fx.xls.subarray(0, 4), 'xls must be CFB').toEqual(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    expect(fx.xlsx.subarray(0, 4), 'xlsx must be ZIP').toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (fx.doc) {
      expect(fx.doc.subarray(0, 4), 'doc must be CFB').toEqual(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    }
  });

  it('detects BOTH container families', () => {
    expect(isBinaryOfficeBuffer(fx.xlsx), 'OOXML/ZIP').toBe(true);
    expect(isBinaryOfficeBuffer(fx.xls), 'legacy CFB').toBe(true);
    if (fx.doc) expect(isBinaryOfficeBuffer(fx.doc), 'legacy CFB .doc').toBe(true);
  });

  it('treats already-converted text as text, not as a binary Office file', () => {
    /*
     * This is why the gate exists at all: /preview pre-converts some documents and hands
     * the adapters a text buffer. Re-running the Office converter on that would fail.
     */
    expect(isBinaryOfficeBuffer(Buffer.from('Sheet: Quote\nItem,Qty\nK-1001,120'))).toBe(false);
    expect(isBinaryOfficeBuffer(Buffer.from('short'))).toBe(false);
  });

  it('the old ZIP-only gate would have rejected every legacy file', () => {
    // Pins the actual defect: this is the exact expression the three adapters inlined.
    const zipOnly = (b: Buffer) => b.length > 4
      && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
    expect(zipOnly(fx.xls), 'a real .xls fails the ZIP test').toBe(false);
    if (fx.doc) expect(zipOnly(fx.doc), 'a real .doc fails the ZIP test').toBe(false);
    // …and would therefore have been UTF-8 decoded into noise.
    expect(fx.xls.toString('utf-8')).not.toContain('3348400');
  });
});

describe('every advertised Office format actually converts', () => {
  it('extracts real content from a legacy .xls', async () => {
    const r = await convertOfficeDocument(fx.xls, 'quote.xls');
    expect(r.text).toContain('3348400');
    expect(r.text).toContain('K-1001');
  });

  it('extracts real content from an .xlsx', async () => {
    const r = await convertOfficeDocument(fx.xlsx, 'quote.xlsx');
    expect(r.text).toContain('3348400');
  });

  it.runIf(fx.doc)('extracts real content from a legacy binary .doc', async () => {
    /*
     * The case officeparser cannot do at all — it throws "Sorry, OfficeParser currently
     * supports docx, pptx, xlsx, odt, odp, ods, pdf, rtf files only". word-extractor reads
     * the CFB container instead.
     */
    const r = await convertOfficeDocument(fx.doc as Buffer, 'quote.doc');
    expect(r.text).toContain('QT-2026-0417');
    expect(r.text).toContain('3348400');
    expect(r.pageCount).toBeGreaterThanOrEqual(1);
  });

  it.runIf(fx.docx)('extracts real content from a .docx', async () => {
    const r = await convertOfficeDocument(fx.docx as Buffer, 'quote.docx');
    expect(r.text).toContain('QT-2026-0417');
  });

  it('rejects .ppt with a message naming the fix', async () => {
    /*
     * No pure-JS parser reads the legacy PowerPoint record stream, and a `.ppt` fixture
     * cannot even be produced to verify against — so this is rejected rather than
     * implemented on hope. The message has to say what to do, because "unsupported type"
     * beside a list containing `.pptx` is a puzzle for someone holding a `.ppt`.
     */
    await expect(convertOfficeDocument(fx.xls, 'deck.ppt')).rejects.toThrow(/save as \.pptx/i);
  });
});

describe('the picker advertises only what the app can parse', () => {
  it('does not offer .ppt anywhere a user or the API can see', () => {
    // Extension list (drives the picker text AND the 415 body), MIME list, and the
    // type resolver — the upload filter tests MIME first, so all three must agree.
    expect(getAllAcceptedExtensions()).not.toContain('.ppt');
    expect(getAllAcceptedMimeTypes()).not.toContain('application/vnd.ms-powerpoint');
    expect(getDocumentType('deck.ppt')).toBeFalsy();
    expect(isOfficeFormat('deck.ppt')).toBe(false);
  });

  it('still offers the formats that do work', () => {
    for (const ext of ['.doc', '.docx', '.pptx', '.xls', '.xlsx']) {
      expect(getAllAcceptedExtensions(), ext).toContain(ext);
    }
    for (const f of ['a.doc', 'a.docx', 'a.pptx', 'a.xls', 'a.xlsx']) {
      expect(isOfficeFormat(f), f).toBe(true);
    }
  });

  it('gives a .ppt upload an actionable rejection, not a generic 415', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'middleware', 'upload.ts'), 'utf-8');
    expect(src).toMatch(/\\\.\(ppt\|pps\)\$/);
    expect(src).toMatch(/save as \.pptx/i);
  });

  it('no adapter still inlines its own magic-byte test', () => {
    /*
     * Three copies of one rule is how the CFB case went missing: each adapter tested ZIP
     * only, and fixing one would not have fixed the others. The shared helper is the
     * single place a new container gets added.
     */
    const dir = join(import.meta.dirname, '..', 'adapters');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /0x50\s*&&|0x4[bB]\s*&&/.test(readFileSync(join(dir, f), 'utf-8')));
    expect(offenders, `adapters with an inlined magic-byte test: ${offenders.join(', ')}`).toEqual([]);
  });
});
