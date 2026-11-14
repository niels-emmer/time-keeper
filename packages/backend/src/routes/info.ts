import { Router } from 'express';

export const infoRouter = Router();

/**
 * GET /api/info
 *
 * Returns the app version (baked in at Docker build time via APP_VERSION env var)
 * and the currently authenticated user's email address.
 */
infoRouter.get('/', (req, res) => {
  res.json({
    version: process.env.APP_VERSION ?? 'dev',
    repoUrl: 'https://github.com/niels-emmer/time-keeper',
    // The account's email, not `users.id`: the identity model changed in
    // Phase A (D7) but this response is part of the existing API surface, and
    // Settings -> About still shows the address the user knows.
    user: req.userEmail,
  });
});
