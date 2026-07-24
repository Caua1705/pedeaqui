# Contrato — `POST /restaurants/{slug}/orders`

Derivado do **OpenAPI publicado pela própria API** (`GET https://api.pederapidex.com/openapi.json`),
schemas `CreateOrderRequest` / `CreateOrderResponse`. Não é suposição: é o schema que o
backend expõe. Os pontos que **são** suposição estão marcados com ⚠️ no fim.

Montagem centralizada em `scripts/services/order-payload.js` → `buildOrderPayload(state)`.
Se o contrato mudar, é esse arquivo que muda.

## Requisição

`Content-Type: application/json` · `Authorization: Bearer <token>` (opcional — só se logado)

| Campo | Tipo | Obrig. | De onde o front tira |
|---|---|---|---|
| `branch_id` | uuid | **sim** | `operationContext.branch_id` (unidade escolhida no modal de operação) |
| `order_type` | string | **sim** | `operationContext.order_type` → `"delivery"` \| `"pickup"` |
| `items` | array (min 1) | **sim** | `cart` |
| `items[].product_id` | uuid | **sim** | `item.id` do produto |
| `items[].quantity` | int ≥ 1 | não (default 1) | `item.qty` |
| `items[].observation` | string\|null | não | `item.obs` |
| `items[].selected_options` | array | não | `item.selected_options` — **já gravado nesse formato pelo carrinho** |
| `items[].selected_options[].option_group_id` | uuid | **sim** | `group.id` |
| `items[].selected_options[].option_id` | uuid | **sim** | id da opção marcada |
| `customer` | objeto\|null | não | **só visitante**: `{name, phone}` |
| `customer.name` | string (min 1) | sim (se `customer`) | snapshot do cliente |
| `customer.phone` | string (min 8) | sim (se `customer`) | snapshot do cliente |
| `customer_address_id` | uuid\|null | não | `address.id` quando o endereço já existe no backend |
| `address` | objeto\|null | não | fluxo visitante / endereço ainda não persistido |
| `address.street/number/neighborhood/complement/reference/city/state` | string\|null | não | `operationContext.address` |
| `address.zipcode` | string\|null | não | ⚠️ front guarda como `postal_code` — **é remapeado** |
| `address.latitude/longitude` | number\|string\|null | não | `operationContext.address` |
| `payment_method` | string\|null | não | `method_type` do backend |
| `coupon_id` | uuid\|null | não | `selectedCoupon.id` |
| `coupon_code` | string 1..100\|null | não | `selectedCoupon.code` |
| `notes` | string\|null | não | observação do pedido (hoje não usado pela UI) |

### O que NÃO existe na requisição

`subtotal`, `total`, `delivery_fee`, `service_fee`, `discount`, `cashback` **não são campos
aceitos**. O schema não os define. O backend calcula tudo. Isso confirma o princípio: o
front manda inputs, o servidor devolve os valores.

### Regras que o schema não expressa (aplicadas em `buildOrderPayload`)

- **Cupom**: `coupon_id` **XOR** `coupon_code`, nunca os dois. Se houver `id`, manda `id`.
- **Endereço**: `customer_address_id` **XOR** `address`. Com id, não manda o objeto.
- **Endereço só em delivery**: em `pickup` nenhum dos dois é enviado.
- **Cliente autenticado**: identidade vem do JWT. **Nunca** mandamos `customer_id`
  (o campo nem existe); `customer` só vai no fluxo visitante.
- Campos vazios/nulos são omitidos em vez de enviados como `""`.

## Resposta de sucesso (200) — `CreateOrderResponse`

| Campo | Tipo | Obrig. |
|---|---|---|
| `id` | uuid | sim |
| `order_number` | **integer** | sim |
| `status` | string | sim |
| `subtotal` | number | sim |
| `delivery_fee` | number | sim |
| `service_fee` | number | sim |
| `total` | number | sim |
| `message` | string | sim |
| `coupon_code` | string\|null | não |
| `coupon_discount_amount` | **string decimal** (`"0.00"`) | não |
| `cashback_redeemed_amount` | **string decimal** | não |
| `discount_total` | **string decimal** | não |

Atenção ao tipo misto: totais são `number`, descontos são `string` decimal. A tela de
sucesso normaliza com `Number()` antes de formatar.

## Erros

| Status | Significado | Tratamento no front |
|---|---|---|
| 422 | validação (`detail[]` FastAPI) | mensagem específica, carrinho intacto, botão reabilitado |
| 409 | conflito (cupom já usado/expirado) | mensagem específica, cupom continua selecionado para o usuário decidir |
| 4xx/5xx | genérico | mensagem do `detail`/`message` |
| — | `TimeoutError` (8s, Fase 0) | mensagem de retry; **mesma** Idempotency-Key |

## ⚠️ Suposições a validar com o backend

1. **`Idempotency-Key` não está no OpenAPI.** O endpoint declara só o path param
   `restaurant_slug` — nenhum header de idempotência. O front **já envia** o header, mas
   **hoje o backend ignora**. Enquanto não for honrado server-side, um retry após timeout
   pode criar pedido duplicado. **Pendência de backend.**
2. **`payment_method`** é `string` livre no schema (sem enum). Enviamos o `method_type`
   canônico do próprio backend (`GET /restaurants/{slug}/info` → `payment_methods[].method_type`),
   hoje: `pix`, `credit_card`, `debit_card`. Validar se `POST /orders` aceita esses mesmos valores.
3. **`order_type`** é `string` livre (sem enum). Assumimos `"delivery"` / `"pickup"`, que é o
   que o front já usava e o que `/coupons/preview` recebe.
4. **`notes`** existe no schema mas não tem campo na UI. Enviado como `null`.
5. **`address.zipcode`**: assumimos que corresponde ao CEP que o front guarda em `postal_code`.
6. Não há endpoint de "preview do pedido". A revisão exibe o cálculo **local** (mesma conta
   que o carrinho sempre fez) e o substitui pelos valores do servidor após o 200.
   Divergência entre os dois vira pendência de backend, não de front.
