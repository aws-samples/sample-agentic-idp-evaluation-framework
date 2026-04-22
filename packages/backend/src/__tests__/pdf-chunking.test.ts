import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { splitPdfByPages } from '../adapters/token-stream-adapter.js';

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

describe('splitPdfByPages', () => {
  it('returns a single chunk when under the limit', async () => {
    const pdf = await makePdf(50);
    const chunks = await splitPdfByPages(pdf, 90, 2);
    expect(chunks).toHaveLength(1);
  });

  it('splits a 146-page PDF into 2 chunks of <=90 pages with 2-page overlap', async () => {
    const pdf = await makePdf(146);
    const chunks = await splitPdfByPages(pdf, 90, 2);
    expect(chunks.length).toBe(2);
    for (const c of chunks) {
      const loaded = await PDFDocument.load(c);
      expect(loaded.getPageCount()).toBeLessThanOrEqual(90);
    }
  });

  it('splits a 300-page PDF into 4 chunks', async () => {
    const pdf = await makePdf(300);
    const chunks = await splitPdfByPages(pdf, 90, 2);
    expect(chunks.length).toBe(4);
  });

  it('every chunk except possibly the last is exactly chunkSize pages', async () => {
    const pdf = await makePdf(200);
    const chunks = await splitPdfByPages(pdf, 90, 2);
    const counts = await Promise.all(
      chunks.map(async (c) => (await PDFDocument.load(c)).getPageCount()),
    );
    // Step = 88, so chunks cover: [0,90), [88,178), [176,200) → sizes: 90, 90, 24
    expect(counts[0]).toBe(90);
    expect(counts[1]).toBe(90);
  });

  it('overlap is honored (consecutive chunks share pages)', async () => {
    const pdf = await makePdf(180);
    const chunks = await splitPdfByPages(pdf, 90, 5);
    const counts = await Promise.all(
      chunks.map(async (c) => (await PDFDocument.load(c)).getPageCount()),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(180); // sum includes overlap
  });
});
