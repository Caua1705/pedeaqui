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
- [x] 3.4 folha de confirmação: RECUSADA — escreve o token de uso único em :2134
- [x] 3.5 troca de filial: NÃO TOCADA — ela é dona de parte do estado do checkout

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

═══════════════════════════════════════════════════════════════════
# ITEM 3.4 — A FOLHA DE CONFIRMAÇÃO: RECUSADA, e agora com a prova medida
═══════════════════════════════════════════════════════════════════

## Primeiro, a medida — porque medida sozinha não decide, mas é onde se começa

`node tools/fios-do-corte.mjs`, na árvore de hoje (5.644 linhas, 298 funções):

```
bloco                                       linhas   fios   l/fio
Informacoes da loja (modal + info*)            143     24     6.0
Produto: modal e opcoes                         26      5     5.2
Confirmar pedido (folha) + submissao           119     27     4.4
Perfil: historico de pedidos                   157     40     3.9
Cupom: folha de detalhe + helpers               46     12     3.8
AFERICAO — operacao/filial (JA RECUSADO)       314     84     3.7
Cashback                                        13      5     2.6
Inicio: rendering da home                       53     22     2.4
```

**4,4 l/fio contra um piso de 10**, e a três décimos do bloco que já foi
recusado duas vezes. Mas a §9.1 da skill avisa, com razão, que essa régua
SUBESTIMA um corte feito no contrato `mount(ctx)` — as seis telas que saíram
mediam 3,9–6,0 pela régua antiga e 15–44 pela nova. Então o número não basta
para recusar, e não é ele que recusa.

## O que recusa: a folha precisaria de uma porta de ESCRITA de token

```js
// restaurant-page.js:2134, dentro de confirmOrderFromSheet()
savedCardPaymentToken = await window.PedeAquiCardFlow?.requestSavedCardToken?.(selectedSavedCard) || '';
```

A folha **escreve o token de uso único do gateway**. Depois dela, quem o lê é
`currentCardPaymentPayload()` (`:2786`) e quem o confere é `submitOrder()`
(`:3053`) — a rede que impede um pedido de cartão de sair SEM cartão. E ela
escreve mais dois: `orderSubmitInFlight` (`:2988`) e, na submissão que sai
junto, `confirmedTotalAtSubmit` (`:3059`), que é o total congelado contra o
qual `evaluateTotalMismatch()` compara o `order.total`.

A §9 da skill é explícita nos dois sentidos:

> `app` é porta de GETTERS.
> Estado DA TELA mora aqui dentro. **Sem acessor de volta para o page**: se o
> page precisa ler o estado da tela, o corte está errado.

Aqui não é "o page precisa ler o estado da tela": é a tela precisando **gravar**
três estados do app, um deles um token de uso único que vale dinheiro.

## E agora o custo desse erro está MEDIDO, não suposto

Na rodada anterior esta recusa terminava em "é a que menos se pode dar ao luxo
de errar". Hoje ela termina com um número, e o número saiu do item 3.3 desta
mesma rodada:

**`selectedSavedCard` atravessou a fronteira de UM módulo, por valor, uma vez —
e virou uma condição permanentemente falsa no caminho do pagamento, invisível a
lint, a typecheck, a 299 unitários e a 302 E2E.** É uma das quatro variáveis
que a folha teria de atravessar, e o modo mais simples de atravessar (por
valor) foi o que falhou. Uma porta de ESCRITA é mais difícil que uma de leitura,
e o preço do erro está no `docs/order-contract.md`, item 11: **numa recusa de
cartão o pedido já está gravado e não há rota de cliente para cancelá-lo.**

**RECUSADA.** Fica ao lado do dono do dinheiro. Mesma conclusão da rodada
anterior, agora com a medida da régua nova ao lado e com o custo do erro
demonstrado nesta sessão em vez de temido.

═══════════════════════════════════════════════════════════════════
# ITEM 3.5 — A TROCA DE FILIAL: NÃO TOCADA
═══════════════════════════════════════════════════════════════════

Era para ser a última, e a regra do prompt era **parar e escrever** se ela
exigisse mexer em algo já migrado. Não cheguei a tentá-la, porque os blocos
anteriores foram todos recusados — mas a leitura confirma a recusa e o motivo é
o mesmo do 3.4, visto do outro lado:

`clearBranchScopedSelection()` (`restaurant-page.js:4179`) zera **as quatro
variáveis de pagamento** (`:4180-4183`) na MESMA transação em que zera o cupom.
O comentário do código já diz por quê: *"O token do cartão é de uso único no
gateway; deixá-lo vivo só produziria uma recusa mais adiante."*

