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
- [x] 3.1 rede ampliada: 4 -> 13 testes, com 3 injecoes vistas vermelhas
- [x] 3.2 documentado: 8 funções escrevem, 12 leem, em 6 blocos + 1 módulo
- [x] 3.3 medir a costura ANTES de mover achou DOIS defeitos vivos no módulo
      do Pix (fotografia do boot). Migração não começou — motivo escrito
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

═══════════════════════════════════════════════════════════════════
# ITEM 3.1 — A REDE DO DINHEIRO, AMPLIADA
═══════════════════════════════════════════════════════════════════

A rede de 31/08 tinha 4 testes (taxa de entrega, adicional, cashback, payload
sem dinheiro). Hoje tem **13**, e as seis parcelas que faltavam entraram.

| teste | o que ele trava |
|---|---|
| cupom PERCENTUAL com teto | "10% de 68,60" daria 6,86; o backend aplica um teto e manda 4,00. 6,86 não pode existir na sacola, e o total é 73,49 — que **não** é 76,99 − 4,00 |
| cupom FIXO que zera a sacola | total `R$ 0,00`, sem `-R$` em lugar nenhum, e a linha de desconto continua com o número do backend |
| cupom de FRETE GRÁTIS | a linha da entrega **continua mostrando 7,40**. Escondê-la faria o desconto parecer maior do que é |
| pedido mínimo pelo SUBTOTAL (para cima) | mínimo 72,00 entre o subtotal (68,60) e o total (76,99): as taxas não podem liberar o botão que o backend vai recusar |
| pedido mínimo pelo SUBTOTAL (para baixo) | o cupom derruba o total para 21,99 com o mínimo em 60,00, e o botão continua liberado — o desconto é do restaurante, não do cliente |
| **todas as parcelas juntas** | as cinco linhas na tela E a soma delas: `sub + svc + entrega − desconto === total`, com o cashback ainda fora |

## Os números discordam de propósito — inclusive nos testes novos

Duas das minhas fixtures nasceram com os dois caminhos coincidindo, que é
exatamente a armadilha que o cabeçalho deste arquivo denuncia
(`3 × 7,05 + 0,99 = 22,14`): no cupom percentual `76,99 − 4,00` dava os mesmos
`72,99` que o backend mandava, e no frete grátis `76,99 − 7,40` dava os mesmos
`69,59`. **As duas passavam com a subtração local no lugar do
`total_after_coupon`.** Corrigidas antes de qualquer injeção: hoje o backend
responde `73,49` e `69,60`, um deles com um centavo de diferença — que é
justamente a ordem de grandeza que a tolerância de um centavo do `submitOrder`
existe para tratar.

Foi o experimento que achou isso, não a leitura: a injeção A passou verde na
primeira tentativa, e passar verde com o defeito dentro é o que obriga a olhar
para o fixture.

## As três injeções, e o que cada uma acordou

**Injeção A — o front refaz a conta do cupom** (`Math.max(0, beforeDiscount −
discount)` no lugar do `total_after_coupon`): 3 vermelhos.
```
Expected: "R$ 69,13"  Received: "R$ 71,99"
Expected: "R$ 73,49"  Received: "R$ 72,99"
Expected: "R$ 69,60"  Received: "R$ 69,59"
```

**Injeção B — o mínimo comparado com o TOTAL** e não com o subtotal: 2
vermelhos, **um em cada direção**, que é o ponto do par:
```
Expected substring: "Valor abaixo do pedido mínimo"  Received: "Escolher forma de pagamento"
Expected substring: not "pedido mínimo"              Received: "Valor abaixo do pedido mínimo (R$ 60,00)"
```

**Injeção C — a taxa de serviço sai do total quando entra cupom** (o escape do
item 1, injetado de propósito para medir se a rede o pegaria): **7 dos 13
vermelhos**, cada um nomeando o centavo exato.
```
Expected: "R$ 69,13"  Received: "R$ 68,14"
Expected: "R$ 71,99"  Received: "R$ 71,00"
Expected: "R$ 73,49"  Received: "R$ 72,50"
Expected: "R$ 0,00"   Received: "-R$ 0,99"
Expected: "R$ 69,60"  Received: "R$ 68,61"
Expected: "R$ 21,99"  Received: "R$ 21,00"
Expected: "R$ 70,13"  Received: "R$ 69,14"
```
Isto responde a metade da dúvida do item 1 que **dava** para responder daqui:
se algum dia o backend confirmar que `total_after_coupon` não inclui a taxa de
serviço, a correção não vai ser feita no escuro — sete testes falam do assunto,
com precisão de um centavo.

