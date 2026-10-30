// Parcial: las órdenes sin key (todas las históricas) no ocupan lugar en el índice.
const CREATE_KEY_INDEX = `
  CREATE UNIQUE INDEX orders_idempotency_key_uidx ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL`;
const DROP_KEY_INDEX = 'DROP INDEX IF EXISTS orders_idempotency_key_uidx';

/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.schema.alterTable('orders', (t) => {
    t.uuid('idempotency_key');
    t.text('rejection_reason');
  });
  await knex.raw(CREATE_KEY_INDEX);
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.raw(DROP_KEY_INDEX);
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('idempotency_key');
    t.dropColumn('rejection_reason');
  });
};
