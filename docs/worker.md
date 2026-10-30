# Worker

Proceso que consume el outbox y mantiene `account_balance` y `positions`. Código en `apps/worker/src` y
`packages/db/src/projection.ts`.

## Eventos

Cada orden emite un evento en la misma transacción que la inserta.

| Tipo | Se emite cuando | Efecto en la proyección |
|---|---|---|
| `order.filled` | La orden queda `FILLED` | Mueve pesos y posición |
| `order.new` | Una LIMIT queda `NEW` | Ninguno; avanza `last_seq` |
| `order.rejected` | La orden queda `REJECTED` | Ninguno; avanza `last_seq` |

Efecto de una orden `FILLED`:

| `side` | Pesos | Posición |
|---|---|---|
| `BUY` | `-size * price` | `quantity += size`, `buy_quantity += size`, `buy_cost += size * price` |
| `SELL` | `+size * price` | `quantity -= size` |
| `CASH_IN` | `+size * price` | Ninguna |
| `CASH_OUT` | `-size * price` | Ninguna |

Los importes se calculan en centavos enteros para no acumular error de punto flotante.

## Algoritmo

Una transacción por cuenta (`processNextAccount`):

1. Reclama una cuenta con eventos pendientes (`accounts.seq > account_cursor.last_seq`), la procesada hace más
   tiempo, con `FOR UPDATE SKIP LOCKED` sobre su cursor.
2. Lee sus eventos con `seq > last_seq`, en orden y hasta `batch`.
3. `applyEvents` bloquea la fila de `account_balance`, descarta lo ya aplicado (`seq <= last_seq`), verifica que el
   primer `seq` sea el siguiente al aplicado, y hace upsert de `account_balance` y de cada posición afectada.
4. Avanza `account_cursor.last_seq` y `updated_at`.
5. `COMMIT`.

Cada loop repite el procesamiento mientras encuentre trabajo; después duerme hasta un `NOTIFY` o el próximo polling.

El reclamo es por cuenta y no por evento: con `SKIP LOCKED` por evento, dos workers podrían tomar el evento 1 y el 2
de la misma cuenta a la vez y romper el orden.

## Garantías

| Propiedad | Garantía |
|---|---|
| Orden dentro de una cuenta | Estricto, por `seq` |
| Paralelismo | Entre cuentas distintas |
| Entrega | At-least-once |
| Efectos en la base | Exactly-once: la proyección y el cursor avanzan en la misma transacción |
| Reaplicar eventos | Sin efecto: se descarta lo que ya está aplicado |
| Hueco de `seq` | El worker falla en vez de corromper el saldo |

Para efectos fuera de la base (por ejemplo un webhook) el handler debe usar `(aggregateId, seq)` como clave de
idempotencia.

## Despertar

- **`LISTEN/NOTIFY`:** la API emite `pg_notify('outbox', userId)` al commit. El worker escucha por una conexión
  directa; el pooler (PgBouncer en modo transacción) no soporta `LISTEN`.
- **Polling:** cada `pollMs` el loop vuelve a buscar trabajo. Cubre notificaciones perdidas y el arranque.
- **Cuentas nuevas:** el worker asegura una fila de `account_cursor` por cuenta al arrancar y cada 30 s.

## Configuración

| Parámetro | Valor | Origen |
|---|---|---|
| Consumidor | `projector` | `main.ts` |
| Concurrencia | 4 loops | Variable `WORKER_CONCURRENCY` |
| Polling | 1.000 ms | `runner.ts` |
| Eventos por tanda | 100 | `runner.ts` |
| Sincronización de cursores | 30 s | `runner.ts` |
| Conexión | `DATABASE_URL_DIRECT` | Variable de entorno |

Conexiones por worker: `concurrency + 2` (un pool de `concurrency + 1` y la conexión de `LISTEN`).

Con `SIGINT` o `SIGTERM` el worker deja de aceptar trabajo, espera a que terminen los loops en curso y cierra las
conexiones.

## Escalar

- Más procesos o más `WORKER_CONCURRENCY`. Cada loop procesa una cuenta a la vez.
- Una cuenta con muchos eventos se procesa en tandas de `batch`; el orden por `updated_at` deja turno a las demás.
- Una cuenta muy activa no se paraleliza: su orden es serial por diseño.

## Modos de falla

| Situación | Comportamiento |
|---|---|
| Worker caído | Las órdenes se aceptan igual. El portfolio queda desactualizado; la validación de fondos sigue siendo correcta porque suma los eventos pendientes. Al volver, procesa lo acumulado |
| Falla un handler | Se revierte la transacción y se reintenta en el siguiente ciclo |
| Un evento que falla siempre | Bloquea esa cuenta, no las demás, y reintenta cada ciclo. Faltan un contador de reintentos y una cola de eventos fallidos |
| Hueco de `seq` | `applyEvents` lanza un error; la cuenta queda detenida hasta resolverlo |
| Se pierde un `NOTIFY` | El polling lo recupera en `pollMs` |
