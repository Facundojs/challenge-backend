import { join } from 'node:path';
import knex, { Knex } from 'knex';

export type Db = Knex;
export type Tx = Knex.Transaction;

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export function loadEnv(): void {
  try { process.loadEnvFile(join(__dirname, '..', '..', '..', '.env')); } catch { console.warn('No .env file found'); }
}

interface CreateDbOptions {
  poolMax?: number;
  searchPath?: string[];
}

export function createDb(connectionString: string, { poolMax = 10, searchPath }: CreateDbOptions = {}): Db {
  return knex({
    client: 'pg',
    connection: connectionString,
    pool: { min: 0, max: poolMax },
    searchPath,
    migrations: { directory: MIGRATIONS_DIR },
  });
}

export async function migrate(db: Db): Promise<void> {
  await db.migrate.latest();
}

export { lockAccount, emit, toOutboxEvent } from './outbox';
export { applyEvents, eventEffect, getAccountState } from './projection';
