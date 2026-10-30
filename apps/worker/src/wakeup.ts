import { Client } from 'pg';
import { OUTBOX_CHANNEL } from '@challenge/contracts';

// Permite a los loops dormir hasta un timeout o hasta que alguien llame a notify().
export class WakeSignal {
  private waiters = new Set<() => void>();

  wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, timeoutMs);
      this.waiters.add(wake);
    });
  }

  notify(): void {
    for (const wake of [...this.waiters]) wake();
  }
}

// Escucha los NOTIFY del outbox. Requiere conexión directa: PgBouncer no soporta LISTEN.
// Devuelve la función para cerrar la conexión.
export async function listenOutbox(url: string, onNotify: () => void): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: url });
  client.on('notification', onNotify);
  client.on('error', (err) => console.error('listener', err.message));
  await client.connect();
  await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
  return () => client.end();
}
