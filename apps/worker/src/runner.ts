import type { Db } from '@challenge/db';
import { ensureCursors, Handler, processNextAccount } from './claim';
import { listenOutbox, WakeSignal } from './wakeup';

export interface WorkerOptions {
  consumer: string;
  handler: Handler;
  listenUrl?: string;
  concurrency?: number;
  pollMs?: number;
  batch?: number;
}

const CURSOR_SYNC_MS = 30_000;

export async function startWorker(db: Db, options: WorkerOptions): Promise<() => Promise<void>> {
  const { consumer, handler, listenUrl, concurrency = 4, pollMs = 1000, batch = 100 } = options;
  const wake = new WakeSignal();
  let running = true;

  await ensureCursors(db, consumer);
  const cursorSync = setInterval(() => ensureCursors(db, consumer).catch(console.error), CURSOR_SYNC_MS);
  const stopListening = listenUrl ? await listenOutbox(listenUrl, () => wake.notify()) : undefined;

  const processPending = async () => {
    let processed = true;
    while (running && processed) {
      processed = await processNextAccount(db, consumer, handler, batch);
    }
  };

  const loop = async () => {
    while (running) {
      await processPending().catch((err) => console.error('worker error', err));
      if (running) await wake.wait(pollMs);
    }
  };
  const loops = Array.from({ length: concurrency }, loop);

  return async () => {
    running = false;
    wake.notify();
    clearInterval(cursorSync);
    await Promise.all(loops);
    await stopListening?.();
  };
}
