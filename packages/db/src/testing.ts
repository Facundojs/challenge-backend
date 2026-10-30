import { randomBytes } from 'node:crypto';
import { applyEvents, createDb, Db, emit, loadEnv, lockAccount, migrate, toOutboxEvent } from './index';

loadEnv();

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
const ARS_INSTRUMENT_ID = 66;

const CREATE_SCHEMA = 'CREATE SCHEMA ??';
const DROP_SCHEMA = 'DROP SCHEMA ?? CASCADE';

export interface TestDb {
  db: Db;
  drop: () => Promise<void>;
}

// Schema descartable con las migraciones aplicadas y datos mínimos, sin tocar las tablas reales.
// Requiere conexión directa. Datos: usuarios 1 y 2 sin movimientos; AAA(1) close 100, BBB(2) close 50,
// SIN(3) sin marketdata, ARS(66) moneda.
export async function createTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error('Falta TEST_DATABASE_URL o DATABASE_URL_DIRECT');
  const schema = `test_${randomBytes(4).toString('hex')}`;

  const admin = createDb(TEST_DATABASE_URL, { poolMax: 1 });
  await admin.raw(CREATE_SCHEMA, [schema]);

  const db = createDb(TEST_DATABASE_URL, { poolMax: 20, searchPath: [schema] });
  await migrate(db);

  await db('users').insert([
    { id: 1, email: 'a@test.com', accountnumber: '10001' },
    { id: 2, email: 'b@test.com', accountnumber: '10002' },
  ]);
  await db('instruments').insert([
    { id: 1, ticker: 'AAA', name: 'Alpha S.A.', type: 'ACCIONES' },
    { id: 2, ticker: 'BBB', name: 'Beta Corp', type: 'ACCIONES' },
    { id: 3, ticker: 'SIN', name: 'Sin Precio', type: 'ACCIONES' },
    { id: ARS_INSTRUMENT_ID, ticker: 'ARS', name: 'PESOS', type: 'MONEDA' },
  ]);
  await db('marketdata').insert([
    { instrumentid: 1, high: 110, low: 90, open: 95, close: 98, previousclose: 96, date: '2023-07-13' },
    { instrumentid: 1, high: 110, low: 90, open: 95, close: 100, previousclose: 98, date: '2023-07-14' },
    { instrumentid: 2, high: 55, low: 45, open: 50, close: 50, previousclose: 48, date: '2023-07-14' },
  ]);

  return {
    db,
    drop: async () => {
      await db.destroy();
      await admin.raw(DROP_SCHEMA, [schema]);
      await admin.destroy();
    },
  };
}

// Aplica lo pendiente del outbox a la proyección, como lo haría el worker.
export async function projectAll(db: Db): Promise<void> {
  const accounts = await db('accounts').select('user_id');
  for (const { user_id } of accounts) {
    await db.transaction(async (trx) => {
      const projected = await trx('account_balance').where({ user_id }).first('last_seq');
      const pending = await trx('outbox').where('aggregate_id', user_id).andWhere('seq', '>', projected?.last_seq ?? 0).orderBy('seq');
      await applyEvents(trx, user_id, pending.map(toOutboxEvent));
    });
  }
}

// Carga pesos por el mismo camino que cualquier movimiento: orden + evento, y luego se proyecta.
export async function seedCash(db: Db, userId: number, amount: number): Promise<void> {
  await db.transaction(async (trx) => {
    await lockAccount(trx, userId);
    const [{ id }] = await trx('orders')
      .insert({ instrumentid: ARS_INSTRUMENT_ID, userid: userId, size: amount, price: 1, type: 'MARKET', side: 'CASH_IN', status: 'FILLED', datetime: trx.fn.now() })
      .returning('id');
    await emit(trx, userId, 'order.filled', {
      orderId: id, userId, instrumentId: ARS_INSTRUMENT_ID, side: 'CASH_IN', type: 'MARKET', size: amount, price: 1, status: 'FILLED',
    });
  });
  await projectAll(db);
}
