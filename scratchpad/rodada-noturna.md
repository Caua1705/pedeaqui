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
| 5 | fluxo de cupons | contrato lido, nada construído |

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
| `tenant-theme:198` | `new Date('2026-08-29T12:00:00Z')` com `clock.install` + `pauseAt` | fica: relógio congelado, já corrigido em rodada anterior |
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
