import NodeCache from 'node-cache';

const MAX_KEYS = 5000;

export const createCache = (ttlSeconds: number): NodeCache =>
  new NodeCache({ stdTTL: ttlSeconds, checkperiod: ttlSeconds * 1, maxKeys: MAX_KEYS, useClones: false });

export async function cached<T>(cache: NodeCache, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return hit;

  const value = await load();

  try {
    cache.set(key, value);
  } catch {}

  return value;
}
