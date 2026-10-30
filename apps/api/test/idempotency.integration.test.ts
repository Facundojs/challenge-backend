import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, seedCash, TestDb } from '@challenge/db/src/testing';
import { createApp } from '../src/app';

const EVENTS_OF_ORDER = "payload->>'orderId' = ?";

let db: TestDb;
let api: ReturnType<typeof request>;

beforeAll(async () => {
  db = await createTestDb();
  api = request(createApp(db.db));
  await seedCash(db.db, 1, 1_000_000);
  await seedCash(db.db, 2, 1_000_000);
});
afterAll(async () => { await db.drop(); });

const buy = (body: object = {}, key?: string, userId = 1) => {
  const req = api.post('/orders');
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send({ userId, instrumentId: 1, side: 'BUY', type: 'MARKET', size: 10, ...body });
};
const orderCount = async (userId = 1) => Number((await db.db('orders').where({ userid: userId }).count({ n: '*' }).first())!.n);

describe('POST /orders con Idempotency-Key', () => {
  it('un reintento devuelve la orden original (200) sin duplicar orden, pesos ni evento', async () => {
    const before = await orderCount();
    const first = await buy({}, 'retry-1');
    const second = await buy({}, 'retry-1');

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await orderCount()).toBe(before + 1);

    const events = await db.db('outbox').whereRaw(EVENTS_OF_ORDER, [String(first.body.id)]);
    expect(events).toHaveLength(1);
  });

  it('un REJECTED también es idempotente y conserva el motivo', async () => {
    const first = await buy({ size: 1_000_000 }, 'rejected-1');
    const second = await buy({ size: 1_000_000 }, 'rejected-1');
    expect(first.body.status).toBe('REJECTED');
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.rejectionReason).toMatch(/Pesos insuficientes/);
  });

  it('la misma key con otro contenido devuelve la orden original: el contenido no se compara', async () => {
    const first = await buy({ size: 10 }, 'reused-1');
    const before = await orderCount();
    const second = await buy({ size: 11 }, 'reused-1');
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await orderCount()).toBe(before);
  });

  it('la misma key de dos usuarios son dos órdenes distintas', async () => {
    const a = await buy({}, 'shared-key', 1);
    const b = await buy({}, 'shared-key', 2);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('reintentos concurrentes crean una sola orden', async () => {
    const before = await orderCount();
    const results = await Promise.all(Array.from({ length: 6 }, () => buy({}, 'concurrent-1')));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await orderCount()).toBe(before + 1);
  });

  it('trim se ignora; el casing distingue', async () => {
    const first = await buy({}, 'trim-key');
    const padded = await buy({}, '  trim-key  ');
    const upper = await buy({}, 'TRIM-KEY');
    expect(padded.status).toBe(200);
    expect(padded.body.id).toBe(first.body.id);
    expect(upper.status).toBe(201);
    expect(upper.body.id).not.toBe(first.body.id);
  });

  it.each([['vacía', ''], ['con espacios internos', 'a b'], ['demasiado larga', 'x'.repeat(256)]])('400 con key %s', async (_n, key) => {
    expect((await buy({}, key)).status).toBe(400);
  });

  it('sin header no hay deduplicación', async () => {
    const before = await orderCount();
    await buy();
    await buy();
    expect(await orderCount()).toBe(before + 2);
  });

  it('los reintentos no dejan huecos en el seq del outbox', async () => {
    const { seq } = (await db.db('accounts').where({ user_id: 1 }).first('seq'))!;
    const events = await db.db('outbox').where({ aggregate_id: 1 }).orderBy('seq').select('seq');
    expect(events.map((e) => Number(e.seq))).toEqual(Array.from({ length: events.length }, (_, i) => i + 1));
    expect(Number(seq)).toBe(events.length);
  });
});
