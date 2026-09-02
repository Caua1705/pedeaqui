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

---

# A. Varredura de BOMBAS-RELÓGIO (02/09/2026)

Pergunta da varredura: **existe lógica que compare uma data contra o relógio
REAL e tenha uma data limite embutida?** Feita sobre `scripts/`, `tests/`,
`tools/`, `public/`, `index.html` e `restaurant.html`.

## A.1 O universo: só CINCO sítios comparam com o relógio real

    grep -rnE "(<=?|>=?)\s*new Date\(\)|new Date\(\)\s*(<=?|>=?)|getFullYear|getMonth\(\)|getDay\(\)|getHours\(\)"

| sítio | o que compara | veredito |
|---|---|---|
| `scripts/pages/restaurant-auth-flow.js:185` | data de nascimento `<= new Date()` | **regra de produto, sem limite embutido.** Não aceitar nascimento futuro é o comportamento certo, e os testes usam `1990-04-12` — passado que segue passado |
| `tests/e2e/card-payment-flow.spec.js:67` | validade do cartão vs `now.getFullYear()` | **era a bomba. CORRIGIDA** — ver A.2 |
| `tests/e2e/payment-card-validation-timing.spec.js:65` | idem | **seguro**: só digita `01/20` (jan/2020), e um passado continua passado. É o teste de "Informe uma data de validade futura" |
| `tests/e2e/helpers.js:330` | `validadeFutura()` = `11/<ano+5>` | a correção |
| `tests/e2e/tenant-theme.spec.js:213` | `clock.install`/`pauseAt` | **era bomba de outra forma. CORRIGIDA** — ver A.3 |

Todo o resto que lê o relógio (`Date.now()`) é **relativo**: TTL de cache
(`ttl-cache`, `payment-config-service`, `delivery-service`, `club-service`), TTL
da sacola (`restaurant-page:2920`), poda de `order-tracking`, idade relativa do
pedido no Perfil (`profile-screen:156`) e a janela do Pix. Relativo não tem
limite embutido: ele anda com o relógio, não contra ele.

## A.2 A bomba fechada: `11/31` (estouraria em **01/12/2031**)

Três sítios digitavam a validade `11/31` num cartão de teste, e quem confere é o
relógio REAL nos dois lados — o SDK falso e, em `mercado-pago-secure-fields`, o
SDK de verdade. Vista vermelha com `11/24`: o `#creditCardModal` não fecha.
Hoje é `validadeFutura()`.

## A.3 A segunda bomba, de outra forma: `clock.pauseAt` (já estourou)

`tenant-theme:198` passava o MESMO instante para `install()` e `pauseAt()`.
`pauseAt` só anda para a frente, e o relógio falso avança entre as duas chamadas
— o teste vivia de a diferença ser zero. Caiu numa suíte completa desta rodada
com `Cannot fast-forward to the past`. Hoje o `pauseAt` recebe `INSTANTE + 60 s`.

## A.4 Datas literais que NÃO são bombas, e por quê

Cada uma foi conferida contra a pergunta "alguém compara isto com o relógio?".

| sítio | data | por que não é bomba |
|---|---|---|
| `tests/fixtures/coupons.json:11,25,39` e `customer-coupons.test.js:25` | `2099-12-31` (`valid_until`) | o front **nunca compara** validade de cupom com o relógio — quem filtra cupom vencido é o backend (`CustomerCouponState` não tem estado para "vencido" justamente porque ele não entra na lista). O front só **formata** (`couponValidUntil`, `formatCouponDate`) |
| `tests/fixtures/orders.json` (3 datas) | 12/07 a 30/08/2026 | os três já passam de 24 h, e `profOrderRelativeDate` só troca de formato NESSA fronteira. Eles só envelhecem — direção segura. **Nenhum teste afirma "Realizado…"** |
| `tests/e2e/profile-order-tracking.spec.js:26` | `agora − 2 min` | relativo. E `profOrderRelativeDate` não tem ramo "hoje/ontem", então não há penhasco de meia-noite |
| `tests/e2e/card-payment-flow.spec.js:153…` | `expiration_year: 2030` do cartão salvo | **nenhum código de produção lê `expiration_year`/`expiration_month`** (conferido por grep). O cartão salvo não é filtrado por validade no front |
| `cashback-statement.spec.js:32`, `profile-order-tracking.spec.js:209-210`, `tools/capture-screens.mjs:200,201,790` | 2026 | só exibição; nenhuma asserção sobre a data |
| `tests/unit/order-tracking.test.js:173,177`, `service-caches.test.js:18` | 2026 | `vi.setSystemTime` — relógio INJETADO, que é o jeito certo |
| `public/sw.js:24` | `VERSION = 'v2'` | versão de cache sem data |

## A.5 O horário de funcionamento NÃO lê o relógio — e isso está certo

Era o candidato mais óbvio da lista do prompt. Conferido: **"está aberto?" vem
de `is_open` e "que dia é hoje?" vem de `current_weekday`**, os dois do backend
(`store-info-format.js:54`, `store-info-screen.js:184`, `restaurant-page:1218`).
Por isso `store-hours.spec.js` compara a linha destacada com o
`INFO.current_weekday` da própria fixture e passa em qualquer dia da semana.

Não há promoção, banner ou cupom filtrado por data no front.

## A.6 DUAS coisas que a varredura achou e que não são bomba-relógio

**1. `index.html:425` — `© 2025 Rapidex`.** Não quebra nada, mas já está
**errado hoje** (é 2026) e está na landing, visível para todo visitante. Não
corrigido nesta rodada porque a landing está fora do escopo desta branch;
anotado aqui para não se perder.

**2. O contador do Pix conta pelo relógio DO CLIENTE, e o backend não manda
prazo.** `restaurant-pix-flow.js:749` faz `pollUntil = Date.now() +
PIX_POLL_WINDOW_MS`, e a tela promete "Você tem até 10 minutos". Conferido no
contrato: **`StartPaymentResponse` tem `checkout_url`, `payment_status`,
`provider`, `provider_payment_id`, `qr_code` e `status_detail` — e NENHUM campo
de expiração.** O front não tem como saber o prazo real da cobrança; ele conta o
próprio. Relógio adiantado, aparelho suspenso ou aba em segundo plano fazem o
contador divergir do gateway.

Não é defeito do front — é lacuna de contrato. Entra na lista de pedidos ao
backend (§B.4).

---

# B. O QUE O BACKEND PRECISA ENTREGAR — texto para colar no agente do backend

> Colar a partir daqui. Contexto: front white-label de pedidos
> (`pedeaqui_front`), consumindo a API do Rapidex. Cada item diz o que o front
> precisa RECEBER e por que ele não pode resolver do lado dele.

## B.1 `visibility` em `CustomerCouponResponse`

**Pedido:** publicar o campo `visibility` (`public` | `segment` | `private`) em
`CustomerCouponResponse`, o mesmo enum `CouponVisibility` que já existe em
`CouponCreate` e `CouponAdminResponse`.

**Por que o front precisa.** A regra de produto da etiqueta do card é:

- cupom com `label = "selected_for_you"` → tarja **"Selecionado para você"**;
- cupom **público** → tarja **"para todos"**;
- cupom de **segmento** sem label → **nenhuma tarja**.

Hoje `CustomerCouponResponse` publica `label`, mas não publica `visibility`.
Sem ele o front consegue distinguir só o primeiro caso, e os outros dois ficam
indistinguíveis — os dois viram "nenhuma tarja".

