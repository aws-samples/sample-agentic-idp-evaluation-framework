import { Router } from 'express';
import type { MidwayUser } from '../middleware/midway.js';

const router = Router();

router.get('/me', (req, res) => {
  const user = (req as any).midwayUser as MidwayUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({
    alias: user.alias,
    email: user.email,
  });
});

export default router;
