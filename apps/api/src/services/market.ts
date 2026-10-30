import type { Db, Tx } from '@challenge/db';

export async function latestClose(db: Db | Tx, instrumentId: number): Promise<number | null> {
  const row = await db('marketdata').where({ instrumentid: instrumentId }).orderBy('date', 'desc').first('close');
  return row && row.close !== null ? Number(row.close) : null;
}
