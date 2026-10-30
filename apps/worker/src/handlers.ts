import { applyEvents } from '@challenge/db';
import type { Handler } from './claim';

// Proyecta los eventos de una cuenta a account_balance y positions, dentro de la tx que avanza el cursor.
export const projectionHandler: Handler = (events, trx) => applyEvents(trx, events[0].aggregateId, events);
