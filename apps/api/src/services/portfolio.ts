import type { Db } from '@challenge/db';
import { notFound } from '../lib/errors';
import { num, numOrNull, pctChange, round2 } from '../lib/money';
import { AVERAGE_COST, LATEST_PRICE_JOIN } from './sql';

export interface Position {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
  averageCost: number;
  lastPrice: number | null;
  marketValue: number | null;
  totalReturnPct: number | null;
  dailyReturnPct: number | null;
}

export interface Portfolio {
  userId: number;
  totalValue: number;
  availableCash: number;
  positions: Position[];
}

interface PositionRow {
  id: number;
  ticker: string;
  name: string;
  qty: number;
  avg_cost: string | null;
  close: string | null;
  previousclose: string | null;
}

export function toPosition(row: PositionRow): Position {
  const quantity = num(row.qty);
  const averageCost = num(row.avg_cost);
  const lastPrice = numOrNull(row.close);
  return {
    instrumentId: row.id,
    ticker: row.ticker,
    name: row.name,
    quantity,
    averageCost: round2(averageCost),
    lastPrice,
    marketValue: lastPrice === null ? null : round2(quantity * lastPrice),
    totalReturnPct: pctChange(lastPrice, averageCost),
    dailyReturnPct: pctChange(lastPrice, numOrNull(row.previousclose)),
  };
}

export async function getPortfolio(db: Db, userId: number): Promise<Portfolio> {
  if (!(await db('users').where({ id: userId }).first('id'))) throw notFound('Usuario');

  // Proyección que mantiene el worker: eventualmente consistente con `orders`.
  const [balance, rows] = await Promise.all([
    db('account_balance').where({ user_id: userId }).first('available'),
    db
      .from('positions as p')
      .join('instruments as i', 'i.id', 'p.instrument_id')
      .joinRaw(LATEST_PRICE_JOIN, ['p.instrument_id'])
      .where('p.user_id', userId)
      .andWhere('p.quantity', '>', 0)
      .select('i.id', 'i.ticker', 'i.name', 'p.quantity as qty', 'm.close', 'm.previousclose')
      .select(db.raw(AVERAGE_COST))
      .orderBy('i.ticker'),
  ]);

  const positions = rows.map(toPosition);
  const availableCash = round2(num(balance?.available));
  const totalValue = round2(availableCash + positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0));
  return { userId, totalValue, availableCash, positions };
}
