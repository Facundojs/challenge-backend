import { OUTBOX_CHANNEL, OrderEventPayload, OutboxEvent, OutboxEventType } from '@challenge/contracts';
import type { Tx } from './index';
import { NOTIFY_OUTBOX } from './sql';

// Lock de la cuenta hasta el COMMIT: serializa las escrituras de una misma cuenta.
// Devuelve false si la cuenta no existe.
export async function lockAccount(trx: Tx, userId: number): Promise<boolean> {
  const row = await trx('accounts').where({ user_id: userId }).forUpdate().first('user_id');
  return !!row;
}

// Asigna el próximo seq de la cuenta e inserta el evento. Requiere lockAccount en la misma tx: con el
// lock tomado, el seq n+1 no es visible antes que n y una tx que no emite no deja huecos.
export async function emit(trx: Tx, userId: number, type: OutboxEventType, payload: OrderEventPayload): Promise<void> {
  const [{ seq }] = await trx('accounts').where({ user_id: userId }).increment('seq', 1).returning('seq');
  await trx('outbox').insert({ aggregate_id: userId, seq, type, payload: JSON.stringify(payload) });
  await trx.raw(NOTIFY_OUTBOX, [OUTBOX_CHANNEL, String(userId)]);
}

export const toOutboxEvent = (row: { aggregate_id: number; seq: string | number; type: OutboxEventType; payload: OrderEventPayload }): OutboxEvent => ({
  aggregateId: row.aggregate_id,
  seq: Number(row.seq),
  type: row.type,
  payload: row.payload,
});
