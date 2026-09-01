# Rodada da sacola e do checkout — FONTE DA VERDADE (rodada/sacola)

Sessão iniciada 01/09/2026. Branch `rodada/sacola`, a partir de `89ed3a1`
(`rodada/checkout`). NUNCA commitar na `main`.

Antecessores lidos antes de mover: `CLAUDE.md`, a skill `pedeaqui-front`
inteira, `scratchpad/rodada-front.md` e `scratchpad/rodada-checkout.md` — em
especial os 8 escapes pendentes, os 4 testes de dinheiro
(`tests/e2e/cart-money-chain.spec.js`) e a recusa por medida das quatro
variáveis de pagamento.

## Regras desta rodada (do prompt)

- Um commit por item, verde, com push. Este arquivo atualizado no MESMO commit.
- **Portão lido SEM pipe.** `| tail` engole a linha do erro e já mentiu 4 vezes.
- **Antes de medir E2E:** matar node órfão e conferir a porta 4174 livre.
- **REGRA DE DINHEIRO (seção 3):** nenhum commit de movimento pode mudar um
  valor que o cliente vê ou paga. Número que muda = defeito achado = commit
  SEPARADO, com teste próprio. Nunca mover e corrigir no mesmo commit.
- Parar se: um número de dinheiro mudar sem motivo conhecido · escapes > 8 ·
  o mesmo portão vermelho 3x no mesmo item · precisar mexer no backend.

## Ordem de execução e status

Legenda: [ ] pendente · [~] em andamento · [x] feito+commitado+push · [!] bloqueado

### Item 1 — o desconto que some (INDEPENDENTE, PRIMEIRO)
- [x] 1.1 ERA DEFEITO. A linha de desconto entrou, com 3 vermelhos vistos
- [x] 1.2 ACHADO NO CAMINHO: a taxa de serviço pode estar saindo do total com
      cupom. NÃO corrigido — depende de uma resposta do backend (escape novo)

### Item 2 — o falsy legítimo (a régua tinha um buraco)
- [x] 2.1 varredura: 141 campos do contrato x 4 famílias -> 46 sítios, com a
      régua validada contra o defeito conhecido antes de acreditar nela
- [x] 2.2 NENHUM dos 46 muda comportamento alcançável. O que a varredura achou
      foi um buraco na REDE: dois sítios de sort_order sem teste nenhum

### Item 3 — sacola e checkout
- [ ] 3.1 ampliar a rede do dinheiro (cupom %, cupom fixo, taxa de serviço,
      pedido mínimo, e a combinação de todos)
- [ ] 3.2 documentar as 4 variáveis de pagamento e os 5 blocos que escrevem
- [ ] 3.3 migração por `mount(ctx)`, do mais isolado ao mais entrelaçado
- [ ] 3.4 folha de confirmação: migrar ou recusar por medida
- [ ] 3.5 troca de filial: a ÚLTIMA

## Estado inicial medido

`scripts/pages/restaurant-page.js`: **5.628 linhas**.


═══════════════════════════════════════════════════════════════════
# ITEM 1 — O DESCONTO QUE SUME
═══════════════════════════════════════════════════════════════════

## A pergunta do prompt: era defeito, ou comportamento correto mal explicado?

**Era DEFEITO.** O dado existia, formatado e pronto, e não havia onde escrevê-lo.

## O cálculo, que é o que decide

A seção "Valores" da sacola (`restaurant.html`, `.cart-price-summary`) tinha
QUATRO linhas, e nenhuma delas é o desconto:

| linha | id | valor no fixture da rede do dinheiro |
|---|---|---|
| Subtotal | `#csSub` | 68,60 |
| Taxa de serviço | `#csSvcFeeBtn` | 0,99 |
| Taxa de entrega | `#csDelivery` | 7,40 |
| **soma das linhas de cima** | — | **76,99** |
| Total | `#csTotal` | **69,13** |

`76,99 - 69,13 = 7,86`. Sete reais e oitenta e seis centavos entre a última
parcela e o total, sem uma linha explicando.

E o dado JÁ ESTAVA na mão: `cartTotals()` (`restaurant-page.js:1870`) devolve
`{subtotal, svc, delivery, discount, total}` — **`discount` é devolvido e
nunca era desenhado**. Não é conta que faltava, é linha que faltava.

