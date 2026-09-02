# Rodada noturna — 02/09/2026

**Fonte da verdade desta rodada.** Ao retomar depois de compactação: releia este
arquivo INTEIRO antes de qualquer coisa e continue do que ele diz, nunca da
lembrança.

Branch: `rodada/noturna`. Nunca commitar na `main`. Um commit por item, verde,
com push. Portão sem pipe (`| tail` engole o exit code — §5.1 armadilha 5 e
§11 higiene 3 da skill).

## Regras desta rodada (do prompt)

- O job de **deploy do CI está quebrado de propósito** e vai ficar vermelho.
  Não mexer no `ci.yml`, não tentar consertar. O que importa é o `verify`.
- FORA da rodada: sacola · checkout · `cartTotals` · folha de confirmação ·
  troca de filial · `ci.yml`/deploy · login com Google · voz no app · tela do
  assistente · merge na main.
- PARAR se: número de dinheiro mudar sem motivo conhecido · decisão de produto
  não escrita · mesmo portão vermelho 3× no mesmo item · precisar mexer no
  backend.

## Higiene de medição (§11 da skill)

- Antes de medir E2E: matar node órfão de `vite preview`/playwright e conferir a
  porta **4174** livre. `reuseExistingServer` faz o Playwright reaproveitar um
  `preview` velho e **nunca reconstruir** — o sintoma é experimento que não
  reprova o que deveria.
- NÃO editar spec no meio de um lote.
- Distribuição decide se a execução presta: contar testes acima de 10 s.

---

## Estado dos itens

