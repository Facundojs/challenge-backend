export const NOTIFY_OUTBOX = 'SELECT pg_notify(?, ?)';

export const LAST_PROJECTED_SEQ = 'COALESCE(b.last_seq, 0)';

export const UPSERT_BALANCE = `
  INSERT INTO account_balance (user_id, available, last_seq) VALUES (?, ?, ?)
  ON CONFLICT (user_id) DO UPDATE
    SET available = account_balance.available + EXCLUDED.available,
        last_seq = EXCLUDED.last_seq`;

export const UPSERT_POSITION = `
  INSERT INTO positions (user_id, instrument_id, quantity, buy_quantity, buy_cost) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (user_id, instrument_id) DO UPDATE
    SET quantity = positions.quantity + EXCLUDED.quantity,
        buy_quantity = positions.buy_quantity + EXCLUDED.buy_quantity,
        buy_cost = positions.buy_cost + EXCLUDED.buy_cost`;
