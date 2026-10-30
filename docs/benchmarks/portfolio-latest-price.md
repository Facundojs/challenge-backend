# Último precio en portfolio y búsqueda

Compara dos formas de obtener el último precio de `marketdata`: `DISTINCT ON` sobre toda la tabla y un `LATERAL`
por instrumento.

## Decisión final

`LEFT JOIN LATERAL (... ORDER BY date DESC LIMIT 1)` por instrumento, apoyado en el índice `(instrumentid, date)`.
Lo usan el portfolio y la búsqueda de activos.

- Su costo depende de los instrumentos pedidos y no del historial.
- Con 10M de filas, el portfolio tarda 0,12 ms (con `DISTINCT ON`, 66 ms) y la búsqueda 2,8 ms (con `DISTINCT ON`, 1,9 s).

## Resultado

![Tiempo de la consulta según el tamaño de marketdata](portfolio-latest-price.svg)

Mediana de 11 ejecuciones por punto, escala logarítmica.

| Filas en `marketdata` | Portfolio `DISTINCT ON` | Portfolio `LATERAL` | Búsqueda `DISTINCT ON` | Búsqueda `LATERAL` |
|---|---|---|---|---|
| 100 mil | 0,75 ms | 0,10 ms | 34 ms | 1,7 ms |
| 300 mil | 1,6 ms | 0,11 ms | 79 ms | 2,5 ms |
| 1 millón | 6,5 ms | 0,12 ms | 185 ms | 2,7 ms |
| 3 millones | 12,7 ms | 0,12 ms | 530 ms | 2,7 ms |
| 10 millones | 65,9 ms | 0,12 ms | 1.897 ms | 2,8 ms |

- `DISTINCT ON` calcula el último precio de todos los instrumentos, así que su tiempo crece con el historial.
- `LATERAL` hace un acceso por índice por instrumento pedido: 20 en el portfolio.
- En la búsqueda sube de 1,7 a 2,8 ms porque accede una vez por instrumento coincidente (1.000 en esta prueba).
- Costo: el índice `(instrumentid, date)` pesa 214 MB con 10M de filas.

## Método

- Las dos consultas reales de la API, con `EXPLAIN (ANALYZE)`.
- Portfolio: 20 posiciones de un usuario. Búsqueda: término que coincide con los 1.000 instrumentos, `LIMIT 50`.
- 1.000 instrumentos con 100 a 10.000 días de historial. PostgreSQL 18 en Docker, 1 GB de RAM, `shared_buffers` 230 MB.

## Límites

- El mercado real tiene 65 instrumentos: en la búsqueda, el costo de `LATERAL` está sobreestimado.
- Cache caliente, sin red.
- `marketdata` tiene hoy 2 días de datos: la mejora aplica cuando crezca el historial.
