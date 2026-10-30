# Modelo de datos

El modelo provisto no se altera: solo recibe columnas, tablas e índices nuevos, siempre por migración
(`packages/db/migrations/`). Los nombres de columna de las tablas originales están en minúscula
(`instrumentid`, `userid`, `previousclose`).

## Tablas originales

| Tabla | Columnas | Uso |
|---|---|---|
| `users` | `id`, `email`, `accountnumber` | Dueños de las cuentas |
| `instruments` | `id`, `ticker`, `name`, `type` | 65 `ACCIONES` y la moneda `ARS` (id 66, tipo `MONEDA`) |
| `orders` | `id`, `instrumentid`, `userid`, `size`, `price`, `type`, `side`, `status`, `datetime` | Fuente de verdad de los movimientos |
| `marketdata` | `id`, `instrumentid`, `high`, `low`, `open`, `close`, `previousclose`, `date` | Precios diarios; `close` es el último precio |

En un CASH_IN o CASH_OUT, `size` son los pesos y `price` vale 1.

## Datos de partida

| Dato | Valor |
|---|---|
| Usuarios | 4 (solo el usuario 1 tiene órdenes) |
| Órdenes originales | 11, todas del usuario 1 |
| `marketdata` | 126 filas: 63 instrumentos en 2 días (2023-07-13 y 2023-07-14) |
| Instrumentos sin precio | PGR (id 3) e IRCP (id 10) |
| Posición negativa | El usuario 1 vendió 30 unidades del instrumento 31 con 20 compradas en órdenes `FILLED` (posición -10) |

La posición negativa viene en los datos provistos. El portfolio solo muestra posiciones con cantidad mayor a 0, así
que no aparece, aunque la venta sí suma pesos.

## Cambios por migración

| # | Migración | Cambio |
|---|---|---|
| 0 | `base_schema` | Crea las tablas originales solo si no existen. En la base del challenge no hace nada; en una base vacía (local, tests) deja el modelo listo |
| 1 | `accounts_outbox` | `accounts`, `outbox`, `account_cursor`, trigger de alta de cuentas e índices |
| 2 | `order_idempotency` | `orders.idempotency_key`, `orders.rejection_reason` y unique parcial |
| 3 | `account_projection` | `account_balance` y `positions`, con backfill desde `orders` |
| 4 | `instruments_trigram_search` | Extensión `pg_trgm` e índices GIN en `instruments` |
| 5 | `drop_request_hash` | Elimina `orders.request_hash` si existe |

### Tablas nuevas

**`accounts`**: una fila por usuario.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | integer, PK, FK `users.id` | Cuenta |
| `seq` | bigint, default 0 | Último `seq` emitido en el outbox |

Sirve de lock de serialización por cuenta y de contador de eventos. Un trigger sobre `users` crea la cuenta (y su
fila de `account_balance`) al insertar un usuario.

**`outbox`**: eventos escritos en la misma transacción que la orden.

| Columna | Tipo | Descripción |
|---|---|---|
| `aggregate_id` | integer, FK `accounts.user_id` | Cuenta dueña del evento |
| `seq` | bigint | Orden del evento dentro de la cuenta |
| `type` | text | `order.new`, `order.filled` u `order.rejected` |
| `payload` | jsonb | Orden: id, usuario, instrumento, `side`, `type`, `size`, `price`, `status`, motivo de rechazo |
| `created_at` | timestamptz | Momento de la escritura |

PK `(aggregate_id, seq)`.

**`account_cursor`**: progreso de cada consumidor por cuenta.

| Columna | Tipo | Descripción |
|---|---|---|
| `consumer` | text | Nombre del consumidor (`projector`) |
| `account_id` | integer, FK `accounts.user_id` | Cuenta |
| `last_seq` | bigint, default 0 | Último `seq` procesado |
| `updated_at` | timestamptz, default `epoch` | Último procesamiento; ordena el reclamo para repartir turnos |

PK `(consumer, account_id)`.

**`account_balance`**: pesos disponibles proyectados.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | integer, PK, FK `accounts.user_id` | Cuenta |
| `available` | numeric(18,2), default 0 | Pesos disponibles |
| `last_seq` | bigint, default 0 | Último `seq` del outbox ya aplicado |

`last_seq` está en la misma fila que `available` para leerlos atómicamente.

**`positions`**: posiciones proyectadas por usuario e instrumento.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | integer, FK `accounts.user_id` | Cuenta |
| `instrument_id` | integer, FK `instruments.id` | Instrumento |
| `quantity` | integer | Compradas menos vendidas (`FILLED`) |
| `buy_quantity` | integer | Acciones compradas |
| `buy_cost` | numeric(18,2) | Costo total de las compras |

PK `(user_id, instrument_id)`. El costo promedio es `buy_cost / buy_quantity`.

### Columnas nuevas en `orders`

| Columna | Tipo | Descripción |
|---|---|---|
| `idempotency_key` | uuid, nullable | `uuidv5("{userId}:{key}")` del header `Idempotency-Key` |
| `rejection_reason` | text, nullable | Motivo de un `REJECTED`, para repetirlo en un reintento |

### Índices nuevos

| Índice | Tabla y columnas | Para qué |
|---|---|---|
| `orders_user_status_idx` | `orders(userid, status)` | Consultas por usuario y estado |
| `marketdata_instrument_date_idx` | `marketdata(instrumentid, date)` | Último precio por instrumento |
| `instruments_ticker_idx` | `instruments(ticker)` | Orden por ticker |
| `orders_idempotency_key_uidx` | `orders(idempotency_key)` unique, `WHERE idempotency_key IS NOT NULL` | Deduplicar reintentos; las órdenes sin key no ocupan lugar |
| `instruments_ticker_trgm_idx` | GIN trigramas sobre `instruments.ticker` | `ILIKE '%q%'` |
| `instruments_name_trgm_idx` | GIN trigramas sobre `instruments.name` | `ILIKE '%q%'` |

## Backfill de la proyección

La migración 3 calcula `account_balance` y `positions` desde las órdenes `FILLED` ya existentes y deja
`last_seq = accounts.seq`. Antes toma `LOCK TABLE accounts IN SHARE MODE`: ninguna escritura de cuenta puede avanzar
el `seq` mientras se calcula, así que la proyección queda exactamente al día. Las órdenes anteriores a la migración
no tienen eventos en el outbox; después de ella, la proyección solo avanza con eventos.

## Invariantes

Siempre:

- `outbox.seq` de una cuenta es contiguo desde 1.
- `accounts.seq` es el mayor `seq` del outbox de la cuenta.
- `account_balance.last_seq <= accounts.seq`.
- `account_cursor.last_seq <= accounts.seq`.

Cuando `account_balance.last_seq = accounts.seq` (sin eventos pendientes):

- `account_balance.available` coincide con la suma de las órdenes `FILLED` de la cuenta
  (CASH_IN `+size`, CASH_OUT `-size`, SELL `+size*price`, BUY `-size*price`).
- Cada fila de `positions` coincide con la suma de las órdenes `FILLED` BUY y SELL del usuario y el instrumento.
