// Índices de trigramas para la búsqueda de instrumentos por substring (ILIKE '%q%').
// Aceleran términos de 3 o más caracteres; con menos, Postgres hace seq scan.

// CREATE EXTENSION IF NOT EXISTS no es seguro ante migraciones simultáneas: el lock las serializa.
const LOCK_EXTENSION = "SELECT pg_advisory_xact_lock(hashtext('create_extension_pg_trgm'))";

// SCHEMA public: la extensión es de toda la base, no del schema de la migración (los tests usan uno propio).
const CREATE_EXTENSION = 'CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public';

// La clase de operador se califica con el schema donde está instalada la extensión.
const EXTENSION_SCHEMA = `
  SELECT n.nspname AS schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm'`;

const createIndex = (name, column, schema) =>
  `CREATE INDEX ${name} ON instruments USING gin (${column} ${schema}.gin_trgm_ops)`;

const DROP_TICKER_INDEX = 'DROP INDEX IF EXISTS instruments_ticker_trgm_idx';
const DROP_NAME_INDEX = 'DROP INDEX IF EXISTS instruments_name_trgm_idx';

/** @param {import('knex').Knex} knex */
exports.up = async (knex) => {
  await knex.raw(LOCK_EXTENSION);
  await knex.raw(CREATE_EXTENSION);
  const { rows } = await knex.raw(EXTENSION_SCHEMA);
  const schema = `"${rows[0].schema}"`;
  await knex.raw(createIndex('instruments_ticker_trgm_idx', 'ticker', schema));
  await knex.raw(createIndex('instruments_name_trgm_idx', 'name', schema));
};

// La extensión se deja instalada: es de toda la base y otros objetos podrían usarla.
/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.raw(DROP_TICKER_INDEX);
  await knex.raw(DROP_NAME_INDEX);
};
