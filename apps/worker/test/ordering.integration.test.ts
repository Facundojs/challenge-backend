import { afterAll, beforeAll, expect, it } from 'vitest';
import { emit, lockAccount } from '@challenge/db';
import { createTestDb, TestDb } from '@challenge/db/src/testing';
import { startWorker } from '../src/runner';
import type { OutboxEvent } from '@challenge/contracts';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.drop(); });

const payload = (userId: number, n: number) => ({
  orderId: n, userId, instrumentId: 1, side: 'BUY' as const, type: 'MARKET' as const,
  size: 1, price: 1, status: 'FILLED' as const,
});

const publish = (userId: number, n: number) =>
  db.db.transaction(async (c) => {
    await lockAccount(c, userId);
    await emit(c, userId, 'order.filled', payload(userId, n));
  });

const N = 20;

it('procesa cada cuenta en orden de seq, en paralelo entre cuentas, sin duplicar', async () => {
  const seen: { account: number; seq: number; at: number }[] = [];
  const handler = async (events: OutboxEvent[]) => {
    for (const e of events) {
      seen.push({ account: e.aggregateId, seq: e.seq, at: performance.now() });
      if (e.aggregateId === 1) await new Promise((r) => setTimeout(r, 20));
    }
  };

  await Promise.all([
    ...Array.from({ length: N }, (_, i) => publish(1, i)),
    publish(2, 0),
  ]);

  const stop = await startWorker(db.db, { consumer: 't', handler, concurrency: 4, pollMs: 50, batch: 5 });
  const t0 = performance.now();
  while (seen.length < N + 1 && performance.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 25));
  await stop();

  const acc1 = seen.filter((s) => s.account === 1).map((s) => s.seq);
  expect(acc1).toEqual(Array.from({ length: N }, (_, i) => i + 1));

  const acc2 = seen.filter((s) => s.account === 2);
  expect(acc2).toHaveLength(1);

  // la cuenta 2 no espera a que termine la cuenta 1
  const lastOf1 = Math.max(...seen.filter((s) => s.account === 1).map((s) => s.at));
  expect(acc2[0].at).toBeLessThan(lastOf1);

  const cursors = await db.db('account_cursor').where({ consumer: 't' }).orderBy('account_id').select('account_id', 'last_seq');
  expect(cursors.map((r) => [r.account_id, Number(r.last_seq)])).toEqual([[1, N], [2, 1]]);
}, 90_000);