Ou seja: **a troca de filial é dona de um pedaço do estado do checkout.**
Migrar o checkout sem ela quebra a transação — e "trocar de filial é
transacional" é o defeito mais caro que a auditoria consertou (b3c03ec: a
sacola do cliente sumia por uma falha de rede, sem uma palavra na tela).
Migrar os dois juntos é um corte de ~640 linhas com as quatro variáveis do
dinheiro atravessando a fronteira nos DOIS sentidos.

Ela mede 314 linhas / 84 fios = **3,7 l/fio**, e é a aferição impressa pela
própria ferramenta — o bloco contra o qual todos os outros são comparados.

**NÃO TOCADA.** Terceira recusa, e a primeira em que o custo do erro na
travessia foi medido nesta mesma sessão.

## Conclusão do item 3, inteira

**Nenhuma linha do `restaurant-page.js` foi movida, e é o resultado correto.**
5.628 → 5.644 linhas (+16), e as 16 são a linha de desconto do item 1 mais os
comentários dela e do acessor do Pix. Zero de movimento.

O que a seção 3 entregou, já que não moveu código:

1. **A rede do dinheiro passou de 4 para 13 testes**, com as três injeções
   vistas vermelhas — e uma delas é o escape do item 1, medido a fundo: sete
   testes acordam se a taxa de serviço sair do total.
2. **O mapa das quatro variáveis de pagamento**, conferido na árvore de hoje:
   oito funções escrevem, doze leem, em seis blocos mais um módulo.
3. **Dois defeitos vivos achados na costura dos módulos que JÁ saíram**, um
   deles visível na última tela antes do pagamento — e a guarda que impede a
   classe inteira de voltar.
4. **Três recusas por medida**, cada uma com a linha do motivo e, agora, com o
   custo do erro demonstrado em vez de suposto.

═══════════════════════════════════════════════════════════════════
# RELATÓRIO FINAL DA RODADA DA SACOLA (01/09/2026)
`rodada/sacola`, a partir de `89ed3a1` · 7 commits · 11 arquivos ·
+1.540 / −25
═══════════════════════════════════════════════════════════════════

## 1. O desconto que some: era DEFEITO, e o cálculo

**Era defeito, não texto.** A seção "Valores" da sacola tinha quatro linhas —
Subtotal, Taxa de serviço, Taxa de entrega, Total — e nenhuma de desconto:

```
Subtotal            68,60
Taxa de serviço      0,99
Taxa de entrega      7,40
                  ───────
soma das linhas     76,99
Total               69,13     ← 7,86 sem uma linha explicando
```

