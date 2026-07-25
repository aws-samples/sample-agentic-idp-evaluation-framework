import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf-8');

/**
 * A response cut off at the output-token ceiling was reported as a clean success.
 *
 * Bedrock says so explicitly — Converse sets `messageStop.stopReason = 'max_tokens'`
 * and the Responses API sets `status: 'incomplete'` with
 * `incomplete_details.reason = 'max_output_tokens'` — and every adapter discarded it.
 * So a response that ended mid-value:
 *
 *     data:
 *       - {"label": "Benchmark cell: 723 ms", "bbox": [330, 470, 540, 482]}
 *       - {"
 *
 * was parsed as far as it went and shown with the model's own confidence (0.88)
 * attached. A table missing its last rows renders as a perfectly good table, so the
 * user had no way to distinguish half an extraction from a whole one.
 *
 * These are source-level assertions because the property is structural: EVERY
 * generating adapter must read its API's stop signal. A behavioural test on one
 * adapter would pass while another silently kept swallowing it.
 */
describe('every generating adapter detects truncation', () => {
  const CONVERSE_ADAPTERS = [
    'adapters/token-stream-adapter.ts', // direct Claude / Nova
    'adapters/bda-llm-adapter.ts', // BDA -> LLM structuring
    'adapters/two-phase-adapter.ts', // Textract -> LLM structuring
  ];

  it.each(CONVERSE_ADAPTERS)('%s reads messageStop.stopReason', (file) => {
    const src = read(file);
    expect(src, `${file} never reads messageStop`).toMatch(/event\.messageStop\?\.stopReason/);
    expect(src, `${file} never reports truncation`).toMatch(/truncated:\s*stopReason === 'max_tokens'/);
  });

  it('the Mantle/GPT path reads the Responses API incomplete status', () => {
    // Different API, different signal — a Converse-shaped check would silently never
    // fire here, which is exactly how one path stays broken while the others are fixed.
    const client = read('config/mantle.ts');
    expect(client).toMatch(/status === 'incomplete'/);
    expect(client).toMatch(/max_output_tokens/);
    expect(read('adapters/mantle-responses-adapter.ts')).toMatch(/truncated: result\.truncated/);
  });

  it('Pegasus reads its own stop reason', () => {
    expect(read('adapters/pegasus-adapter.ts')).toMatch(/stopReason === 'max_tokens'/);
  });

  it('processor-base propagates it to the result', () => {
    // Detecting it in the adapter is useless if it stops there.
    expect(read('processors/processor-base.ts')).toMatch(/output\.truncated \? \{ truncated: true \}/);
  });

  it('preview sends it to the client', () => {
    expect(read('routes/preview.ts')).toMatch(/result\.truncated \? \{ truncated: true \}/);
  });

  it('a truncated run is still returned, not thrown away', () => {
    /*
     * Deliberate: the parsed fragment is often usable, and the user has already paid
     * for the tokens. Throwing would discard both. The contract is "surfaced, not
     * hidden" — so `truncated` must not appear inside the empty-extraction throw.
     */
    const base = read('processors/processor-base.ts');
    const throwBlock = base.slice(base.indexOf('if (allEmpty'), base.indexOf('const result:'));
    expect(throwBlock).not.toMatch(/truncated/);
  });
});
