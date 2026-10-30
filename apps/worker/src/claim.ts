import { toOutboxEvent } from '@challenge/db';
import type { Db, Tx } from '@challenge/db';
import type { OutboxEvent } from '@challenge/contracts';
import { ENSURE_CURSORS } from './sql';

export type Handler = (events: OutboxEvent[], trx: Tx) => Promise<void>;

export async function ensureCursors(db: Db, consumer: string): Promise<void> {
  await db.raw(ENSURE_CURSORS, [consumer]);
}

// Reclama una cuenta con eventos pendientes y procesa hasta `batch` en orden de seq. El cursor avanza en
// la misma tx que el handler: si falla, se revierte y se reintenta. Devuelve false si no había trabajo.
export async function processNextAccount(db: Db, consumer: string, handler: Handler, batch = 100): Promise<boolean> {
  return db.transaction(async (trx) => {
    // SKIP LOCKED por cuenta, no por evento: preserva el orden dentro de la cuenta y deja el resto libre.
    const cursor = await trx('account_cursor as c')
      .join('accounts as a', 'a.user_id', 'c.account_id')
      .where('c.consumer', consumer)
      .andWhere('a.seq', '>', trx.ref('c.last_seq'))
      .orderBy('c.updated_at')
      .forUpdate('c')
      .skipLocked()
      .first('c.account_id', 'c.last_seq');
    if (!cursor) return false;

    const rows = await trx('outbox')
      .where('aggregate_id', cursor.account_id)
      .andWhere('seq', '>', cursor.last_seq)
      .orderBy('seq')
      .limit(batch);
    if (!rows.length) return false;

    const events = rows.map(toOutboxEvent);
    await handler(events, trx);
    await trx('account_cursor')
      .where({ consumer, account_id: cursor.account_id })
      .update({ last_seq: events[events.length - 1].seq, updated_at: trx.fn.now() });
    return true;
  });
}
