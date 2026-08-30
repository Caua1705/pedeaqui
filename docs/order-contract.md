# Contrato — pedido e pagamento online

Derivado do **OpenAPI publicado pela própria API** (`GET https://api.pederapidex.com/openapi.json`),
schemas `CreateOrderRequest` / `CreateOrderResponse` / `StartPaymentResponse` /
`OrderDetailResponse`. Não é suposição: é o schema que o backend expõe. Os pontos que
**são** suposição estão marcados com ⚠️ no fim.

Montagem centralizada em `scripts/services/order-payload.js` → `buildOrderPayload(state)`.
Se o contrato mudar, é esse arquivo que muda.

## As três rotas do ciclo

| Rota | Quem autoriza | Quando |
|---|---|---|
| `POST /restaurants/{slug}/orders` | Bearer **opcional** | cria o pedido; devolve `tracking_token` |
| `POST /restaurants/{slug}/orders/{tracking_token}/payment` | o próprio token — **+ Bearer obrigatório no cartão** | abre a cobrança no gateway |
| `GET /restaurants/{slug}/orders/track/{tracking_token}` | o próprio token (sem security) | acompanha status e pagamento |

Cliente logado tem um quarto caminho, `GET /customers/me/orders/{order_id}`, autorizado pelo
Bearer.

**A consulta pública por telefone não existe mais.** Verificado no OpenAPI atual: nenhuma
rota expõe `phone` como query param para buscar pedido. Para um visitante, perder o
`tracking_token` é perder o acesso ao pedido — daí ele ser persistido por slug em
`scripts/state/order-tracking.js` **antes** de qualquer renderização de confirmação.

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
| `payment_method` | string (max 50)\|null | não **no schema** — ver abaixo | `method_type` do backend |
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
- **`payment_method` é obrigatório para o front, mesmo sendo opcional no schema.** O
  OpenAPI declara `anyOf: [{string, maxLength 50}, {null}]` **fora de `required`**, ou seja,
  o schema aceita ausência. Mas é ele que decide o `payment_flow` do pedido, e sem ele não
  há como saber se a cobrança online deve existir. Por isso a chave vai **sempre** no JSON
  (`buildOrderPayload`), e `validateOrderPayload` **barra o envio** quando ela está vazia —
  o erro vira "Escolha a forma de pagamento" na tela, não um 422 genérico.

## Resposta de sucesso (200) — `CreateOrderResponse`

| Campo | Tipo | Obrig. |
|---|---|---|
| `id` | uuid | sim |
| `order_number` | **integer** | sim |
| `tracking_token` | string | sim |
| `status` | string | sim |
| `payment_flow` | string | sim |
| `payment_status` | string | sim |
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

`tracking_token` é gravado por slug **antes de renderizar a confirmação**
(`RapidexOrderTracking.remember`). É a única credencial do visitante para o próprio pedido.

## Cobrança online — `POST /restaurants/{slug}/orders/{tracking_token}/payment`

**Corpo OPCIONAL** — `StartPaymentRequest { card?: CardPaymentPayload }`. Pix continua
sendo um POST sem corpo, exatamente como antes de o cartão existir; `card` (com `token`
obrigatório e `saved_card_id` quando é cartão salvo) só vai quando a forma de pagamento do
pedido é cartão.

**`security: HTTPBearer`, e o Bearer NÃO é decorativo.** O `tracking_token` do path
continua sendo a autorização — é o que mantém o Pix de visitante funcionando sem conta —,
mas o backend **exige cliente autenticado para cobrar no cartão**: o `payer.email` de um
pedido de visitante é sintético, e sintético entra na análise antifraude do Mercado Pago e
volta recusado. Sem o header, cobrança de cartão responde **401 `login_required`** antes de
o gateway ser chamado, com CVV certo ou errado. Por isso `startOrderPayment()`
(`scripts/services/order-service.js`) manda `authOptions()` junto.

⚠️ Esta seção já esteve **errada** aqui, afirmando "sem corpo" e "sem security" — e foi
essa descrição que deixou o cartão sem o header. O `POST .../payment` mudou quando o cartão
entrou; a fonte é `../pedeaqui_back/openapi.json`, não a memória desta página.

Resposta 200 — `StartPaymentResponse`:

| Campo | Tipo | Obrig. |
|---|---|---|
| `provider` | string | sim |
| `provider_payment_id` | string | sim |
| `payment_status` | string | sim |
| `status_detail` | string\|null | não |
| `qr_code` | string\|null | não |
| `checkout_url` | string\|null | não |

**`payment_status` significa coisas diferentes em cada forma de pagamento**, e é essa
diferença que decide a tela: no Pix é **sempre `pending`** (a cobrança nasce aberta e o
cliente ainda vai pagar); no cartão ele **já é o desfecho** — `paid`, `failed` ou
`in_review` —, porque a autorização é síncrona.

Daí as duas classificações separadas em `restaurant-page.js`:

