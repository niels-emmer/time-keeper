import express from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { categoriesRouter } from './routes/categories.js';
import { timerRouter } from './routes/timer.js';
import { entriesRouter } from './routes/entries.js';
import { summaryRouter } from './routes/summary.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Health check — no auth required (oauth2-proxy skips this route)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  // All other API routes require auth
  app.use('/api', authMiddleware);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/timer', timerRouter);
  app.use('/api/entries', entriesRouter);
  app.use('/api/summary', summaryRouter);

  app.use(errorHandler);

  return app;
}
