# Búsqueda de instrumentos: `ILIKE` con y sin `pg_trgm`

Compara la búsqueda por substring (`ILIKE '%q%'` sobre ticker y nombre) sin índice y con índices GIN de trigramas.

## Decisión final

Índices GIN con `pg_trgm` sobre `instruments.ticker` e `instruments.name`, creados por la migración
`20231001000004_instruments_trigram_search.js`.

- Con 1 millón de instrumentos, un término de 3 letras baja de 131 ms a 0,39 ms.
- Con los 65 instrumentos actuales no tiene efecto: el planner hace seq scan en ambos casos.
- Los términos de menos de 3 caracteres no usan el índice.

## Resultado

![Tiempo de la búsqueda según el tamaño de la tabla](instrument-search-trigram.svg)

Mediana de 11 ejecuciones por punto, escala logarítmica.

| Instrumentos | 3 letras, sin índice | 3 letras, `pg_trgm` | 2 letras, sin índice | 2 letras, `pg_trgm` | Tamaño de los índices |
|---|---|---|---|---|---|
| 65 | 0,03 ms | 0,03 ms | 0,03 ms | 0,03 ms | 0,1 MB |
| 10 mil | 3,2 ms | 0,01 ms | 3,2 ms | 3,1 ms | 2,5 MB |
| 100 mil | 31 ms | 0,04 ms | 30 ms | 30 ms | 10 MB |
| 1 millón | 131 ms | 0,39 ms | 129 ms | 132 ms | 71 MB |

- Con una palabra poco frecuente (6 letras), a 1 millón de filas la búsqueda baja de 139 ms a 0,02 ms.
- Con 1 millón de filas, los índices pesan lo mismo que la tabla (65 MB).

## Método

- La consulta real de la API: `ILIKE` sobre ticker y nombre, ranking y `LIMIT 50`, con `EXPLAIN (ANALYZE)`.
- Tablas de 65 a 1 millón de instrumentos. PostgreSQL 18 en Docker, 1 GB de RAM.

## Límites

- El índice no se usa con términos de menos de 3 caracteres.
- Requiere la extensión `pg_trgm`, que es de toda la base. En Neon es `trusted`: la instala el dueño de la base.