- `paymentStatusKind()` — do **Pix**. Desconhecido = `pending`: seguir esperando é barato.
- `cardChargeKind()` — do **cartão**. Desconhecido = `declined`: no cartão não existe
  esperar, então o erro caro passa a ser o oposto — dar como feito um pedido que ninguém
  pagou. Só aprovação (ou `in_review`, que é decisão tomada) cria pedido.

`status_detail` é o motivo **cru** do gateway e só existe no cartão. É a única pista do que
pedir ao cliente numa recusa — `StartPaymentResponse` não tem campo de mensagem —, e
`cc_rejected_bad_filled_security_code` (redigitar o CVV) pede coisa oposta de
`cc_rejected_insufficient_amount` (usar outro cartão). A tradução mora em
`CARD_DECLINE_REASONS`, é **nominal**, e o valor desconhecido cai numa frase genérica em
vez de virar um palpite errado.

`qr_code` é o **copia-e-cola** do Pix (payload EMV em texto), não uma imagem: o schema não
tem nenhum campo de imagem.

A tela de pagamento exibe esse payload **truncado** (uma linha, cortada pelo CSS) com o
botão de copiar ao lado — ninguém digita um EMV, e o texto inteiro só tomaria a tela. O
elemento guarda a string **completa**: é dela que a cópia sai. **Não existe mais QR
desenhado na tela** (decisão de produto ao alinhar a tela com a referência de mercado).
O gerador `scripts/utils/qrcode.js` foi REMOVIDO na auditoria de 29/08/2026 — eram 566
linhas no bundle de todo cliente, sem um chamador. Se o QR desenhado voltar, ele está em
`git show b2a80ff:scripts/utils/qrcode.js`, com os 34 testes que o conferiam contra a
norma em `tests/unit/qrcode.test.js`. As duas razões que o justificavam continuam de pé
(zero dependências de runtime, e a CSP proíbe imagem de terceiro), então é resgate, não
reescrita.

`qr_code` e `checkout_url` são ambos anuláveis e **alternativos** — a tela renderiza o que
vier e só falha se vierem os dois vazios. Com `qr_code`, a tela mostra código + botão de
copiar e **não** exibe o link. Quando vem **só** `checkout_url`, o campo do código e o rodapé
"Copiar código" somem e o link aparece como única saída, filtrado para `http(s)` antes de
virar `href`. Ou seja: o link é caminho de exceção, não um segundo botão.

## Acompanhamento — `GET /restaurants/{slug}/orders/track/{tracking_token}`

**Sem `security`** no OpenAPI: rota pública autorizada pelo próprio token. Devolve
`OrderDetailResponse`, cujos campos de pagamento são:

| Campo | Tipo | Obrig. |
|---|---|---|
| `payment_status` | string | sim |
| `payment_flow` | string\|null | não |
| `payment_method` | string\|null | não |

## Erros

| Status | Significado | Tratamento no front |
|---|---|---|
| 422 | validação (`detail[]` FastAPI) | mensagem específica, carrinho intacto, botão reabilitado |
| 409 | conflito (cupom já usado/expirado) | mensagem específica, cupom continua selecionado para o usuário decidir |
| 4xx/5xx | genérico | mensagem do `detail`/`message` |
| — | `TimeoutError` (8s, Fase 0) | mensagem de retry; **mesma** Idempotency-Key |

### `detail` não tem UM formato

O mesmo campo chega em três formas diferentes, e é isso que torna perigoso
exibi-lo direto:

| Forma | De onde vem | Exemplo |
|---|---|---|
| string | `HTTPException` do FastAPI | `{"detail": "cupom expirado"}` |
| array | `HTTPValidationError` (422) | `{"detail": [{loc, msg, type}]}` |
| objeto | erro estruturado do pagamento | `{"detail": {"code": "...", "retryable": false}}` |

Interpolar os dois últimos numa mensagem imprime **`[object Object]`** na tela do
cliente. Toda leitura passa por `scripts/utils/api-error.js`
(`PedeAquiApiError`), que é o único lugar que conhece as três formas. Quando não
há texto legível ele devolve `''` — nunca `String(objeto)` —, e quem chama cai
no fallback em português.

### Cobrança: retentável × definitivo

`paymentErrorInfo(error)` devolve `{code, retryable, text, structured}` e é o
`retryable` que decide a **tela**, não o status:

- **retentável** → mantém "Tentar novamente", dizendo que o pedido segue registrado;
- **definitivo** → esconde o botão e orienta a combinar outra forma de pagamento
  com o restaurante. Oferecer retry aqui seria oferecer a mesma falha de novo;
- **409** → ramo próprio: o pedido pode **já estar pago**, então não sugere nem
  retentar nem pagar de outro jeito, e sim conferir antes.

Sem a flag, o front decide pelo transporte (timeout/rede/5xx = retentável) e o
desconhecido cai em **não retentável** — mesmo princípio do `payment_status`:
o desconhecido falha para o lado barato.

