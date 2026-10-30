# API

Base: `http://localhost:3000`. JSON en ambos sentidos. Sin autenticación. Ejemplos listos para ejecutar en
[`requests.http`](../requests.http).

Todo error responde `{ "error": "<mensaje>" }`; los errores de validación agregan `details` con las observaciones de zod.

## GET /health

`200 {"ok": true}`.

## GET /users/:userId/portfolio

Valor total, pesos disponibles y posiciones del usuario. Lee la proyección: es eventualmente consistente
([`architecture.md`](architecture.md#modelo-de-consistencia)).

```json
{
  "userId": 1,
  "totalValue": 904784,
  "availableCash": 753000,
  "positions": [
    {
      "instrumentId": 47,
      "ticker": "PAMP",
      "name": "Pampa Holding S.A.",
      "quantity": 40,
      "averageCost": 930,
      "lastPrice": 925.85,
      "marketValue": 37034,
      "totalReturnPct": -0.45,
      "dailyReturnPct": 0.44
    }
  ]
}
```

| Campo | Cálculo |
|---|---|
| `availableCash` | Pesos proyectados desde las órdenes `FILLED` |
| `quantity` | Compradas menos vendidas; solo se listan posiciones con cantidad mayor a 0 |
| `averageCost` | Costo total de las compras / acciones compradas |
| `lastPrice` | `close` más reciente de `marketdata` |
| `marketValue` | `quantity * lastPrice` |
| `totalReturnPct` | `lastPrice / averageCost - 1`, en porcentaje |
| `dailyReturnPct` | `close / previousclose - 1`, en porcentaje |
| `totalValue` | `availableCash` + suma de `marketValue` |

Un instrumento sin precio de mercado devuelve `lastPrice`, `marketValue` y los rendimientos en `null`, y no suma al
total. Las posiciones salen ordenadas por ticker.

| Código | Causa |
|---|---|
| 400 | `userId` no es un entero positivo |
| 404 | Usuario inexistente |

## GET /instruments

Búsqueda por ticker y/o nombre: `?q=mol`.

```json
[
  {
    "id": 4,
    "ticker": "MOLA",
    "name": "Molinos Agro S.A.",
    "type": "ACCIONES",
    "lastPrice": 6640,
    "dailyReturnPct": 0.28
  }
]
```

- `q` se normaliza (`trim` y minúsculas) antes de consultar y de usar el cache.
- Coincide por substring, sin distinguir mayúsculas, en el ticker o en el nombre. El carácter `%` no es comodín.
- No devuelve la moneda `ARS`.
- Orden: ticker exacto, luego ticker que empieza con `q`, luego alfabético. Máximo 50 resultados.
- Los resultados se cachean 60 s por proceso: el precio puede tener hasta 60 s de antigüedad.

| Código | Causa |
|---|---|
| 400 | `q` ausente o vacío |

## POST /orders

Envía una orden de compra o venta.

| Campo | Tipo | Regla |
|---|---|---|
| `userId` | entero positivo | Obligatorio |
| `instrumentId` | entero positivo | Obligatorio; solo `ACCIONES` |
| `side` | `BUY` \| `SELL` | Obligatorio |
| `type` | `MARKET` \| `LIMIT` | Obligatorio |
| `size` | entero positivo | Cantidad de acciones. Exactamente uno de `size` y `amount` |
| `amount` | número positivo | Pesos a invertir; se compran `floor(amount / precio)` acciones |
| `price` | número positivo | Obligatorio en `LIMIT`; no se admite en `MARKET` |

No se aceptan campos adicionales. Header opcional: `Idempotency-Key` ([más abajo](#idempotencia)).

```json
{
  "id": 14,
  "userId": 1,
  "instrumentId": 47,
  "side": "BUY",
  "type": "MARKET",
  "size": 10,
  "price": 925.85,
  "status": "FILLED",
  "datetime": "2026-10-30T15:21:08.000Z"
}
```

Un `REJECTED` agrega `rejectionReason`.

### Reglas

| Situación | Resultado |
|---|---|
| MARKET | Se ejecuta al último `close`: `FILLED` |
| LIMIT | Queda `NEW` al precio enviado; no se ejecuta sola |
| Con `amount` | Cantidad = `floor(amount / precio)`; en LIMIT el precio es el enviado |
| BUY por más pesos de los disponibles | `REJECTED`: `Pesos insuficientes: necesita X, disponible Y` |
| SELL por más acciones de las que tiene | `REJECTED`: `Acciones insuficientes: intenta vender N, tiene M` |
| Instrumento inexistente | 404, no se guarda |
| Instrumento no operable (`ARS`) | 422, no se guarda |
| MARKET sin precio de mercado | 422, no se guarda |
| `amount` que no alcanza para 1 acción | 422, no se guarda |

- Los `REJECTED` por saldo o acciones sí se guardan y responden 201.
- La validación de fondos y de acciones es fuerte: considera la proyección y los eventos aún no proyectados.
- Las órdenes `NEW` no reservan pesos ni acciones.
- El efecto de una orden `FILLED` aparece en el portfolio cuando el worker la proyecta.

### Códigos de respuesta

| Código | Causa |
|---|---|
| 201 | Orden creada: `FILLED`, `NEW` o `REJECTED` |
| 200 | Reintento con una `Idempotency-Key` ya usada: devuelve la orden original |
| 400 | Body inválido (con `details`), JSON malformado o `Idempotency-Key` inválida |
| 404 | Usuario o instrumento inexistente |
| 409 | La key corresponde a una orden de otro usuario (prácticamente imposible) |
| 413 | Body mayor a 100 kB |
| 422 | Instrumento no operable, sin precio de mercado o monto menor a 1 acción |

### Idempotencia

Con `Idempotency-Key`, un reintento devuelve la orden original (200 y header `Idempotency-Replayed: true`) sin crear
otra orden, mover pesos ni emitir un evento. Aplica también a las órdenes `REJECTED`. Sin el header no hay
deduplicación.

- La key se normaliza con `trim`; las mayúsculas distinguen.
- Se rechaza con 400 si está vacía, supera 255 caracteres o contiene espacios o caracteres de control.
- El contenido de la request no se compara: la misma key con otro contenido devuelve la orden original.
- Los errores de validación no se guardan, así que un reintento se vuelve a evaluar.
- La key está acotada por usuario: dos usuarios pueden usar la misma key.

## Ejemplos

```bash
# Compra a mercado por cantidad
curl -X POST localhost:3000/orders -H 'Content-Type: application/json' \
  -d '{"userId":1,"instrumentId":47,"side":"BUY","type":"MARKET","size":10}'

# Compra por monto en pesos, idempotente
curl -X POST localhost:3000/orders -H 'Content-Type: application/json' -H 'Idempotency-Key: compra-001' \
  -d '{"userId":1,"instrumentId":47,"side":"BUY","type":"MARKET","amount":10000}'

# Venta límite
curl -X POST localhost:3000/orders -H 'Content-Type: application/json' \
  -d '{"userId":1,"instrumentId":47,"side":"SELL","type":"LIMIT","size":5,"price":1000}'

curl localhost:3000/users/1/portfolio
curl 'localhost:3000/instruments?q=mol'
```
