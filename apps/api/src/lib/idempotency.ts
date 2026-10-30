import { AppError } from './errors';
import { uuidv5 } from './uuid';

const NAMESPACE = '3f6b2d9e-8a41-4c57-9e0d-5b7c1a2e4f68';
const MAX_KEY_LENGTH = 255;

export function normalizeKey(raw: string): string {
  const key = raw.trim();
  if (!key) throw new AppError(400, 'Idempotency-Key vacía');
  if (key.length > MAX_KEY_LENGTH) throw new AppError(400, `Idempotency-Key supera ${MAX_KEY_LENGTH} caracteres`);
  if (/[\s\x00-\x1f\x7f]/.test(key)) throw new AppError(400, 'Idempotency-Key no admite espacios ni caracteres de control');
  return key;
}

export const deriveKey = (userId: number, key: string): string => uuidv5(`${userId}:${key}`, NAMESPACE);