| item | assunto | estado |
|---|---|---|
| 0 | scratchpad + branch | **feito** |
| 1 | os 8 escapes pendentes | **feito** — 2 fechados (#5 e #7), 5 mantidos com motivo, 1 virou o item 2 |
| 2 | `pix-payment:116` | **feito** — mecanismo PROVADO por reprodução, gatilho aberto; sem quarentena |
| 3 | testes dependentes da hora | **feito** — 1 bomba de data desarmada, 4 esperas convertidas, 1 conversão revertida por medida |
| 4 | chips chumbados `restaurant.html:462-470` | **feito** — markup fora, guarda de markup vermelha antes |
| 5 | fluxo de cupons | **feito no que dá** — 8 entregas; 3 bloqueadas por backend e 2 por ordem técnica, todas com motivo escrito |

## AMBIENTE — leia antes de rodar portão

`node_modules` chegou nesta sessão **sem `typescript`, `openapi-typescript` e
`@types/node`**: `npm run typecheck:cards` respondia `'tsc' não é reconhecido`
e — ATENÇÃO — pelo Bash isso saía com **exit 0**, ou seja o portão se pulava em
silêncio. `npm install` (02/09/2026) resolveu, **sem tocar no
`package-lock.json`**. Se o typecheck voltar a "passar" instantaneamente,
confira `ls node_modules/.bin/ | grep tsc` antes de acreditar.

---

## Item 1 — os 8 escapes herdados

Lista de partida (de `rodada-sacola.md` §6, que já fechou o antigo #4):

| # | escape | herdado de | estado ao entrar |
|---|---|---|---|
| 1 | `auth-screen-nav.spec.js:105` | checkout | nomeado, nunca reproduzido |
| 2 | `order-flow.spec.js:163` | checkout | caiu 1× dentro de travamento de máquina |
| 3 | `pix-payment.spec.js:116` | checkout | `307,6` sem explicação → **é o item 2 desta rodada** |
| 5 | `restaurant-club.js:146` precedência latente | checkout | inofensivo hoje, inverte quando o backend publicar |
| 6 | `address-service.js:25` precedência DE PROPÓSITO | checkout | documentado |
| 7 | `menu-service.js:181,193` cadeias fantasma | checkout | inofensivas |
| 8 | `provider_error_code` existe e ninguém lê | checkout | melhoria da tela de recusa |
| 9 | `assistant-voice-session.spec.js:472` | sacola | teto de 8 s com preparo de 25 s |

(Numeração preservada de propósito — o antigo #4 fechou na rodada da sacola.)

### O que saiu: 2 fechados, e a família era MAIOR que o escape

O escape #5 estava escrito como UM sítio (`restaurant-club.js:146`,
`short_description || description`). Ao varrer a família — a lição da §11 da
skill, "corrigido o sítio, varra a FAMÍLIA, senão ela volta pelo irmão" —
apareceram **30 sítios em 6 arquivos**, e três deles ninguém tinha nomeado:

| arquivo | o fantasma | vencia quem |
|---|---|---|
| `restaurant-club.js:146` | `short_description` | `description` (o escape #5) |
| `coupon-detail-screen.js:75` | `expires_at` | `valid_until` — **novo** |
| `screens/home-screen.js:243` | `title` em cupom PÚBLICO | `name` — **novo** |
| `coupon-format.js:42-43` | `type`, `value`, `amount` | `discount_type`, `discount_value` — **novo** |
| `menu-service.js:186-191,198-203` | `uuid`,`title`,`name`,`subtitle`,`description`,`imageUrl`,`image`,`order` | ninguém: o escape #7 |
| + fallbacks mortos em club e detalhe | `coupon_id`,`coupon_code`,`min_subtotal`,`minimum_order_value`,`end_date`,`valid_to`,`banner_url`,`cover_url`,`image`,`image_path` | — |

**Nenhum deles mudava um pixel hoje**: fantasma lê `undefined` sempre. Os dois
preços são (1) código que MENTE para quem lê e (2) a inversão silenciosa no dia
em que o backend publicar aquele nome.

### A armadilha que essa varredura descobriu, e que uma regra única quebraria

`name` e `title` são o **mesmo campo em dois esquemas**, e qual é o certo
depende de QUEM está lendo:

| esquema | o rótulo do cupom se chama | quem lê |
|---|---|---|
| `PublicCouponResponse` | **`name`** | o trilho da Home (feed do `/menu`) |
| `CustomerCouponResponse` | **`title`** | o card do Clube (`/coupons`) |

E a **folha de detalhe recebe os DOIS**: `getCouponForDetail()`
(`restaurant-page.js:4855`) procura primeiro na lista do Clube e cai para o feed
do cardápio. Lá `coupon.name || coupon.title` **não é defeito** — é normalização
deliberada de dois contratos, a mesma figura do escape #6
(`address-service.js:25`). Uma regra do tipo "sempre prefira `title`" quebraria
o trilho da Home; por isso a guarda é por ARQUIVO, com os esquemas declarados.

### A guarda: `tests/unit/contract-field-names.test.js`

12 testes. Para cada alvo, dois: uma **sonda contra vacuidade** (a varredura
ainda enxerga nomes que sabidamente existem — sem ela, uma regex que parasse de
casar faria a afirmação passar sem olhar para nada) e a afirmação em si.

Vista vermelha ANTES da correção: **6 falharam, 6 sondas passaram**, nomeando os
30 sítios com arquivo:linha. Uma correção intermediária foi necessária no
próprio stripper — o `replace` do comentário de bloco por um espaço colapsava o
arquivo e a linha relatada apontava para outro lugar; hoje ele preserva as
quebras.

Fora da guarda **de propósito**: `restaurant-page.js` (o arquivo do dinheiro,
não aberto para isto nesta rodada). Os três sítios de cupom dele foram
conferidos à mão em 02/09/2026 e os três já têm o nome do contrato na frente:
`:712`, `:4805`, `:4806`.

### Os que ficam, com o motivo

| # | escape | por que fica |
|---|---|---|
| 1 | `auth-screen-nav.spec.js:105` | nunca reproduzido (0 em 7+ execuções saudáveis, incluindo a desta rodada). Sem vermelho não há causa a ler, e `fixme` num teste que passa troca suspeita por perda REAL de cobertura |
| 2 | `order-flow.spec.js:163` | idem, e é o único guardião da Idempotency-Key reaproveitada na retentativa — que é dinheiro |
| 3 | `pix-payment.spec.js:116` | **é o item 2 desta rodada** |
| 6 | `address-service.js:25` | precedência DE PROPÓSITO: `normalizeAddress` normaliza a forma da API e a que ele mesmo grava no localStorage. É a MESMA figura da folha de detalhe do cupom, agora documentada nas duas pontas |
| 8 | `provider_error_code` | a tela onde ele cabe é a de recusa de cartão — **checkout de pagamento, fora desta rodada** (item 6 do prompt) |
| 9 | `assistant-voice-session.spec.js:472` | **voz no app está fora desta rodada** (item 6 do prompt). Continua com os números medidos: teto de 8 s, preparo com direito a 25 s |

**Contagem: 6 escapes abertos** (era 8). Abaixo do limite.

### Verificação do item 1

- `npm run lint` — `78 problems (0 errors, 78 warnings)`, todos herdados
- `npm run typecheck:cards` — exit 0 (depois do `npm install`, ver AMBIENTE)
- `npm run test` — **315 passed** (28 arquivos); eram 303 + 12 da guarda nova
- `npm run test:e2e` — **302 passed · 3 skipped**, exit 0, 4,9 min,
  **6 testes acima de 10 s** (a linha de base limpa tem 6–9; a suja tinha 43)

Nenhum número de dinheiro mudou: as 30 trocas removem nome que lia `undefined`.

---

## Item 2 — `pix-payment.spec.js:116`, o `307,6`

### Não reproduz, e isso foi MEDIDO

20 execuções isoladas do teste, `--repeat-each=20 --workers=4` (contenção de
propósito): **20 de 20 verdes**, com durações subindo de 7 s a 17 s — ou seja
com a máquina de fato ocupada. Mais duas suítes completas verdes na rodada.

### A lei, por sonda em quatro larguras

Uma sonda temporária (`_sonda-pix116.spec.js`, apagada depois) mediu painel,
rodapé e CTA a 1280, 989, 767 e 390 px:

| viewport | painel | offset `cta.x − footer.x` |
|---|---|---|
| 1280 | 414 | **20** |
| 989 | 414 | **20** |
| 767 | 767 | 196,5 |
| 390 | 390 | 16 |

    offset = (larguraDoPainel − 374) / 2

(rodapé com 16px de padding + CTA `width:374px; margin:0 auto`, `pix.css:682`.)

### 307,6 é ARITMETICAMENTE INALCANÇÁVEL neste CSS

São três regimes, e só três:

| regime | painel | offset |
|---|---|---|
| `pix.css` valendo, viewport ≥ 768 | 414 | 20 |
| `pix.css` valendo, viewport ≤ 767 (`@media`, `pix.css:55`) | viewport | ≤ 196,5 |
| `pix.css` ausente (`.modal` de `restaurant.css:380`, `max-width:600px`) | 600 | 113 |

307,6 exige painel de **989,2 px**. Acima de 767 o teto de 414 é absoluto;
abaixo dele o máximo é `(767−374)/2 = 196,5`. Conferido folha por folha: não há
`@media`, `zoom` nem regra de `.modal--fs` neste repositório que solte o teto
numa largura de ~989.

### E o mecanismo foi REPRODUZIDO

Com `#pixPaymentModal .modal{max-width:989.2px!important}` injetado por
`addStyleTag`, o Chromium arredonda para **989,1875** e a linha lê
**307,59375** — o mesmo número, até a última casa, do vermelho de 31/08/2026.
Largura (374) e altura (45) do CTA seguem corretas na injeção, exatamente como
estavam naquela falha.

**O QUE aconteceu está provado: o painel ficou com 989,19 px. O POR QUE
continua aberto.**

### O que mudou no teste, e por que NÃO houve quarentena

A afirmação do offset sozinha embute TRÊS fatos — painel 414, CTA 374, CTA
centrado — e, ao falhar, não nomeava nenhum. Entrou uma linha ANTES dela:

```js
expect(footerBox.width, 'o painel do Pix perdeu o teto de 414px').toBeCloseTo(414, 1);
```

Vista vermelha com a injeção: `Expected: 414 / Received: 989.1875`. Se o
vermelho voltar, ele diz o que procurar.

Quarentena foi recusada: o teste passa 20/20 sob contenção e duas suítes
inteiras, e é ele quem guarda a geometria do CTA, o peso de fonte que o Inter
realmente carrega (700, não 650) e a cor da marca em três elementos. `fixme`
aqui trocaria uma dúvida por uma perda real. Timeout não foi tocado.

### Verificação do item 2

`lint 78 problems (0 errors)` · `test:e2e 302 passed · 3 skipped`, exit 0,
3,9 min, **4 testes acima de 10 s** · 20/20 isoladas sob contenção.

---

## Item 3 — testes que dependem da hora

### 3.1 Leitura de relógio REAL (`new Date()` / `Date.now()` sem injeção)

Varridos `tests/` e `scripts/`. O que existe, e o veredito de cada um:

| sítio | o que faz | veredito |
|---|---|---|
| `card-payment-flow:65` e `payment-card-validation-timing:63` | o SDK falso do Mercado Pago valida a validade do cartão contra `new Date()` | **CORRIGIDO** — ver 3.2 |
| `mercado-pago-secure-fields:117,118,183` | o SDK REAL valida contra o relógio de verdade | **CORRIGIDO** — ver 3.2 |
| `maps-autocomplete:150` | `expect(Date.now()-t0).toBeGreaterThanOrEqual(3000)` | fica: direção SEGURA (máquina lenta só aumenta o medido) |
| `maps-autocomplete:156` | `expect(Date.now()-t1).toBeLessThan(3000)` | **CORRIGIDO** — direção insegura |
| `csp:40,42` | `Date.now()+15_000` como teto de um laço de amostragem | fica: teto de laço, não afirmação |
| `profile-order-tracking:26` | `created_at = agora − 2 min` | fica: relativo a agora, e `profOrderRelativeDate` (`profile-screen:153`) não tem ramo "hoje/ontem" — não há penhasco de meia-noite |
| `assistant-voice-session:35` | `expires_at` relativo a agora | fica: relativo |
| `tenant-theme:198` | `new Date('2026-08-29T12:00:00Z')` com `clock.install` + `pauseAt` | **EU CLASSIFIQUEI ERRADO. Corrigido depois — ver §3.6** |
| `order-tracking.test:173,177` e `service-caches.test:18` | `vi.setSystemTime` | fica: relógio injetado, que é o certo |
| `restaurant-auth-flow:185` | validade de data de nascimento contra `new Date()` | fica: é a regra de produto (não aceitar nascimento futuro), e as fixtures usam `1990-04-12` |
| `cashback-statement.js:7` | `toLocaleDateString('pt-BR')` converte para o fuso LOCAL | fica: nenhum teste afirma a data, e mostrar a data local é o comportamento certo. **Anotado**: num fuso a leste de UTC uma transação de madrugada mostra o dia seguinte |

**E um negativo que vale escrever: o horário da loja NÃO lê o relógio.** "Está
aberto?" vem de `is_open` e "que dia é hoje?" vem de `current_weekday`, os dois
do backend (`store-info-format.js:54`, `store-info-screen.js:184`). Por isso
`store-hours.spec.js` compara a linha destacada com `INFO.current_weekday` da
própria fixture, e passa em qualquer dia da semana. Era o candidato mais óbvio
da varredura e está certo.

### 3.2 A bomba de data: `11/31`

Três sítios digitavam a validade `11/31` num cartão de teste, e quem confere é
o relógio REAL nos dois lados (o mock e, em `mercado-pago-secure-fields`, o SDK
de verdade). **Em 01/12/2031 os três passariam a recusar o cartão** e a suíte
ficaria vermelha sem uma linha de código ter mudado — a mesma classe do teste
que só quebrava entre 00:00 e 01:30, com a virada em anos em vez de em horas, e
por isso pior: quando estourar, ninguém vai lembrar deste literal.

**Visto vermelho:** com `11/24` (já vencida) no lugar, `card-payment-flow` cai
— `#creditCardModal` não fecha, 14 tentativas. É exatamente o que acontecerá em
01/12/2031.

Passa a valer `validadeFutura()` em `tests/e2e/helpers.js`: `11/<ano+5>`.

### 3.3 Espera por tempo em vez de espera por condição

Eram 28 sítios. **Quatro corrigidos, e um quinto REVERTIDO depois de medido.**

| sítio | o que virou |
|---|---|
| `maps-autocomplete:156` | a medição de parede saiu; `calls.novo === 1` já provava o mesmo, melhor |
| `menu-scrollspy` (`bootMenu`) | `waitForTimeout(500)` → `waitForFunction(() => .cat.active)` |
| `menu-scrollspy:118` | `waitForTimeout(600)` → `expect.poll(activeSlug).toBe(slugs[0])` |
| `image-framing:67,75` | `waitForTimeout(2500)` ×2 → espera por 4 derivadas `complete && naturalWidth > 0` |
| `overlay-blur:119` | `waitForTimeout(700)` → afirmação com retentativa, teto explícito de 2 s |
| ~~`menu-scrollspy` `scrollToSection`~~ | **REVERTIDO** — ver abaixo |

Sobram **24** `waitForTimeout`, e cada um tem motivo escrito:

- **Asserção NEGATIVA** (não há condição a esperar; só se pode dar tempo para
  algo *não* acontecer): `club-coupons:145`, `order-flow:286`,
  `menu-image-loader:82`, `lifecycle:91`, `boot-smoke:103,137`.
  A forma que os melhoraria é a *requisição-sentinela* — disparar uma chamada
  conhecida e esperar por ela, já que qualquer coisa que a tela tenha disparado
  saiu antes. Não feito nesta rodada; anotado.
- **Intervalo de amostragem dentro de um laço por condição**: `csp:50`
  (comentado no próprio arquivo), `lifecycle:145`.
- **Tempo real de propósito**: `pix-payment:809` (comentado), `pix-payment:560`
  (atravessar a janela de 10 min é o próprio teste).
- **Fora desta rodada** (voz e assistente, item 6 do prompt): `assistant-screen`
  ×2, `assistant-voice` ×1, `assistant-voice-session` ×7.
- **Fora desta rodada** (checkout / cartão): `order-flow:251`,
  `mercado-pago-secure-fields:180`. Anotado que `order-flow:251` é redundante —
  a linha seguinte já é uma afirmação com retentativa.
- **`menu-scrollspy:60,62`**: ver abaixo. Ficam por MEDIDA.

### 3.4 O experimento que REPROVOU minha própria correção

`scrollToSection` faz cinco rolagens de 350ms mais 400ms de sobra, e parecia o
vício clássico. Troquei por um laço que reaplica a rolagem até o topo da seção
parar de andar por três quadros. O experimento de dois braços, com a CPU
estrangulada por CDP (`Emulation.setCPUThrottlingRate`):

| taxa | braço A (antigo) | braço B (novo) |
|---|---|---|
| 4× | 3 passed | 3 passed |
| 8× | 3 passed | — |
| 14× | **3 de 3 execuções verdes** | 2 verdes, **1 com dois vermelhos** (2,2 min contra 1,1 min) |
| 20× | estoura o teto de 30 s | estoura o teto de 30 s |

Duas conclusões, e a segunda é a que importa:

1. **O experimento não discrimina acima de 14×**, porque ali o teste inteiro já
   está perto do teto de 30 s nos dois braços — o que falha é o orçamento, não
   a espera. Estrangular mais não é medir melhor.
2. **A troca era ERRADA por desenho.** A afirmação que essas esperas alimentam
   compara `expectedSlug` com `activeSlug` **lidos no mesmo instante** — ela não
   depende de onde a rolagem parou, e o comentário de `expectedSlug` já dizia
   isso. "Esperar assentar" ACRESCENTA uma dependência que a afirmação nunca
   teve; sob carga, com as fotos entrando por lazy-load, o assentamento pode não
   chegar nunca. A mesma armadilha derrubou a primeira versão da espera de
   `image-framing` (exigia TODAS as imagens `complete`, e no cardápio isso
   estourou 30 s).

**A regra que fica:** espera por tempo que alimenta uma comparação de duas
leituras do MESMO instante **não é a espera ruim**. A ruim é a que aposta em
quando um efeito terá acontecido. Antes de trocar, pergunte de que a afirmação
depende — não de que a tela depende.

### 3.5 O que NÃO foi visto vermelho, e está dito assim

O filtro `naturalWidth > 0` de `image-framing` fecha um buraco real (imagem em
voo dá `naturalWidth 0`, a proporção vira `NaN`, e `Math.abs(NaN - x) > 0.04` é
**falso** — ela passava como se estivesse certa). Mas **não consegui reproduzir
o passe silencioso nesta máquina**: sem espera nenhuma, os dois braços passaram
(7,2 s e 6,5 s), porque aqui as derivadas chegam rápido demais. A correção está
justificada por construção, não por vermelho observado.

---

## Item 4 — os seis chips chumbados

### O que era

`restaurant.html:458-471`, dentro de `#profSubpagamento`: um cartão afirmando
"O pagamento é realizado diretamente no estabelecimento" mais **seis chips**
escritos à mão — Pix, cartão de crédito, cartão de débito, vale-refeição,
vale-alimentação e dinheiro. A lista de UM restaurante servindo de esqueleto
para todos, num app white-label. `tests/fixtures/info.json` (cópia fiel da
produção) mostra que ESTA filial aceita PIX no grupo online e só crédito/débito
no de entrega: **nada de vale, nada de dinheiro**. E "pago no estabelecimento" é
falso para quem paga PIX online.

### A premissa que a sonda CORRIGIU

Entrei supondo um flash: app sobe, /info em voo, a pessoa abre Perfil →
Pagamento e lê a lista errada. **Medido: esse flash não existe.**
`openProfSub('pagamento')` (`screens/profile-screen.js:440`) troca o corpo por
"Carregando formas de pagamento..." sempre que `restaurantInfoState.status !==
'success'` — ou seja ele já cobria os seis chips antes de a subtela aparecer.

Escrevi um E2E que afirmava ver o flash e ele **falhou**, o que foi a sorte da
rodada: um teste assim passaria pelo motivo errado (§3.3 da skill). A sonda
mostrou o que de fato acontece — `document.querySelectorAll('.prof-pay-chip')
.length === 6` logo depois do boot, mas o corpo trocado ao abrir.

O que sobra é real: os chips **estão no DOM de toda loja**, alcançáveis por
leitor de tela e busca na página, e servem de esqueleto para quem mexer nessa
tela.

### O que ficou

- **Vermelho visto**: `tests/unit/white-label-markup.test.js`, 3 de 4 falhando
  (a quarta é a sonda contra vacuidade, que passou). Guarda que o
  `#profSubpagamento` não escreve chip, não afirma onde o pagamento acontece e
  não nomeia forma de pagamento nenhuma.
- Markup removido; `<div class="prof-sub-body"></div>` com o motivo escrito ao
  lado.
- **Rede**: `tests/e2e/profile-payment-methods.spec.js`, 2 testes. O primeiro
  prova que a tela desenha exatamente o que o `/info` da filial devolveu, com
  os rótulos vindos da FIXTURE (uma lista à mão no teste seria o mesmo defeito
  um andar acima). O segundo segura o `/info` e prova que o estado sem resposta
  é "Carregando", nunca uma lista.
- Nenhum dos dois E2E foi visto vermelho, e está dito assim: eles são rede de
  regressão, não a prova do defeito. A prova é a guarda de markup.

### Anotado, fora da rodada

`#paymentMethodModal` (`restaurant.html:1341`) também tem um botão de **PIX**
escrito à mão. É a tela de CHECKOUT — fora desta rodada — e o caso é diferente:
o app mostra ou esconde aquele botão conforme `/payment-config` e `/info`, em
vez de ignorá-lo. Fica na lista.

`#profSubcupons` (`restaurant.html:477`) é uma subtela do Perfil que diz
**sempre** "Nenhum cupom disponível", com markup estático e nenhum código que a
preencha — e é alcançável pela linha "Cupons" do Perfil. Vai para o item 5.

### Verificação do item 4

`lint 78 problems (0 errors)` · `typecheck:cards` exit 0 · `test 319 passed`
(29 arquivos) · `test:e2e 304 passed · 3 skipped`, exit 0, 5,4 min,
**3 testes acima de 10 s**.

---

## Item 5 — o fluxo de cupons

### 5.0 O que o backend JÁ devolve hoje (levantado antes de codar)

Três rotas, todas por slug de restaurante:

| rota | o que faz | quem chama hoje |
|---|---|---|
| `GET /restaurants/{slug}/coupons` | a lista do cliente, **com o estado já decidido** | `club-service.getCustomerCoupons` |
| `POST /restaurants/{slug}/coupons/preview` | valida UM cupom contra a sacola | `club-service.previewCoupon` |
| `POST /restaurants/{slug}/coupons/claim` | **digitar um código sem sacola** | **NINGUÉM — não está ligado no front** |

**`GET /coupons` aceita `subtotal`, `delivery_fee` e `order_type` como query, e
os três são OPCIONAIS.** O `@description` da rota diz o que isso significa, e é
exatamente a regra dura do prompt: *"Sem `subtotal` a rota responde a tela do
Clube... Com `subtotal` ela responde a tela do checkout."* Ou seja **a mesma
função do backend decide nos dois lugares** — não há o que construir aqui, só o
que usar. `getCustomerCoupons` já monta a query.

`CustomerCouponResponse` (o que cada card recebe pronto):
`code, description, discount_amount, discount_type, id, image_url, label,
min_order_value, missing_amount, state, title, valid_until`.

`CustomerCouponState` = **`applicable` | `missing_amount` | `login_required`**,
e o `@description` dele já implementa a decisão "cupom indisponível aparece SÓ
quando existe ação que destrava": *"Nao ha valor para 'nao aparece': cupom sem
conserto nesta sacola — vencido, primeira-compra para quem ja comprou, de outro
segmento, teto estourado, cooldown correndo — simplesmente nao entra na lista."*

`CustomerCouponLabel` = **`selected_for_you`**, e um só. O `@description` já
escreve a decisão da etiqueta: *"Nao ha `exclusivo`: o alvo e um SEGMENTO, nao
uma pessoa, e prometer exclusividade para um recorte de milhares de clientes e
propaganda que nao se sustenta."*

### 5.0.1 As três restrições que o prompt mandou conferir: NENHUMA existe

O prompt pede para checar "forma de pagamento, horário do dia, itens
específicos". Conferido em `CouponCreate`/`CouponAdminResponse` — que é onde as
regras da campanha são declaradas:

`code, cooldown_days, coupon_template_id, description, discount_type,
discount_value, first_order_only, is_active, max_discount_amount,
min_order_value, target_segment, title, total_usage_limit,
usage_limit_per_customer, valid_from, valid_until, visibility`

**Não há restrição por forma de pagamento, por horário do dia nem por item.**
O que existe é: valor mínimo, primeira compra, segmento/visibilidade, janela de
validade, tetos de uso, cooldown e teto de desconto. Qualquer tela que ofereça
"só no PIX" ou "só das 18h às 22h" estaria inventando — **não construir.**

### 5.0.2 O que fica BLOQUEADO POR BACKEND

| decisão do prompt | por que não dá |
|---|---|
| etiqueta **"para todos"** no cupom público | `CustomerCouponResponse` **não publica `visibility`** — o campo existe só em `CouponCreate`/`CouponAdminResponse`. Sem ele o front não distingue público de segmento, e inventar a distinção é anunciar audiência por chute |
| **"sem código aplica automaticamente"** | o contrato permite `code: null`, mas **ninguém diz QUAL escolher** quando mais de um cupom sem código cabe na mesma sacola. Escolher pelo maior `discount_amount` é uma decisão de DINHEIRO tomada no front, que é a regra 1 do CLAUDE.md. Precisa de uma rota que devolva "o cupom que o backend aplicaria", ou de uma regra escrita |

### 5.0.3 A leitura de escopo que eu tomei

O item 5 diz "Nada aqui toca sacola, checkout de pagamento ou troca de filial" e
o item 6 lista "sacola · checkout" como fora. Mas o item 5 TAMBÉM pede "Checkout:
onde aplica, com campo único para digitar código".

Li assim, e é o que está construído: **a MATEMÁTICA da sacola é intocável**
(`cartTotals`, a folha de confirmação, o pagamento), e a UI de cupom é o
trabalho desta rodada. Nenhuma linha desta seção soma preço.

### 5.A CONSTRUÍDO — o botão diz o que vai acontecer, e nada aplica sem sacola

**O defeito mais caro que isto fecha, e ele estava em produção:**
`confirmCouponDetail()` com a sacola VAZIA fazia `armSelectedCoupon()` +
`persistCouponChoice()` e dizia *"Cupom selecionado. Adicione produtos à sacola
para usar"*. Um cupom **aplicado sem preview nenhum**, gravado na sacola
guardada, que voltava armado no próximo boot e seguia no `coupon_id` do
`POST /orders`. Num cupom de uso único, o backend o **queima** ali.

Isso é exatamente o que a decisão do prompt proíbe: *"Nunca aplicar para depois
falhar."*

**O decisor único: `scripts/services/coupon-cta.js`.**

| situação | rótulo | destino |
|---|---|---|
| `login_required` | "Entre para usar" | login |
| `missing_amount` com valor | "Faltam R$ 8,85" | **cardápio** |
| sacola VAZIA | "Ver cardápio" | cardápio |
| `applicable` com sacola | "Aplicar cupom" | preview → aplica |
| **sem `state`** (vitrine do `/menu`) com sacola | "Aplicar cupom" | preview → aplica |
| `state` presente mas desconhecido | "Ver cardápio" | cardápio |

Duas decisões que precisaram ser tomadas e estão escritas no cabeçalho do
módulo:

1. **`login_required` vence a sacola vazia.** Sem conta o cupom não volta nem na
   lista; "Ver cardápio" mandaria a pessoa ao lugar errado.
2. **Ausência de `state` NÃO é estado desconhecido.** `PublicCouponResponse` (o
   trilho da Home) não tem `state`, e a folha de detalhe recebe os dois
   contratos. Recusar esses cupons abriria um buraco de capacidade sem
   substituto — e não precisa: aplicar continua passando pelo backend, uma
   porta adiante, no `POST /coupons/preview`, que é **A MESMA função** que
   decidiu os estados da lista. A regra dura continua valendo.

   Isto foi descoberto pelo E2E: `confirmar o cupom aplica o desconto` ficou
   vermelho porque `JP10` vem do feed do `/menu`, sem `state`.

**A sacola entra por ACESSOR.** `getCart: () => cart` no `createRestaurantClub
Controller` — `cart` é reatribuído (restoreCart, troca de filial, limpar
sacola), e uma cópia viraria a fotografia do boot, com o botão decidindo para
sempre com a sacola de quando o app subiu (§2.1 da skill).

**`persistCouponChoice()` foi REMOVIDA**, e o buraco tem comentário. Ela só
existia para o ramo da sacola vazia; deixá-la de pé é deixar o mecanismo do
defeito armado para quem for religar. A gravação legítima do cupom aplicado
continua sendo a de `updateCartUI` (`restaurant-page.js:2262`).

### 5.B CONSTRUÍDO — a etiqueta

`getCouponBadge` passa a ser: `label === 'selected_for_you'` → "Selecionado para
você"; **senão a tarja não existe** (o elemento não é desenhado). Saíram duas:

- **"Cupom disponível"**, que aparecia em todo card sem label — uma tarja que
  todo mundo tem não distingue ninguém.
- **"Frete grátis"** para `discount_type: free_delivery`, que **repetia o
  `title`**: o card dizia a mesma coisa duas vezes.

"Para todos" no público está bloqueado por backend (§5.0.2).

### Verificação do estágio A+B

`lint 78 problems (0 errors)` · `typecheck:cards` exit 0 · `test 332 passed`
(30 arquivos; +11 do decisor, +3 do contrato) · `test:e2e 305 passed ·
3 skipped`, exit 0, 4,2 min, **3 acima de 10 s**.

Vermelhos vistos: 11 unitários do decisor escritos primeiro; 5 E2E do Clube
caíram com a mudança de comportamento e foram lidos um a um (não "consertados"
— dois deles passaram a afirmar a regra nova); e a tarja foi vista vermelha com
a função antiga reinjetada (`Expected: 0 / Received: 1`).

**Nenhum número de dinheiro mudou.** O que mudou é QUANDO um cupom pode ser
armado — e a mudança só REMOVE um caminho que armava sem preview.

### 3.6 O que a varredura do item 3 DEIXOU PASSAR, e quem achou foi a suíte

Na varredura eu olhei `tenant-theme:198` — `const INSTANTE =
new Date('2026-08-29T12:00:00Z')` com `clock.install` + `pauseAt` — e escrevi
"fica: relógio congelado, já corrigido em rodada anterior". **Errado.**

Ele caiu numa suíte completa em 02/09/2026 com

    Error: clock.pauseAt: Error: Cannot fast-forward to the past

A causa, e ela é exatamente a classe que o item 3 caçava: **`pauseAt` só anda
para a frente, e entre `install()` e `pauseAt()` o relógio falso AINDA ANDA.**
São duas idas ao browser pelo protocolo, e o tempo real que passa entre elas
avança a hora da página. Com os dois recebendo o MESMO instante, o teste vivia
de a diferença ser zero — o que depende de a máquina estar livre.

O comentário do próprio arquivo já dizia a metade certa ("uma data anterior a
de instalacao e erro"), e foi ela que me fez concluir que estava resolvido. A
metade que faltava é que a hora de instalação NÃO fica parada.

Dois braços, com 300 ms injetados entre as duas chamadas: o braço antigo falha
**sempre** com a mensagem idêntica à da suíte; o novo (`pauseAt` em
`INSTANTE + 60 s`) passa **sempre**. O minuto de folga não é medido por
ninguém — só precisa ser maior que qualquer atraso de protocolo — e nada
dispara no salto, porque as duas chamadas acontecem antes do `goto`.

**A lição, e ela é sobre a varredura, não sobre o teste:** eu li o comentário
do arquivo em vez de ler a semântica da API. Um comentário que explica metade
de uma armadilha é mais perigoso que nenhum — ele encerra a investigação.

### 3.7 Uma assinatura NOVA de família D (o cano quebrou)

Na mesma noite, outra suíte completa deu **um** vermelho em
`maps-autocomplete:143`:

    Error: page.goto: net::ERR_NO_BUFFER_SPACE

em **1,4 s**, no `goto`. Não é asserção e não é timeout: é o Windows sem buffer
de socket depois de horas de Playwright — `netstat -an | grep -c TIME_WAIT`
respondeu **676** no instante seguinte. O arquivo passou 7/7 isolado logo
depois.

É família **D** da §11 da skill, com uma assinatura que a tabela dela ainda não
tinha. Vai para a skill.

### 5.C CONSTRUÍDO (em parte) — a faixa da Home

**Feito:** o botão "Usar cupom" saiu do card do trilho da Home, e a divisória
pontilhada com ele (ela existia para separar o corpo do card do botão). O
trilho lê `menu.coupons` = `PublicCouponResponse`, **sem `state`** — o backend
nunca julgou aquele cupom contra esta pessoa — e do lado da Home a sacola quase
sempre está vazia, que é justamente o caso em que aplicar armava um cupom sem
preview. O prompt lista esse botão como FORA, e ele é.

**NÃO feito, e o motivo é técnico:** "a faixa ... leva ao cardápio", isto é o
card deixar de abrir a folha de detalhe. O card da Home é **o único caminho
testado** do repasse miniatura→foto grande (`coupon-detail-image.spec.js`: a
miniatura de 168px do trilho segura o lugar até a variante ≥414 terminar). O
card do Clube tem o mesmo gancho no código (`readyCardImage`), mas a imagem
dele é `src` cru, sem variante — retargetar o teste não preservaria o assunto.

Mudar o destino agora apaga uma funcionalidade real e o único teste dela, **sem
substituto**, porque a superfície que passa a ser o lugar de ler regras é a tela
"usar cupom" (5.E), que não existe ainda. A ordem certa é: construir a tela,
mover a leitura para lá, e só então virar o destino do card.

### 5.D CONSTRUÍDO — o Clube abre pelos cupons

A lista de cupons subiu para o topo e o cartão de saldo de cashback desceu para
depois dela. O Clube **é** a lista — é para isso que a pessoa entra — e o saldo
empurrava os cupons para baixo da dobra num aparelho de 390px.

**O cartão não foi apagado, e isso é deliberado.** O extrato de cashback só tem
uma porta (`openCashbackStatement`, no ícone desse cartão); apagá-lo deixaria a
tela do extrato sem entrada nenhuma. A decisão escrita era "sem saldo de
cashback **no topo**", e é isso que está feito. Guardado por teste, inclusive a
existência do ícone.

"Sem cupom aplicado" no Clube: **não havia nada a remover** — conferido, a tela
nunca teve indicação de cupom aplicado.

### Verificação do estágio C+D

`lint 78 problems (0 errors)` · `test 332 passed` · `test:e2e 306 passed ·
3 skipped`, exit 0, 4,4 min, **3 acima de 10 s**.

Vermelhos vistos, os dois por injeção: o botão de volta na Home
(`Expected: 0 / Received: 3`) e a ordem invertida no Clube
(`o saldo de cashback voltou para o topo do Clube: Expected true, Received
false`).

**Duas execuções foram descartadas no caminho, e as duas por motivo escrito:**
uma com `ERR_NO_BUFFER_SPACE` (família D, §3.7) e uma com o
`clock.pauseAt` (defeito real, corrigido — §3.6).

### 5.E CONSTRUÍDO — o campo único de código, no checkout

**Duas coisas, e a primeira é uma rota que o backend tinha e o front nunca
chamou.**

**`POST /coupons/claim` ligado.** `api-routes.claimCoupon`, `api.claimCoupon` e
`clubService.claimCoupon`, com 6 unitários. Quem recebia um código de fora —
panfleto, mensagem, embalagem — não tinha onde digitá-lo. O serviço:

- apara o código (colar de uma mensagem traz espaço em volta com frequência);
- código vazio não vira requisição;
- passa o cupom devolvido pelo **mesmo filtro da lista** (sem `id` não há
  detalhe, `state` desconhecido não tem botão que faça sentido);
- **deixa a recusa do backend SUBIR.** Um `null` para tudo faria a tela
  responder a um código correto e a um errado com a mesma cara.

**O campo do checkout**, na sacola, logo acima de "Valores". Ele NÃO calcula e
NÃO julga: monta `{ code }` e passa pelas MESMAS três portas da folha de
detalhe (`armSelectedCoupon` → `previewSelectedCoupon` → `restoreSelectedCoupon`
na recusa).

**Nada no caminho do dinheiro precisou mudar para ele existir:**
`CouponPreviewRequest` já aceita `coupon_code` no lugar de `coupon_id`, e
`buildOrderPayload` já manda `coupon_code` quando não há id
(`order-payload.js:132`). `cartTotals()` não foi tocado.

Sem sacola a seção **sai da tela** (não fica desabilitada — um campo cinza
convida a tentar). É a mesma regra do decisor do botão.

#### O defeito que o teste novo achou no código VELHO

`previewSelectedCoupon({ silent: true })` não pintava a mensagem, e o campo lia
o motivo de uma variável. Só que o ramo `valid: false` chama `updateCartUI()`,
que **chama `previewSelectedCoupon()` de novo** (o cupom ainda está armado
nesse instante) — e a reentrada zerava a frase no topo, antes de quem pediu em
silêncio conseguir lê-la. O campo exibia "Não foi possível aplicar este cupom"
no lugar de *"Este cupom é válido apenas na primeira compra"*.

A correção não é uma guarda de reentrância: o motivo passa a morrer em
`armSelectedCoupon()`, que é o instante em que uma tentativa nova começa e o
motivo da anterior deixa de valer.

#### Vermelhos vistos

- Os 6 unitários do claim, escritos antes do serviço.
- 2 dos 5 E2E falharam na primeira execução, e um deles era o defeito acima.
- **Injeção**: tirando `restoreSelectedCoupon(anterior)`, o teste do cupom
  recusado falha com `Received: "PANFLETO10"` — ou seja o código que o backend
  recusou ENTRA no `POST /orders`. É o ponto caro do arquivo.

#### Verificação do estágio E

`lint 78 problems (0 errors)` · `typecheck:cards` exit 0 · `test 338 passed`
(30 arquivos) · `test:e2e 311 passed · 3 skipped`, exit 0, 4,2 min,
**3 acima de 10 s**.

**Nenhum número de dinheiro mudou.** O que entrou é um caminho NOVO para um
cupom chegar ao mesmo `POST /coupons/preview` que já existia, e o total exibido
continua sendo o `total_after_coupon` que o backend devolve.

### 5.F CONSTRUÍDO — a tela de cupons tem UM dono

`#profSubcupons` (a subtela "Cupons" do Perfil) era markup **estático** dizendo
"Nenhum cupom disponível", sem nenhum código que a preenchesse. Ela respondia
isso para quem tinha cupons e para quem não tinha, sempre, desde que existe.

**E a sonda mostrou que ela era inalcançável por um motivo mais forte do que se
supunha.** O Perfil é SEMPRE remontado em JS (`prof-account-page`,
`restaurant-page.js:5286`) — para o visitante e para quem está logado — e a
lista estática de `.prof-option-row` do `restaurant.html`, inclusive a linha
"Cupons", **NUNCA renderiza**. Medido com o Perfil aberto:

    document.querySelectorAll('.prof-option-row').length === 0

Some-se a trava de login (`screens/profile-screen.js:419`, que joga `cupons`
para a tela de entrar) e o resultado é que aquela subtela nunca foi vista por
ninguém.

A subtela saiu, com o buraco comentado, e a linha estática passou a apontar
para `mobNavClub` — o Clube é o dono único da lista, e é ele que desenha os três
estados com as etiquetas e as regras. Guardado por E2E: `#profSubcupons` não
existe nem escondida, e o texto "Nenhum cupom disponível" não está no documento.

**ACHADO NOVO, e maior que este item:** o bloco estático inteiro de
`.prof-option-row` no `restaurant.html` é markup morto — o Perfil é sempre
desenhado por JS. É a mesma família dos seis chips do item 4, e vale uma
varredura própria. **Não removido nesta rodada**: são ~7 linhas de opção com
ícones, e apagá-las sem entender o que mais depende daquele bloco é maior que o
item 5.

---

# RELATÓRIO FINAL — rodada noturna de 02/09/2026

Branch `rodada/noturna`, 9 commits, todos verdes e empurrados. Nada na `main`.

| commit | item |
|---|---|
| `445a73c` | o scratchpad que retoma sozinho |
| `1a5fb86` | 1 — o nome fantasma que vence o nome certo |
| `9ad48fb` | 2 — `pix-payment:116`, o 307,6 reproduzido |
| `53dffc3` | 3 — a validade que vence em 2031, e as esperas que apostam no relógio |
| `97b016a` | 4 — as formas de pagamento de UM restaurante no HTML |
| `f5c5433` | 5A/5B — o cupom armado sem preview, e a etiqueta |
| `13a2b5f` | 5C/5D — o Clube pelos cupons, a Home só divulga, o relógio da suíte |
| `6771664` | 5E — o campo único do checkout e a rota de resgate |
| `0043744` | 5F — a tela que dizia "Nenhum cupom disponível" para todo mundo |

## 1. Escapes: de 8 para 6

**Fechados (2):**

- **#5** `restaurant-club.js:146` — e com ele a FAMÍLIA inteira: 30 sítios em 6
  arquivos, três nunca nomeados. Guarda nova
  `tests/unit/contract-field-names.test.js` (14 testes), vista vermelha em 6
  alvos com as 6 sondas verdes.
- **#7** cadeias fantasma dos banners (`menu-service`) — `BannerResponse`
  declara sete campos e **nenhum é texto**.

**Mantidos (6), com o motivo:**

| # | escape | motivo |
|---|---|---|
| 1 | `auth-screen-nav.spec.js:105` | nunca reproduzido, 0 em 12+ execuções saudáveis nesta rodada. `fixme` num teste que passa troca suspeita por perda REAL |
| 2 | `order-flow.spec.js:163` | idem, e guarda a Idempotency-Key reaproveitada na retentativa, que é dinheiro |
| 3 | `pix-payment.spec.js:116` | mecanismo PROVADO, gatilho aberto — ver item 2 |
| 6 | `address-service.js:25` | precedência DE PROPÓSITO (dois contratos), agora documentada nas duas pontas |
| 8 | `provider_error_code` | a tela dele é a recusa de cartão — checkout, fora da rodada |
| 9 | `assistant-voice-session.spec.js:472` | voz, fora da rodada |

## 2. `pix-payment:116` — causa parcial, sem quarentena

20/20 verdes isoladas sob contenção de 4 workers (7 a 17 s por execução).

Sonda em quatro larguras deu a lei `offset = (larguraDoPainel − 374) / 2`, e com
ela os três regimes possíveis dão 20, ≤196,5 e 113. **307,6 exige um painel de
989,2 px, que nenhum deles produz.** Injetando `max-width:989.2px`, a linha lê
**307,59375** — o número da falha, até a última casa.

O QUE aconteceu está provado; o POR QUE não. O teste passa a afirmar a largura
do rodapé ANTES do offset, então uma recorrência diz `Expected 414, Received
989.1875` em vez de um número sem dono. **Sem quarentena e sem tocar em
timeout.**

## 3. Testes dependentes da hora

**Achados e corrigidos:**

| sítio | classe | correção |
|---|---|---|
| `card-payment-flow:230`, `mercado-pago-secure-fields:117,118,183` | validade `11/31` conferida contra o relógio REAL | `validadeFutura()` — quebraria em **01/12/2031**. Visto vermelho com `11/24` |
| `maps-autocomplete:156` | `Date.now()-t1 < 3000`, direção INSEGURA | removido; `calls.novo === 1` já provava melhor. Dois braços: antigo `Received: 4033`, novo passa |
| **`tenant-theme:198`** | `install`+`pauseAt` no MESMO instante | `pauseAt(INSTANTE + 60s)`. **Eu tinha classificado como resolvido; quem achou foi a suíte** |
| `menu-scrollspy` (boot e `:118`) | tempo no lugar de condição | `.cat.active` existir; afirmação com retentativa |
| `image-framing:67,75` | 2500 ms ×2 | 4 derivadas `complete && naturalWidth > 0` |
| `overlay-blur:119` | 700 ms sobre timer de 560 ms do app | afirmação com retentativa, teto de 2 s |

**Uma conversão foi REVERTIDA pela medida** (`scrollToSection`): a afirmação que
aquelas esperas alimentam compara duas leituras do MESMO instante e nunca
dependeu de assentamento. Ver §3.4 do scratchpad.

**Sobram 24 `waitForTimeout`**, cada um com motivo escrito: asserção negativa
(6), intervalo de amostragem (2), tempo real de propósito (2), voz/assistente
fora da rodada (10), checkout/cartão fora da rodada (2), `scrollToSection` (2).

**Negativo útil:** o horário da loja NÃO lê relógio — `is_open` e
`current_weekday` vêm do backend, e por isso `store-hours.spec.js` passa em
qualquer dia da semana.

## 4. Os chips chumbados

Markup fora, container vazio, `tests/unit/white-label-markup.test.js` vista
vermelha em 3 de 4 (a quarta é a sonda). Rede em
`tests/e2e/profile-payment-methods.spec.js`, com os rótulos vindos da fixture.

**A premissa do prompt (um flash na tela) não se confirmou** — `openProfSub`
já cobria os chips antes de a subtela aparecer. O E2E que afirmava o flash
falhou, e isso foi a sorte da rodada: ele teria passado pelo motivo errado. O
defeito real é outro e continua real: os chips estavam no DOM de toda loja.

## 5. O fluxo de cupons

**Pronto:**

1. **Nada aplica sem sacola.** O decisor único `services/coupon-cta.js` (11
   unitários) governa o rótulo e o destino em duas superfícies.
2. **`persistCouponChoice()` removida** — era ela que armava um cupom sem
   preview com a sacola vazia, gravava na sacola guardada e o mandava no
   `coupon_id` do pedido. Num cupom de uso único, o backend o queima.
3. **Etiqueta**: `selected_for_you` ou nada. Saíram "Cupom disponível" (que
   todo card tinha) e "Frete grátis" (que repetia o `title`).
4. **Home só divulga**: o botão "Usar cupom" saiu do trilho.
5. **Clube abre pelos cupons**; o saldo de cashback desceu para depois da lista
   (não foi apagado: o extrato só tem aquela porta).
6. **O campo único de código no checkout**, com 5 E2E.
7. **`POST /coupons/claim` ligado** (6 unitários) — a rota existia no contrato
   desde sempre e o front nunca a chamou.
8. **`#profSubcupons` removida** — dizia "Nenhum cupom disponível" para todo
   mundo, e era inalcançável dos dois lados.

**Bloqueado por backend:**

| o que | falta |
|---|---|
| etiqueta "para todos" no público | `visibility` em `CustomerCouponResponse` |
| "sem código aplica automaticamente" | uma regra de QUAL cupom escolher quando mais de um cabe — escolher pelo maior desconto é decisão de dinheiro tomada no front |
| restrição por forma de pagamento / horário / item | **não existem no contrato** — conferido em `CouponCreate` |

**Não construído, com o motivo técnico:** o card da Home levar ao cardápio. Ele
é o único caminho testado do repasse miniatura→foto grande, e a superfície que
o substituiria (a tela dedicada de "usar cupom") não existe. A ordem certa é
construir a tela, mover a leitura de regras para lá, e só então virar o destino.

**A tela dedicada de "usar cupom" não foi construída**, e a razão é de produto:
o Clube JÁ é a lista com etiquetas e regras, alcançável da Home pela barra de
navegação. Uma terceira superfície para o mesmo dado é a figura que esta rodada
passou a noite removendo. Se ela for mesmo separada do Clube, falta escrito o
que ela mostra que o Clube não mostra.

## 6. Números de dinheiro que mudaram

**Nenhum.** Todas as mudanças de cupom ou removem um caminho que armava sem
preview, ou acrescentam um caminho novo para o MESMO `POST /coupons/preview`.
`cartTotals()` não foi aberto. As 30 trocas de nome do item 1 removem nomes que
liam `undefined` em 100% das chamadas.

O que mudou de comportamento, e está guardado por teste:

- confirmar cupom com a sacola vazia **não arma mais nada** (antes armava);
- código recusado no checkout **não entra no pedido** (visto vermelho: sem o
  rollback, `coupon_code: "PANFLETO10"` vai no `POST /orders`).

## 7. O que eu faria diferente

1. **Ler a semântica da API, não o comentário do arquivo.** O comentário de
   `tenant-theme` explicava METADE da armadilha do `pauseAt` e encerrou minha
   investigação. Custou um vermelho numa suíte completa horas depois. Comentário
   é pista, não conclusão.
2. **Sondar antes de escrever o teste.** Duas vezes escrevi um teste sobre um
   comportamento que eu supunha (o flash dos chips; a linha "Cupons" do Perfil)
   e o teste falhou porque a premissa estava errada. A sonda de 20 segundos
   teria dado a resposta certa antes, e nas duas vezes a resposta era mais
   interessante que a hipótese.
3. **Nunca usar `git checkout <arquivo>` para desfazer uma injeção.** Apagou
   duas mudanças não commitadas de `restaurant-club.js` e custou refazê-las. O
   jeito certo é copiar o arquivo para o scratchpad antes e restaurar pela
   cópia — que é o que passei a fazer no resto da noite.
4. **Commitar cada estágio antes da próxima injeção.** Consequência do erro
   acima: passei a fechar o estágio em commit assim que ficava verde.
5. **Não escalar o estrangulamento de CPU depois que ele deixa de discriminar.**
   Gastei três lotes a 14x e 20x descobrindo que ali o teto de 30 s domina os
   dois braços. O sinal de parada era claro no primeiro lote em que os DOIS
   falharam.
6. **Desconfiar de um portão que responde rápido demais.** O
   `typecheck:cards` passou "verde" (exit 0) por não ter `tsc` instalado, e eu
   só percebi porque o PowerShell reportou diferente do Bash.
