import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';

// Errores 4xx que lanzan los middlewares de Express (JSON malformado, body demasiado grande, etc.).
const clientErrorStatus = (err: unknown): number | null => {
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true ? status : null;
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) return void res.status(400).json({ error: 'Request inválido', details: err.issues });
  if (err instanceof AppError) return void res.status(err.status).json({ error: err.message });

  const status = clientErrorStatus(err);
  if (status) return void res.status(status).json({ error: status === 400 ? 'JSON inválido' : err.message });

  console.error(err);
  res.status(500).json({ error: 'Error interno' });
};
