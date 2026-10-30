# Arquitectura

## Componentes

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| API | `apps/api` | HTTP: valida, aplica reglas de negocio y escribe órdenes |
| Worker | `apps/worker` | Consume el outbox y mantiene la proyección de saldo y posiciones |
| Acceso a datos | `packages/db` | knex, migraciones, lock de cuenta, outbox y lógica de proyección |
| Contratos | `packages/contracts` | Tipos de eventos compartidos entre API y worker |

La API y el worker no se importan entre sí. Su única comunicación es Postgres: la tabla `outbox`, el canal
`LISTEN/NOTIFY` y las tablas de proyección. Se despliegan y escalan por separado.

```
apps/api/src
  routes/      HTTP: un router por recurso, validación de entrada, errorHandler
  services/    consultas y reglas de negocio
  lib/         funciones puras: dinero, uuid v5, key de idempotencia, cache, errores
  schemas.ts   esquemas de validación (zod)

apps/worker/src
  runner.ts    loops concurrentes, polling y parada ordenada
  wakeup.ts    LISTEN/NOTIFY y señal de despertar
  claim.ts     reclamo de una cuenta y procesamiento de sus eventos
  handlers.ts  handler que proyecta eventos

packages/db/src
  outbox.ts      lockAccount, emit, toOutboxEvent
  projection.ts  eventEffect, applyEvents, getAccountState
  sql.ts         SQL crudo
  testing.ts     base de pruebas, seedCash, projectAll
```

## Flujos

### Enviar una orden

```
POST /orders
  routes/orders      valida el body (zod) y normaliza el header Idempotency-Key
  services/orders    placeOrder, una sola transacción:
    1. lockAccount     SELECT ... FOR UPDATE sobre accounts
    2. findByKey       si la key ya existe, devuelve la orden original
    3. resolveTerms    instrumento, precio y cantidad
    4. checkFunds      proyección + eventos pendientes de proyectar
    5. insertOrder     INSERT en orders (FILLED, NEW o REJECTED)
    6. emit            seq = seq + 1, INSERT en outbox, NOTIFY
  COMMIT
```

La orden y su evento se confirman juntos. Un error de validación revierte la transacción y no deja rastro. Un
rechazo por saldo o acciones sí se guarda como `REJECTED` y emite su evento.

### Proyectar el saldo

```
worker (un loop por cada unidad de concurrencia)
  processNextAccount, una transacción:
    1. reclama una cuenta:  FOR UPDATE SKIP LOCKED sobre account_cursor
    2. lee sus eventos con seq > last_seq, en orden de seq
    3. applyEvents:         UPSERT en account_balance y positions, avanza last_seq
    4. avanza account_cursor
  COMMIT
  duerme hasta un NOTIFY o hasta el próximo polling
```

### Leer el portfolio

```
GET /users/:userId/portfolio
  account_balance    una fila con los pesos disponibles
  positions          las posiciones del usuario con cantidad > 0
  LATERAL marketdata último precio de cada instrumento, por el índice (instrumentid, date)
  la valuación y los rendimientos se calculan al leer
```

### Buscar instrumentos

```
GET /instruments?q=
  q se normaliza (trim + minúsculas) al validar
  cache en memoria, 60 s, con q como clave
  si no está en cache: ILIKE sobre ticker y nombre (índices GIN de trigramas)
                       + LATERAL del último precio, con ranking y LIMIT 50
```

## Modelo de consistencia

| Operación | Fuente | Consistencia |
|---|---|---|
| `GET /portfolio` | `account_balance` y `positions` | Eventual, con el atraso del worker |
| Validar fondos o acciones al enviar una orden | proyección + eventos con `seq > last_seq` | Fuerte |
| `GET /instruments` | consulta + cache | Hasta 60 s de antigüedad |
| Deduplicar reintentos | unique parcial sobre `idempotency_key` | Fuerte |

La validación es fuerte porque `last_seq` está en la misma fila que `available`: ambos salen del mismo snapshot, y
los eventos con `seq` mayor son exactamente los que la proyección todavía no aplicó.

## Concurrencia

- **Escrituras de una cuenta:** `lockAccount` toma el lock de su fila en `accounts` hasta el `COMMIT`. Las órdenes
  de una misma cuenta se serializan; las de cuentas distintas no se bloquean entre sí.
- **Orden de los eventos:** `seq` se asigna al emitir, con el lock tomado. El orden de `seq` coincide con el orden
  de commit, y el `seq` n+1 no es visible antes que el n. Una transacción que no emite (un reintento idempotente) no
  consume `seq`, por lo que no hay huecos.
- **Procesamiento:** el worker reclama una cuenta, no un evento. Un solo worker procesa una cuenta a la vez, en
  orden; las demás cuentas quedan disponibles para otros workers.
- **Reintentos concurrentes:** dos requests con la misma key se serializan por el lock de la cuenta; el segundo
  encuentra la orden del primero.

## Escalado

| Parte | Cómo escala | Límite |
|---|---|---|
| API | Instancias sin estado (el cache es local) | Conexiones a Postgres: pool de 10 por instancia |
| Worker | Más procesos o más `WORKER_CONCURRENCY` | Una cuenta se procesa a la vez; una cuenta muy activa no se paraleliza |
| Lecturas | Costo proporcional a las posiciones del usuario | Requiere el índice `(instrumentid, date)`; ver [benchmark](benchmarks/portfolio-latest-price.md) |
| Búsqueda | Índices de trigramas y cache | Cache por proceso; los índices no aceleran términos de menos de 3 caracteres |
| Outbox | Polling sobre Postgres, sin broker | No hay purga de eventos procesados |

El camino de evolución para el outbox (relay a un broker o CDC sobre la tabla `outbox`) está en
[`decisions.md`](decisions.md#d2-outbox-transaccional-con-orden-por-cuenta).
