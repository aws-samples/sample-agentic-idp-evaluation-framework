import { Router } from 'express';
import type { MidwayUser } from '../middleware/midway.js';
import { getFeedbackStatus, submitFeedback } from '../services/feedback.js';

const router = Router();

function getUserAlias(req: any): string | null {
  const user = req.midwayUser as MidwayUser | undefined;
  return user?.alias ?? null;
}

// GET /api/feedback/status — has the current user submitted feedback yet?
router.get('/status', async (req, res) => {
  try {
    const alias = getUserAlias(req);
    if (!alias) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const status = await getFeedbackStatus(alias);
    res.json(status);
  } catch (err) {
    console.error('[Feedback] Status error:', err);
    res.status(500).json({ error: 'Failed to load feedback status' });
  }
});

// POST /api/feedback — submit feedback (once per user)
router.post('/', async (req, res) => {
  try {
    const alias = getUserAlias(req);
    if (!alias) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const { rating, comment } = req.body ?? {};
    const record = await submitFeedback(alias, rating, comment);
    res.status(201).json(record);
  } catch (err: any) {
    const msg = err?.message ?? 'Failed to submit feedback';
    if (msg.includes('already submitted') || err?.name === 'ConditionalCheckFailedException') {
      res.status(409).json({ error: 'Feedback already submitted' });
      return;
    }
    if (msg.startsWith('Rating must')) {
      res.status(400).json({ error: msg });
      return;
    }
    console.error('[Feedback] Submit error:', err);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

export default router;
