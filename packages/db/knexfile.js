const path = require('node:path');

try { process.loadEnvFile(path.join(__dirname, '..', '..', '.env')); } catch { /* sin .env */ }

module.exports = {
  client: 'pg',
  connection: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
  migrations: { directory: path.join(__dirname, 'migrations') },
};
