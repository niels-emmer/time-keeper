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
    user: req.userId,
  });
});
