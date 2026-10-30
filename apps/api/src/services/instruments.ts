import type { Db } from '@challenge/db';
import { cached, createCache } from '../lib/cache';
import { numOrNull, pctChange } from '../lib/money';
import { INSTRUMENT_RANKING, LATEST_PRICE_JOIN } from './sql';

export interface InstrumentResult {
  id: number;
  ticker: string;
  name: string;
  type: string;
  lastPrice: number | null;
  dailyReturnPct: number | null;
}

interface InstrumentRow {
  id: number;
  ticker: string;
  name: string;
  type: string;
  close: string | null;
  previousclose: string | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const toInstrument = (row: InstrumentRow): InstrumentResult => ({
  id: row.id,
  ticker: row.ticker,
  name: row.name,
  type: row.type,
  lastPrice: numOrNull(row.close),
  dailyReturnPct: pctChange(numOrNull(row.close), numOrNull(row.previousclose)),
});

const SEARCH_LIMIT = 50;
const SEARCH_CACHE_TTL_SECONDS = 60;
const searchCache = createCache(SEARCH_CACHE_TTL_SECONDS);

export const searchInstruments = (db: Db, q: string): Promise<InstrumentResult[]> =>
  cached(searchCache, q, () => findInstruments(db, q));

// see migration instruments_trigram_search).
export const instrumentSearchQuery = (db: Db, q: string) =>
  db
    .from('instruments as i')
    .joinRaw(LATEST_PRICE_JOIN, ['i.id'])
    .whereNot('i.type', 'MONEDA')
    .andWhere((w) => w.whereILike('i.ticker', `%${escapeLike(q)}%`).orWhereILike('i.name', `%${escapeLike(q)}%`))
    .orderByRaw(INSTRUMENT_RANKING, [q, `${escapeLike(q)}%`])
    .limit(SEARCH_LIMIT)
    .select('i.id', 'i.ticker', 'i.name', 'i.type', 'm.close', 'm.previousclose');

const findInstruments = async (db: Db, q: string): Promise<InstrumentResult[]> =>
  (await instrumentSearchQuery(db, q)).map(toInstrument);
