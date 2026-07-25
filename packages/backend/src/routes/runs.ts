import { Router } from 'express';
import { getRecentRuns, getAllRecentRuns, getRunById } from '../services/activity-tracker.js';
import { getRunStage } from '@idp/shared';
import { config } from '../config/aws.js';
import type { AuthUser } from '../middleware/auth.js';

const router = Router();

/*
 * Run history is a DISCLOSURE risk on a shared deployment, so it is refused here at
 * the API rather than merely hidden in the UI.
 *
 * With AUTH_PROVIDER=none every visitor is the same alias, so one shared history
 * would let any visitor list, open and resume documents another person uploaded.
 * Hiding the nav link would not help: these endpoints are directly callable.
 *
 * Admins are NOT exempt. On a demo with authentication disabled anyone could claim
 * an admin alias, so an exemption would be the same hole with extra steps.
 */
function runHistoryDisabled(res: import('express').Response): boolean {
  if (!config.disableRunHistory) return false;
  res.status(403).json({
    error: 'Run history is disabled on this deployment',
    detail:
      'This is a shared demo without per-user authentication, so stored runs would be '
      + 'visible to every visitor. Uploads are processed in-session only.',
    disabled: true,
  });
  return true;
}


// GET /api/runs — list recent runs for the authenticated user
// Query params: limit (max 50), all=true (admin only — returns all users' runs)
router.get('/', async (req, res) => {
  if (runHistoryDisabled(res)) return;
  const user = (req as any).authUser as AuthUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
    const wantAll = req.query.all === 'true';
    const isAdmin = config.adminUsers.includes(user.alias);

    // Admin can request all users' runs
    const runs = (wantAll && isAdmin)
      ? await getAllRecentRuns(limit)
      : await getRecentRuns(user.alias, limit);

    // Return a lightweight list (strip full results payload)
    const items = runs.map((r) => ({
      runId: r.runId,
      userId: r.userId,
      documentId: r.documentId,
      documentName: r.documentName,
      capabilities: r.capabilities,
      methods: r.methods,
      timestamp: r.timestamp,
      status: r.status,
      // How far the run actually got, so the list can distinguish a preview-only
      // run from a finished evaluation — `status` alone reported both as
      // "complete" — and so Resume knows which step to open. Derived from the
      // record's contents, which also classifies pre-existing runs correctly.
      stage: getRunStage(r).stage,
      source: r.source,
      fileType: r.fileType,
      fileSize: r.fileSize,
      pageCount: r.pageCount,
      documentLanguages: r.documentLanguages,
    }));

    res.json({ runs: items, count: items.length });
  } catch (err) {
    console.error('[Runs] List error:', err);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// GET /api/runs/:runId — get full run data for reload
router.get('/:runId', async (req, res) => {
  if (runHistoryDisabled(res)) return;
  const user = (req as any).authUser as AuthUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { runId } = req.params;
  if (!runId) {
    res.status(400).json({ error: 'runId is required' });
    return;
  }

  try {
    // First try the requesting user's own run
    let run = await getRunById(user.alias, runId);

    // If not found and user is admin, scan for the run across all users
    if (!run && config.adminUsers.includes(user.alias)) {
      const allRuns = await getAllRecentRuns(200);
      run = allRuns.find((r) => r.runId === runId) ?? null;
    }

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    // Include the derived stage so the client knows which step to resume at
    // without having to re-derive it from the payload.
    res.json({ ...run, stage: getRunStage(run).stage });
  } catch (err) {
    console.error('[Runs] Get error:', err);
    res.status(500).json({ error: 'Failed to get run' });
  }
});

export default router;