E o dado já estava pronto: `cartTotals()` devolve `{subtotal, svc, delivery,
discount, total}` desde sempre — **`discount` era devolvido e nunca desenhado.**
Não faltava conta, faltava linha. É o mesmo defeito que criou o
`cart-service-fee.spec.js` ("Subtotal R$ 0,01, Total R$ 1,00, R$ 0,99 sem linha
nenhuma"), agora na linha do cupom.

Por que a suíte não pegou: todos os testes afirmavam sobre `#csTotal` e nenhum
sobre a SOMA das linhas de cima. Um número certo embaixo passa em todo teste que
só olha para ele.

Corrigido com quatro vermelhos vistos, e com um teste-fantasma consertado antes
de entrar (`toBeHidden()` sozinho é satisfeito por um elemento que não existe).

## 2. Os falsy encontrados: 46, e NENHUM muda comportamento

`node tools/falsy-do-contrato.mjs` — 141 campos numéricos/booleanos do
contrato × 4 famílias (`campo || padrão` e ternário; `!campo`; `if (campo)`;
`filter(Boolean)`) = **46 sítios**. Conferidos um a um:

| resultado | quantos |
|---|---|
| o fallback é **o próprio 0** → mesmo número dos dois jeitos | 8 |
| `Number(order.X) || 0` no bloco de dinheiro do perfil — idem | 7 |
| `Math.max(1, Number(max_select \|\| 1))` — é o `Math.max` que iguala os dois lados, não o operador | 4 |
| já perguntam `Number.isFinite` antes de decidir — **a forma certa** | 7 |
| `is_open`, que chega normalizado a booleano de verdade | 2 |
| booleano em que `false` significa exatamente "não faça" | 2 |
| `weekday: 0` → `DIAS_DO_CONTRATO[0]` = `Segunda-feira`, truthy | 1 |
| falso positivo da régua (variável local, string de estado, DOM, config) | 15 |
| **mudam comportamento alcançável** | **0** |

**A família estava fechada.** As quatro cadeias de `sort_order` corrigidas em
31/08 eram todas as que existiam nessa forma — não uma amostra. A régua foi
validada contra o defeito conhecido antes de eu acreditar na resposta dela, e a
primeira versão dela era cega ao caso mais comum daqui (`Number(x.campo) || y`).

**O que ela achou não foi defeito, foi buraco na rede:** `sort_order` vale
`@default 0` em SEIS schemas e a rede cobria QUATRO. `ProductOptionGroupResponse`
e `ProductOptionResponse` estavam certos e sem teste — um `||` de volta ali
passaria por tudo, e a opção de menor ordem (o "sem nada", o mais barato, o que
abre a lista) cairia para o fim. Três casos novos, dois vistos vermelhos.

## 3. Linhas do `restaurant-page.js`: 5.628 → 5.643

**+15, e nenhuma de movimento.** São a linha de desconto do item 1, o comentário
dela, e o comentário do acessor do Pix. Zero código migrado — ver o item 4.

## 4. Recusado por medida, com o motivo

| o quê | medida | motivo |
|---|---|---|
| **Folha de confirmação** | 119 l / 27 fios = **4,4 l/fio** (piso 10) | ela ESCREVE o token de uso único do gateway (`:2134`), mais `orderSubmitInFlight` e `confirmedTotalAtSubmit`. Migrar exige porta de ESCRITA de uma tela para o fechamento — a única coisa que o contrato de telas proíbe |
| **Troca de filial** | 314 l / 84 fios = **3,7 l/fio** (a aferição) | `clearBranchScopedSelection()` zera as quatro variáveis de pagamento na MESMA transação do cupom. Ela é dona de um pedaço do estado do checkout |
| Os outros seis blocos | 2,4 a 6,0 l/fio | nenhum alcança o piso; a tabela está no item 3.4 |
| **A régua nova, aplicada** | — | a §9.1 avisa que a medida de bloco subestima um corte `mount(ctx)`. Aplicada, ela recusa por um motivo mais duro que o número: **de quem é o estado** |

E o que mudou nesta rodada não foi a conclusão, foi a prova: o custo de errar
uma travessia deixou de ser suposto. `selectedSavedCard` — uma das quatro que a
folha teria de atravessar — cruzou a fronteira de UM módulo por valor, uma vez,
e virou uma condição permanentemente falsa no caminho do pagamento, invisível a
lint, typecheck, 299 unitários e 302 E2E.

## 5. Números de dinheiro que mudaram: NENHUM

O total, o subtotal, a taxa de serviço, a taxa de entrega e o desconto que o
cliente paga são exatamente os mesmos. O que mudou foi o que ele **vê**:

- uma linha que já existia no dado (`cartTotals().discount`) passou a ser
  desenhada. Nenhum valor foi recalculado, e o número é `discount_amount` do
  contrato;
- o cartão do pedido na tela de pagamento passou a dizer o nome da LOJA em vez
  do nome da plataforma. É nome, não dinheiro.

Producao inteira nesta rodada: **3 arquivos, 50 linhas** —
`restaurant.html` (a linha de desconto),
`scripts/pages/restaurant-page.js` (+19: a linha de desconto e os dois
acessores) e `scripts/pages/restaurant-pix-flow.js` (+39: o `S`, o
`ESTADO_OBRIGATORIO` e tres leituras com prefixo). O resto sao testes,
ferramentas e prosa.

## 6. Escapes e bloqueados por backend

### Escapes pendentes (8 — dos 8 anteriores, 1 fechou e 1 entrou)

| # | escape | estado |
|---|---|---|
| 1 | `auth-screen-nav.spec.js:105` | herdado, nunca reproduzido |
| 2 | `order-flow.spec.js:163` | herdado, só dentro de travamento de máquina |
| 3 | `pix-payment.spec.js:116` | herdado, o `307,6` continua sem explicação |
| ~~4~~ | ~~a sacola não mostra a linha de desconto~~ | **FECHADO nesta rodada (item 1)** |
| 5 | `restaurant-club.js:146` precedência latente | herdado |
| 6 | `address-service.js:25` precedência DE PROPÓSITO | herdado, documentado |
| 7 | `menu-service.js:181,193` cadeias fantasma inofensivas | herdado |
| 8 | `provider_error_code` existe e ninguém lê | herdado |
| **9** | **`assistant-voice-session.spec.js:472`** | **NOVO.** O teto de inatividade sob teste é **8 s** e o preparo (`conversar()`) tem direito a **15 s + 10 s = 25 s**, contados de depois que o contador já começou. É o `:491` de novo, com números três vezes piores. Não corrigido: subir o teto leva o teste de ~13 s para ~35 s e exige `test.setTimeout` próprio, e mudar orçamento de relógio sem medir os dois braços é palpite |

**A conta bate em 8 e está NO LIMITE.** Se a dúvida da taxa de serviço abaixo
for contada como escape em vez de bloqueio de backend, são **9** — que é a
condição de parada do prompt. A rodada para aqui de qualquer forma, com os cinco
itens fechados.

### Bloqueados por backend

**UM NOVO, e é o mais importante desta rodada:**

**A taxa de serviço pode estar saindo do total quando um cupom entra.**
`CouponPreviewRequest` tem `additionalProperties: false` e cinco campos, nenhum
de taxa de serviço — o front **não pode** enviá-la. E `cartTotals()` troca o
total INTEIRO pelo `total_after_coupon`. As duas leituras possíveis:

| leitura | a favor dela |
|---|---|
| **a resposta NÃO inclui a taxa** | ela devolve `subtotal` e `delivery_fee` como `required` e **não** devolve `service_fee`, ao contrário do `CreateOrderResponse`; e a requisição EXIGE que o cliente informe o `delivery_fee`, ou seja o preview orça o que recebe |
| **inclui** | a rota é por slug, o backend sabe o `service_fee_amount`; e todos os fixtures deste repositório assumem isso (`club-coupons:181` só fecha somando a taxa) |

Os fixtures são a assunção de quem os escreveu, não uma resposta capturada.
**Não mexi no número**, e o motivo é a regra da rodada: número de dinheiro não
muda por aposta.

**E a pergunta já está instrumentada — não falta código, falta ler o log.**
`evaluateTotalMismatch()` (`:3337`) chama `logAppError` com
`confirmado=X pedido=Y`. Se a primeira leitura estiver certa, **todo pedido com
cupom e taxa de serviço já está registrando**:

```
Total divergente entre a confirmação e o pedido criado
confirmado=71.00 pedido=71.99      → diferença = +0,99 = service_fee_amount
```

e o cliente já está vendo *"O total ficou R$ 71,99, acima dos R$ 71,00 que você
confirmou."* Uma diferença constante, igual à taxa de serviço, só em pedidos com
cupom, **prova** a primeira leitura. Nenhuma ocorrência prova a segunda.

E a rede já está pronta para a correção: a injeção C do item 3.1 mostrou que
**7 dos 13 testes** acordam se a taxa sair do total, cada um com o centavo
exato. A correção, se vier, não será feita no escuro.

### Herdados, sem mudança

`old_price`, `ChatResponse.options`, `recommendation_reason`; a recusa de cartão
sem rota de cancelamento (`docs/order-contract.md`, item 11); Places API (New)
com os dois bloqueios.

## 7. O que eu faria diferente

1. **Matar o `npm run preview` depois de usar a captura de telas.** Deixei um de
   pé e `reuseExistingServer` fez o Playwright medir a árvore da captura por
   várias execuções — a injeção A do item 3.1 passou VERDE com o defeito dentro.
   A regra de higiene falava em porta ocupada; o perigo maior é o servidor velho
   **atender calado**.
2. **Escrever o fixture pensando na injeção, não na asserção.** Duas das minhas
   fixtures novas nasceram com os dois caminhos coincidindo — a armadilha que o
   cabeçalho daquele arquivo denuncia, cometida dentro dele. Quem as pegou foi a
   injeção, não a revisão.
3. **Desconfiar do próprio verde de uma varredura nova.** A varredura das
   fotografias acusou ONZE na primeira versão e DOIS na correta; a do falsy
   achava 25 sítios e perdia justamente os sete do bloco de dinheiro. Nas duas
   vezes o conserto veio de rodar a régua contra um caso cuja resposta eu já
   sabia — e é por isso que a guarda que ficou tem sonda contra passar por
   vacuidade.
4. **Ler a duração antes da mensagem, de novo.** Os dois vermelhos de voz eram
   de carga, e eu li a asserção antes de olhar para os 22,2 s e para o
   `--workers=1` isolado. A taxonomia da §11 existe para gastar dez segundos
   nisso — e o número que decide é a DISTRIBUIÇÃO, não o tempo total: a
   execução verde tinha **7** testes acima de 10 s e a suja tinha **43**, na
   mesma árvore.
5. **Corrigir a FAMÍLIA, não a instância — e eu já tinha lido a lição.**
   Consertei o teto herdado de um poll (`:381`) e deixei três irmãos idênticos
   de pé; um deles (`:724`) caiu na execução seguinte com a mensagem
   **idêntica, caractere por caractere**. A rodada anterior escreveu isso com
   todas as letras ("migrei os 52 sítios da espera de boot, e não só o que
   falhou") e eu li antes de começar. Quando a causa é do FORMATO e não do
   teste, ou se corrige a família inteira ou ela volta pelo irmão. Custou duas
   execuções da suíte para reaprender.

## O lote de confirmação (árvore final)

Higiene antes de cada execução: node órfão morto, porta 4174 conferida livre.

| execução | resultado | tempo | testes acima de 10 s |
|---|---|---|---|
| conf 1 | 301 passed · **1 failed** | 6,8 min | 11 |
| conf 2 | **302 passed** · 0 failed | 6,4 min | 9 |
| *(descartada — família C)* | *279 de 305, travada* | *>10 min* | ***141*** |
| conf 3 | **302 passed** · 0 failed | 6,3 min | **6** |

**Duas limpas de duas medições válidas**, mais uma execução descartada e um
vermelho que não é do código. A contagem honesta está abaixo.

### A descartada, e por que descartar foi medida e não conveniência

Ela travou em 279 de 305, com **141 testes acima de 10 s** (contra 6 a 11 nas
saudáveis, na MESMA árvore), um deles com **1,5 minuto**, e a memória livre da
máquina em **442 MB**. É a família C da §11 ao pé da letra: *"um ou mais testes
com duração em MINUTOS, e uma dezena de irmãos estourando o teto juntos —
descarte a execução, não é medição."*

O que confirma que era a máquina e não a árvore: depois de matar os processos e
esperar, a memória livre voltou de **442 MB para 1.445 MB**, e a execução
seguinte, na mesma árvore, fechou **302/302 com 6 testes lentos** — o melhor
número do lote inteiro. O registro dela fica em
`scratchpad/conf-sacola-resumo.txt` — o log bruto NÃO, porque `*.log` é
gitignored aqui e a convenção do repositório é o `-resumo.txt` (foi assim em
caça, g2, portão, prova e conf). Descartar sem deixar registro é pedir para a
próxima pessoa duvidar; deixá-lo onde a convenção o coloca é o que faz o
registro ser encontrado.

### O vermelho da conf 1 não é dos três tipos conhecidos — é um QUARTO

```
Error: write UNKNOWN
   at helpers.js:403   (o waitForFunction de esperarAppPronto)
```

Aos **5,9 s**, sem `Expected`, sem `Received`, sem `Test timeout`. `write
UNKNOWN` é erro de libuv escrevendo num handle morto: o processo do Chromium
caiu ou o pipe do driver quebrou. A pilha aponta para o `esperarAppPronto` e a
tentação é mexer no helper — mas ele não afirma nada ali, só estava esperando
quando o cano fechou.

Entrou na taxonomia da skill como **família D — "o cano quebrou"**, com a regra
que a separa da família A em dez segundos: **A tem `Expected`/`Received`, D não
tem.** As duas execuções seguintes fecharam 302/302 sem que uma linha fosse
tocada.

### A família de polls, corrigida entre um lote e outro

O lote ANTERIOR foi encerrado de propósito — eu ia mudar a árvore, e uma
sequência que mede árvores diferentes não quer dizer nada. Antes de encerrar,
ele entregou o que importava: `:724` caiu com a mensagem **idêntica caractere
por caractere** à do `:381` que eu tinha consertado uma execução antes.

Havia **três** irmãos com a mesma forma — `:442`, `:458` e `:742` — todos
esperando um `response.create` VOLTAR pelo canal de dados depois de um
`emitir()`, todos herdando os 5 s do `expect` enquanto os irmãos do MESMO teste
carregam `{ timeout: 10000 }` escrito e esperam menos. Os três ganharam o mesmo
teto, com o comentário de família escrito uma vez.

E a distribuição, que é o número que decide se uma execução presta:

| execução | tempo | testes acima de 10 s |
|---|---|---|
| a limpa | 6,3 min | **6** |
| a suja (o lote anterior) | 9,0 min | **43** |
| a travada (descartada) | >10 min | **141** |

Um `grep` de um segundo separa "achei um flake" de "medi uma máquina ocupada".
Essa conta e a lição da família entraram na §11 da skill.