É o MESMO defeito que criou o `cart-service-fee.spec.js` — *"num pedido de
R$ 0,01 o cliente via Subtotal R$ 0,01 e Total R$ 1,00, R$ 0,99 sem nenhuma
linha"* — agora na linha do cupom em vez da taxa. A regra que os dois guardam é
uma só: **nenhuma parcela do total pode ficar sem linha.**

## A correção

- `restaurant.html`: `#csDiscountRow` / `#csDiscount`, uma `.cps-row` igual às
  outras (nenhuma regra de CSS nova — a folha já veste `.cps-row`), entre a
  taxa de entrega e o divisor.
- `restaurant-page.js` (`updateCartUI`): escreve `- ${fmt(totals.discount)}` e
  liga/desliga a linha por `totals.discount > 0`, com
  `setProperty(..., 'important')` — a folha declara `display:flex!important` na
  `.cps-row` e um inline comum perderia. É o mesmo idioma da linha da taxa de
  serviço, três linhas acima.
- O valor é `discount_amount`, do contrato (`CouponPreviewResponse`), **não**
  uma subtração feita aqui. O sinal negativo é do texto, não da conta: uma
  linha escrita "R$ 5,00" no meio de somas leria como mais uma parcela SOMANDO.

## Os três vermelhos vistos, e por que cada um

| defeito injetado | teste que caiu | mensagem |
|---|---|---|
| *(a linha não existe — o estado de antes)* | "o desconto do cupom tem linha própria" | `expect(locator).toBeVisible() failed · element(s) not found` |
| *(idem)* | "as linhas da sacola fecham junto" | `toHaveText("- R$ 5,00") · element(s) not found` |
| linha SEMPRE visível (`display:'flex'` fixo) | "sem cupom não há linha de desconto" | `Expected: hidden / Received: visible` |
| a linha lê o campo errado (`subtotal - total`) | os dois primeiros | `Expected "- R$ 5,00" / Received "- -R$ 0,53"` e `"- -R$ 3,39"` |

**E um teste que passava pelo motivo errado foi consertado antes de entrar.**
A primeira versão de "sem cupom não há linha" era só `toBeHidden()` — e ele
passou VERDE na execução em que os dois irmãos ficaram vermelhos, porque
`toBeHidden()` é satisfeito por um elemento que **não existe**. Ele afirmava
"não achei nada", não "existe e está escondida". Hoje ele exige
`toHaveCount(1)` primeiro. (Skill §3.3: o teste que passa pelo motivo errado dá
cobertura de mentira por anos.)

## ACHADO NO CAMINHO, e NÃO corrigido: a taxa de serviço com cupom

Fazer a conta fechar obrigou a olhar de onde vem cada parcela do total, e
apareceu uma pergunta que **não dá para responder deste lado da rede**.

`cartTotals()` troca o total INTEIRO pelo número do backend quando há cupom:

```js
const beforeDiscount = subtotal + svc + delivery;      // inclui a taxa de serviço
const total = selectedCouponPreview
  ? (previewTotal ?? Math.max(0, beforeDiscount - discount))   // ← só total_after_coupon
  : beforeDiscount;
```

E o que o front MANDA no preview (`previewSelectedCoupon`, `:4788`) são duas
parcelas: `subtotal` e `deliveryFee`. **A taxa de serviço não é enviada — e não
pode ser:** `CouponPreviewRequest` tem `additionalProperties: false` e cinco
campos, nenhum deles de taxa de serviço.

Se `total_after_coupon` for `subtotal + delivery_fee - discount` (as duas
parcelas que ele recebeu, que são exatamente as duas que ele DEVOLVE, ambas
`required` na resposta), então **aplicar um cupom apaga a taxa de serviço do
total exibido** — R$ 0,99 no fixture de produção
(`tests/fixtures/menu.json`: `service_fee_amount: 0.99`), em todo pedido com
cupom.

**As duas leituras, e a evidência de cada uma:**

