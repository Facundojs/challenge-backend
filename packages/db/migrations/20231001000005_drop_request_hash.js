// Las bases que aplicaron una versión anterior de la migración de idempotencia tienen esta columna.
// Las demás no: por eso solo se elimina si existe.

/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  if (await knex.schema.hasColumn('orders', 'request_hash')) {
    await knex.schema.alterTable('orders', (t) => t.dropColumn('request_hash'));
  }
};

// La columna no vuelve a crearse.
exports.down = async () => {};
