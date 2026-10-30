import { describe, expect, it } from 'vitest';
import { deriveKey, normalizeKey } from '../src/lib/idempotency';
import { uuidv5 } from '../src/lib/uuid';

describe('derivación de la key', () => {
  it('uuidv5 coincide con el vector de referencia (RFC 4122, namespace DNS)', () => {
    expect(uuidv5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('queda scopeada por usuario y fija el resultado para la normalización vigente', () => {
    expect(deriveKey(1, 'abc')).not.toBe(deriveKey(2, 'abc'));
    expect(deriveKey(1, 'abc')).toBe(deriveKey(1, 'abc'));
    expect(deriveKey(1, 'abc')).toMatchInlineSnapshot(`"2368e464-c4a1-501e-914a-c98c867cdcd4"`);
  });

  it('solo hace trim: el casing distingue y el resto se rechaza', () => {
    expect(normalizeKey('  k1 ')).toBe('k1');
    expect(normalizeKey('K1')).not.toBe(normalizeKey('k1'));
    for (const bad of ['', '   ', 'a b', 'a\tb', 'a\u0000b', 'x'.repeat(256)]) expect(() => normalizeKey(bad)).toThrow();
  });
});
