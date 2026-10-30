# Índice de idempotencia en `orders` a 10M de filas

Costo de indexar `orders.idempotency_key` según el tipo de key, para deduplicar reintentos de `POST /orders`.

## Decisión final

`idempotency_key uuid` derivada con UUID v5 de `{userId}:{key}`, con un unique parcial sobre esa sola columna.

- Es la única variante que deduplica una key opaca del cliente y queda acotada por usuario.
- Con la tabla en 10M de filas, un insert cuesta 6 µs de mediana y 33 µs en p99; el chequeo de key, 6 µs y 40 µs.
- UUID v7 es más rápido pero no se puede derivar de la key del cliente. El índice compuesto es más lento y más grande sin ventaja.

## Resultado

![Inserciones por segundo según el tamaño de la tabla](idempotency-index.svg)

Promedio de dos corridas con media móvil de 3 tandas (1,5M filas).

- El uuid aleatorio baja de ~500 mil a ~110 mil filas/s entre 0,5M y 10M de filas. El v7 se mantiene entre 570 y 790 mil.
- La variante sin índice también baja (de 1,3M a 1M filas/s): parte de la caída es de la tabla y no del índice.
- El índice compuesto carga más lento que el aleatorio (58 s contra 48 s) y ocupa 33% más (511 MB contra 385 MB).

## Variantes

Tabla de 10 columnas con PK serial, 10M de filas en tandas de 500.000. PostgreSQL 18.6 en Docker, 1 GB de RAM,
`shared_buffers` 230 MB.

| Variante | Índice |
|---|---|
| Sin índice | ninguno |
| uuid aleatorio | `UNIQUE (k)` con `gen_random_uuid()`, misma distribución que un v5 |
| uuid v7 | `UNIQUE (k)` con valores crecientes |
| compuesto | `UNIQUE (userid, k)`, 1.000 usuarios |

## Carga de 10M de filas

| Variante | Tiempo | Filas/s promedio | Índice |
|---|---|---|---|
| Sin índice | 12 s | 811 mil | n/a |
| uuid v7 | 19 s | 518 mil | 301 MB |
| uuid aleatorio | 48 s | 206 mil | 385 MB |
| compuesto | 58 s | 171 mil | 511 MB |

Filas por segundo según el tamaño de la tabla (miles):

| Variante | 0,5M | 5M | 10M |
|---|---|---|---|
| Sin índice | 1298 | 1044 | 970 |
| uuid v7 | 787 | 669 | 742 |
| uuid aleatorio | 506 | 267 | 108 |
| compuesto | 480 | 188 | 134 |

## Insert suelto con la tabla en 10M

20.000 muestras por variante, en microsegundos.

| Variante | p50 | p99 |
|---|---|---|
| Sin índice | 2 | 6 |
| uuid v7 | 3 | 11 |
| uuid aleatorio | 6 | 33 |
| compuesto | 7 | 46 |

## Límites

- No incluye red, commit ni fsync por orden.
- Postgres local con 1 GB de RAM: con más memoria, la degradación del uuid aleatorio aparece más tarde.
- Dos corridas; los tiempos totales variaron hasta 23% entre ellas.

## Si la tabla crece mucho

Las keys solo se necesitan por una ventana de 24-48 h. La alternativa es una tabla `idempotency_keys(userid, key, order_id, created_at)`
particionada por día, descartando las particiones viejas: el índice queda chico y en memoria.