| leitura | a favor |
|---|---|
| **A resposta NÃO inclui a taxa de serviço** | a resposta devolve `subtotal` e `delivery_fee` como `required` e **não** devolve `service_fee` — ao contrário de `CreateOrderResponse`, que devolve os três; e a requisição EXIGE que o cliente informe `delivery_fee`, ou seja o preview orça o que recebe, não o que descobre sozinho |
| **A resposta inclui** | a rota é `/restaurants/{slug}/coupons/preview` — o backend sabe qual é o restaurante e pode ler `service_fee_amount`; e TODOS os fixtures deste repositório assumem isso (`club-coupons.spec.js:181` responde `total_after_coupon: '20.02'` para `subtotal '21.15' + delivery '0.00' - discount '2.12'`, e 20,02 só sai somando a taxa de 0,99) |

**Por que NÃO mexi no número.** Mudar `total` para `previewTotal + svc` é mudar
um valor que o cliente vê e paga, apostando numa leitura do backend que não
tenho como executar daqui. A regra da rodada é explícita nos dois sentidos:
número de dinheiro não muda sem motivo conhecido, e o item não pode depender do
backend. Os fixtures do repositório são a assunção de quem os escreveu, não uma
resposta capturada — não servem de prova, nem para um lado nem para o outro.

**E a pergunta JÁ ESTÁ INSTRUMENTADA em produção — não falta código, falta ler
o log.** `evaluateTotalMismatch()` (`restaurant-page.js:3329`) compara o total
confirmado com o `order.total` e chama `logAppError` com
`confirmado=X pedido=Y`. Se a leitura A estiver certa, **todo pedido com cupom
e taxa de serviço já está registrando essa divergência**, com o valor exato da
taxa:

```
Total divergente entre a confirmação e o pedido criado
confirmado=71.00 pedido=71.99      → diferença = +0,99 = service_fee_amount
```

E o cliente já está vendo, depois de criar o pedido: *"O total ficou R$ 71,99,
acima dos R$ 71,00 que você confirmou. Confira com o restaurante antes de
pagar."* **Uma diferença constante e igual à taxa de serviço, só em pedidos com
cupom, prova a leitura A.** Nenhuma ocorrência prova a leitura B.

Vai para a lista de escapes com essa assinatura escrita. É a resposta em uma
consulta ao log, não em uma discussão.

**O que a linha de desconto faz nesse meio-tempo:** sob a leitura B ela fecha a
conta exatamente. Sob a leitura A ela explica R$ 5,00 dos R$ 5,99 e deixa a
sobra de R$ 0,99 VISÍVEL, em vez de escondida dentro de um buraco de R$ 7,86.
Nos dois casos é melhor do que estava, e em nenhum dos dois ela mente.


## Verificação do item 1

| portão | resultado |
|---|---|
| `npm run lint` | **0 errors**, 78 warnings (a linha de base do repositório) |
| `npm run typecheck:cards` | ok |
| `npm run test` | **296 unitários**, 27 arquivos, 0 vermelhos |
| `npm run test:e2e` | **exit 0 · 296 passed · 3 skipped · 6,0 min** (eram 293; os 3 novos são os desta linha) |

Higiene antes da medição de E2E: 0 processo node, porta 4174 livre.

### A captura das 58 telas — e o que ela responde AQUI

Este commit MUDA uma tela de propósito, então "Nenhuma diferença" não era a
resposta esperada. A pergunta que a captura responde é outra, e é a que importa:
**a linha nova mexe em alguma coisa fora do resumo de valores?**

Resultado: **58 telas, 10 elementos diferentes em cada, TODOS dentro de
`div[10]>div>div[3]>div>div[7]` — a `.cart-price-summary`.** Nenhum caminho
fora dela aparece no diff, em nenhuma das 58. Os 10 são a re-indexação: a
comparação é por caminho estrutural (`tag` + índice entre irmãos de mesma tag),
então inserir uma `div` empurra o divisor de `div[4]` para `div[5]` e o total de
`div[5]` para `div[6]`, e o relatório lê isso como "sumiu/novo/classe trocada".
Nenhuma propriedade mudou de valor em elemento nenhum.

### E o "R$ 0,00 solto" foi conferido por medida, não por argumento

A linha é escondida pelo JS, e o JS só roda quando a sacola é desenhada — então
restava a pergunta de se, ANTES da primeira renderização, ela apareceria escrita
"R$ 0,00". Lendo o `csDiscountRow` na captura: `display: "none"` em **58 de 58
telas**, inclusive a `home` (o cliente nem abriu a sacola) e a `sacola` sem
cupom. `updateCartUI()` já roda no boot; não há instante em que a linha vazia
seja desenhada.

