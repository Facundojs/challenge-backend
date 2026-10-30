import { describe, expect, it } from 'vitest';
import { toPosition } from '../src/services/portfolio';

const row = { id: 47, ticker: 'ABC', name: 'Alpha', qty: 40, avg_cost: '930.00', close: '925.85', previousclose: '921.80' };

describe('toPosition', () => {
  it('valúa con el último close y calcula los rendimientos', () => {
    expect(toPosition(row)).toEqual({
      instrumentId: 47,
      ticker: 'ABC',
      name: 'Alpha',
      quantity: 40,
      averageCost: 930,
      lastPrice: 925.85,
      marketValue: 37_034,
      totalReturnPct: -0.45,
      dailyReturnPct: 0.44,
    });
  });

  it('sin precio de mercado no inventa valor ni rendimiento', () => {
    expect(toPosition({ ...row, close: null, previousclose: null })).toMatchObject({
      lastPrice: null,
      marketValue: null,
      totalReturnPct: null,
      dailyReturnPct: null,
    });
  });

  it('sin costo promedio no calcula el rendimiento total', () => {
    expect(toPosition({ ...row, avg_cost: null }).totalReturnPct).toBeNull();
  });
});
