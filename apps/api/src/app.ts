import express from 'express';
import type { Db } from '@challenge/db';
import { errorHandler } from './routes/errorHandler';
import { instrumentsRouter } from './routes/instruments';
import { ordersRouter } from './routes/orders';
import { portfolioRouter } from './routes/portfolio';

export function createApp(db: Db) {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(ordersRouter(db), portfolioRouter(db), instrumentsRouter(db));
  app.use(errorHandler);
  return app;
}
