import { Router } from 'express';
import { config } from '../config/aws.js';
import { queryActivity, getActivityStats } from '../services/activity-tracker.js';
import { getFeedbackSummary } from '../services/feedback.js';
import type { MidwayUser } from '../middleware/midway.js';

const router = Router();

// Admin-only middleware.
//
// Defense-in-depth: refuse to grant admin when auth is disabled (AUTH_PROVIDER=none
// or MIDWAY_DISABLED=true), even if an alias happens to match `adminUsers`. This
// prevents a misconfigured public deployment from handing admin to anonymous users.
function requireAdmin(req: any, res: any, next: any) {
  const effectiveProvider = process.env.MIDWAY_DISABLED === 'true' ? 'none' : config.authProvider;
  if (effectiveProvider === 'none') {
    res.status(403).json({
      error: 'Admin access required',
      message: 'Admin endpoints are disabled when AUTH_PROVIDER=none.',
    });
    return;
  }
  const user = req.midwayUser as MidwayUser | undefined;
  if (!user || config.adminUsers.length === 0 || !config.adminUsers.includes(user.alias)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

router.use(requireAdmin);

// GET /api/admin/stats — dashboard summary
router.get('/stats', async (_req, res) => {
  try {
    const stats = await getActivityStats();
    res.json(stats);
  } catch (err) {
    console.error('[Admin] Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// GET /api/admin/activity?userId=X&startDate=Y&limit=Z
router.get('/activity', async (req, res) => {
  try {
    const { userId, startDate, endDate, limit } = req.query;
    const records = await queryActivity({
      userId: userId as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });
    res.json({ records, count: records.length });
  } catch (err) {
    console.error('[Admin] Activity query error:', err);
    res.status(500).json({ error: 'Failed to query activity' });
  }
});

// GET /api/admin/feedback — survey summary + all submissions
router.get('/feedback', async (_req, res) => {
  try {
    const summary = await getFeedbackSummary();
    res.json(summary);
  } catch (err) {
    console.error('[Admin] Feedback error:', err);
    res.status(500).json({ error: 'Failed to load feedback' });
  }
});

export default router;