═══════════════════════════════════════════════════════════════════
# ITEM 2 — O FALSY LEGÍTIMO
═══════════════════════════════════════════════════════════════════

## A régua, e a validação dela ANTES de acreditar na resposta

`node tools/falsy-do-contrato.mjs`. Ela lê o `openapi.json`, separa **todo**
campo cujo tipo inclui `number`, `integer`, `boolean` — ou uma string decimal,
porque `"0.00"` é truthy mas `Number("0.00") || y` engole o zero igual — e
procura no `scripts/` cada leitura desses campos em quatro formas:

| família | forma | por que ela conta |
|---|---|---|
| fallback | `campo \|\| padrão`, `campo ? a : b` | a forma do defeito conhecido |
| negação | `!campo` | "não veio" e "veio zero" viram a mesma coisa, e não há operador para desconfiar |
| guarda | `if (campo)`, `&& campo` | a mesma troca, do lado positivo |
| filter(Boolean) | numa linha que cita o campo | numa lista de números, APAGA o zero — a mais silenciosa das quatro |

**A régua foi conferida contra o defeito conhecido antes de eu acreditar em
qualquer resposta dela.** Com o `??` de `menu-service.js:117` trocado de volta
por `||`, ela aponta:

```
scripts/services/menu-service.js:117  campo=sort_order
    sort_order: Number(category.sort_order || index)
    contrato: AdminCategoryCreate @default 0 | AdminCategoryResponse @default 0
```

E a primeira versão dela **não** teria apontado o caso mais comum daqui: sem
atravessar `)` e `]`, `Number(x.campo) || y` escapava, e com ele os sete sítios
do bloco de dinheiro do perfil. Isso está escrito no cabeçalho da ferramenta,
junto das duas cegueiras que ela ainda tem (desestruturação, e campo que o
`api.d.ts` não conhece).

## O resultado: 46 sítios, e nenhum muda comportamento alcançável

141 campos numéricos/booleanos no contrato · 46 sítios
(fallback 43 · negação 0 · guarda 2 · filter(Boolean) 1).
Lista bruta em `scratchpad/item2-varredura.txt`. A conferência, por grupo:

| grupo | sítios | por que cair no fallback dá o MESMO resultado |
|---|---|---|
| `Number(campo \|\| 0)` — `additional_price` (4×), `min_select` (2×), `min_order_value`, `discount_value` | 8 | o fallback é **o próprio 0**. Com 0 o `\|\|` dispara e devolve 0; com `??` devolveria 0. Idênticos |
| `Math.max(1, Number(group.max_select \|\| 1))` (4×) | 4 | com `max_select: 0` o `\|\|` devolve 1 e o `??` devolveria 0 — mas o `Math.max(1, …)` iguala os dois em 1. **É o `Math.max` que salva**, não o operador |
| bloco de dinheiro do perfil: `Number(order.subtotal) \|\| 0` e os cinco irmãos | 6 | mesmo caso do primeiro grupo. O único com dois nomes (`discount_total \|\| coupon_discount_amount`) só divergiria com `discount_total: "0.00"` e `coupon_discount_amount > 0` ao mesmo tempo — dados que se contradizem, não um zero legítimo |
| `Number.isFinite(product.price) ? … : …` (6×) e `order-tracking:124` | 7 | são o **jeito certo** já escrito: perguntam se é número finito antes de decidir, e por isso o 0 passa |
| `branch.is_open ? 0 : 1` e `list.find(b => b.is_open)` | 2 | `is_open` chega **normalizado** de `branch-availability-service.js:48` (`is_open_now === true`): é booleano de verdade quando chega aqui |
| `status === 'success' ? …` (6×) | 6 | falso positivo da régua: `success` é campo de `AIFeedbackResponse`, mas aqui é uma **string de estado local**, não um campo da API |
| `DIAS_DO_CONTRATO[Number(day?.weekday)] \|\| String(…)` | 1 | `weekday: 0` é SEGUNDA, e `DIAS_DO_CONTRATO[0]` é `'Segunda-feira'` — **truthy**. O `\|\|` só dispara fora da faixa. (É o sítio que já errou uma vez; hoje está certo) |
| guardas `if (res?.requires_email_verification)`, `if (info.retryable)` | 2 | booleanos em que `false` significa exatamente "não faça" — pular é a leitura certa |
| o resto (`fallback().x \|\| ''`, `filter(Boolean)` sobre bairro/cidade, `is_main ? -1 : index`, `dataset.count`) | 10 | strings, config local ou DOM — não são campo numérico da API |