Em todos os ramos a tela mostra o **número do pedido**: ele existe, e nenhuma
mensagem pode levar o cliente a refazê-lo.

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
7. **`payment_flow` não tem enum no schema** — é `string` livre. Assumimos que o valor
   `"online"` (case-insensitive) é o que marca o pedido que precisa de cobrança; qualquer
   outro valor cai no fluxo de pagar na entrega, que vai direto para a tela de sucesso.
   Ou seja: a decisão é **do backend**, e o desconhecido falha para o caminho seguro (não
   inventa uma cobrança). Validar a lista real de valores com o backend.
8. **`payment_status` não tem enum no schema** — também é `string` livre. O front
   normaliza em três grupos (`paid` / `failed` / `pending`) a partir de uma lista de
   sinônimos (`paid|approved|succeeded|confirmed|captured|settled|completed` →
   pago; `failed|canceled|expired|refused|rejected|declined|refunded|chargeback|voided` →
   falhou), e **tudo o que não reconhece é tratado como pendente** — o polling continua em
   vez de declarar pago por engano. Validar os valores reais do gateway.
9. ~~**`PaymentErrorDetail` NÃO EXISTE no OpenAPI publicado.**~~ **RESOLVIDO.**
   O schema existe e está publicado (`PaymentErrorDetail`/`PaymentErrorResponse`,
   com o enum `PaymentErrorCode`), e o `POST .../payment` declara `400`, `401`,
   `422`, `502` e `503` além do `200`. Os códigos que importam ao checkout:
   `login_required` (401 — cartão sem cliente autenticado) e `card_token_required`
   (400 — cartão sem o token do navegador).
   Nota: `https://api.pederapidex.com/openapi.json` responde **404** hoje — a
   fonte é `../pedeaqui_back/openapi.json`, que é de onde
   `npm run api:generate` já lê.
   O front continua sem tabela de `code`: quem decide a tela é o `retryable`, e a
   `message` do backend já vem pronta em português.
10. **Não há rota para trocar a forma de pagamento de um pedido já criado.** O
   OpenAPI expõe, para o cliente, apenas `POST /orders`, `POST .../payment` e
   `GET .../track` (o único `PATCH` é `/admin/orders/{id}/status`). Por isso, no
   erro definitivo, "escolher outra forma de pagamento" é **orientação** para
   resolver com o restaurante pelo número do pedido — não um botão, que
   prometeria algo que a API não faz.
11. **A cobrança não declara validade.** `StartPaymentResponse` não tem `expires_at` nem
   equivalente, então o front não sabe quando o Pix vence: usa uma janela **própria** de
   10 min de polling (`PIX_POLL_WINDOW_MS`) e, ao estourar, para de consultar e oferece
   verificação manual em vez de afirmar que expirou de verdade. Se o backend passar a
   expor a validade, é ela que deve mandar.
   O contador, a barra de progresso e o texto de consequência saem todos de
   `PIX_POLL_WINDOW_MS`, então não podem divergir entre si.
   ⚠️ **A tela afirma que o pedido será cancelado depois do prazo. Isso é decisão de
   produto, não do contrato:** nada no OpenAPI declara validade da cobrança nem
   cancelamento automático de pedido não pago, e o que o front de fato faz ao estourar
   a janela é **parar de consultar** e oferecer verificação manual. **Pendência de
   backend:** confirmar que o cancelamento existe e publicar o prazo real — se ele for
   diferente de 10 min, é `PIX_POLL_WINDOW_MS` que precisa mudar, e o texto acompanha.
12. **Os itens do pedido não voltam.** `CreateOrderResponse` traz só totais, e o carrinho
   é esvaziado no instante da criação. Para que "Ver itens do pedido" exista na cobrança
   depois de um reload, uma foto enxuta das linhas (nome, quantidade, valor) é gravada
   junto do `tracking_token` em `scripts/state/order-tracking.js`. Se o backend passar a
   devolver os itens em `GET .../track`, essa cópia local perde a razão de ser.
   A gaveta mostra só quantidade e nome — o valor continua guardado, mas não vai à tela:
   o número que tem de bater com a cobrança é o total, e é ele que fica visível.
13. **⚠️ CARTÃO RECUSADO DEIXA PEDIDO ÓRFÃO — pendência de backend, a mais importante
   desta lista.** A ordem das chamadas é imposta pela API: o pedido precisa EXISTIR para
   ser cobrado (`POST /orders` e só então `POST /orders/{tracking_token}/payment`, que é
   endereçada pelo `tracking_token`). Logo, quando o cartão é recusado, o pedido **já está
   gravado** — sem pagamento.
   O que o front faz hoje: não mostra tela de pedido feito, devolve o cliente à sacola com
   o motivo da recusa e **não toca nos itens** (ver `failCardCheckout`). O que ele **não**
   pode fazer: cancelar o pedido — não existe rota de cliente para isso (o único `PATCH` de
   status é `/admin/orders/{id}/status`).
   **Pendência de backend:** cancelar (ou não expor à cozinha) o pedido `payment_flow:
   online` cuja cobrança de cartão voltou `failed`. Enquanto isso não existir, uma recusa
   de cartão deixa um pedido registrado e não pago. Uma rota de cancelamento pelo
   `tracking_token` também resolveria, e aí o front a chamaria em `failCardCheckout`.
