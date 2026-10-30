import type { OrderEventPayload, OutboxEvent } from '@challenge/contracts';
import type { Tx } from './index';
import { LAST_PROJECTED_SEQ, UPSERT_BALANCE, UPSERT_POSITION } from './sql';

interface PositionEffect {
  instrumentId: number;
  qty: number;
  buyQty: number;
  buyCostCents: number;
}

export interface Effect {
  cashCents: number;
  position?: PositionEffect;
}

export interface AccountState {
  availableCents: number;
  /** Acciones del instrumento consultado, incluyendo eventos aún sin proyectar. */
  held: number;
}

const toCents = (v: number | string): number => Math.round(Number(v) * 100);
const fromCents = (c: number): string => (c / 100).toFixed(2);

// Solo las órdenes FILLED mueven pesos y posiciones.
export function eventEffect(p: OrderEventPayload): Effect | null {
  if (p.status !== 'FILLED') return null;
  const cents = toCents(p.size * p.price);
  switch (p.side) {
    case 'CASH_IN': return { cashCents: cents };
    case 'CASH_OUT': return { cashCents: -cents };
    case 'BUY': return { cashCents: -cents, position: { instrumentId: p.instrumentId, qty: p.size, buyQty: p.size, buyCostCents: cents } };
    case 'SELL': return { cashCents: cents, position: { instrumentId: p.instrumentId, qty: -p.size, buyQty: 0, buyCostCents: 0 } };
  }
}

// Aplica los eventos de una cuenta a la proyección. Idempotente: ignora lo ya aplicado (seq <= last_seq)
// y falla si falta un seq, para no corromper el saldo en silencio.
export async function applyEvents(trx: Tx, userId: number, events: OutboxEvent[]): Promise<void> {
  const row = await trx('account_balance').where({ user_id: userId }).forUpdate().first('last_seq');
  const applied = row ? Number(row.last_seq) : 0;
  const fresh = events.filter((e) => e.seq > applied);
  if (!fresh.length) return;
  if (fresh[0].seq !== applied + 1) throw new Error(`Hueco en el outbox de la cuenta ${userId}: aplicado ${applied}, llegó ${fresh[0].seq}`);

  let cashCents = 0;
  const positions = new Map<number, Omit<PositionEffect, 'instrumentId'>>();
  for (const event of fresh) {
    const effect = eventEffect(event.payload);
    if (!effect) continue;
    cashCents += effect.cashCents;
    if (!effect.position) continue;
    const { instrumentId, ...delta } = effect.position;
    const total = positions.get(instrumentId) ?? { qty: 0, buyQty: 0, buyCostCents: 0 };
    positions.set(instrumentId, {
      qty: total.qty + delta.qty,
      buyQty: total.buyQty + delta.buyQty,
      buyCostCents: total.buyCostCents + delta.buyCostCents,
    });
  }

  await trx.raw(UPSERT_BALANCE, [userId, fromCents(cashCents), fresh[fresh.length - 1].seq]);
  for (const [instrumentId, p] of positions) {
    await trx.raw(UPSERT_POSITION, [userId, instrumentId, p.qty, p.buyQty, fromCents(p.buyCostCents)]);
  }
}

// Estado fuerte para validar una orden: proyección + eventos pendientes (seq > last_seq). Una sola
// consulta, así saldo y last_seq salen del mismo snapshot. Devuelve null si la cuenta no existe.
export async function getAccountState(trx: Tx, userId: number, instrumentId: number): Promise<AccountState | null> {
  const rows = await trx('accounts as a')
    .leftJoin('account_balance as b', 'b.user_id', 'a.user_id')
    .leftJoin('positions as p', (join) => join.on('p.user_id', 'a.user_id').andOnVal('p.instrument_id', '=', instrumentId))
    .leftJoin('outbox as o', (join) => join.on('o.aggregate_id', 'a.user_id').andOn('o.seq', '>', trx.raw(LAST_PROJECTED_SEQ)))
    .where('a.user_id', userId)
    .select('b.available as available', 'p.quantity as quantity', 'o.payload as payload');
  if (!rows.length) return null;

  let availableCents = toCents(rows[0].available ?? 0);
  let held = Number(rows[0].quantity ?? 0);
  for (const { payload } of rows) {
    const effect = payload ? eventEffect(payload) : null;
    if (!effect) continue;
    availableCents += effect.cashCents;
    if (effect.position?.instrumentId === instrumentId) held += effect.position.qty;
  }
  return { availableCents, held };
}
