// Modelo provisto. Con hasTable, solo actúa sobre una DB vacía (local, tests).

/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email');
      t.string('accountnumber');
    });
  }
  if (!(await knex.schema.hasTable('instruments'))) {
    await knex.schema.createTable('instruments', (t) => {
      t.increments('id');
      t.string('ticker');
      t.string('name');
      t.string('type');
    });
  }
  if (!(await knex.schema.hasTable('orders'))) {
    await knex.schema.createTable('orders', (t) => {
      t.increments('id');
      t.integer('instrumentid').references('id').inTable('instruments');
      t.integer('userid').references('id').inTable('users');
      t.integer('size');
      t.decimal('price', 10, 2);
      t.string('type');
      t.string('side');
      t.string('status');
      t.timestamp('datetime', { useTz: false });
    });
  }
  if (!(await knex.schema.hasTable('marketdata'))) {
    await knex.schema.createTable('marketdata', (t) => {
      t.increments('id');
      t.integer('instrumentid').references('id').inTable('instruments');
      t.decimal('high', 10, 2);
      t.decimal('low', 10, 2);
      t.decimal('open', 10, 2);
      t.decimal('close', 10, 2);
      t.decimal('previousclose', 10, 2);
      t.date('date');
    });
  }
};

exports.down = async () => {};
