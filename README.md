# cocos-challenge-backend

API de portfolio, búsqueda de activos y órdenes, con un worker que mantiene una proyección de saldo y posiciones
desde un outbox. Enunciado en [`challenge.md`](challenge.md).

## Estructura

```
apps/api             Express: routes/ (HTTP), services/ (consultas y reglas), lib/ (funciones puras)
apps/worker          consume el outbox y mantiene la proyección
packages/db          knex, migraciones, helpers de outbox y proyección
packages/contracts   tipos de eventos compartidos
```

`api` y `worker` no se importan entre sí: se comunican solo por Postgres y se escalan por separado
(`make up WORKERS=3`).

## Cómo correrlo

Requiere Node >= 22 (`nvm use`). `make help` lista los atajos.

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev:api        # http://localhost:3000
npm run dev:worker
npm test
```

Ejemplos de requests en [`requests.http`](requests.http).

| Variable | Host | Uso |
|---|---|---|
| `DATABASE_URL` | `-pooler` | API |
| `DATABASE_URL_DIRECT` | directo | worker, migraciones, tests |

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/users/:userId/portfolio` | valor total, pesos disponibles, posiciones |
| GET | `/instruments?q=` | búsqueda por ticker y/o nombre, con cache de 60 s |
| POST | `/orders` | `{userId, instrumentId, side: BUY\|SELL, type: MARKET\|LIMIT, size \| amount, price?}`; header opcional `Idempotency-Key` |

## Diseño

### Saldo y posiciones

Los pesos disponibles y las posiciones viven en una proyección (`account_balance`, `positions`) que el worker
mantiene desde el outbox, para no agregar `orders` en cada consulta. Cada orden `FILLED` aplica
`CASH_IN +size`, `CASH_OUT -size`, `SELL +size*price`, `BUY -size*price`, y la cantidad y el costo de la posición.

| Operación | Fuente | Consistencia |
|---|---|---|
| `GET /portfolio` | proyección | eventual |
| Validar fondos o acciones al enviar una orden | proyección + eventos con `seq > last_seq` | fuerte |

- La validación se hace bajo el lock de la cuenta, por lo que no se puede sobregirar aunque el worker esté
  atrasado. Con más atraso se leen más eventos pendientes.
- `last_seq` está en la misma fila que `available`: ambos salen del mismo snapshot.
- El worker ignora lo ya aplicado y falla si falta un `seq`.
- La migración hace el backfill desde `orders`; después la proyección solo avanza con eventos.

Posición: cantidad = BUY - SELL de órdenes `FILLED` (solo se listan las de cantidad > 0). Costo promedio = costo
total de los BUY / acciones compradas. Rendimiento total = `close / costo promedio - 1`; diario =
`close / previousclose - 1`.

### Último precio

El precio de cada posición y de cada resultado de búsqueda se obtiene con un `LEFT JOIN LATERAL` por instrumento
sobre el índice `(instrumentid, date)` (`LATEST_PRICE_JOIN` en `apps/api/src/services/sql.ts`). La valuación se
hace al leer porque el precio cambia continuamente.

Benchmark: [`docs/benchmarks/portfolio-latest-price.md`](docs/benchmarks/portfolio-latest-price.md).

### Búsqueda de activos

- `q` se normaliza (`trim` + minúsculas) al validar el request, antes de la consulta y del cache. Responde 400
  si queda vacío.
- Los resultados se cachean 60 s con `node-cache`, con `q` normalizado como clave: ` BETA ` y `beta` comparten
  entrada. Con 5.000 claves el cache deja de guardar y la búsqueda responde igual, sin cachear.
- El cache es local a cada proceso, y los precios de los resultados pueden tener hasta 60 s de antigüedad.
- El `ILIKE '%q%'` sobre ticker y nombre usa índices GIN de trigramas (`pg_trgm`) para términos de 3 o más
  caracteres. Con los 65 instrumentos actuales no hay efecto; aplica al crecer el catálogo.

Benchmark: [`docs/benchmarks/instrument-search-trigram.md`](docs/benchmarks/instrument-search-trigram.md).

### Órdenes

- MARKET se ejecuta al último `close` y queda `FILLED`. LIMIT queda `NEW` al precio enviado y no se ejecuta sola.
- Se envía `size` o `amount`; con `amount` se compran `floor(amount / precio)` acciones.
- Sin pesos o sin acciones: se guarda como `REJECTED` y responde 201.
- Instrumento inexistente (404), no operable, sin precio de mercado o monto menor a 1 acción (422): no se guarda.
- Solo se opera `ACCIONES`; `ARS` no es operable ni aparece en la búsqueda.
- Las órdenes `NEW` no reservan pesos ni acciones.
- Enviar una orden toma el lock de la fila de la cuenta (`accounts`) durante toda la transacción: las órdenes
  de una misma cuenta se serializan y las de cuentas distintas no se bloquean.

### Idempotencia

`POST /orders` acepta `Idempotency-Key`. Sin el header no hay deduplicación.

- La key se normaliza con `trim` y distingue mayúsculas. Responde 400 si está vacía, supera 255 caracteres o
  contiene espacios o caracteres de control.
- Se guarda `uuidv5("{userId}:{key}")` en `orders.idempotency_key`, con un unique parcial. La misma key de dos
  usuarios no colisiona.
- Un reintento devuelve la orden original con 200 y el header `Idempotency-Replayed`, sin crear orden, mover
  pesos ni emitir evento. Incluye las `REJECTED`. El contenido de la request no se compara.
