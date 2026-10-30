import { describe, expect, it } from 'vitest';
import type { OrderEventPayload } from '@challenge/contracts';
import { eventEffect } from '../src/projection';

const event = (over: Partial<OrderEventPayload>): OrderEventPayload => ({
  orderId: 1, userId: 1, instrumentId: 47, side: 'BUY', type: 'MARKET', size: 10, price: 930.5, status: 'FILLED', ...over,
});

describe('eventEffect', () => {
  it('BUY descuenta pesos y suma acciones y costo', () => {
    expect(eventEffect(event({}))).toEqual({
      cashCents: -930_500,
      position: { instrumentId: 47, qty: 10, buyQty: 10, buyCostCents: 930_500 },
    });
  });

  it('SELL suma pesos y resta acciones sin tocar el costo de compra', () => {
    expect(eventEffect(event({ side: 'SELL', size: 4 }))).toEqual({
      cashCents: 372_200,
      position: { instrumentId: 47, qty: -4, buyQty: 0, buyCostCents: 0 },
    });
  });

  it('CASH_IN y CASH_OUT mueven solo pesos', () => {
    expect(eventEffect(event({ side: 'CASH_IN', instrumentId: 66, size: 1000, price: 1 }))).toEqual({ cashCents: 100_000 });
    expect(eventEffect(event({ side: 'CASH_OUT', instrumentId: 66, size: 1000, price: 1 }))).toEqual({ cashCents: -100_000 });
  });

  it.each(['NEW', 'REJECTED', 'CANCELLED'] as const)('una orden %s no tiene efecto', (status) => {
    expect(eventEffect(event({ status }))).toBeNull();
  });

  it('no acumula error de punto flotante en centavos', () => {
    expect(eventEffect(event({ size: 3, price: 0.1 }))?.cashCents).toBe(-30);
  });
});
