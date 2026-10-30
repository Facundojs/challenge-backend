# Documentación

Diseño, decisiones y medición del backend. El [README](../README.md) cubre solo cómo instalar y correr el proyecto.

| Documento | Contenido |
|---|---|
| [`architecture.md`](architecture.md) | Componentes, flujos, modelo de consistencia, concurrencia y escalado |
| [`data-model.md`](data-model.md) | Tablas originales, cambios por migración, invariantes y datos de partida |
| [`api.md`](api.md) | Endpoints, reglas de negocio, códigos de respuesta y ejemplos |
| [`worker.md`](worker.md) | Outbox, algoritmo del worker, garantías y modos de falla |
| [`decisions.md`](decisions.md) | Cada decisión de diseño: motivo, alternativas y tradeoffs |
| [`testing.md`](testing.md) | Estrategia de tests, aislamiento y cómo correrlos |

## Benchmarks

| Tema | Decisión | Informe |
|---|---|---|
| Índice de idempotencia | uuid v5 derivado de `{userId}:{key}`, unique parcial | [`benchmarks/idempotency-index.md`](benchmarks/idempotency-index.md) |
| Último precio | `LATERAL` por instrumento sobre `(instrumentid, date)` | [`benchmarks/portfolio-latest-price.md`](benchmarks/portfolio-latest-price.md) |