- Los reintentos concurrentes se serializan con el lock de la cuenta.

Benchmark del índice a 10M de filas: [`docs/benchmarks/idempotency-index.md`](docs/benchmarks/idempotency-index.md).

### Outbox y worker

Orden estricto por cuenta y paralelismo entre cuentas, solo con Postgres.

1. Al emitir un evento, la transacción (con el lock de la cuenta) asigna `seq = seq + 1`. El orden de `seq` es
   el de commit y `n+1` no es visible antes que `n`. Una transacción que no emite no consume `seq`.
2. El worker reclama una cuenta con `FOR UPDATE SKIP LOCKED` sobre `account_cursor`, proyecta sus eventos
   `seq > last_seq` en orden y avanza el cursor en la misma transacción.
3. Cuentas distintas las toman workers distintos; una cuenta con muchos eventos se procesa en tandas.
4. `LISTEN/NOTIFY` despierta a los workers; el polling (1 s) cubre notificaciones perdidas.

Semántica at-least-once; los efectos sobre la misma base son exactly-once.

## Modelo de datos

Las tablas originales solo reciben columnas e índices nuevos; no se altera lo existente. Cambios, por migración (`packages/db/migrations/`):

| Tabla | Motivo |
|---|---|
| `accounts(user_id, seq)` | lock y contador de eventos por cuenta; trigger para usuarios nuevos |
| `outbox(aggregate_id, seq, type, payload)` | eventos escritos en la misma transacción que la orden |
| `account_cursor(consumer, account_id, last_seq)` | progreso de cada consumidor por cuenta |
| `account_balance(user_id, available, last_seq)` | pesos disponibles proyectados |
| `positions(user_id, instrument_id, quantity, buy_quantity, buy_cost)` | posiciones proyectadas |
| `orders.idempotency_key` | deduplicación de reintentos, con unique parcial |
| `orders.rejection_reason` | motivo de rechazo, repetible en un reintento |
| índices `orders(userid, status)`, `marketdata(instrumentid, date)`, `instruments(ticker)` | saldo, último precio y búsqueda |
| extensión `pg_trgm` e índices GIN `instruments(ticker)`, `instruments(name)` | búsqueda por substring (ver [Búsqueda de activos](#búsqueda-de-activos)) |

Las órdenes anteriores a la migración no tienen eventos en el outbox.

La migración `20231001000005_drop_request_hash.js` elimina `orders.request_hash`, columna de una versión anterior de la
migración de idempotencia, solo en las bases que la tienen.

```bash
npm run migrate
npm run migrate:status
npm run migrate:rollback
npm run migrate:make nombre
```

## Benchmarks

| Tema | Decisión | Informe |
|---|---|---|
| Índice de idempotencia | uuid v5 derivado de `{userId}:{key}`, unique parcial | [`idempotency-index.md`](docs/benchmarks/idempotency-index.md) |
| Último precio | `LATERAL` por instrumento sobre `(instrumentid, date)` | [`portfolio-latest-price.md`](docs/benchmarks/portfolio-latest-price.md) |
| Búsqueda de instrumentos | índices GIN `pg_trgm` en ticker y nombre | [`instrument-search-trigram.md`](docs/benchmarks/instrument-search-trigram.md) |

## Tests

```bash
npm run test:unit          # sin base de datos
npm run test:integration   # requiere Postgres
npm test                   # ambos
```

`*.unit.test.ts` y `*.integration.test.ts`, cada uno con su config de vitest. Los de integración crean un schema
temporal en `TEST_DATABASE_URL` (o, si no está definida, `DATABASE_URL_DIRECT`), aplican las migraciones y lo eliminan al terminar.
La migración de trigramas instala `pg_trgm` en la base, que es de toda la base y no se elimina con el schema temporal.

| Tipo | Archivo | Cubre |
|---|---|---|
| Unit | `apps/api/test/idempotency.unit.test.ts` | derivación y normalización de la key |
| Unit | `apps/api/test/money.unit.test.ts`, `portfolio.unit.test.ts` | variación porcentual, acciones por monto, valuación |
| Unit | `apps/api/test/errorHandler.unit.test.ts` | JSON malformado, body grande, esquema inválido |
| Unit | `apps/api/test/cache.unit.test.ts` | TTL de 60 s, claves independientes, cache lleno |
| Unit | `apps/api/test/search.unit.test.ts` | normalización de `q` y rechazo de queries vacías |
| Unit | `packages/db/test/projection.unit.test.ts` | efecto de cada evento en la proyección |
| Integración | `apps/api/test/orders.integration.test.ts` | órdenes, rechazos, concurrencia sin sobregiro, portfolio, búsqueda, su cache y el uso de los índices de trigramas |
| Integración | `apps/api/test/idempotency.integration.test.ts` | reintentos secuenciales y concurrentes, aislamiento por usuario |
| Integración | `apps/worker/test/ordering.integration.test.ts` | orden por cuenta y paralelismo entre cuentas |
| Integración | `apps/worker/test/projection.integration.test.ts` | convergencia con `orders`, idempotencia, hueco de `seq` |

## Limitaciones

- El cache de búsqueda es por proceso: con varias instancias de la API cada una tiene el suyo.
- Las órdenes LIMIT no se ejecutan: el enunciado indica que no hay que simular el mercado.
- Un evento que el handler rechaza siempre bloquea esa cuenta (no las demás). Faltan reintentos con contador y
  dead-letter.
- La API calcula el dinero con `number` redondeado a 2 decimales; la proyección acumula en centavos enteros. En producción, una librería decimal o centavos de punta a punta.
