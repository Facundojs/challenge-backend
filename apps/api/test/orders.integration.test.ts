import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, projectAll, seedCash, TestDb } from '@challenge/db/src/testing';
import { createApp } from '../src/app';
import { instrumentSearchQuery } from '../src/services/instruments';

// Seed en packages/db/src/testing.ts
let db: TestDb;
let api: ReturnType<typeof request>;

beforeAll(async () => {
  db = await createTestDb();
  api = request(createApp(db.db));
  await seedCash(db.db, 1, 1_000_000);
});
afterAll(async () => { await db.drop(); });

const send = (body: object) => api.post('/orders').send(body);
// El portfolio lee la proyección: se aplica lo pendiente del outbox antes de consultarlo.
const portfolio = async (userId = 1) => {
  await projectAll(db.db);
  return (await api.get(`/users/${userId}/portfolio`)).body;
};
const cash = async (userId = 1) => (await portfolio(userId)).availableCash as number;

describe('POST /orders', () => {
  it('MARKET BUY por cantidad: FILLED al último close y descuenta pesos', async () => {
    const before = await cash();
    const res = await send({ userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', size: 10 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'FILLED', type: 'MARKET', size: 10, price: 100 });
    expect(await cash()).toBe(before - 1000);
  });

  it('por monto: compra el máximo de acciones enteras', async () => {
    const res = await send({ userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', amount: 1050 });
    expect(res.body).toMatchObject({ status: 'FILLED', size: 10, price: 100 }); // 10.5 -> 10
  });

  it('por monto insuficiente para 1 acción: 422 y no se guarda', async () => {
    const count = async () => (await db.db('orders').count({ n: '*' }).first())!.n;
    const before = await count();
    const res = await send({ userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', amount: 99 });
    expect(res.status).toBe(422);
    expect(await count()).toBe(before);
  });

  it('LIMIT queda NEW con el precio indicado y NO mueve pesos', async () => {
    const before = await cash();
    const res = await send({ userId: 1, instrumentId: 2, side: 'BUY', type: 'LIMIT', size: 5, price: 40 });
    expect(res.body).toMatchObject({ status: 'NEW', type: 'LIMIT', price: 40, size: 5 });
    expect(await cash()).toBe(before);
  });

  it('BUY sin pesos suficientes: REJECTED, queda grabada y no mueve pesos', async () => {
    const before = await cash();
    const res = await send({ userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', size: 1_000_000 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
    const row = await db.db('orders').where({ id: res.body.id }).first('status');
    expect(row!.status).toBe('REJECTED');
    expect(await cash()).toBe(before);
  });

  it('SELL sin acciones suficientes: REJECTED; con acciones: FILLED y suma pesos', async () => {
    const rejected = await send({ userId: 1, instrumentId: 2, side: 'SELL', type: 'MARKET', size: 1 });
    expect(rejected.body.status).toBe('REJECTED');

    const before = await cash();
    const sold = await send({ userId: 1, instrumentId: 1, side: 'SELL', type: 'MARKET', size: 5 });
    expect(sold.body).toMatchObject({ status: 'FILLED', size: 5, price: 100 });
    expect(await cash()).toBe(before + 500);
  });

  it('instrumento sin precio de mercado: 422 en MARKET', async () => {
    const res = await send({ userId: 1, instrumentId: 3, side: 'BUY', type: 'MARKET', size: 1 });
    expect(res.status).toBe(422);
  });

  it('no se opera la moneda ni usuarios/instrumentos inexistentes', async () => {
    expect((await send({ userId: 1, instrumentId: 66, side: 'BUY', type: 'MARKET', size: 1 })).status).toBe(422);
    expect((await send({ userId: 999, instrumentId: 1, side: 'BUY', type: 'MARKET', size: 1 })).status).toBe(404);
    expect((await send({ userId: 1, instrumentId: 999, side: 'BUY', type: 'MARKET', size: 1 })).status).toBe(404);
  });

  it.each([
    ['size y amount juntos', { size: 1, amount: 100 }],
    ['ni size ni amount', {}],
    ['LIMIT sin price', { size: 1, type: 'LIMIT' }],
    ['MARKET con price', { size: 1, price: 10 }],
    ['size fraccionario', { size: 1.5 }],
  ])('400 por request inválido: %s', async (_name, extra) => {
    const res = await send({ userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', ...extra });
    expect(res.status).toBe(400);
  });

  it('escribe un evento en el outbox con seq contiguo por orden', async () => {
    const rows = await db.db('outbox').where({ aggregate_id: 1 }).orderBy('seq').select('seq', 'type');
    expect(rows.length).toBeGreaterThan(3);
    rows.forEach((r, i) => expect(Number(r.seq)).toBe(i + 1));
  });
});

describe('proyección del portfolio', () => {
  it('es eventualmente consistente: no refleja la orden hasta que se proyecta', async () => {
    const before = await cash();
    await send({ userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', size: 1 });
    expect((await api.get('/users/1/portfolio')).body.availableCash).toBe(before);
    expect(await cash()).toBe(before - 100);
  });

  it('valida fondos contra la proyección más los eventos pendientes, sin esperar al worker', async () => {
    await db.db('users').insert({ id: 3, email: 'c@test.com', accountnumber: '10003' });
    await seedCash(db.db, 3, 1000);
    const first = await send({ userId: 3, instrumentId: 2, side: 'BUY', type: 'MARKET', size: 12 }); // $600
    const second = await send({ userId: 3, instrumentId: 2, side: 'BUY', type: 'MARKET', size: 12 }); // anterior sin proyectar
    expect(first.body.status).toBe('FILLED');
    expect(second.body.status).toBe('REJECTED');
  });
});

describe('concurrencia sobre una cuenta', () => {
  it('no permite sobregirar: 8 compras simultáneas que no entran todas', async () => {
    // Cuenta 2 con $1.000; cada compra vale $400 (8 acciones a $50) => solo 2 entran.
    await seedCash(db.db, 2, 1000);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => send({ userId: 2, instrumentId: 2, side: 'BUY', type: 'MARKET', size: 8 })),
    );
    const statuses = results.map((r) => r.body.status);
    expect(statuses.filter((s) => s === 'FILLED')).toHaveLength(2);
    expect(statuses.filter((s) => s === 'REJECTED')).toHaveLength(6);
    expect(await cash(2)).toBe(200);
  });
});

describe('GET /users/:id/portfolio y /instruments', () => {
  it('portfolio: total = pesos + valor de posiciones, con rendimiento', async () => {
    const body = await portfolio();
    const pos = body.positions.find((p: any) => p.ticker === 'AAA');
    expect(pos).toMatchObject({ lastPrice: 100, averageCost: 100, totalReturnPct: 0, dailyReturnPct: 2.04 });
    const positionsValue = body.positions.reduce((sum: number, p: any) => sum + p.marketValue, 0);
    expect(body.totalValue).toBeCloseTo(body.availableCash + positionsValue, 2);
  });

  it('búsqueda por ticker o nombre, sin mayúsculas y sin devolver la moneda', async () => {
    expect((await api.get('/instruments?q=aaa')).body.map((i: any) => i.ticker)).toEqual(['AAA']);
    expect((await api.get('/instruments?q=corp')).body.map((i: any) => i.ticker)).toEqual(['BBB']);
    expect((await api.get('/instruments?q=pesos')).body).toEqual([]);
    expect((await api.get('/instruments?q=%25')).body).toEqual([]); // el % no es comodín
    expect((await api.get('/instruments')).status).toBe(400);
  });
});

describe('índices de trigramas', () => {
  it('la consulta de búsqueda puede usar los índices de ticker y nombre', async () => {
    const query = instrumentSearchQuery(db.db, 'beta').toSQL();
    const plan = await db.db.transaction(async (trx) => {
      await trx.raw('SET LOCAL enable_seqscan = off'); // con 4 filas el planner elegiría seq scan
      const { rows } = await trx.raw(`EXPLAIN ${query.sql}`, query.bindings as never);
      return rows.map((r: any) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('instruments_ticker_trgm_idx');
    expect(plan).toContain('instruments_name_trgm_idx');
  });
});

describe('cache de búsqueda', () => {
  afterEach(() => vi.useRealTimers());

  it('comparte la entrada entre variantes de la misma query y expira a los 60 s', async () => {
    const first = (await api.get('/instruments?q=beta')).body;
    expect(first.map((i: any) => i.ticker)).toEqual(['BBB']);

    await db.db('instruments').where({ id: 2 }).update({ name: 'Renombrada' });
    expect((await api.get('/instruments?q=%20BETA%20')).body).toEqual(first); // misma entrada: trim + lowercase

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    expect((await api.get('/instruments?q=beta')).body).toEqual([]); // expiró y ve el cambio

    await db.db('instruments').where({ id: 2 }).update({ name: 'Beta Corp' });
  });
});
