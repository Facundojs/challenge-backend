const BACKFILL_ACCOUNTS = 'INSERT INTO accounts (user_id) SELECT id FROM users';

// Los usuarios nuevos reciben su cuenta automáticamente.
const CREATE_ACCOUNT_FUNCTION = `
  CREATE FUNCTION create_account_for_user() RETURNS trigger AS $$
  BEGIN
    INSERT INTO accounts (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`;
const CREATE_ACCOUNT_TRIGGER = `
  CREATE TRIGGER users_create_account AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_account_for_user()`;
const DROP_ACCOUNT_TRIGGER = 'DROP TRIGGER IF EXISTS users_create_account ON users';
const DROP_ACCOUNT_FUNCTION = 'DROP FUNCTION IF EXISTS create_account_for_user()';

const EPOCH = "'epoch'";

/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.createTable('accounts', (t) => {
    t.integer('user_id').primary().references('id').inTable('users');
    t.bigInteger('seq').notNullable().defaultTo(0);
  });
  await knex.raw(BACKFILL_ACCOUNTS);
  await knex.raw(CREATE_ACCOUNT_FUNCTION);
  await knex.raw(CREATE_ACCOUNT_TRIGGER);

  await knex.schema.createTable('outbox', (t) => {
    t.integer('aggregate_id').notNullable().references('user_id').inTable('accounts');
    t.bigInteger('seq').notNullable();
    t.text('type').notNullable();
    t.jsonb('payload').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['aggregate_id', 'seq']);
  });

  await knex.schema.createTable('account_cursor', (t) => {
    t.text('consumer').notNullable();
    t.integer('account_id').notNullable().references('user_id').inTable('accounts');
    t.bigInteger('last_seq').notNullable().defaultTo(0);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.raw(EPOCH));
    t.primary(['consumer', 'account_id']);
  });

  await knex.schema.alterTable('orders', (t) => t.index(['userid', 'status'], 'orders_user_status_idx'));
  await knex.schema.alterTable('marketdata', (t) => t.index(['instrumentid', 'date'], 'marketdata_instrument_date_idx'));
  await knex.schema.alterTable('instruments', (t) => t.index(['ticker'], 'instruments_ticker_idx'));
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.alterTable('instruments', (t) => t.dropIndex([], 'instruments_ticker_idx'));
  await knex.schema.alterTable('marketdata', (t) => t.dropIndex([], 'marketdata_instrument_date_idx'));
  await knex.schema.alterTable('orders', (t) => t.dropIndex([], 'orders_user_status_idx'));
  await knex.schema.dropTable('account_cursor');
  await knex.schema.dropTable('outbox');
  await knex.raw(DROP_ACCOUNT_TRIGGER);
  await knex.raw(DROP_ACCOUNT_FUNCTION);
  await knex.schema.dropTable('accounts');
};
