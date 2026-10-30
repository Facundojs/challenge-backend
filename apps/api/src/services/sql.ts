export const AVERAGE_COST = 'p.buy_cost / NULLIF(p.buy_quantity, 0) AS avg_cost';

export const INSTRUMENT_RANKING = '(upper(i.ticker) = upper(?)) DESC, (i.ticker ILIKE ?) DESC, i.ticker';

// Último precio de un instrumento (`??` es su columna de join). LATERAL lo busca por el índice
// (instrumentid, date) solo para los instrumentos de la consulta, sin recorrer todo marketdata.
export const LATEST_PRICE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT close, previousclose FROM marketdata
    WHERE instrumentid = ?? ORDER BY date DESC LIMIT 1
  ) m ON true`;
