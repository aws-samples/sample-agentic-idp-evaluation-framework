import { Router } from 'express';
import { METHOD_INFO, METHODS, type ProcessingMethod } from '@idp/shared';
import { isMethodConfigured } from '../services/method-availability.js';

const router = Router();

/**
 * GET /api/methods
 *
 * Catalog + per-deployment availability. The UI previously listed every method
 * as equally usable and only discovered that BDA or Guardrails was unconfigured
 * when a run failed halfway through. Serving availability up front lets the UI
 * mark those methods as unavailable, with the reason, before the user picks one.
 */
router.get('/', (_req, res) => {
  const methods = (METHODS as readonly ProcessingMethod[]).map((id) => {
    const info = METHOD_INFO[id];
    const availability = isMethodConfigured(id);
    return {
      id,
      family: info.family,
      name: info.name,
      shortName: info.shortName,
      description: info.description,
      modelId: info.modelId,
      tokenPricing: info.tokenPricing,
      estimatedCostPerPage: info.estimatedCostPerPage,
      strengths: info.strengths,
      limitations: info.limitations,
      available: availability.available,
      unavailableReason: availability.reason,
      unavailableDetail: availability.detail,
    };
  });

  res.json({
    methods,
    summary: {
      total: methods.length,
      available: methods.filter((m) => m.available).length,
      unavailable: methods.filter((m) => !m.available).length,
    },
  });
});

export default router;
