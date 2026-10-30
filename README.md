# cocos-challenge-backend

API REST de portfolio, búsqueda de activos y órdenes de compra y venta, con un worker que mantiene una proyección de
saldo y posiciones. Resuelve el [challenge de backend](challenge.md).

## Stack

Node.js 22, TypeScript, Express 5, knex, PostgreSQL (Neon), zod, vitest.

## Estructura

```
apps/api             API HTTP (Express)
apps/worker          proceso que proyecta saldo y posiciones desde el outbox
packages/db          knex, migraciones y lógica de base de datos compartida
packages/contracts   tipos compartidos entre la API y el worker
docs/                documentación de diseño, decisiones y benchmarks
```

## Requisitos

- Node.js >= 22 (`nvm use` toma la versión de `.nvmrc`)
- Acceso a la base PostgreSQL del challenge, o un Postgres propio
- Docker (opcional)

## Instalación

```bash
npm install
cp .env.example .env     # completar con las credenciales de la base
npm run migrate
```

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión de la API (con pooler) |
| `DATABASE_URL_DIRECT` | Conexión directa: worker, migraciones y tests |
| `PORT` | Puerto de la API (3000 por defecto) |
| `WORKER_CONCURRENCY` | Loops del worker (4 por defecto) |

## Uso

```bash
npm run dev:api      # API en http://localhost:3000
npm run dev:worker   # worker (necesario para que el portfolio refleje las órdenes)
```

Con Docker: `make up` levanta la migración, la API y un worker (`make up WORKERS=3` para más workers).
`make help` lista todos los atajos.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/users/:userId/portfolio` | Valor total, pesos disponibles y posiciones |
| GET | `/instruments?q=` | Búsqueda por ticker y/o nombre |
| POST | `/orders` | Envía una orden MARKET o LIMIT (header opcional `Idempotency-Key`) |

Contrato completo y reglas en [`docs/api.md`](docs/api.md). Ejemplos en [`requests.http`](requests.http).

## Scripts

| Comando | Descripción |
|---|---|
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run migrate:status` | Lista las migraciones aplicadas y pendientes |
| `npm run migrate:rollback` | Revierte el último lote |
| `npm run migrate:make <nombre>` | Crea una migración |
| `npm run typecheck` | Verifica los tipos |

## Tests

```bash
npm run test:unit          # sin base de datos
npm run test:integration   # requiere Postgres; usa un schema temporal
npm test                   # ambos
```

Más detalle en [`docs/testing.md`](docs/testing.md).

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Componentes, flujos, consistencia y escalado |
| [`docs/data-model.md`](docs/data-model.md) | Cambios al modelo de datos por migración |
| [`docs/api.md`](docs/api.md) | Endpoints, reglas y códigos de respuesta |
| [`docs/worker.md`](docs/worker.md) | Outbox, garantías y modos de falla |
| [`docs/decisions.md`](docs/decisions.md) | Decisiones de diseño, alternativas y tradeoffs |
| [`docs/testing.md`](docs/testing.md) | Estrategia de tests |
| [`docs/benchmarks/`](docs/benchmarks/) | Mediciones: [idempotencia](docs/benchmarks/idempotency-index.md), [último precio](docs/benchmarks/portfolio-latest-price.md) |
