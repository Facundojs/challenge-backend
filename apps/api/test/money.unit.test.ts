import { describe, expect, it } from 'vitest';
import { cents, numOrNull, pctChange, round2, sharesFor } from '../src/lib/money';

describe('pctChange', () => {
  it('calcula la variación respecto de la base', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(98, 100)).toBe(-2);
    expect(pctChange(100, 98)).toBe(2.04);
  });

  it.each([[null, 100], [100, null], [100, 0], [null, null]])('es null con %s y %s', (current, base) => {
    expect(pctChange(current, base)).toBeNull();
  });
});

describe('sharesFor', () => {
  it('compra solo acciones enteras', () => {
    expect(sharesFor(1050, 100)).toBe(10);
    expect(sharesFor(99, 100)).toBe(0);
  });

  it('no pierde una acción por error de punto flotante', () => {
    expect(sharesFor(0.3, 0.1)).toBe(3);
  });
});

describe('conversiones', () => {
  it('numOrNull distingue null de cero', () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull('0.00')).toBe(0);
    expect(numOrNull('12.50')).toBe(12.5);
  });

  it('round2 y cents redondean a dos decimales', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(cents(0.1 + 0.2)).toBe(30);
  });
});
