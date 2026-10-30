export type OrderSide = 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';

export interface OrderEventPayload {
  orderId: number;
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: number;
  status: OrderStatus;
  rejectionReason?: string;
}

export type OutboxEventType = 'order.new' | 'order.filled' | 'order.rejected';

// seq es contiguo por cuenta y se asigna bajo su lock: orden de seq == orden de commit.
export interface OutboxEvent {
  aggregateId: number;
  seq: number;
  type: OutboxEventType;
  payload: OrderEventPayload;
}

export const OUTBOX_CHANNEL = 'outbox';