## O ERRO DE MEDIÇÃO desta seção, registrado porque é fácil de repetir

A injeção A **passou verde na primeira execução**, com os 13 testes. Não era o
teste: era a medição. Eu tinha deixado um `npm run preview` de pé desde a
captura de telas do item 1, e `playwright.config.js` tem
`reuseExistingServer: !process.env.CI` — o Playwright reaproveitou aquele
servidor e **nunca reconstruiu o bundle**. Todas as execuções desde a captura
mediram a árvore da captura.

É a regra de higiene do `rodada-checkout.md` ("matar node órfão e conferir a
porta 4174 ANTES de medir") valendo para o caso que ela não nomeava: o problema
não é só a porta ocupada atrapalhar o servidor novo — é o servidor VELHO
atender e a medição inteira falar de outro código. Um `npm run preview` de pé é
mais perigoso que uma porta ocupada, porque a suíte não reclama de nada.

Depois de matar os dois processos e conferir a porta, a injeção A ficou
vermelha com as três mensagens acima.

## Verificação do item 3.1

lint **0 errors**/78 warnings · typecheck ok · **299 unitários** ·
`test:e2e` **exit 0 · 302 passed · 3 skipped · 6,5 min** (eram 296).

═══════════════════════════════════════════════════════════════════
# ITEM 3.2 — AS QUATRO VARIÁVEIS DE PAGAMENTO, E QUEM AS TOCA
═══════════════════════════════════════════════════════════════════

Conferido linha a linha na árvore de hoje (`b858745`), não copiado da rodada
anterior — os números mudaram com a linha de desconto do item 1.

## As quatro

| # | variável | linha | o que é |
|---|---|---|---|
| 1 | `paymentMethod` | `:46` | o RÓTULO exibido ("Pix", "Visa •••• 2508") |
| 2 | `paymentMethodKey` | `:47` | a CHAVE da UI (`"pix"`, `"credit:<id>"`) |
| 3 | `selectedSavedCard` | `:48` | o cartão salvo escolhido (objeto) |
| 4 | `savedCardPaymentToken` | `:49` | **o token de uso único do gateway** |

## Quem ESCREVE — oito funções, em sete blocos diferentes

| ordem no tempo | função | linha | escreve |
|---|---|---|---|
| boot | `resetRuntimeStateForPageLoad()` | `:333-336` | zera as **quatro** |
| checkout, ao desenhar | `renderCheckoutPaymentMethods()` | `:2662-2663`, `:2669-2670` | limpa as quatro quando o método selecionado não está mais na lista da filial |
| checkout, ao escolher | `commitPaymentMethod()` | `:2682-2686` | escreve rótulo e chave; limpa cartão e token |
| checkout, cartão salvo | `selectSavedCardPayment()` | `:2748-2749` | escreve o cartão, **zera o token** |
| checkout, cartão apagado | `clearSavedCardPayment()` | `:2767-2770` | zera as quatro, só se o cartão apagado era o escolhido |
| **folha de confirmação** | `confirmOrderFromSheet()` | **`:2134`** | **escreve o token** (`requestSavedCardToken`) |
| recusa do cartão | `failCardCheckout()` | `:3242` | zera o token — ele já foi gasto |
| pedido criado | `leaveCartAfterOrder()` | `:3124-3127` | zera as quatro |
| **troca de filial** | `clearBranchScopedSelection()` | **`:4180-4183`** | zera as quatro, na MESMA transação do cupom |

## Quem LÊ — onze funções, em cinco blocos

| bloco | função | linha | lê |
|---|---|---|---|
| sacola | `syncCartLocationState()` | `:2201-2242` | `paymentMethod` (rótulo do CTA e do cartão de pagamento) |
| sacola | `updateCartUI()` | `:2257` | `paymentMethod` (vai para o `cartStore`) |
| sacola | `handleCartCta()` | `:2004` | `paymentMethod` (decide entre escolher pagamento e confirmar) |
| rótulo | `selectedPaymentSummary()` | `:1960-1977` | `paymentMethodKey`, `paymentMethod` |
| folha | `syncOrderConfirmSheet()` | `:2040-2041` | `paymentMethod` |
| folha | `confirmOrderFromSheet()` | `:2127-2135` | as **quatro** |
| checkout | `openPaymentMethodScreen()` | `:2492-2503` | `paymentMethodKey`, `paymentMethod` |
| checkout | `renderCheckoutPaymentMethods()` | `:2645-2677` | `selectedSavedCard`, `paymentMethodKey`, `paymentMethod` |
| submissão | `orderPaymentMethodForApi()` | `:2779` | `paymentMethodKey`, `paymentMethod` |
| submissão | `currentCardPaymentPayload()` | `:2786-2789` | `selectedSavedCard`, `savedCardPaymentToken` |
| submissão | `submitOrder()` | `:3046` | `selectedSavedCard`, `savedCardPaymentToken` (a rede que barra um pedido de cartão SEM cartão) |
| Pix (outro arquivo) | `retryPixPayment()` | `pix-flow:913` | `selectedSavedCard` — **e é aqui que estava o defeito do item 3.3** |

## A ordem, num pedido de cartão salvo

```
boot                     zera as quatro
 → commitPaymentMethod   paymentMethod/Key = "credit:<id>"
 → selectSavedCardPayment  selectedSavedCard = card ; token = ''
 → confirmOrderFromSheet   token = requestSavedCardToken(card)     ← escrita
 → currentCardPaymentPayload  { saved_card_id, token }             ← leitura
 → submitOrder             confere que os dois existem
 → leaveCartAfterOrder     zera as quatro
```

E em qualquer ponto, **transversalmente**: `clearBranchScopedSelection()` zera
as quatro junto com o cupom. É a razão pela qual a troca de filial é dona de um
pedaço do estado do checkout, e a razão pela qual os dois não se separam.

**Conclusão que a tabela sustenta, e é a mesma da rodada anterior com os
números conferidos:** oito funções escrevem e doze leem, em SEIS blocos
distintos mais um módulo. Isto não é estado de tela — é estado do app no
caminho do dinheiro. A §9 da skill diz que se o page precisa ler o estado da
tela, o corte está errado; aqui o page **escreve** o estado que a tela leria, em
oito lugares.

═══════════════════════════════════════════════════════════════════
# ITEM 3.3 — A MIGRAÇÃO: o que eu achei ANTES de mover a primeira linha
═══════════════════════════════════════════════════════════════════

A ordem do item 3.3 é "do mais isolado ao mais entrelaçado", e o primeiro passo
de cada corte é medir como o bloco conversa com o resto. Medir isso nos blocos
que JÁ saíram — para saber o que estava certo antes de copiar o idioma — achou
**dois defeitos vivos** no módulo do Pix.

## A régua: `let` reatribuído + passado por VALOR = fotografia do boot

A §2.1 da skill nomeia esta como a armadilha mais cara, e diz por quê: ela não
produz erro nenhum na tela. A varredura cruza três listas do
`restaurant-page.js`:

1. os `let` de topo do IIFE;
2. quais deles são **reatribuídos** depois da declaração;
3. os nomes passados como **taquigrafia** (por valor) em cada `X.init({...})`.

A interseção das três é a lista de fotografias. Resultado:

```
pixFlow.init      FOTOGRAFIA  restaurant         (declarado :23, reatribuído em 3 lugares)
pixFlow.init      FOTOGRAFIA  selectedSavedCard  (declarado :48, reatribuído em 7 lugares)
addressFlow.init  nenhuma
authFlow.init     nenhuma
```

**A primeira versão da varredura acusou ONZE**, incluindo os quatro do
`addressFlow` e os cinco do `authFlow`. Estava errada: aqueles chegam como
`nome: () => nome` e `{ get, set }`, que é o jeito CERTO, e a expressão
`=> operationContext,` casava com o padrão. A régua só vale contando
**taquigrafia pura** — uma linha só de identificadores e vírgulas. Onze viraram
dois, e é por isso que o teste que ficou dessa varredura tem uma sonda que
falha se a lista de reatribuídos vier vazia.

## Defeito 1 — VIVO, e na última tela antes de o cliente pagar

`pixFlow.init()` roda no corpo do IIFE do `restaurant-page`, **antes do boot**.
Nesse instante `restaurant` vale `{}`. E `applyMenuPayload()` **reatribui**
(`restaurant = payload.restaurant || …`) em vez de mutar — então a cópia que o
módulo do Pix guardou continua `{}` para sempre.

`pixStoreLabel()` (`pix-flow:367`) lê `restaurant.name`, não acha, e cai em
`fallback().restaurantName`, que é a string `'Restaurante'`
(`scripts/config/fallback-config.js:6`) — o nome genérico da PLATAFORMA.

**Medido**, com a asserção forte no lugar da fraca:
```
Locator: locator('#pixOrderStore')
Expected substring: "Júnior da Picanha"
Received string:    "Restaurante - MATRIZ"
14 × locator resolved to <strong id="pixOrderStore">Restaurante - MATRIZ</strong>
```

Num app **white-label**, um nome de plataforma no cartão do pedido da tela de
pagamento é o defeito que a §7 da skill descreve com outras palavras ("todo
restaurante novo nascia parcialmente laranja do piloto") — e este está na
última tela que o cliente vê antes de pagar.

**Por que a suíte não pegou:** `pix-payment.spec.js:68` afirmava
`await expect(page.locator('#pixOrderStore')).not.toBeEmpty()`. Ela passa com
`"Restaurante - MATRIZ"`, com `"—"`, com qualquer coisa. É um teste que prova
que o elemento tem texto, não que tem o texto CERTO.

## Defeito 2 — LATENTE, e é honesto dizer que é latente

`retryPixPayment()` (`pix-flow:913`) tem:

```js
if (pixSession.cardPayment && selectedSavedCard?.id) {
  const token = await window.PedeAquiCardFlow?.requestSavedCardToken?.(selectedSavedCard);
```

`selectedSavedCard` é a fotografia do boot: **`null`, sempre**. A condição nunca
é verdadeira, e a retentativa sairia com o token de uso único **já gasto** — a
recusa que o comentário do `clearBranchScopedSelection()` descreve ("o token do
cartão é de uso único no gateway; deixá-lo vivo só produziria uma recusa mais
adiante").

**Mas o ramo é INALCANÇÁVEL hoje**, e conferi antes de chamá-lo de defeito
vivo: `#pixRetryBtn` só aparece por `showPixError()`, e `startPixCharge()` tem
`if (isCard) { session.cardDeclined = …; return; }` **antes** dela. Um cartão
recusado volta para a sacola por `failCardCheckout()`, que zera a `pixSession`.
Nenhum caminho leva um cartão à tela de erro do Pix.

Então: a condição está permanentemente falsa por dois motivos independentes, e
o dia em que um deles for removido o outro continua. Corrigido junto porque é a
mesma causa e a mesma linha — e porque **uma condição permanentemente falsa no
caminho do pagamento é precisamente o que este repositório mais paga caro**
(`api.d.ts`: campos procurados por anos que nunca existiram).

## A correção

O idioma do `S` de `restaurant-address-flow.js`, copiado, não inventado:

- `restaurant-pix-flow.js`: os dois saem da lista de estáveis; entram
  `const S = {}` e `ESTADO_OBRIGATORIO = ['restaurant', 'selectedSavedCard']`;
  `init()` recusa getter faltando **com o nome**, em vez de seguir com
  `undefined`. Três leituras ganham o prefixo `S.` — e nada mais.
- `restaurant-page.js`: `restaurant: () => restaurant` e
  `selectedSavedCard: () => selectedSavedCard`, no grupo comentado.

Depois: `0 fotografia(s) do boot` nos três módulos.

## A GUARDA, que é o que sobra depois

`tests/unit/page-modules.test.js` ganhou um quarto `describe`. As três
verificações que já existiam não veem esta classe: o nome existe dos dois
lados, com o tipo certo, e o módulo importa sem estourar. Esta lê o
`restaurant-page.js`, monta a lista de `let` reatribuídos, monta a lista de
taquigrafia de cada `init()`, e exige interseção vazia.

**Vista vermelha**, com a passagem por valor de volta:
```
× restaurant-pix-flow: nenhum nome que muda de valor chega por cópia
AssertionError: pixFlow.init({ leva por valor um nome que o restaurant-page
reatribui: o módulo ficaria com a fotografia do boot. Passe como getter
(`nome: () => nome`), como os outros.:
expected [ 'restaurant', 'selectedSavedCard' ] to deeply equal []
```
Ela **nomeia os dois**. E tem uma sonda própria (`reatribuidos.size > 10` e
`reatribuidos.has('cart')`) para não passar por vacuidade no dia em que a
varredura parar de casar — passar por vacuidade é a pior forma de passar.

## A migração propriamente dita: NÃO começou, e o motivo

Encontrar dois defeitos vivos na costura dos módulos que **já saíram** muda a
ordem das coisas. A regra desta rodada é que nada se move sem a rede; a rede da
costura acabou de nascer (a guarda acima) e ela precisa ser a base ESTÁVEL
contra a qual um corte novo seja verificado, não mudar junto.

E a medida da rodada anterior continua valendo, agora reconfirmada com os
números conferidos no item 3.2: oito funções escrevem as quatro variáveis de
pagamento e doze as leem, em seis blocos mais um módulo. Ver 3.4 e 3.5.

## Verificação do item 3.3

lint **0 errors**/78 warnings · typecheck ok · **303 unitários** (eram 299) ·
`test:e2e` **exit 0 · 302 passed · 3 skipped · 6,3 min**.
Higiene: 0 node órfão, porta 4174 livre antes de medir.

### Os dois vermelhos da execução anterior, e o que eram

A execução ANTES desta fechou `300 passed / 2 failed`, e os dois eram de
`assistant-voice-session.spec.js` — fora do eixo que mexi. Isolados,
`--workers=1`: **23/23**. Diagnóstico de cada um, pela taxonomia da §11:

**`:381`** — `Timeout 5000ms exceeded while waiting on the predicate`,
`Received array: ["conversation.item.create"]`. Família 5 da §11, "orçamento
desigual por escolha de ferramenta": o último `expect.poll` do teste herdava o
padrão de **5 s** enquanto os **dois irmãos do mesmo teste** têm
`{ timeout: 10000 }` explícito — e ele é o que mais espera, porque depois do
`emitir()` ainda falta a ida-e-volta pelo canal. Corrigido com o teto
explícito, e o argumento é o do `tenant-theme:161`: o defeito que ele guarda é
a fila NÃO escoar, o que torna a espera infinita, não lenta.

**`:472`** — `InvalidStateError: RTCDataChannel.readyState is not 'open'` no
PRIMEIRO `emitir()` depois do preparo. **NÃO corrigido, e a razão é uma conta
que dá para conferir lendo duas linhas do mesmo arquivo:**

| o quê | quanto | onde |
|---|---|---|
| teto de inatividade da sessão SOB TESTE | **8 s** | `:478` `inatividade_s: 8` |
| tempo que o preparo tem direito de levar | **15 s** (conexão) **+ 10 s** (saudação) = **25 s** | `conversar()`, `:209` e `:211` |

O contador de inatividade começa quando o áudio abre, ou seja **antes** de
`conversar()` terminar. O preparo tem direito a 25 s dentro de um limite de
8 s — é a mesma armadilha do `:491` que a rodada anterior corrigiu ("o teto sob
teste matando o preparo do teste"), com números três vezes piores. O próprio
comentário do teste previu: *"um orçamento apertado aqui vira teste instável
quando a suíte roda em paralelo"*.

**Por que fica nomeado e não corrigido:** a correção é subir `inatividade_s`
acima dos 25 s do preparo, o que leva o teste de ~13 s para ~35 s e exige um
`test.setTimeout` próprio. Mudar orçamento de relógio sem medir os dois braços
é palpite, e a rodada proíbe palpite — a conta acima é a prova de que o teste
está errado, não a prova de qual número o conserta. Vai para os escapes com os
dois valores escritos.

Na execução seguinte (a desta verificação) ele passou.
