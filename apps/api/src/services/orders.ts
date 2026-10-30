import { emit, getAccountState, lockAccount } from '@challenge/db';
import type { Db, Tx } from '@challenge/db';
import type { OrderEventPayload, OrderSide, OrderStatus, OrderType, OutboxEventType } from '@challenge/contracts';
import { conflict, invalid, notFound } from '../lib/errors';
import { deriveKey } from '../lib/idempotency';
import { cents, num, round2, sharesFor } from '../lib/money';
import { latestClose } from './market';

export interface PlaceOrderInput {
  userId: number;
  instrumentId: number;
  side: 'BUY' | 'SELL';
  type: OrderType;
  size?: number;
  amount?: number;
  price?: number;
  /** Header Idempotency-Key ya normalizado. Sin él no hay deduplicación. */
  idempotencyKey?: string;
}

export interface Order {
  id: number;
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: number;
  status: OrderStatus;
  rejectionReason?: string;
  datetime: string;
}

export interface PlaceOrderResult {
  order: Order;
  /** true si la orden ya existía para esa Idempotency-Key. */
  replayed: boolean;
}

type PlacedStatus = 'NEW' | 'FILLED' | 'REJECTED';

interface Terms {
  price: number;
  size: number;
}

interface Verdict {
  status: PlacedStatus;
  rejectionReason?: string;
}

const EVENT_BY_STATUS: Record<PlacedStatus, OutboxEventType> = {
  NEW: 'order.new',
  FILLED: 'order.filled',
  REJECTED: 'order.rejected',
};

// Una sola tx bajo el lock de la cuenta. Los errores de validación hacen rollback;
// los rechazos de negocio (sin pesos / sin acciones) se guardan como REJECTED.
export async function placeOrder(db: Db, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const idempotencyKey = input.idempotencyKey ? deriveKey(input.userId, input.idempotencyKey) : null;

  return db.transaction(async (trx) => {
    if (!(await lockAccount(trx, input.userId))) throw notFound('Usuario');

    // El lock serializa los reintentos concurrentes de una cuenta: el segundo ve la orden del primero.
    const replay = idempotencyKey && (await findByKey(trx, idempotencyKey, input.userId));
    if (replay) return { order: replay, replayed: true };

    const terms = await resolveTerms(trx, input);
    const verdict = await checkFunds(trx, input, terms);
    const order = await insertOrder(trx, input, terms, verdict, idempotencyKey);
    await emit(trx, input.userId, EVENT_BY_STATUS[verdict.status], toEventPayload(order));
    return { order, replayed: false };
  });
}

async function findByKey(trx: Tx, idempotencyKey: string, userId: number): Promise<Order | null> {
  const row = await trx('orders').where({ idempotency_key: idempotencyKey }).first();
  if (!row) return null;
  if (row.userid !== userId) throw conflict('Idempotency-Key en conflicto');
  return toOrder(row);
}

// Precio y cantidad de la orden; valida instrumento, precio de mercado y monto.
async function resolveTerms(trx: Tx, input: PlaceOrderInput): Promise<Terms> {
  const instrument = await trx('instruments').where({ id: input.instrumentId }).first('type');
  if (!instrument) throw notFound('Instrumento');
  if (instrument.type !== 'ACCIONES') throw invalid('Solo se puede operar instrumentos de tipo ACCIONES');

  const price = input.type === 'LIMIT' ? input.price! : await latestClose(trx, input.instrumentId);
  if (price === null) throw invalid('El instrumento no tiene precio de mercado');

  const size = input.size ?? sharesFor(input.amount!, price);
  if (size < 1) throw invalid('El monto no alcanza para comprar al menos 1 acción');
  return { price, size };
}

// Proyección + eventos pendientes de proyectar, bajo el lock de la cuenta: no se puede sobregirar
// aunque el worker vaya atrasado.
async function checkFunds(trx: Tx, input: PlaceOrderInput, { price, size }: Terms): Promise<Verdict> {
  const accepted: Verdict = { status: input.type === 'MARKET' ? 'FILLED' : 'NEW' };
  const state = await getAccountState(trx, input.userId, input.instrumentId);
  if (!state) throw notFound('Usuario');

  if (input.side === 'BUY' && cents(size * price) > state.availableCents) {
    return { status: 'REJECTED', rejectionReason: `Pesos insuficientes: necesita ${round2(size * price)}, disponible ${state.availableCents / 100}` };
  }
  if (input.side === 'SELL' && size > state.held) {
    return { status: 'REJECTED', rejectionReason: `Acciones insuficientes: intenta vender ${size}, tiene ${state.held}` };
  }
  return accepted;
}

async function insertOrder(trx: Tx, input: PlaceOrderInput, { price, size }: Terms, verdict: Verdict, idempotencyKey: string | null): Promise<Order> {
  const [row] = await trx('orders')
    .insert({
      instrumentid: input.instrumentId,
      userid: input.userId,
      size,
      price,
      type: input.type,
      side: input.side,
      status: verdict.status,
      datetime: trx.fn.now(),
      idempotency_key: idempotencyKey,
      rejection_reason: verdict.rejectionReason ?? null,
    })
    .returning('*');
  return toOrder(row);
}

const toOrder = (row: any): Order => ({
  id: row.id,
  userId: row.userid,
  instrumentId: row.instrumentid,
  side: row.side,
  type: row.type,
  size: row.size,
  price: num(row.price),
  status: row.status,
  ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
  datetime: new Date(row.datetime).toISOString(),
});

const toEventPayload = (order: Order): OrderEventPayload => ({
  orderId: order.id,
  userId: order.userId,
  instrumentId: order.instrumentId,
  side: order.side,
  type: order.type,
  size: order.size,
  price: order.price,
  status: order.status,
  ...(order.rejectionReason ? { rejectionReason: order.rejectionReason } : {}),
});
