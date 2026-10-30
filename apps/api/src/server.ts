import { createDb, loadEnv } from '@challenge/db';
import { createApp } from './app';

loadEnv();

const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
if (!url) throw new Error('Falta DATABASE_URL');

const db = createDb(url, { poolMax: 10 });
const port = Number(process.env.PORT ?? 3000);
createApp(db).listen(port, () => console.log(`api escuchando en :${port}`));
