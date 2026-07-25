import { describe, it, expect } from 'vitest';
import { METHODS, METHOD_INFO, CAPABILITY_SUPPORT, getMethodFamily } from '@idp/shared';
import { scoringBoundsForTest } from '../services/pipeline-generator.js';

const { balancedScore, maxSpeedRank, maxCostPerPage } = scoringBoundsForTest;

/**
 * The balanced strategy is the default, so its arithmetic decides which method
 * most users are shown. It previously normalised speed against a hardcoded
 * divisor of 11 while SPEED_RANK had grown to 18, producing negative scores that
 * subtracted from accuracy rather than merely ranking low.
 */
describe('balancedScore normalisation', () => {
  it('derives its bounds from the real tables', () => {
    expect(maxSpeedRank).toBeGreaterThanOrEqual(18);
    expect(maxCostPerPage).toBeCloseTo(
      Math.max(...Object.values(METHOD_INFO).map((m) => m.estimatedCostPerPage)), 6,
    );
  });

  it('stays within 0-100 for every method and every supported capability', () => {
    for (const method of METHODS) {
      const family = getMethodFamily(method);
      const support = CAPABILITY_SUPPORT[family] ?? {};
      for (const capability of Object.keys(support) as Array<keyof typeof support>) {
        const score = balancedScore(method, capability as never);
        expect(score, `${method}/${String(capability)} scored ${score}`).toBeGreaterThanOrEqual(0);
        // Accuracy 100 + cost 100 + speed 100 weighted = 100, plus the 100-point
        // Guardrails PII specialist preference (which must outrank any cost or
        // speed advantage, since a missed redaction is a data leak).
        expect(score, `${method}/${String(capability)} scored ${score}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it('scores the slowest method low rather than negative', () => {
    // Opus 5 is the slowest rank in the table. Under the old divisor its speed
    // term was -63.6, which dragged its total below methods that support the
    // capability far worse.
    const score = balancedScore('claude-opus-5', 'text_extraction');
    expect(score).toBeGreaterThan(0);
  });

  it('still ranks a fast, cheap, equally-capable method above a slow expensive one', () => {
    // The fix must not invert the intended ordering: for a capability both
    // handle well, Haiku should still beat Opus 5 on the balanced weighting.
    const haiku = balancedScore('claude-haiku', 'text_extraction');
    const opus5 = balancedScore('claude-opus-5', 'text_extraction');
    expect(haiku).toBeGreaterThan(opus5);
  });

  it('gives Guardrails the PII specialist bonus over a general LLM', () => {
    const guardrails = balancedScore('bedrock-guardrails', 'pii_redaction');
    const sonnet = balancedScore('claude-sonnet', 'pii_redaction');
    expect(guardrails).toBeGreaterThan(sonnet);
  });
});
