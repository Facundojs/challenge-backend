# Decisiones de diseño

Cada decisión indica el contexto, lo elegido, las alternativas descartadas y los tradeoffs. Las que se midieron enlazan
a su benchmark.

| # | Decisión |
|---|---|
| [D1](#d1-saldo-y-posiciones-como-proyección-eventual) | Saldo y posiciones como proyección eventual |
| [D2](#d2-outbox-transaccional-con-orden-por-cuenta) | Outbox transaccional con orden por cuenta |
| [D3](#d3-validación-de-fondos-con-eventos-pendientes) | Validación de fondos con eventos pendientes |
| [D4](#d4-alcance-de-las-órdenes) | Alcance de las órdenes |
| [D5](#d5-idempotencia) | Idempotencia |
| [D6](#d6-último-precio-con-lateral) | Último precio con `LATERAL` |
| [D7](#d7-cache-de-búsqueda) | Cache de búsqueda |
| [D8](#d8-búsqueda-con-pg_trgm) | Búsqueda con `pg_trgm` |

## D1. Saldo y posiciones como proyección eventual

**Contexto.** El enunciado calcula tenencia y pesos agregando `orders`. Hacerlo en cada consulta tiene un costo que
crece con el historial del usuario.

**Decisión.** Las tablas `account_balance` y `positions` las mantiene el worker desde el outbox. El portfolio las lee:
una fila de saldo y una por posición. La valuación se calcula al leer, porque el precio cambia continuamente.

**Alternativas.**
- Agregar `orders` en cada lectura: costo proporcional al historial.
- Actualizar la proyección en la misma transacción de la orden: consistente, pero suma trabajo al camino crítico de
  escritura y acopla la orden a la proyección.

**Tradeoffs.** La lectura es eventual (con el atraso del worker). Hay más piezas: worker, backfill e invariantes. El
riesgo de sobregiro se cubre con D3.

## D2. Outbox transaccional con orden por cuenta

**Contexto.** Se necesita orden estricto por cuenta y paralelismo entre cuentas, sin broker: solo Postgres.

**Decisión.**
1. Cada escritura toma el lock de la fila de la cuenta (`accounts`) hasta el `COMMIT`.
2. Al emitir el evento se asigna `seq = seq + 1` de la cuenta, con el lock tomado.
3. El evento se inserta en `outbox` en la misma transacción que la orden.
4. El worker reclama una cuenta con `FOR UPDATE SKIP LOCKED` sobre `account_cursor`, aplica sus eventos en orden y
   avanza el cursor en la misma transacción.
5. `LISTEN/NOTIFY` despierta a los workers; el polling cubre las notificaciones perdidas.

**Por qué un `seq` por cuenta.** Un poller que lee `id > último` sobre un serial global pierde eventos: las
transacciones confirman fuera de orden y una con id menor puede aparecer después. Con un `seq` contiguo asignado bajo el
lock, el `n+1` no es visible antes que el `n`.

**Por qué reclamar cuentas y no eventos.** `SKIP LOCKED` por evento deja que dos workers tomen eventos consecutivos de la
misma cuenta y rompe el orden.

**Alternativas.**

| Opción | Ventaja | Por qué no |
|---|---|---|
| CDC (Debezium sobre el WAL) | Orden de commit y sin polling | Requiere Kafka Connect, manejar el replication slot (el WAL crece si el consumidor cae) y expone las tablas internas como contrato |
| Outbox con relay a un broker (Kafka, SQS FIFO con la cuenta como clave) | El broker garantiza el orden por clave | No hay broker en el proyecto |
| Un worker serial | Orden trivial | No hay paralelismo entre cuentas |

**Tradeoffs.** La latencia depende del polling si se pierde un `NOTIFY`. Una cuenta muy activa se procesa en serie.
Cada worker usa `concurrency + 2` conexiones. No hay purga de eventos.

**Evolución.** Si el polling se vuelve el límite, Debezium puede leer la tabla `outbox` hacia un broker sin cambiar los
productores. Detalle operativo en [`worker.md`](worker.md).

## D3. Validación de fondos con eventos pendientes

**Contexto.** Con una proyección eventual, validar contra ella permitiría sobregirar mientras el worker esté
atrasado.

**Decisión.** Al enviar una orden, `getAccountState` lee en una sola consulta la proyección y los eventos del outbox con
`seq > last_seq`, y suma sus efectos en memoria. Se ejecuta bajo el lock de la cuenta. `last_seq` está en la misma fila
que `available`, así que ambos salen del mismo snapshot.

**Alternativas.** Validar solo contra la proyección: permite sobregiro. Agregar `orders`: pierde el beneficio de D1.

**Tradeoff.** Cuanto más atrasado esté el worker, más eventos pendientes se leen al validar. Una purga futura del outbox
debe respetar `last_seq`.

## D4. Alcance de las órdenes

- **Las órdenes `NEW` no reservan pesos ni acciones.** El enunciado no pide reserva. La validación considera solo lo
  `FILLED`; reservar implicaría restar las `NEW` pendientes.
- **Las LIMIT no se ejecutan.** El enunciado indica que no hay que simular el mercado.
- **No hay endpoint de cancelación.** El enunciado pide tres endpoints y ninguno cancela; el estado `CANCELLED` existe en
  los datos, pero el código no lo genera.
- **CASH_IN y CASH_OUT** existen como órdenes y la proyección los aplica, pero ningún endpoint los crea.
- **Solo se opera `ACCIONES`.** `ARS` es la moneda y no es operable.

## D5. Idempotencia

**Contexto.** Un cliente que reintenta un `POST /orders` no debe duplicar la orden.

**Decisión.**
- Header opcional `Idempotency-Key`. Sin él no hay deduplicación.
- La key se normaliza solo con `trim` y distingue mayúsculas. Se rechaza con 400 si está vacía, supera 255 caracteres o
  tiene espacios internos o caracteres de control.
- Se guarda `uuidv5("{userId}:{key}")` en `orders.idempotency_key`, con un unique parcial
  (`WHERE idempotency_key IS NOT NULL`).
- Un reintento devuelve la orden original con 200 y el header `Idempotency-Replayed`, sin orden ni evento nuevos.
  Incluye las `REJECTED`, con su motivo.
- Los errores de validación no se guardan: un reintento se vuelve a evaluar.
- El contenido de la request no se compara.

**Por qué derivar la key.** El `userId` dentro del hash acota la key por usuario, evita colisiones entre usuarios y
fija el ancho de la columna.

**Alternativas.**

| Opción | Por qué no |
|---|---|
| Usar la key del cliente tal cual | Colisiona entre usuarios y su formato y tamaño son arbitrarios |
| UUID v4 | Es aleatorio: no se puede derivar de la key |
| UUID v7 | Lleva un timestamp que cambia en cada reintento. Con el timestamp del cliente habría que validar una ventana y su reloj |
| Índice compuesto `(userid, key)` | Más lento y 33% más grande que el uuid solo, sin ventaja medida |
| Pasar la key a minúsculas | Fusiona keys distintas y se pierde una orden sin aviso |
| Comparar un hash del request | Complejidad adicional; se aceptó que una key reutilizada con otro contenido devuelva la orden original |

**Tradeoff.** Un cliente que reutiliza una key por error con otro monto no recibe advertencia.

**Benchmark.** Con 10M de filas, un insert cuesta 6 µs de mediana (33 µs en p99); el uuid aleatorio carga 2,5 veces más
lento que uno secuencial (48 s contra 19 s). Informe: [`benchmarks/idempotency-index.md`](benchmarks/idempotency-index.md).

**Evolución.** Las keys solo hace falta recordarlas por una ventana de 24-48 h: una tabla `idempotency_keys`
particionada por día mantendría el índice chico.

## D6. Último precio con `LATERAL`

**Decisión.** El último precio de cada instrumento se obtiene con `LEFT JOIN LATERAL (... ORDER BY date DESC LIMIT 1)`
sobre `(instrumentid, date)`. Lo usan el portfolio y la búsqueda (`LATEST_PRICE_JOIN`).

**Alternativa.** `DISTINCT ON` sobre toda `marketdata` en una CTE: calcula el último precio de todos los instrumentos
aunque la consulta necesite 20, y su costo crece con el historial.

**Tradeoff.** Depende del índice `(instrumentid, date)`, que pesa 214 MB con 10M de filas.

**Benchmark.** Con 10M de filas, el portfolio baja de 66 ms a 0,12 ms y la búsqueda de 1,9 s a 2,8 ms. Informe:
[`benchmarks/portfolio-latest-price.md`](benchmarks/portfolio-latest-price.md).

## D7. Cache de búsqueda

**Decisión.** Los resultados de `GET /instruments` se cachean 60 s con `node-cache`, con `q` normalizado (`trim` y
minúsculas) como clave. La normalización se hace al validar el request, antes de la consulta y del cache, por lo que
` BETA ` y `beta` comparten entrada. Con 5.000 claves, el cache deja de guardar y la búsqueda responde igual.

**Alternativas.** Redis para compartir el cache entre instancias: no hay infraestructura para eso. Sin cache: cada
tecla de un buscador consultaría la base.

**Tradeoffs.** El cache es local a cada proceso. Los precios de los resultados pueden tener hasta 60 s de antigüedad. No
hay protección contra varias requests idénticas que llegan a la vez con el cache vacío.

## D8. Búsqueda con `pg_trgm`

**Decisión.** Índices GIN de trigramas sobre `instruments.ticker` e `instruments.name`, creados por migración. Aceleran
el `ILIKE '%q%'` para términos de 3 o más caracteres.

**Tradeoffs.**
- Con los 65 instrumentos actuales no tiene efecto: el planner hace seq scan.
- Los términos de menos de 3 caracteres no usan el índice.
- Los índices ocupan algo más que la tabla.
- La extensión es de toda la base. La migración la instala en `public`, toma un advisory lock para soportar migraciones
  simultáneas y califica la clase de operador con el schema real.