**Conclusão honesta: a família estava fechada.** As quatro cadeias de
`sort_order` corrigidas em 31/08/2026 eram todas as que existiam nessa forma —
não uma amostra. O que sobra são fallbacks que devolvem o mesmo número, e sete
sítios que já perguntam `Number.isFinite` antes de decidir, que é a forma certa.

## O que a varredura ACHOU, e não era um defeito: um buraco na REDE

`sort_order` vale `@default 0` em **seis** schemas do contrato, e a rede de
31/08 cobria **quatro**:

| schema | normalizado em | tinha teste? |
|---|---|---|
| `CategoryResponse` | `menu-service:117` | sim |
| `ProductResponse` | `menu-service:166` | sim |
| `BannerResponse` (banner) | `menu-service:191` | sim |
| `BannerResponse` (destaque) | `menu-service:203` | sim |
| **`ProductOptionGroupResponse`** | **`menu-service:137`** | **não** |
| **`ProductOptionResponse`** | **`menu-service:145`** | **não** |

Os dois usam `??` e estão **certos hoje**. O que faltava era a rede: um `||` de
volta ali passa por lint, por typecheck e pelos 296 unitários sem uma palavra —
e o cliente veria a opção de menor ordem, que costuma ser o "sem nada", o mais
barato, o que abre a lista de adicionais, cair para o fim dela.

Três casos novos em `tests/unit/menu-sort-order.test.js`, com a lista chegando
fora de ordem de propósito (fixture que já vem ordenado passa com `||` também e
não prova nada — skill §4).

**Vistos vermelhos**, com `??` → `||` nos dois sítios:

```
× o grupo de ordem 0 vem primeiro, mesmo chegando por último
  expected [ 'ponto', 'bebida', 'tamanho' ] to deeply equal [ 'tamanho', 'ponto', 'bebida' ]
× a opção de ordem 0 vem primeira — é ela que abre a lista de adicionais
  expected [ 'farofa', 'vinagrete', 'nada' ] to deeply equal [ 'nada', 'farofa', 'vinagrete' ]
  Tests  2 failed | 6 passed (8)
```

O terceiro caso (`sort_order` ausente e `null`) ficou **verde nos dois lados**,
de propósito: ele é o freio contra a correção ir longe demais — cair no índice
quando não há ordem é a única coisa que o `||` acertava.

## Observações que ficam nomeadas (não são desta rodada)

1. **Seis campos de `RestaurantSettingsResponse` que o front nunca lê:**
   `accepts_delivery_now`, `delivery_paused_until`, `delivery_pause_reason`,
   `delivery_time_bands`, `free_delivery_enabled`, `free_delivery_min_order_value`.
   Os dois de frete grátis é CERTO não ler — quem aplica é o backend, no
   `/delivery/estimate`, e lê-los aqui seria a segunda cópia da regra. Os de
   pausa de entrega são recurso não construído.
2. **`accepts_delivery` / `accepts_pickup` / `is_open` são lidos do BRANCH, e
   `BranchResponse` não tem nenhum dos três.** `menu-service:79-80` os
   normaliza com `!== false`, ou seja **sempre `true`**, e os dois filtros que
   os usam (`restaurant-page:3934` e `:4100`) nunca filtram. Hoje é inerte e
   falha ABERTO; quem decide de verdade é `/branches/availability`
   (`is_open_now` + `delivery.delivers_to_address`). Cadeia fantasma da mesma
   família do D1/D2 da rodada anterior.
3. **`PublicCouponResponse.sort_order` existe e ninguém o lê** — a vitrine de
   cupons sai na ordem do array.

## Verificação do item 2

| portão | resultado |
|---|---|
| `npm run lint` | **0 errors**, 78 warnings |
| `npm run typecheck:cards` | ok |
| `npm run test` | **299 unitários** (eram 296), 27 arquivos, 0 vermelhos |
| `npm run test:e2e` | **não re-executado, e o motivo é verificável:** `git diff b1bb106 -- scripts restaurant.html styles index.html` é VAZIO. Nenhum byte de produção mudou desde o commit cujo E2E fechou 296/0 |
