export const ENSURE_CURSORS = `
  INSERT INTO account_cursor (consumer, account_id)
  SELECT ?, user_id FROM accounts
  ON CONFLICT DO NOTHING`;
