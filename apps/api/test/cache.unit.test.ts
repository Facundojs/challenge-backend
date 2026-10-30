import NodeCache from 'node-cache';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, createCache } from '../src/lib/cache';

afterEach(() => vi.useRealTimers());

const counter = <T>(value: T) => {
  const load = vi.fn(async () => value);
  return load;
};

describe('cached', () => {
  it('carga una sola vez por clave dentro del TTL', async () => {
    const cache = createCache(60);
    const load = counter(['AAA']);
    expect(await cached(cache, 'aaa', load)).toEqual(['AAA']);
    expect(await cached(cache, 'aaa', load)).toEqual(['AAA']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('vuelve a cargar cuando vence el TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cache = createCache(60);
    const load = counter('valor');
    await cached(cache, 'k', load);

    vi.setSystemTime(Date.now() + 59_000);
    await cached(cache, 'k', load);
    expect(load).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2_000);
    await cached(cache, 'k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('separa las claves y cachea también los resultados vacíos', async () => {
    const cache = createCache(60);
    const empty = counter<string[]>([]);
    await cached(cache, 'a', empty);
    await cached(cache, 'a', empty);
    await cached(cache, 'b', empty);
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('con el cache lleno responde igual, sin cachear', async () => {
    const cache = new NodeCache({ stdTTL: 60, maxKeys: 1 });
    await cached(cache, 'a', counter(1));
    const load = counter(2);
    expect(await cached(cache, 'b', load)).toBe(2);
    expect(await cached(cache, 'b', load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
