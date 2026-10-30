// Proyección eventual por cuenta (pesos disponibles y posiciones), mantenida por el worker desde el outbox.

// Ninguna escritura de cuenta puede avanzar el seq mientras se calcula el backfill, así que
// last_seq = accounts.seq deja la proyección exactamente al día con orders.
const LOCK_ACCOUNTS = 'LOCK TABLE accounts IN SHARE MODE';

const BACKFILL_BALANCE = `
  INSERT INTO account_balance (user_id, available, last_seq)
  SELECT a.user_id,
         COALESCE(SUM(CASE o.side
           WHEN 'CASH_IN'  THEN o.size
           WHEN 'CASH_OUT' THEN -o.size
           WHEN 'SELL'     THEN o.size * o.price
           WHEN 'BUY'      THEN -o.size * o.price END), 0),
         a.seq
  FROM accounts a
  LEFT JOIN orders o ON o.userid = a.user_id AND o.status = 'FILLED'
  GROUP BY a.user_id, a.seq`;

const BACKFILL_POSITIONS = `
  INSERT INTO positions (user_id, instrument_id, quantity, buy_quantity, buy_cost)
  SELECT o.userid, o.instrumentid,
         SUM(CASE o.side WHEN 'BUY' THEN o.size ELSE -o.size END),
         SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE 0 END),
         SUM(CASE WHEN o.side = 'BUY' THEN o.size * o.price ELSE 0 END)
  FROM orders o JOIN accounts a ON a.user_id = o.userid
  WHERE o.status = 'FILLED' AND o.side IN ('BUY', 'SELL')
  GROUP BY o.userid, o.instrumentid`;

const ACCOUNT_FUNCTION_WITH_BALANCE = `
  CREATE OR REPLACE FUNCTION create_account_for_user() RETURNS trigger AS $$
  BEGIN
    INSERT INTO accounts (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO account_balance (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`;
const ACCOUNT_FUNCTION_WITHOUT_BALANCE = `
  CREATE OR REPLACE FUNCTION create_account_for_user() RETURNS trigger AS $$
  BEGIN
    INSERT INTO accounts (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`;

/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('account_balance', (t) => {
    t.integer('user_id').primary().references('user_id').inTable('accounts');
    t.decimal('available', 18, 2).notNullable().defaultTo(0);
    // Último seq del outbox ya aplicado. Va en la misma fila que `available` para leerlos atómicamente.
    t.bigInteger('last_seq').notNullable().defaultTo(0);
  });
  await knex.schema.createTable('positions', (t) => {
    t.integer('user_id').notNullable().references('user_id').inTable('accounts');
    t.integer('instrument_id').notNullable().references('id').inTable('instruments');
    t.integer('quantity').notNullable().defaultTo(0);
    t.integer('buy_quantity').notNullable().defaultTo(0);
    t.decimal('buy_cost', 18, 2).notNullable().defaultTo(0);
    t.primary(['user_id', 'instrument_id']);
  });

  await knex.raw(LOCK_ACCOUNTS);
  await knex.raw(BACKFILL_BALANCE);
  await knex.raw(BACKFILL_POSITIONS);
  await knex.raw(ACCOUNT_FUNCTION_WITH_BALANCE);
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.raw(ACCOUNT_FUNCTION_WITHOUT_BALANCE);
  await knex.schema.dropTable('positions');
  await knex.schema.dropTable('account_balance');
};