**Por que o front não resolve sozinho.** Não há como inferir audiência a partir
dos campos que chegam. Inferir por ausência de `label` juntaria "público" e
"segmento" numa coisa só, que é exatamente a distinção pedida. E anunciar
audiência por chute num app white-label é anunciar errado para o restaurante
inteiro.

**Não estamos pedindo `target_segment`** — o segmento em si é interno da
campanha e não deve sair. O que falta é só o discriminador de audiência.

## B.2 Qual cupom aplicar quando existe mais de um automático

**Pedido:** uma das duas formas, e a primeira é a preferida.

**(a)** Um campo em `CustomerCouponResponse` marcando o cupom que o backend
aplicaria a esta sacola — por exemplo `auto_apply: boolean`, verdadeiro em **no
máximo um** cupom da lista, calculado com o mesmo `subtotal`/`delivery_fee`/
`order_type` que a chamada informou.

**(b)** Ou, se preferirem manter a resposta só descritiva: a regra de desempate
escrita no `@description` da rota (ex.: "maior `discount_amount`; empate,
menor `min_order_value`; empate, o de `valid_until` mais próximo"), para o front
implementá-la.

**Por que o front precisa.** A regra de produto é: cupom **sem código**
(`code: null`) aplica **automaticamente** quando a sacola permite; cupom **com
código** a pessoa digita. Hoje o contrato permite `code: null` e a rota devolve
vários cupons `applicable` ao mesmo tempo — mas nada diz qual deles aplicar.

**Por que o front não resolve sozinho.** Escolher "o de maior
`discount_amount`" é uma **decisão de dinheiro tomada no cliente**, e a regra
número 1 deste front é que o front não calcula nem decide dinheiro. Duas
implementações da mesma escolha (a nossa e a de vocês, na criação do pedido)
divergem no dia em que entrar teto de desconto, cooldown ou empate — e a
divergência aparece onde mais custa: o app aplica o cupom A, o pedido nasce com
o cupom B, e o cliente vê o desconto mudar entre a sacola e a confirmação.

**Observação:** a opção (a) é melhor também porque é a mesma função que já
decide `state`, `discount_amount` e `missing_amount` — não é conta nova, é um
campo a mais na conta que já roda.

## B.3 As três restrições que não existem no contrato

Conferido em `CouponCreate` / `CouponAdminResponse`. Os campos de regra hoje
são: `min_order_value`, `first_order_only`, `target_segment`, `visibility`,
`valid_from`, `valid_until`, `total_usage_limit`, `usage_limit_per_customer`,
`cooldown_days`, `max_discount_amount`, `discount_type`, `discount_value`.

**Não existe restrição por forma de pagamento, por horário do dia, nem por
item.** O front não construiu nada para elas — construir seria inventar regra
que o backend não sabe aplicar, e a tela prometeria uma coisa que a criação do
pedido não cumpre.

Se essas restrições forem entrar, o que o front precisa é:

**(i) Forma de pagamento.** Um campo na campanha (ex.: `allowed_payment_methods:
string[] | null`, `null` = todas) e, principalmente, **o reflexo dele no estado
do cliente**: com a forma de pagamento ainda não escolhida no momento da lista,
o cupom restrito precisa vir com `state` que diga isso. Sugestão: um valor novo
em `CustomerCouponState`, por exemplo `payment_method_required`, mais um campo
com as formas aceitas para o card escrever a frase ("Só no PIX").

Sem um estado próprio, o cupom restrito a PIX apareceria como `applicable` para
quem vai pagar no cartão, e a recusa só chegaria na criação do pedido — que é
exatamente o "aplicar para depois falhar" que este fluxo existe para não fazer.

**(ii) Horário do dia.** Campos na campanha (ex.: `valid_weekdays: int[]`,
`valid_time_start` / `valid_time_end`) e o mesmo cuidado no estado: **quem
decide se está dentro da janela tem de ser o backend**, porque o relógio do
cliente não é confiável e o fuso da loja não é o do aparelho. O front precisa
receber ou `state = "applicable"` (está na janela agora) ou um estado que diga
que não está, mais o texto da janela para o card ("Válido das 18h às 22h").

Este ponto é importante e é a razão de não termos construído nada: **hoje o
front não compara NENHUMA data ou hora contra o relógio** — nem validade de
cupom, nem horário de funcionamento (que vem resolvido em `is_open` e
`current_weekday`). Manter essa propriedade é o que faz o app funcionar igual em
qualquer fuso e com qualquer relógio errado.

**(iii) Itens específicos.** Campos na campanha (ex.: `applicable_product_ids` /
`applicable_category_ids`) e, no cliente, a mesma coisa: o `state` já calculado
contra a sacola enviada, mais o texto para o card ("Válido em pizzas"). O front
manda a sacola no `POST /coupons/preview`, então vocês já têm o que precisam
para decidir — o que falta é o campo que diz o resultado.

**O padrão dos três é o mesmo, e é o que já funciona hoje:** o front manda o
contexto, o backend devolve o veredito e a frase. Toda vez que o front precisa
reconstruir a regra para saber se um cupom cabe, ele vira uma segunda
implementação da regra de cupom — e é aí que o card promete R$ 15 e o checkout
tira R$ 10.

## B.4 Fora de cupom, mas do mesmo tipo: o prazo da cobrança Pix

**Pedido:** um campo de expiração absoluta em `StartPaymentResponse` — por
exemplo `expires_at` (ISO 8601, com fuso).

**Por que o front precisa.** A tela do Pix mostra um contador e diz "Você tem
até 10 minutos para fazer o pagamento. Após esse tempo, o pedido será
cancelado". Hoje esse prazo é **do front**: ele faz `Date.now() + 10 min` e
conta no relógio do aparelho. `StartPaymentResponse` traz `checkout_url`,
`payment_status`, `provider`, `provider_payment_id`, `qr_code` e
`status_detail` — nenhum prazo.

**O que isso custa.** Relógio do aparelho adiantado/atrasado, celular suspenso
no bolso ou aba em segundo plano fazem o contador divergir do prazo real do
gateway. O cliente pode ver "faltam 4 minutos" numa cobrança que já expirou, ou
o contrário. Com `expires_at` o front conta contra um instante do servidor e
para de adivinhar.

---

# C. Não mergeado, e por quê

A branch `rodada/noturna` fica onde está. O `ci.yml` não foi tocado em nenhum
commit desta rodada — conferido: `git log --stat` não mostra o arquivo.

---

# D. Escapes, segunda passada — o #6 fechou, e cobrou caro

## D.1 O escape apontava para o LEITOR; o defeito estava no ESCRITOR

O escape #6 era `address-service.js:25`,
`postal_code || zipcode || zip_code || cep`, arquivado como "precedência DE
PROPÓSITO, documentado". Fui conferir **qual é o nome do contrato** e:

- `CustomerAddressResponse` declara **`zipcode`**;
- **`postal_code` não existe em esquema de endereço NENHUM** da API.

Até aí o escape estava certo: `postal_code` é o nome **interno** do front, que
`normalizeAddress` produz de propósito para ter uma forma só entre a API, o
localStorage e o resultado do Google. E `order-payload.js:70` já mapeava de
volta para `zipcode` ao criar o pedido.

**Mas nem toda borda mapeava de volta.**

## D.2 O defeito: nenhum cliente logado conseguia salvar endereço na conta

`addressApiPayload()` (`restaurant-page.js:3817`) vai **direto** para
`createCustomerAddress` / `updateCustomerAddress`
(`restaurant-address-flow.js:1171-1172`), e mandava:

    street, number, neighborhood, city, state, complement, reference,
    postal_code,  place_id,  alias,  latitude, longitude

`CreateCustomerAddressRequest` e `UpdateCustomerAddressRequest` declaram
`city, complement, is_default, label, latitude, longitude, neighborhood,
number, reference, state, street, zipcode` — e os dois são
**`additionalProperties: false`**.

**Três nomes fora do contrato num modelo `extra=forbid` = 422 na requisição
inteira.** Não é campo ignorado: é a requisição recusada.

O que o cliente via: o `alert("Não foi possível salvar o endereço na sua conta.
Ele continuará disponível neste aparelho para você tentar novamente.")` de
`finishAddressDetails`, **toda vez**, e o endereço gravado localmente com
`sync_error: true`. Em outro aparelho, nada.

## D.3 Por que nenhum portão pegou

**Nenhum teste do repositório salvava um endereço.** `mockApi()` só atende
`GET /customers/me/addresses`; o POST caía no catch-all — que hoje responde 404
e anota a rota, mas quem lê `rotasDesconhecidas` é o `boot-smoke`, e ele
percorre as **dez telas principais**, entre as quais não está o formulário de
endereço.

É o buraco exato que a §4 da skill descreve por outro lado: *"um mock que só
aceita é um teste que só concorda"* — aqui não havia nem mock, e o silêncio deu
no mesmo.

## D.4 A correção, e o teste que lê o CONTRATO

`tests/e2e/customer-address-contract.spec.js`, **os dois testes vistos
vermelhos** antes da correção, com os três nomes na mensagem:

    Error: o backend recusaria este payload
    + { loc: ["body","postal_code"], type: "extra_forbidden" }
    + { loc: ["body","place_id"],    type: "extra_forbidden" }
    + { loc: ["body","alias"],       type: "extra_forbidden" }

    Error: o endereço ficou marcado como não sincronizado

**O mock recusa lendo o `openapi.json`**, e não uma lista de campos copiada à
mão: uma lista à mão aqui seria a segunda cópia do contrato, e ela divergiria —
provavelmente na direção do que o código manda hoje, que é o defeito.

Na produção:

- `postal_code` → **`zipcode`** (com `zipcode` primeiro na cadeia);
- `alias` → **`label`**;
- `place_id` **sai** do payload (é do Google, não da nossa API; o front continua
  guardando-o localmente, e o `addressFingerprint` o usa);
- `addressFingerprint` (`:3615`) passa a ler **`zipcode` primeiro**. Um endereço
  vindo cru do `GET /customers/me/addresses` não tem `postal_code`, e sem isso o
  mesmo endereço gerava impressões digitais diferentes conforme o caminho por
  onde chegou — o app o trataria como dois.

**Escape #6: FECHADO.**

## D.5 Os que ficam, e por quê

| # | escape | por que fica |
|---|---|---|
| 1 | `auth-screen-nav.spec.js:105` | nunca reproduzido em 15+ execuções saudáveis. **Hipótese nova, escrita para quem vir o próximo vermelho:** o `after = await header.boundingBox()` é uma leitura ÚNICA de geometria logo depois de o login entrar deslizando (`from-bottom-nav`), e as afirmações que a precedem esperam o fundo e a trava de rolagem, mas não a caixa. É a mesma forma que o `pix-payment:116` tinha antes do `esperarAssentar`. **Não mexi**: sem vermelho não dá para provar, e trocar um teste que passa por uma correção especulativa é como se cria teste-fantasma |
| 2 | `order-flow.spec.js:163` | idem, e é o único guardião da Idempotency-Key reaproveitada na retentativa, que é dinheiro |
| 3 | `pix-payment.spec.js:116` | mecanismo provado (painel de 989,19 px) e reproduzido; o gatilho continua aberto. O teste hoje NOMEIA a largura, então a próxima recorrência diz o que procurar |
| 8 | `provider_error_code` | a tela dele é a de recusa de cartão — **checkout de pagamento, que continua fora desta branch**. É melhoria de mensagem, não defeito |
| 9 | `assistant-voice-session.spec.js:472` | **voz continua fora desta branch**. Números medidos: teto de inatividade de 8 s contra um preparo com direito a 25 s |

**Contagem: 5 escapes abertos** (eram 8 no início da noite).

---

# E. A família do defeito do endereço, varrida — e a guarda que fica

## E.1 Os OUTROS payloads de esquema fechado: conferidos um a um, todos certos

O contrato tem **18 esquemas `additionalProperties: false`**. Destes, os que o
front envia:

| rota | esquema | veredito |
|---|---|---|
| `POST /customers/me/addresses` | `CreateCustomerAddressRequest` | **era o defeito** — corrigido |
| `PATCH /customers/me/addresses/{id}` | `UpdateCustomerAddressRequest` | mesmo payload, mesma correção |
| `PATCH /customers/me` | `UpdateCurrentCustomerRequest` | ✅ `validateCustomerDataForm` devolve exatamente `{name, email, phone, birth_date}`, os quatro obrigatórios |
| `POST /delivery/estimate` | `DeliveryEstimateRequest` | ✅ `{branch_id, address_id}` ou `{branch_id, address}` |
| `POST /branches/availability` | `BranchAvailabilityRequest` | ✅ `{address_id}` ou `{address}` |
| (aninhado nos dois de cima) | `DeliveryAddressInput` | ✅ `deliveryAddressPayload` produz exatamente os 8 campos |
| `POST /customers/me/addresses/import` | `ImportCustomerAddressRequest` | ✅ `importAddressPayload` usa `zipcode`, `label`, `client_reference` |
| `POST /coupons/preview` | `CouponPreviewRequest` | ✅ os 5 campos, e nada mais |
| `POST /coupons/claim` | `CouponClaimRequest` | ✅ `{code}` |

`CreateOrderRequest` **não** é fechado — o pedido aceita campo extra sem 422.

## E.2 A guarda: `mockApi()` passa a recusar como o backend recusa

Um mock que responde 200 a qualquer corpo não tem opinião sobre o corpo, e foi
por essa fresta que os três nomes passaram. Agora, **antes de qualquer rota**,
`mockApi()` confere o corpo contra o esquema declarado no `openapi.json` e
responde **422** quando há campo fora do contrato ou obrigatório ausente.

**A tabela vem do CONTRATO, não de uma lista escrita no helper.** Ela é montada
percorrendo `paths`: todo caminho+método com corpo `$ref` entra, e rota nova
entra sozinha. Uma lista à mão seria a segunda cópia do contrato, e divergiria
na direção do que o código manda hoje — que é justamente o defeito.

Confere **nome de campo** e **obrigatório ausente**, com um nível de
aninhamento (o `address` do estimate é um `DeliveryAddressInput`, também
fechado). **Não** confere tipo, formato nem faixa: reimplementar o Pydantic aqui
seria a terceira cópia do contrato, e o que custou dinheiro neste repositório
foi sempre o NOME, não o tipo.

**Sonda contra vacuidade** (a lição da noite): com `campo_inventado` injetado no
corpo de `previewCoupon`, `club-coupons` cai — o mock recusa, o cupom não
aplica, a folha não fecha. A guarda está viva.

Custo: **zero**. A suíte inteira passou na primeira execução com o mock estrito
— o que também é a confirmação independente da §E.1.

## E.3 Uma armadilha de FERRAMENTA nova, que custou uma reescrita

Inserir o bloco novo no `helpers.js` com
`String.prototype.replace(de, textoComTemplateLiteral)` **corrompeu o arquivo**:
o texto continha `` `^${...}$` ``, e num argumento de substituição a sequência
`` $` `` significa "tudo o que vem ANTES do casamento". O resultado foi o
começo do `helpers.js` injetado no meio de uma template string, e o erro que
apareceu (`Unexpected token $ref`, dez linhas adiante) não apontava para a
causa.

**A regra:** ao inserir código por script, use a forma de FUNÇÃO
(`s.replace(de, () => bloco)`). Ela não interpreta `$&`, `` $` ``, `$'` nem
`$1`. E `node --check <arquivo>` depois de toda edição mecânica — ele dá a
linha certa, que o lint não deu.

---

# F. O contrato do backend mudou NO MEIO da rodada

`npm run test` ficou vermelho num teste que **não é meu**:

    api-contract.test.js > o spec versionado é o do backend
    O backend mudou o contrato desde a última sincronização.

É exatamente o incidente que criou esse teste (a troca de `/coupons/available`
por `/coupons`, que deixou a tela do Clube quebrada com todos os portões
verdes), pego desta vez **no minuto em que aconteceu**.

**O que mudou:** `valid_until` deixou de ser obrigatório e passou a ser
anulável, em `CustomerCouponResponse`, `CouponCreate` e `CouponAdminResponse`.
Nenhuma rota, nenhum esquema, nenhum outro campo. Ou seja: **cupom sem prazo de
validade passou a existir.**

**O front já tolerava** — `formatCouponDate` e `couponValidUntil` devolvem `''`
para valor vazio, e a linha só entra se houver texto. Mas "já tolerava" sem
teste é afirmação sobre código lido, não sobre comportamento medido, e as três
fixtures do repositório têm prazo — nada exercitava esse caminho.

Sincronizado (`npm run api:generate`, os dois arquivos juntos) e coberto por
teste novo, **visto vermelho**: tirando a guarda `if (!value) return ''` de
`formatCouponDate`, o card passa a anunciar `Válido até 01/01` (o epoch), e o
teste acusa.

**Só a `main` do backend mudou; nada foi pedido por mim.** Este item está aqui
porque o próximo a retomar precisa saber que o contrato andou.

---

# G. TODA ESCRITA DO FRONT, e qual delas tem teste de verdade

Levantamento de 02/09/2026. A coluna "exercitada" **não é leitura de código**: é
medição. O `mockApi()` foi instrumentado para registrar toda requisição não-GET
que chega até ele, e a suíte inteira rodou. O que não apareceu, não passou por
ali.

## G.1 A tabela

`fechado?` = o esquema do corpo é `additionalProperties: false`, ou seja um nome
fora do contrato derruba a requisição com 422 — a bomba do #6.

| método | rota | esquema | fechado? | exercitada? | mock recusa como o backend? |
|---|---|---|---|---|---|
| POST | `/restaurants/{slug}/branches/availability` | `BranchAvailabilityRequest` | **SIM** | **SIM**, 307× | **SIM** |
| POST | `/restaurants/{slug}/orders` | `CreateOrderRequest` | não | **SIM**, 61× | sim (só obrigatórios) |
| POST | `/restaurants/{slug}/orders/{token}/payment` | `StartPaymentRequest` | não | **SIM**, 47× | sim (desde o conserto do `anyOf`, §G.3) |
| POST | `/restaurants/{slug}/delivery/estimate` | `DeliveryEstimateRequest` | **SIM** | **SIM**, 34× | **SIM** |
| POST | `/restaurants/{slug}/coupons/preview` | `CouponPreviewRequest` | **SIM** | **SIM**, 17× | **SIM** |
| POST | `/customers/me/addresses` | `CreateCustomerAddressRequest` | **SIM** | **SIM** (spec novo desta rodada) | **SIM** (validador próprio, lendo o mesmo `openapi.json`) |
| POST | `/customers/me/cards` | `SaveCardRequest` | não | sim, 4 specs | **NÃO** — rota própria do spec, sem conferência |
| DELETE | `/customers/me/cards/{id}` | (sem corpo) | — | sim | — |
| POST | `/auth/login` | `LoginRequest` | não | sim, 2 specs | **NÃO** — rota própria |
| POST | `/auth/verify-email-code` | `VerifyEmailCodeRequest` | não | sim, 1 spec | **NÃO** — rota própria |
| POST | `/voice/session`, `/voice/search` | fora do spec | — | sim | — (fora do contrato, por decisão) |
| **PATCH** | **`/customers/me`** | **`UpdateCurrentCustomerRequest`** | **SIM** | **NÃO** | **NÃO** |
| **PATCH** | **`/customers/me/addresses/{id}`** | **`UpdateCustomerAddressRequest`** | **SIM** | **NÃO** | **NÃO** |
| **POST** | **`/customers/me/addresses/import`** | **`ImportCustomerAddressesRequest`** | **SIM** | **NÃO** | **NÃO** |
| PATCH | `/customers/me/password` | `ChangeCustomerPasswordRequest` | não | **NÃO** | — |
| DELETE | `/customers/me/addresses/{id}` | (sem corpo) | — | **NÃO** | — |
| PATCH | `/customers/me/addresses/{id}/default` | (sem corpo) | — | **NÃO** | — |
| POST | `/auth/register` | `RegisterCustomerRequest` | não | **NÃO** | — |
| POST | `/auth/resend-email-code` | `ResendEmailCodeRequest` | não | **NÃO** | — |
| POST | `/auth/forgot-password` | `ForgotPasswordRequest` | não | **NÃO** | — |
| POST | `/auth/verify-reset-code` | `VerifyResetCodeRequest` | não | **NÃO** | — |
| POST | `/auth/reset-password` | `ResetPasswordRequest` | não | **NÃO** | — |
| POST | `/restaurants/{slug}/coupons/claim` | `CouponClaimRequest` | **SIM** | **NÃO em E2E** (só unitário, com ApiClient falso) | **NÃO** |

## G.2 A RESPOSTA CURTA: são TRÊS a mesma bomba do #6 esperando

Escrita com **esquema fechado** e **nenhum teste que a exercite**:

1. **`PATCH /customers/me`** — "meus dados" do Perfil.
2. **`PATCH /customers/me/addresses/{id}`** — editar endereço.
3. **`POST /customers/me/addresses/import`** — importar endereços locais na
   primeira entrada na conta.

**Nenhuma das três está quebrada HOJE** — conferi os três payloads campo a campo
contra o esquema e estão certos:

- `validateCustomerDataForm` devolve exatamente `{name, email, phone,
  birth_date}`, que são os quatro obrigatórios de `UpdateCurrentCustomerRequest`;
- a #2 usa o **mesmo** `addressApiPayload` da #1 da tabela, que foi corrigido
  nesta rodada — ela está certa *por carona*, e é a que mais assusta: o defeito
  do #6 valia para ela também, e ela continua sem teste próprio;
- `importAddressPayload` usa `zipcode`, `label` e `client_reference`.

O que falta nas três é a **prova**. Foi exatamente essa combinação — payload
certo por leitura, nenhum teste que o exercite — que deixou o 422 do endereço
vivo por quanto tempo ninguém sabe.

**Quarta da lista, mais fraca:** `POST /coupons/claim` tem esquema fechado
(`{code}`), tem seis unitários com `ApiClient` falso, mas **nenhum E2E**. O
corpo é um campo só, então o risco é pequeno — mas a rota que eu liguei nesta
rodada é a única escrita nova sem exercício de ponta a ponta.

**E há uma quinta categoria, sem esquema fechado mas sem conferência nenhuma:**
`/customers/me/cards`, `/auth/login` e `/auth/verify-email-code` são exercitadas
por specs que registram **rota própria** — e rota própria vence o `mockApi()`,
então o validador de contrato nunca as vê. Como os esquemas delas são abertos,
não há risco de 422; o que se perde é a conferência de **obrigatório ausente**.

## G.3 Um buraco do validador que EU deixei, e fechei

O validador montava a tabela lendo `schema.$ref` do corpo. **Duas rotas do
contrato declaram o corpo como `anyOf: [{$ref}, {type: null}]`** — a forma que o
FastAPI gera para corpo OPCIONAL — e ficavam de fora sem dizer nada:

- `POST /restaurants/{slug}/orders/{tracking_token}/payment`
- `POST /restaurants/{slug}/orders/track/{tracking_token}/cancel`

Corrigido: a tabela passou de **64 para 66** rotas. **Não consegui ver este
conserto vermelho**, e está dito assim: `StartPaymentRequest` é aberto e tem
`required: []`, então nenhum corpo daquela rota consegue violar nada hoje; e a
rota de cancelamento o front ainda não chama. É correção por construção.

## G.4 ACHADO GRANDE, e não era o que eu procurava

**A rota de cancelamento pelo cliente EXISTE**, e é a pendência que a §8 da
skill e o `docs/order-contract.md` (item 11) chamam de *"a mais cara, e continua
aberta: numa recusa de cartão o pedido já está gravado e não há rota de cliente
para cancelá-lo"*.

    POST /restaurants/{restaurant_slug}/orders/track/{tracking_token}/cancel

Do `@description` do contrato:

- vale em **`pending` e `accepted`**; a partir de `preparing` responde **409** e
  o app manda falar com o restaurante;
- **sem login, de propósito** — quem autoriza é o `tracking_token` da URL, o
  mesmo do acompanhamento; pedido de convidado é caso normal;
- corpo **opcional**, e o motivo dentro dele também;
- **estorna o pagamento online**, devolve o cupom e devolve o cashback
  resgatado — "um pix pago e cancelado em seguida volta sem ninguém ligar para
  o restaurante";
- sem `Idempotency-Key`: o segundo clique leva 409 da máquina de estados.

**O front não a chama.** E o motivo de ninguém ter notado é estrutural:
`api-contract.test.js` confere que toda rota **que o front chama** existe no
spec — nunca o contrário. Uma capacidade nova que o backend publica não tem
alarme nenhum.

**Não implementado nesta rodada**: é feature nova no caminho do pedido/pagamento,
que continua fora desta branch. Mas a pendência mais cara do repositório
**deixou de ser bloqueada por backend** e passou a ser trabalho de front.

---

# H. Fazer o `api-contract.test.js` valer no CI — plano e custo

## H.1 O problema, exato

`tests/unit/api-contract.test.js` tem três verificações. As duas primeiras
rodam em qualquer lugar. **A terceira — "o spec versionado é o do backend" —
só roda onde `../pedeaqui_back` existe**, e o CI só faz checkout deste
repositório. Ela se pula em silêncio.

Foi essa terceira que pegou, nesta madrugada, o `valid_until` virando anulável.
Na máquina de quem tem os dois repositórios. **No portão, um contrato
dessincronizado passa.**

E o que a dessincronização custa está documentado: foi assim que
`/coupons/available` virou `/coupons`, a tela do Clube quebrou para todo cliente,
e lint + 253 unitários + 243 E2E ficaram verdes.

## H.2 As três formas, com o custo de cada uma

### (a) O backend publica o `openapi.json` numa URL, e o CI baixa

O job `verify` busca `https://api.pederapidex.com/openapi.json` e compara com
`scripts/types/openapi.json`.

- **Custo de implementação:** baixo — um passo no `ci.yml` e uma variante do
  teste que aceita a origem por variável de ambiente.
- **Custo corrente:** o portão passa a depender da API estar **de pé**. Uma
  janela de instabilidade do backend vira CI vermelho num PR que não tem nada a
  ver. Mitigável com "não achou a URL → pula", mas aí volta a se pular em
  silêncio — só que agora de forma **intermitente**, que é pior: um portão que
  às vezes confere é um portão em que se aprende a não confiar.
- **Efeito colateral bom:** pega divergência contra o que está EM PRODUÇÃO, e
  não contra o que está no disco de alguém.
- **Risco:** a URL pública precisa expor o spec. Se ela exigir credencial, o
  segredo entra no CI.

### (b) O backend commita o `openapi.json` num lugar que o CI alcança

Um repositório de contrato, ou um artefato versionado que o CI do front baixa
por tag.

- **Custo de implementação:** médio, e **atravessa dois times** — é a única
  opção que exige mudança do lado do backend.
- **Custo corrente:** praticamente zero, e é determinístico (não depende de
  serviço no ar).
- **Efeito:** o contrato passa a ter versão própria, e "o front está na v12 e o
  backend na v13" vira uma frase que se pode dizer.
- **É a melhor de longe se o backend topar.**

### (c) O CI faz checkout dos DOIS repositórios

Um passo `actions/checkout` extra com `repository: <org>/pedeaqui_back`.

- **Custo de implementação:** o menor de todos — três linhas no `ci.yml`.
- **Custo corrente:** clonar o backend inteiro em todo push do front (segundos,
  mas cresce), **e um token com acesso de leitura ao repositório do backend
  guardado nos secrets do front**. É esse o preço real: um segredo a mais, e um
  acoplamento de permissão entre os dois repositórios.
- **Efeito:** compara contra a `main` do backend, que é o que a máquina local já
  faz — mesma semântica, sem surpresa.

## H.3 Recomendação

**(b) se o backend topar; (c) enquanto ele não topa.** A (a) é a que parece mais
simples e é a que tem o pior custo corrente — ela troca um portão que se pula
por um portão que oscila.

E, em qualquer uma das três, uma coisa muda no teste e é a mais importante:
**ele não pode mais se pular em silêncio**. Hoje a ausência do backend é
indistinguível de "conferido e igual". Com a fonte definida por configuração, o
caso "não consegui conferir" tem de **falhar**, ou no mínimo emitir uma linha
que o log do CI mostre.

**NÃO IMPLEMENTADO** — o `ci.yml` está fora desta rodada, e a escolha entre (b)
e (c) é decisão de infraestrutura, não de front.

---

# I. O `©` da landing — consertado

`index.html` dizia **`© 2025`**, errado desde 1º de janeiro, na landing, para
todo visitante. Nada quebrava e nenhum teste caía: quem percebe um ano velho no
rodapé é quem está avaliando a empresa.

O ano passa a sair do relógio (`landing-page.js`), e o número no HTML é só o que
aparece com o JS desligado.

**O teste NÃO é uma bomba-relógio, e a diferença importa:** ele não tem ano
embutido — compara o ano da página com o ano de quem está rodando, e os dois
andam juntos. É o mesmo padrão de `validadeFutura()`. Visto vermelho com o
`2025` recolocado: `Expected: "2026" / Received: "2025"`.

O contador do Pix **não** foi mexido: ele é pedido de backend (`expires_at` em
`StartPaymentResponse`, §B.4) e conta pelo relógio do cliente porque o contrato
não manda prazo nenhum.

---

# J. Cancelamento pelo cliente — construído

A rota estava no contrato e o front nunca a chamou. É a pendência que o
`docs/order-contract.md` (item 11) e a §8 da skill chamam de **"a mais cara"**:
numa recusa de cartão o pedido já está gravado, e não havia como o cliente
desfazê-lo.

## J.1 As duas condições para o botão aparecer, e as duas são necessárias

**1. A JANELA.** `pending` e `accepted`. De `preparing` em diante o insumo saiu
do estoque, quem come o prejuízo passa a ser o lojista, e o backend responde
**409**. Mostrar o botão fora da janela é oferecer o que vai falhar — o mesmo
defeito que o fluxo do cupom passou esta rodada consertando.

**2. O TOKEN.** Quem autoriza é o `tracking_token`, e ele **não vem no
`OrderDetailResponse`**: só existe no `localStorage` do aparelho que criou o
pedido (`state/order-tracking.js`). Sem ele não há com o que cancelar, e um
botão que erra 404 é pior que botão nenhum.

**A segunda é uma limitação real**, e vai para os pedidos ao backend (§B.5):
um pedido feito no celular não pode ser cancelado pelo computador.

## J.2 A folha de confirmação lê o PEDIDO, não uma lista fixa

Cancelar é irreversível, então pergunta antes. E a folha diz o que acontece com
o dinheiro — montado a partir do pedido:

| condição no pedido | frase |
|---|---|
| `payment_flow: online` + `payment_status: paid` | "O valor pago é estornado para você." |
| `payment_flow: online`, não pago | "A cobrança é cancelada e nada é debitado." |
| pagamento na entrega | "Nada foi cobrado: este pedido seria pago na entrega." |
| `coupon_code` presente | "O cupom X volta a ficar disponível." |
| `cashback_redeemed_amount > 0` | "O cashback usado (R$ Y) volta para o seu saldo." |

Prometer estorno num pedido que se paga na entrega é mentir para quem nunca
pagou; omitir o estorno num Pix já pago é esconder a informação que faz a
pessoa decidir sem medo. Tem E2E para os dois lados.

## J.3 Decisões do serviço

- **Sem Bearer.** A rota não declara `security` (conferido no spec, e há um
  unitário que trava essa premissa). Mandar o header do cliente numa chamada
  que não o pede é vazar credencial de graça — e quebraria o convidado, que é
  o caso que a rota existe para atender.
- **Corpo opcional de verdade**: sem motivo, sem corpo.
- **O `reason` é cortado em 150**, que é o `maxLength` do contrato — e o teste
  lê esse número DO SPEC, não de um literal.
- **O 409 sobe com o status** e vira outra frase na tela: *"O restaurante já
  começou a preparar este pedido"*, **sem** oferecer tentar de novo. Retentativa
  ali é oferecer o que nunca mais vai dar certo.

## J.4 Duas armadilhas que apareceram construindo

**1. `[hidden]` perdendo para o CSS.** A folha tem `display:flex` por um seletor
de id; o `[hidden]{display:none}` do agente de usuário é atributo puro e perde
por especificidade. O elemento ficava com o atributo `hidden` **e visível** — o
DOM dizendo uma coisa e o olho outra. O Playwright relatou
`resolved to <div hidden="">` como VISÍVEL, que é uma mensagem difícil de ler
sem saber disso. A regra que fica: **toda vez que uma folha der `display` a um
elemento que o JS esconde por `hidden`, a linha `[hidden]{display:none}` vai
junto.**

**2. Reusei o `git checkout <arquivo>` para desfazer uma injeção, DE NOVO** — e
perdi o markup da folha de confirmação, 23 linhas. Eu tinha escrito essa exata
armadilha na skill (§12.11) horas antes. Escrever não basta: o hábito é copiar
o arquivo para o scratchpad ANTES de injetar, e restaurar pela cópia.

## J.5 Classes de PAPEL, não de posição

A folha usa `.ui-btn-danger` e `.ui-btn-secondary` de `components.css`, e **não**
`.addr-delete-yes`/`.addr-delete-cancel`. Aqueles dois nomes marcam a POSIÇÃO no
par, não a função, e já trocam de papel entre as três telas que os usam — no
`#logoutConfirm` quem tem "yes" no nome é o botão de FICAR (§4.1 da skill).
Herdar essa confusão numa tela que cancela pedido é herdar a pior parte dela.

## J.6 Verificação

`lint 79 problems (0 errors)` — o warning novo é o `innerHTML` da lista de
consequências, que usa `esc()` · `typecheck:cards` exit 0 · `test 347 passed`
(31 arquivos) · `test:e2e 322 passed · 3 skipped`, exit 0, 6,0 min.

**Vermelhos vistos**, por injeção:
- tirando a janela (`PROF_ORDER_CANCELAVEL`), o botão aparece em `preparing`:
  `Expected: 0 / Received: 1`;
- ligando o botão direto no `confirmOrderCancel` (sem confirmação), a folha não
  abre e o teste cai na linha que exige zero cancelamentos;
- no serviço, três unitários caem ao injetar o Bearer e o `reason` sem corte.

---

# K. O `api-contract.test.js` passa a olhar os DOIS sentidos

Ele conferia um só: *"toda rota que o front chama existe no spec"*. Isso pega
rota MORTA — o `/coupons/available` do incidente. **Não pega o contrário**:
capacidade que o backend publicou e o front ignora. Foi assim que o
cancelamento ficou invisível enquanto o `order-contract.md` seguia listando
"não há rota de cliente para cancelar" como a pendência mais cara.

**É AVISO, não falha**, e o motivo é que a maioria das rotas do spec não é do
app do cliente: `/admin/*` é o painel do lojista, `/payments/webhooks/*` é o
gateway falando com o backend, `/health` é infraestrutura. Um teste que exigisse
consumo de todas nasceria vermelho — e portão que nasce vermelho é portão que se
aprende a ignorar.

Saída de 02/09/2026:

    [contrato] 4 rota(s) de cliente que a API oferece e o front NÃO usa:
      POST   /chat
      POST   /chat/feedback
      GET    /customers/me/export
      PUT    /restaurants/{restaurant_slug}/orders/track/{tracking_token}/review

**Duas descobertas nessas quatro linhas:**

- `GET /customers/me/export` (o pacote da LGPD) e `PUT .../review` (avaliar o
  pedido) são **capacidades publicadas que o app não oferece**. Nenhuma foi
  construída aqui; ficam na lista, que é o ponto.
- `/chat` e `/chat/feedback` são **falso positivo — e o falso positivo é
  informação**. O app usa as duas, mas elas não estão em `api-routes.js`: o
  assistente monta a URL literal (`restaurant-assistant.js:658`). Ou seja, a
  lista denunciou uma rota que escapou do ponto único de rotas. **Não
  silenciei**: silenciar apagaria o sintoma. O conserto é mover as duas para
  `api-routes.js`, e aí elas somem da lista sozinhas.

**Uma armadilha de ferramenta:** a primeira versão usava `console.warn`, e o
vitest **intercepta o console e não imprime a saída de teste que passa**. O
aviso ficou verde e invisível — exatamente o defeito que ele existe para
corrigir. Hoje usa `process.stdout.write`.

E ele tem **sonda contra vacuidade**: se `frontRoutes()`/`toSpecShape()`
pararem de casar, `usadas` fica vazia e a lista vira o spec inteiro. Duas rotas
que o front comprovadamente chama são afirmadas antes.

---

# L. As três escritas sem cobertura — cobertas

`tests/e2e/customer-writes-contract.spec.js`, três testes, um por escrita de
esquema fechado que a varredura da §G.2 achou sem exercício nenhum:

| escrita | o que o teste prende |
|---|---|
| `PATCH /customers/me` | manda **exatamente** `{name, email, phone, birth_date}` — os quatro `required` — e nada mais; e o `birth_date` sai em ISO |
| `PATCH /customers/me/addresses/{id}` | os nomes do contrato: `zipcode`, `label`, sem `place_id`. É o **mesmo** `addressApiPayload` que estava quebrado no POST |
| `POST /customers/me/addresses/import` | `{addresses: [...]}`, e o item de DENTRO (`ImportCustomerAddressRequest`, também fechado) com `zipcode`/`label`/`client_reference` |

**O validador vem do `helpers.js`, exportado.** Estes specs registram rota
própria — e rota própria vence o `mockApi()`, então o corpo deixaria de ser
conferido. `violacoesDaRequisicao` é a MESMA função que o mock usa, lendo o
`openapi.json`. Uma cópia da regra escrita no spec divergiria na direção do que
o código manda hoje, que é exatamente o que se quer pegar.

**Vermelhos vistos**, reinjetando os nomes antigos no `addressApiPayload` e um
campo fora do contrato na importação:

    Error: o backend recusaria este payload
    + "body.postal_code: campo fora do contrato (UpdateCustomerAddressRequest é additionalProperties:false)"
    + "body.place_id:    campo fora do contrato (...)"
    + "body.alias:       campo fora do contrato (...)"

**E o erro que eu cometi escrevendo:** registrei os espiões ANTES do
`mockApi()`. No Playwright a última rota registrada vence, então o `mockApi`
respondia por tudo e os três testes falhavam com "nenhuma requisição" — que é
indistinguível de "o app não chamou". A primeira leitura do vermelho apontou
para o lugar errado (achei que as ações não existiam) e só uma sonda das ações
registradas desfez a confusão. Está escrito no cabeçalho do arquivo.

## L.1 O que a §G.2 listava e o que sobrou

| escrita | antes | agora |
|---|---|---|
| `PATCH /customers/me` | sem teste | **coberta** |
| `PATCH /customers/me/addresses/{id}` | sem teste | **coberta** |
| `POST /customers/me/addresses/import` | sem teste | **coberta** |
| `POST /coupons/claim` | só unitário | continua só unitário — corpo de UM campo, risco pequeno, e a rota nasceu nesta rodada |
| `/customers/me/cards`, `/auth/login`, `/auth/verify-email-code` | rota própria, sem conferência | continuam — esquemas ABERTOS, sem risco de 422; o que se perde é a conferência de obrigatório ausente |
| `/auth/register`, `resend`, `forgot`, `verify-reset`, `reset-password`, `PATCH /customers/me/password` | sem teste | continuam sem teste — esquemas abertos, e o fluxo de autenticação inteiro está fora desta branch |

---

# M. O que o backend ainda precisa entregar — dois itens NOVOS

Somam-se aos de §B.

## B.5 O `tracking_token` no pedido do cliente logado

**Pedido:** publicar `tracking_token` em `OrderDetailResponse` (e/ou em
`CustomerOrderResponse`, da lista), **ou** uma rota de cancelamento por
`order_id` que autorize pelo Bearer.

**Por que.** O cancelamento pelo cliente já está construído e funciona — mas só
**no aparelho que fez o pedido**. Quem autoriza é o `tracking_token`, e ele não
vem em nenhuma resposta do cliente logado: o front só o tem porque o guarda no
`localStorage` quando o `POST /orders` responde.

Consequência prática: pedido feito no celular não pode ser cancelado pelo
computador, nem depois de limpar os dados do navegador, nem passados 7 dias (o
TTL local). O cliente logado vê o pedido, vê que ele está em `accepted`, e não
tem o botão.

**Não estamos pedindo para afrouxar a autorização.** O `tracking_token` continua
sendo a chave do convidado. O que falta é o cliente **autenticado** poder
alcançar o próprio pedido pelo Bearer, que é o que ele já faz para LER
(`GET /customers/me/orders/{id}`) e não faz para cancelar.

## B.6 Duas capacidades publicadas que o app não oferece

Achadas pelo aviso novo do `api-contract.test.js` (§K). Não são pedidos de
mudança no backend — são **avisos de que o front está devendo**:

- **`GET /customers/me/export`** — o pacote da LGPD (direito de acesso e
  portabilidade). O app não tem tela para isso.
- **`PUT /restaurants/{slug}/orders/track/{token}/review`** — avaliar o pedido.
  O app não pede avaliação nenhuma.

Ficam nomeadas aqui para não repetirem a história do cancelamento, que passou
meses invisível.

---

# §B.5 — O `tracking_token` no pedido do cliente logado

> **Texto para colar no agente do backend.** É a continuação da seção B (o que
> o backend precisa entregar). Contexto: front white-label de pedidos
> (`pedeaqui_front`), consumindo a API do Rapidex.

## O pedido

**Publicar o `tracking_token` em `OrderDetailResponse`** — a resposta de
`GET /customers/me/orders/{order_id}`, do cliente autenticado.

Se publicá-lo na lista (`GET /customers/me/orders`) for barato, melhor ainda: o
botão de cancelar aparece no card sem esperar o detalhe carregar. Mas o detalhe
é o que resolve.

**Alternativa equivalente, se preferirem não expor o token:** uma rota de
cancelamento endereçada por `order_id` e autorizada pelo **Bearer** —
`POST /customers/me/orders/{order_id}/cancel` —, com exatamente a mesma
semântica da que já existe (janela `pending`/`accepted`, 409 a partir de
`preparing`, estorno do pagamento online, devolução do cupom e do cashback).

Qualquer uma das duas resolve. Não precisamos das duas.

## Por que o front precisa

O cancelamento pelo cliente **já está construído e funcionando**
(`POST /restaurants/{slug}/orders/track/{tracking_token}/cancel`). O botão
aparece no detalhe do pedido, dentro da janela, com confirmação e com o texto
do que acontece com pagamento, cupom e cashback.

Só que quem autoriza aquela rota é o `tracking_token`, e **ele não vem em
nenhuma resposta do cliente logado**. O front só o tem porque o guarda no
`localStorage` no instante em que o `POST /orders` responde
(`scripts/state/order-tracking.js`).

Consequência prática, e ela é grande:

| situação | o cliente consegue cancelar? |
|---|---|
| pediu no celular, cancela no celular | **sim** |
| pediu no celular, abre no computador | **não** — o botão nem aparece |
| pediu, limpou os dados do navegador | **não** |
| pediu há mais de 7 dias (nosso TTL local) | **não** |
| pediu no app, entrou depois em outro navegador | **não** |

Nos quatro casos de "não", o cliente **vê o pedido** (o histórico vem pelo
Bearer, normalmente), vê que ele está em `accepted`, e não tem como desistir. A
única saída é ligar para o restaurante — que é exatamente o custo que a rota de
cancelamento existe para eliminar.

## Por que o front não resolve sozinho

Não há de onde tirar o token. Ele não está em `OrderDetailResponse`, não está em
`CustomerOrderResponse`, e não há rota que o devolva a partir do `order_id`. O
`localStorage` é a única fonte, e ele é por aparelho e por navegador — não é uma
propriedade do pedido, é uma propriedade de onde o pedido foi feito.

E **não queremos afrouxar a autorização**: o `tracking_token` continua sendo a
chave do convidado, e é ele que mantém o Pix de quem não tem conta funcionando.
O que falta é o cliente **autenticado** poder alcançar o próprio pedido pelo
Bearer para CANCELAR — que é o que ele já faz para LER, em
`GET /customers/me/orders/{order_id}`.

## Sobre expor o token na resposta

Se a preocupação for vazamento: o `tracking_token` já viaja na URL de toda
consulta de acompanhamento e já é guardado no `localStorage` do cliente. Publicá-lo
numa resposta que **exige Bearer e é do próprio dono do pedido** não amplia a
superfície — quem pode ler aquela resposta já é quem poderia cancelar.

Se ainda assim preferirem não expor, a alternativa da rota por `order_id` +
Bearer entrega o mesmo resultado sem o token aparecer em lugar nenhum. É a nossa
preferência se houver dúvida.

## O que muda no front quando chegar

Uma linha: a busca do token deixa de ser só no `localStorage` e passa a cair
para o campo da resposta (ou a chamada troca de rota). O resto — a janela de
status, a confirmação, o texto das consequências, o tratamento do 409 — já está
pronto e testado (`tests/e2e/order-cancel.spec.js`).

---

# N. O `/chat` voltou para o ponto único

`'/chat'` e `'/chat/feedback'` estavam escritas **literalmente** dentro do
`restaurant-assistant.js`. Quem as denunciou foi o aviso novo do
`api-contract.test.js`: elas saíram na lista de "rotas que a API oferece e o
front não usa" — o app usava as duas, mas nenhuma passava por `api-routes.js`,
então a varredura não as via.

**O preço de estar fora não era teórico:** rota literal não é conferida contra o
spec pelo teste que existe justamente para isso. Um renome no backend a
quebraria como a tela do Clube quebrou quando `/coupons/available` virou
`/coupons` — com todos os portões verdes.

Agora são `routes.chat()` e `routes.chatFeedback()`. **O aviso caiu de 4 para 2
linhas sozinho**, e as duas que sobraram são reais:

    [contrato] 2 rota(s) de cliente que a API oferece e o front NÃO usa:
      GET    /customers/me/export
      PUT    /restaurants/{restaurant_slug}/orders/track/{tracking_token}/review

Foi o comportamento certo do aviso: o falso positivo era o sintoma de uma rota
que escapou, e consertar a rota apagou o sintoma — que é diferente de silenciá-lo.

---

# O. As escritas que só tinham caminho feliz — dinheiro primeiro

Medido em 02/09/2026 instrumentando o `mockApi()`. Destas, três estavam **só**
no caminho feliz, e as três são dinheiro.

## O.1 Salvar cartão — nenhum mock da suíte devolvia erro

**TODO** mock de `/customers/me/cards` respondia 200. O contrato declara
`201, 401, 409, 422, 502, 503`.

O que a falha protege: **um cartão que a tela mostra e o gateway não tem é um
cartão que o cliente escolhe no checkout e que recusa na hora de pagar** — com a
sacola montada. O teste novo prende que a falha não coloca o cartão na lista,
que a tela não fecha sobre o erro, que a mensagem do BACKEND chega ao cliente
(não uma frase genérica nossa) e que o botão volta a funcionar.

**Vermelho visto**, tornando o salvamento otimista (o cartão entra na lista
antes de o backend responder): `Expected: 0 / Received: 1`.

## O.2 Remover cartão — a falha PRECISA deixar o cartão na lista

Aqui o contrato é explícito, e o front acerta: *"Se ele [o gateway] estiver fora
do ar a remoção falha inteira (502) e o cartão continua na lista — o cliente
tenta de novo."* Sumir com ele da tela faria a pessoa acreditar que apagou um
cartão que continua na conta do lojista.

**Vermelho visto**, tornando a remoção otimista: `Expected: 1 / Received: 0`.

## O.3 A taxa de entrega que não veio — e o total que sai sem ela

`POST /delivery/estimate` era exercitado **34 vezes** na suíte, sempre com 200.

E a falha dele mexe no total: `deliveryFee()` (`restaurant-page.js:187`) devolve
`currentDeliveryEstimateFee() ?? 0`. Medido no teste novo, com o 422 que a rota
declara:

| linha | valor |
|---|---|
| Subtotal | R$ 68,60 |
| Taxa de serviço | R$ 0,99 |
| Taxa de entrega | **"Taxa indisponivel"** |
| **Total** | **R$ 69,59** |

O total sai **7,40 mais barato** do que o pedido custaria. Isso não é defeito
escondido — é o que a função faz por construção. O que impede o estrago é uma
segunda peça: `hasValidDeliveryEstimateFee()` fica falso e
`validateOrderPayload` **barra a criação do pedido**.

**O buraco era de FIAÇÃO, não de lógica.** O unitário de `order-payload` já
provava o validador com `hasValidDeliveryFee: false`; ninguém provava que uma
falha de verdade da rota chega até aquele estado. Um validador certo ligado no
lugar errado passa nos dois testes separados e deixa o pedido sair com frete
zerado.

**Vermelho visto**, trocando `hasValidDeliveryFee: hasValidDeliveryEstimateFee()`
por `true`: o erro some da sacola e o pedido nasce.

## O.4 Um comentário desatualizado, corrigido de passagem

`cart-money-chain.spec.js` dizia que *"o /delivery/estimate NÃO é atendido pelo
mockApi — cai no catch-all 404"*. **Hoje ele é atendido** (taxa fixa de 5,00), e
a instrumentação mostrou as 34 chamadas chegando lá. O comentário virou o que
ele é: esta rota sobrepõe o mock com o 7,40 que a conta deste arquivo usa.

## O.5 O que continua só no caminho feliz, e por quê

| escrita | por que fica |
|---|---|
| `POST /coupons/claim` | corpo de UM campo (`{code}`), com seis unitários que cobrem recusa, código vazio e filtro. Sem E2E — o risco é pequeno e a rota nasceu nesta rodada |
| `/auth/login`, `/auth/verify-email-code` | esquemas ABERTOS: nome fora do contrato não vira 422. Perde-se só a conferência de obrigatório ausente. E o fluxo de autenticação inteiro está fora desta branch |
| `/auth/register`, `resend`, `forgot`, `verify-reset`, `reset-password`, `PATCH /customers/me/password` | sem teste nenhum, e sem tela coberta por E2E. Mesmo motivo acima; é a próxima frente |
| `POST /orders` e `POST /orders/{token}/payment` | **já tinham** caminho de falha: 409, `detail` em três formas, abort de rede com Idempotency-Key reaproveitada, duplo clique, recusa de cartão, 409 do gateway, cobrança sem QR |
