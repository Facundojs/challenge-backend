import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEvents, emit, lockAccount, toOutboxEvent } from '@challenge/db';
import { createTestDb, seedCash, TestDb } from '@challenge/db/src/testing';
import { ensureCursors, processNextAccount } from '../src/claim';
import { projectionHandler } from '../src/handlers';

let db: TestDb;
// Oráculo: el mismo resultado calculado agregando `orders`, sin pasar por la proyección.
const ORACLE_BALANCES = `
  SELECT userid AS user_id,
         SUM(CASE side WHEN 'CASH_IN' THEN size WHEN 'CASH_OUT' THEN -size
                       WHEN 'SELL' THEN size * price WHEN 'BUY' THEN -size * price END) AS available
  FROM orders WHERE status = 'FILLED' GROUP BY userid ORDER BY userid`;
const ORACLE_POSITIONS = `
  SELECT userid AS user_id, instrumentid AS instrument_id,
         SUM(CASE side WHEN 'BUY' THEN size ELSE -size END) AS quantity,
         SUM(CASE WHEN side = 'BUY' THEN size ELSE 0 END) AS buy_quantity,
         SUM(CASE WHEN side = 'BUY' THEN size * price ELSE 0 END) AS buy_cost
  FROM orders WHERE status = 'FILLED' AND side IN ('BUY', 'SELL') GROUP BY 1, 2 ORDER BY 1, 2`;

beforeAll(async () => {
  db = await createTestDb();
  await seedCash(db.db, 1, 1_000_000);
});
afterAll(async () => { await db.drop(); });

// Escritor mínimo: la orden y su evento van en la misma tx, como en la API.
const place = (userId: number, side: string, instrumentId: number, size: number, price: number, status = 'FILLED') =>
  db.db.transaction(async (trx) => {
    await lockAccount(trx, userId);
    const [o] = await trx('orders')
      .insert({ instrumentid: instrumentId, userid: userId, size, price, type: 'MARKET', side, status, datetime: trx.fn.now() })
      .returning('*');
    await emit(trx, userId, status === 'FILLED' ? 'order.filled' : 'order.rejected', {
      orderId: o.id, userId, instrumentId, side: side as 'BUY', type: 'MARKET', size, price, status: status as 'FILLED',
    });
  });

const drain = async () => {
  await ensureCursors(db.db, 'projector');
  let processed = true;
  while (processed) processed = await processNextAccount(db.db, 'projector', projectionHandler);
};

const snapshot = async () => ({
  balances: (await db.db('account_balance').orderBy('user_id').select('user_id', 'available', 'last_seq')).map((r) => ({ ...r, available: Number(r.available), last_seq: Number(r.last_seq) })),
  positions: (await db.db('positions').orderBy(['user_id', 'instrument_id']).select('user_id', 'instrument_id', 'quantity', 'buy_quantity', 'buy_cost')).map((r) => ({ ...r, buy_cost: Number(r.buy_cost) })),
});

describe('proyección desde el outbox', () => {
  it('converge al mismo resultado que agregar orders', async () => {
    await place(1, 'BUY', 1, 10, 100);
    await place(1, 'BUY', 1, 5, 110);
    await place(1, 'SELL', 1, 4, 120);
    await place(1, 'BUY', 2, 3, 50);
    await place(1, 'BUY', 2, 9999, 50, 'REJECTED');
    await place(1, 'CASH_OUT', 66, 1000, 1);
    await place(2, 'CASH_IN', 66, 5000, 1);
    await place(2, 'BUY', 2, 20, 50);

    await drain();
    const projected = await snapshot();

    // user 1: 1.000.000 - 1.000 - 550 + 480 - 150 - 1.000 (7 eventos con la carga inicial); user 2: 5.000 - 1.000
    expect(projected.balances).toEqual([
      { user_id: 1, available: 997_780, last_seq: 7 },
      { user_id: 2, available: 4_000, last_seq: 2 },
    ]);
    expect(projected.positions).toContainEqual({ user_id: 1, instrument_id: 1, quantity: 11, buy_quantity: 15, buy_cost: 1_550 });

    const oracleBalances = (await db.db.raw(ORACLE_BALANCES)).rows.map((r: any) => ({ user_id: r.user_id, available: Number(r.available) }));
    const oraclePositions = (await db.db.raw(ORACLE_POSITIONS)).rows.map((r: any) => ({ ...r, quantity: Number(r.quantity), buy_quantity: Number(r.buy_quantity), buy_cost: Number(r.buy_cost) }));
    expect(projected.balances.map(({ user_id, available }) => ({ user_id, available }))).toEqual(oracleBalances);
    expect(projected.positions).toEqual(oraclePositions);
  });

  it('es idempotente: reaplicar los mismos eventos no cambia nada', async () => {
    const before = await snapshot();
    const events = (await db.db('outbox').where({ aggregate_id: 1 }).orderBy('seq')).map(toOutboxEvent);
    await db.db.transaction((trx) => applyEvents(trx, 1, events));
    expect(await snapshot()).toEqual(before);
  });

  it('falla si falta un evento en lugar de corromper el saldo', async () => {
    const [last] = (await db.db('outbox').where({ aggregate_id: 1 }).orderBy('seq', 'desc').limit(1)).map(toOutboxEvent);
    await expect(db.db.transaction((trx) => applyEvents(trx, 1, [{ ...last, seq: last.seq + 2 }]))).rejects.toThrow(/Hueco/);
  });
});
