import { createDb, loadEnv } from '@challenge/db';
import { projectionHandler } from './handlers';
import { startWorker } from './runner';

loadEnv();

// Conexión directa: el pooler no soporta LISTEN.
const url = process.env.DATABASE_URL_DIRECT;
if (!url) throw new Error('Falta DATABASE_URL_DIRECT');

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
const db = createDb(url, { poolMax: concurrency + 1 });

startWorker(db, { consumer: 'projector', handler: projectionHandler, listenUrl: url, concurrency }).then((stop) => {
  console.log(`worker listo (concurrency=${concurrency})`);
  const shutdown = async () => {
    await stop();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
