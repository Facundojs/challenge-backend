# Tests

## Comandos

```bash
npm run test:unit          # sin base de datos
npm run test:integration   # requiere Postgres
npm test                   # ambos
npm run typecheck
```

Equivalentes: `make test-unit`, `make test-integration`, `make test`, `make typecheck`.

Los archivos se distinguen por sufijo: `*.unit.test.ts` y `*.integration.test.ts`, cada uno con su configuración de
vitest (`vitest.unit.config.mts`, `vitest.integration.config.mts`).

## Aislamiento de los tests de integración

- Cada archivo crea un schema temporal (`test_<hex>`) en la base de `TEST_DATABASE_URL`, o de `DATABASE_URL_DIRECT`
  si no está definida.
- Aplica todas las migraciones en ese schema (con `search_path` propio) y lo elimina al terminar. No toca las tablas
  reales.
- Requieren una conexión directa: el pooler no mantiene el `search_path`.
- La migración 4 instala `pg_trgm`, que es de toda la base y no se elimina con el schema temporal. Para no tocar la
  base de Cocos, correr la integración contra un Postgres local:

```bash
docker run -d --name pgtest -e POSTGRES_PASSWORD=bench -p 55434:5432 postgres:18
TEST_DATABASE_URL=postgres://postgres:bench@localhost:55434/postgres npm run test:integration
```

La migración 0 crea las tablas originales en una base vacía, así que no hace falta cargar nada antes.

## Datos de prueba

`createTestDb` (en `packages/db/src/testing.ts`) deja:

| Dato | Valor |
|---|---|
| Usuarios | 1 y 2, sin movimientos |
| Instrumentos | `AAA` (1), `BBB` (2), `SIN` (3, sin precio) y `ARS` (66, moneda) |
| Precios | `AAA` cierra en 100 (anterior 98); `BBB` en 50 |

Los pesos se cargan con `seedCash(db, userId, amount)`, que sigue el camino de cualquier movimiento: inserta una
orden CASH_IN, emite su evento y proyecta. `projectAll(db)` aplica lo pendiente del outbox, como lo haría el worker.
