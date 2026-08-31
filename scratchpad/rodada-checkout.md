# Rodada de fechamento do front — FONTE DA VERDADE (rodada/checkout)

Sessão iniciada 31/08/2026. Branch `rodada/checkout`, a partir de `bd325f7`
(main). NUNCA commitar na main.

## Regras desta rodada (do prompt, resumidas)

- Um commit por item, verde, com push. Este arquivo atualizado no MESMO commit.
- Ao retomar depois de compactação: RELER ESTE ARQUIVO PRIMEIRO. Ele vence a
  lembrança.
- **Portão lido SEM pipe.** `| tail` engole o exit code e já mentiu três vezes.
- **Antes de QUALQUER medição de E2E:** matar node órfão e conferir a porta 4174
  livre. Obrigatório, não higiene opcional.
  - PowerShell: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` e
    `Get-NetTCPConnection -LocalPort 4174 -State Listen`.
- **REGRA DE DINHEIRO (item 3):** nenhum commit da seção 3 pode mudar um valor
  que o cliente vê ou paga. Número que muda = defeito achado = commit SEPARADO
  do movimento, com teste próprio. Nunca no mesmo commit: mover código e
  corrigir cálculo.
- Fora da rodada: login Google · fluxo novo de cupons · backend · merge na main.
- Parar se: flakes não fecharem 3 verdes · número de dinheiro mudar sem motivo
  conhecido · item exigir backend · escapes pendentes > 8 · mesmo portão
  vermelho 3x no mesmo item.

## A máquina (medido nesta sessão, e é parte da causa)

8 núcleos lógicos, **8 GB de RAM**. Durante a suíte E2E a memória livre cai
para ~430 MB. `playwright.config.js` usa `workers: undefined` fora do CI =
**4 workers** = 4 Chromiums + `vite preview`. A "carga" dos flakes é isto.

## Ordem de execução e status

Legenda: [ ] pendente · [~] em andamento · [x] feito+commitado+push · [!] bloqueado

### Item 1 — os 5 flakes (BLOQUEANTE)
- [x] 1.1 assistant-product-detail.spec.js:4 — CAUSA ACHADA E CORRIGIDA
- [x] 1.2 assistant-voice-session.spec.js:294 — CAUSA ACHADA E CORRIGIDA
- [x] 1.3 assistant-voice-session.spec.js:668 — MESMA CAUSA, mesmo commit
- [~] 1.4 auth-screen-nav.spec.js:105 - NAO REPRODUZIU (ver abaixo)
- [~] 1.5 order-flow.spec.js:163 - so reproduziu DENTRO de um travamento de maquina (ver abaixo)
- [ ] 1.6 PORTÃO: suíte completa verde 3x seguidas (+ 20 execuções de prova)

### Item 2 — limpeza que destrava
- [x] 2.1 os defeitos recusados sob a régua do fallback defensivo — 19 régua correta, 4 defeito de verdade (sort_order), 2 precedência latente, 2 fantasma inofensiva, 1 prosa
- [x] 2.2 deploy opção C (vercel.json + ci.yml + guarda) — INERTE até 3 secrets; passo a passo em docs/deploy-pelo-portao.md

### Item 3 — sacola, checkout e filial
- [ ] 3.1 inventário do que resta no restaurant-page.js
- [ ] 3.2 rede: unitários de cartTotals e da cadeia de preço COMO ESTÁ HOJE
- [ ] 3.3 migração na ordem do inventário
- [ ] 3.4 troca de filial (ÚLTIMA)
- [ ] 3.5 folha de confirmação (escreve token de cartão — decidir por medida)

## Medições

### Baseline 01 — suíte completa, máquina limpa (31/08/2026)
Comando: `npm run test:e2e` sem pipe, saída em `scratchpad/e2e-baseline-01.log`.
Higiene conferida antes: 0 processos node, porta 4174 livre.
RESULTADO: **exit 1 · 288 passed · 1 failed · 3 skipped · 5,8 min.**
Único vermelho: `assistant-product-detail.spec.js:4`, e ele caiu como teste
**#18 de 292** — cedo, com a máquina ainda folgada. Os outros quatro flakes
passaram nesta execução.

## Item 1 — os cinco flakes, um a um

### 1.1 `assistant-product-detail.spec.js:4` — RESOLVIDO

**Falha observada** (baseline 01, e reproduzida 1 em 3 isolada):
```
Expected: "flex"   Received: "none"
> 46 | expect(await detail.evaluate(el => getComputedStyle(el).display)).toBe('flex');
```

**Causa.** O teste afirmava sobre um INSTANTE governado por um relógio de
parede. `assistantCloseProductDetail()` devolve o `hidden` num
`setTimeout(..., 540)`; o teste fazia `waitForTimeout(120)` e perguntava o
`display` DE FORA. Entre o clique e a pergunta havia ainda dois `expect.poll`
lendo `getAnimations()` — cada um um ida-e-volta pelo protocolo. Sob quatro
workers a soma passou dos 540 ms, o `hidden` já tinha voltado, e a resposta
foi `none`. **O teste media a máquina, não o app.** Nem o `getAnimations()`
servia: ele só responde `true` enquanto a transição AINDA corre, o que é a
mesma aposta contra o relógio, na direção oposta.

**Correção.** A sonda passou a viver DENTRO da página e a medir contra o
relógio da própria animação. No `transitionrun` de `transform` da saída ela
lê a duração que o CSS declara (`getComputedStyle(painel).transitionDuration`
= 520 ms) e conta, em quadros de animação, quantos ms o diálogo continuou
`display:flex`. A asserção é `desenhadoAteMs >= transicaoMs`. Nada disso
depende de quando a pergunta do Playwright chega: uma máquina lenta só
aumenta o número medido, que é o lado seguro.

**Ganho de cobertura de brinde:** o teste antigo não pegava alongar a
transição no CSS sem alongar o temporizador do JS. Este pega, porque compara
os dois números.

**Visto vermelho, dois defeitos reinjetados:**
1. temporizador de 540 → 200 ms: `o painel parou de ser desenhado 212 ms
   depois do começo da saída, e o CSS declara 520 ms` (Expected >= 520,
   Received 212).
2. `detail.hidden = true` imediato (a classe do defeito original): a saída
   nem começa — `fechamento` fica `[]` e o teste morre nomeando a metade que
   faltou.

**Prova:** 5/5 execuções isoladas verdes depois da correção (antes: 2/3).
Portões: lint 0 errors/78 warnings (a linha de base) · typecheck ok ·
287 unitários.

## Escapes pendentes (manter ≤ 8)
(nenhum ainda)

## Bloqueados por backend
(nenhum ainda)

## Decisões tomadas sem o usuário
(nenhuma ainda)

### 1.2 e 1.3 `assistant-voice-session.spec.js:294` e `:668` — RESOLVIDOS

**Reprodução** (o arquivo sozinho, 4 workers, máquina limpa, 3 rodadas):
rodada 1 = 23/23; rodada 2 = **3 vermelhos**; rodada 3 = **2 vermelhos**.
Logs: `scratchpad/voz-1.log`, `voz-2.log`, `voz-3.log`.

**Uma causa só, e ela explica os cinco vermelhos observados no arquivo:**
o teste espera pelo COMEÇO do caminho e afirma sobre o efeito do FIM dele.

| teste | espera | afirma sobre |
|---|---|---|
| :294 | `chamadas.busca.length === 1` (o route handler ENTROU) | a mensagem que o app manda depois de a RESPOSTA voltar |
| :668 | idem, + `waitForTimeout(300)` | as 4 linhas de console, duas delas do round trip HTTP |
| :612 | `waitForTimeout(300)` | o `usage` do `response.done` no corpo do `/ended` |
| :581 | `waitForTimeout(300)` | idem, com 4 eventos |
| :372 | `waitForTimeout(400)` | o `conversation.item.create` da busca |

`chamadas.busca.length` cresce dentro do `page.route`, ou seja **antes** de o
mock responder, antes de o `fetch` do app resolver e antes de `enviar()` pôr o
`function_call_output` no canal. E `emitir()` é uma mensagem num
RTCDataChannel de verdade: mandar não é ter chegado. É exatamente a armadilha
"Corridas no E2E" da skill §4 — esperar um efeito observável do FIM do
caminho, nunca um `waitForTimeout`.

As mensagens de falha batem com isso, uma a uma:
- :294 — `Received array: []` no filtro de `conversation.item.create`.
- :668 — `received value must be a string` (o resumo ainda não fora logado).
- :612 — `corpo.input_audio_tokens` **Expected 45, Received undefined**.

**Correções (todas por condição, nenhuma por relógio):**
- :294 — espera o `response.create`, que o app manda DEPOIS do
  `function_call_output`. E a afirmação "veio depois" virou comparação de
  índices, em vez de um `toContain` que não diz nada sobre ordem.
- :372 — a metade POSITIVA passou a esperar o `conversation.item.create`; a
  NEGATIVA ficou com 200 ms de acomodação, e isso é honesto: janela curta num
  "não aconteceu" erra para o verde, nunca para o vermelho falso.
- :581 e :612 — o recibo de que o app PROCESSOU cada evento é o estado da
  tela, trocado pelo MESMO `case` do handler que acumula o uso
  (`response.created` → `is-speaking`; `response.done` → `is-listening`).
- :668 — poll até que nenhuma das quatro linhas esperadas esteja faltando; a
  mensagem de falha passa a dizer QUAL faltou.

**Vermelho visto:** :294, :668 e :612 foram vistos falhando **antes** da
correção, na própria suíte, com o texto acima (voz-2.log e voz-3.log). :372 e
:581 **não** foram observados vermelhos — são a mesma classe, corrigidos
preventivamente; anotado como tal, não como prova.

**Prova depois:** 4/4 execuções do arquivo com 4 workers, 23/23 em cada
(voz-fix-1..4.log). Portões: lint 0 errors · typecheck ok · 287 unitários.

## A caça (5 execuções da suíte completa, 31/08/2026)

Comando: `npm run test:e2e` sem pipe, 5 vezes, logs em `scratchpad/caca-1..5.log`.
Higiene conferida antes: 0 node órfão, porta 4174 livre.

| rodada | resultado | vermelho | tempo |
|---|---|---|---|
| baseline | 288p / 1f | assistant-product-detail:4 (CORRIGIDO) | 5,8 min |
| caça 1 | **289p / 0f** | — | 6,1 min |
| caça 2 | 274p / 15f | **TRAVAMENTO DE MÁQUINA — descartada** | 36,5 min |
| caça 3 | 288p / 1f | verify-email-code:58 | 5,5 min |
| caça 4 | 288p / 1f | tenant-theme:161 | 8,4 min |
| caça 5 | 288p / 1f | assistant-voice-session:491 | 10,7 min |

**A caça 2 não é medição, e por isso não conta.** Quatro testes de
`assistant-voice.spec.js` levaram **15 a 16 MINUTOS cada**, simultaneamente, e
os outros onze vermelhos são todos estouro do teto de 30 s por poucos segundos
(32–38 s). Nenhum valor de espera conserta uma máquina parada por 16 minutos.
A máquina: 8 núcleos, **8 GB de RAM**, com Edge e WSL residentes; durante a
suíte a memória livre fica em 340–430 MB, e o Playwright roda **4 workers**
(`workers: undefined` = metade dos núcleos). Registrado como risco da própria
medição, não como defeito do código.

### 1.4 `auth-screen-nav.spec.js:105` — NÃO REPRODUZIU
Zero vermelhos em 5 execuções saudáveis + baseline. Na caça 2 (a travada) quem
caiu de `auth-screen-nav` foi `:36` e `:60`, com 35–38 s de estouro de teto —
não o `:105`. **Não há causa a achar sem um vermelho para ler.** Não vai para
quarentena: `test.fixme` num teste que passou 6 vezes seguidas troca uma
suspeita por uma perda real de cobertura (ele guarda o cabeçalho da Home
durante a abertura do login). Fica NOMEADO aqui, sem correção.

### 1.5 `order-flow.spec.js:163` — só dentro do travamento
Único vermelho: caça 2, `Test timeout of 30000ms exceeded` em
`confirmOrderSheet` (helpers.js:412), na MESMA execução em que quatro irmãos
levaram 16 minutos. Saudável, ele leva 7,2 s. O log do Playwright mostra a
espera de estabilidade do botão da folha (`element is not stable`) — o clique
espera a animação de entrada terminar, e essa espera sai do orçamento do teste.
Isso é real e vale anotar, mas **não é a causa do vermelho**: numa máquina
parada por 16 minutos nenhum orçamento salva. Sem um vermelho fora do
travamento, não há o que corrigir com honestidade. Também não vai para
quarentena — ele é o único guardião da Idempotency-Key reaproveitada na
retentativa, que é dinheiro.

## Flakes NOVOS achados na caça (não estavam na lista do prompt)

### verify-email-code.spec.js:58 — RESOLVIDO
**Vermelho** (caça 3): `expect(#vfySubmitBtn).toBeEnabled()` — `Received:
disabled`, 13 tentativas.

**Causa.** `openVerifyScreen()` termina com
`setTimeout(() => vfyDigits()[0]?.focus(), 60)`. O teste tomava o foco por um
clique e digitava, deixando esse temporizador SOLTO. Com a máquina ocupada ele
chega no MEIO da digitação, devolve o foco ao dígito 0, e os seis caracteres se
atropelam: o código fica com menos de seis e o botão nunca habilita.

**Correção.** Esperar o foco que o app dá (`toBeFocused` no primeiro dígito) em
vez de tomá-lo — esperar o foco é esperar aquele temporizador ter corrido.
O seletor também foi ancorado em `#vfyCode`, porque `.vfy-digit` também existe
em `#recCode`.

**Visto vermelho, com os dois braços medidos.** Temporizador do app rebaixado a
400 ms e digitação a 120 ms/tecla, para a corrida acontecer sempre:
- BRAÇO A (clica e digita, o jeito antigo): **falha**, com o texto idêntico ao
  da suíte — `Expected: enabled / Received: disabled`.
- BRAÇO B (espera o foco, o jeito novo): **passa**.

### tenant-theme.spec.js:161 — RESOLVIDO
**Vermelho** (caça 4): `expect(body).not.toHaveClass(/app-booting/)` —
`Received string: "app-booting"`, 6 tentativas, teto de 5 s.

**Causa.** Uma DESIGUALDADE de orçamento criada pela escolha da ferramenta.
Toda outra espera de boot da suíte usa `page.waitForFunction`, cujo teto é o do
teste inteiro (30 s). Esta precisou usar `expect` porque o relógio da página
está congelado (`clock.install` + `pauseAt`) e o rAF do `waitForFunction`
também congela — e com isso herdou o padrão de 5 s, um quinto do que as irmãs
têm. Sob carga o boot passou de 5 s.

**Correção.** `{ timeout: 15_000 }` explícito, com o motivo escrito na margem.
**E o número não enfraquece o que o teste prova:** o defeito que ele guarda é
um PISO DE TEMPO no boot, e com o relógio congelado um piso de tempo nunca
elapsa — ele falha por estouro em qualquer máquina, com 5 s ou com 15. A
diferença é só quanto tempo uma máquina lenta tem para não ser acusada no lugar
do código.

### assistant-voice-session.spec.js:491 — RESOLVIDO
**Vermelho** (caça 5): dentro de `conversar()`, `toContain('response.create')`
com `Received array: []`.

**Causa, e é o assunto do próprio teste.** Ele arma um teto de sessão de
**2 segundos** e depois chama `conversar()`. O teto começa a correr no instante
em que o áudio abre; `conversar()` ainda precisa, DEPOIS desse instante, de uma
ida-e-volta pelo canal de dados para ver o `response.create` da saudação. Sob
carga essa ida-e-volta passou dos 2 s: a sessão encerrou no meio do preparo, o
canal fechou, e a mensagem nunca chegou. **O teto sob teste matava o preparo do
teste.**

**Correção.** A voz sobe (clique + `is-open`, que não depende de nada depois do
áudio abrir) e o teste passa a esperar só o `/ended` chegar no route handler —
que não depende de o teste ter perguntado alguma coisa a tempo.

**Visto vermelho, dois braços, teto rebaixado a 50 ms:**
- BRAÇO A (com `conversar()`): **falha** com `Received array: []`, o texto
  idêntico ao da suíte.
- BRAÇO B (só `is-open` + esperar o `/ended`): **passa**.

**E o primeiro remendo estava errado — o próprio experimento o reprovou.** A
primeira tentativa tirou o `conversar()` inteiro; o braço B ficou vermelho
porque `montar()` NÃO abre a voz (quem clica no botão que a abre é o
`conversar()`). Sem o experimento de dois braços isso teria virado um teste
verde que não testava nada.

# Item 2.1 — a régua do fallback defensivo, conferida cadeia por cadeia

**A lista original dos 12 não é recuperável.** O `rodada-front.md` só registra
"Lista completa no relatório do agente" e NOMEIA os arquivos: menu-service,
club-service, address-service, delivery-service, branch-availability, as duas
cadeias de cupom do `restaurant-page` (`:2668`/`:2688`, hoje `couponDiscountAmount`
em `:1844` e `couponPreviewTotal` em `:1864`), restaurant-club e api-error. O
relatório do agente não está no repositório. Então a enumeração abaixo foi
**refeita do zero**, cadeia por cadeia, contra `scripts/types/api.d.ts` — e é
por cadeia, não por arquivo, que ela conta.

A régua sob julgamento: *"fallback defensivo com o nome certo em primeiro é
limpeza sem teste possível"*. Ela vale quando o fallback é **inalcançável**, ou
quando alcançá-lo dá o mesmo resultado. Ela NÃO vale quando o fallback pode
vencer.

## A. RÉGUA CORRETA — o fallback não muda nada (18 cadeias)

Em todas, o primeiro nome é o do contrato e é **obrigatório** (`required` no
schema), ou o resultado de cair no fallback é idêntico ao de não cair.

| # | cadeia | por que o fallback não alcança |
|---|---|---|
| A1 | `address-service:12` `street \|\| street_name` | `CustomerAddressResponse.street` é obrigatório |
| A2 | `address-service:17` `id \|\| address_id` | `id` obrigatório (uuid) |
| A3 | `address-service:29` `is_default === true \|\| default \|\| isDefault` | `is_default` obrigatório; com `false` o resto dá `false` igual |
| A4 | `address-service:26` `latitude ?? lat` | `latitude` existe; `lat` nunca existiu, e `null ?? undefined` → `null` |
| A5 | `club-service:97` `transaction.id \|\| transaction_id` | `CashbackTransactionResponse.id` obrigatório |
| A6 | `club-service:98` `type \|\| transaction_type \|\| kind` | `type` obrigatório e enum de 5 valores |
| A7 | `club-service:103` `created_at \|\| date \|\| transaction_date` | `created_at` obrigatório |
| A8 | `club-service:113` `balance ?? cashback_balance` | `CashbackTransactionsResponse.balance` obrigatório |
| A9 | `club-service:101` `restaurant_name \|\| merchant_name` | o campo é `string \| null`: o fallback É alcançável, e dá `''` — exatamente o que `restaurant_name \|\| ''` daria |
| A10 | `restaurant-club:85` `coupon.id ?? coupon_id ?? code ?? coupon_code` | `CustomerCouponResponse.id` obrigatório |
| A11 | `restaurant-club:103` `discount_type \|\| type` | obrigatório e enum |
| A12 | `restaurant-club:127` `min_order_value ?? minimum_order_value ?? min_subtotal` | obrigatório (string decimal) |
| A13 | `restaurant-club:129` `valid_until \|\| expires_at \|\| end_date \|\| valid_to` | obrigatório (date-time) |
| A14 | `delivery-service:27-31` — 5 cadeias `??` (delivery_fee, distance_km, travel_time_min, eta_min, eta_max) | todas opcionais; os nomes camelCase alternativos nunca existiram, e `numberOrNull(undefined)` → `null`, igual |
| A15 | `branch-availability:10` `address.full_address \|\| branch.full_address \|\| [partes]` | `BranchAddressResponse.full_address` é obrigatório |
| A16 | `branch-availability:42` `branch.id \|\| branch_id \|\| index` | `id` obrigatório |
| A17 | `restaurant-page:1846` `discount_amount ?? total_discount ?? …` (7 nomes) | `CouponPreviewResponse.discount_amount` obrigatório |
| A18 | `restaurant-page:1866` `total_after_coupon ?? final_total ?? …` (5 nomes) | `total_after_coupon` obrigatório. O comentário no código já conta essa história |
| A19 | `api-error:23` `TEXT_KEYS = [message, msg, detail, description, error]` | `PaymentErrorDetail.message` é obrigatório e vem primeiro |

## B. RÉGUA NÃO VALE — defeito de verdade, corrigido com teste visto vermelho

**Quatro cadeias, uma causa só: `||` sobre um campo cujo valor legítimo é 0.**

```js
sort_order: Number(category.sort_order || index)    // categorias
sort_order: Number(product.sort_order  || index)    // produtos
sort_order: Number(banner.sort_order || banner.order || index)   // banners
sort_order: Number(banner.sort_order || banner.order || index)   // destaques
```

O nome certo VEM em primeiro — a régua parecia valer. Mas o contrato declara,
nos três schemas (`CategoryResponse`, `ProductResponse`, `BannerResponse`):

```
/** Sort Order  @default 0 */
sort_order: number | null;
```

**0 é o valor PADRÃO**, ou seja a resposta normal de todo item que ninguém
reordenou no painel. E `||` não distingue 0 de ausente. Resultado: o item de
MENOR ordem — o que tem de aparecer primeiro — era exatamente o que perdia a
própria ordem e herdava a posição de chegada no array.

Quebra medida, com a lista chegando fora de ordem:
`[alfa(1), beta(2), zero(0)]` → `zero` recebia `index` = 2, empatava com `beta`
e a ordenação estável o deixava por ÚLTIMO. Esperado: `zero, alfa, beta`.

Por que passou anos invisível: o backend costuma entregar a lista já ordenada, e
aí a posição de chegada e a ordem coincidem. Não é garantia — o contrato não
promete ordem de array em lugar nenhum. É a armadilha do "fixture cujos números
coincidem" da skill §4, na versão de produção.

**Correção:** `||` → `??` nos quatro sítios. O caso `null`/ausente continua
caindo no índice, que era a única coisa que o `||` acertava.

**Visto vermelho** (`tests/unit/menu-sort-order.test.js`, 5 casos):
```
AssertionError: expected [ 'alfa', 'beta', 'zero' ] to deeply equal [ 'zero', 'alfa', 'beta' ]   ×4
Tests  4 failed | 1 passed (5)
```
O quinto caso (sem `sort_order` nenhum, e com `sort_order: null`) já passava
antes e continua passando — é ele que trava a correção de não ir longe demais.
Depois: 292 unitários, 0 vermelhos.

## C. Nome certo NÃO vem em primeiro — hoje inofensivo, precedência invertida amanhã

Não são defeitos hoje (o nome à frente nunca existe, então o certo vence), e não
há teste que nasça vermelho. Ficam NOMEADOS porque, no dia em que o backend
publicar o nome de cima, a precedência inverte sem ninguém tocar no front.

| # | cadeia | o nome do contrato |
|---|---|---|
| C1 | `restaurant-club:146` `short_description \|\| description \|\| subtitle` | `description` (2º) |
| C2 | `address-service:25` `postal_code \|\| zipcode \|\| zip_code \|\| cep` | `zipcode` (2º) — **e aqui é de propósito**: `normalizeAddress` normaliza DUAS formas, a da API e a que ele mesmo grava no localStorage (`postal_code`). Local em primeiro é a ordem certa. Documentado, não mexido |

## D. Cadeia inteira fantasma — mas todo leitor tem queda real atrás

| # | cadeia | leitura |
|---|---|---|
| D1 | `menu-service:181,193` `banner.title \|\| banner.name` | `BannerResponse` não tem `title` nem `name`. Sempre `''` |
| D2 | `menu-service:182,194` `banner.subtitle \|\| banner.description` | idem. Sempre `''` |

**Não consertado, e por medida.** Os dois só alimentam (a) o `alt` da imagem e
(b) o bloco `highlight-fallback`, e nos dois lugares há queda para
`app.restaurant.name` logo atrás (`home-screen.js:82,92,298,303`). Com `''` o
comportamento já é o correto. Remover as cadeias não muda um pixel e não produz
teste vermelho — é a régua valendo, mesmo sem nome certo nenhum na frente.
Este é o resto do D9 da auditoria anterior; o que ele tinha de nocivo (a tarja
"Cupom disponível" em 100% dos cards) já saiu.

## E. Prosa velha — corrigida, sem mudança de comportamento

`api-error.js:82-85` avisava que `PaymentErrorDetail` **não** estava publicado
no OpenAPI e que a lista de `code` era desconhecida. Hoje o spec traz
`PaymentErrorResponse = { detail: PaymentErrorDetail }` e
`PaymentErrorCode` com sete valores. O comentário foi reescrito: a ausência de
tabela de códigos passa a ser **escolha** (o oitavo valor pode chegar sem aviso)
e não ignorância. Anotado junto que `provider_error_code` existe no contrato e
ninguém o lê.

## Contagem

- **A (régua correta):** 19 cadeias em 8 arquivos.
- **B (defeito de verdade):** 4 cadeias, uma causa, corrigidas com teste visto
  vermelho.
- **C (precedência latente):** 2, nomeadas, não mexidas.
- **D (fantasma inofensiva):** 2, nomeadas, não mexidas.
- **E (prosa):** 1, corrigida.

A régua valeu em 19 de 25. As 4 em que ela não valeu não falharam por "nome
ausente" — falharam por **valor falsy legítimo**, que é a mesma pergunta com
outra roupa: o fallback podia vencer com o nome certo PRESENTE.

# Item 2.2 — o deploy passa a esperar o portão (opção C)

**Implementado, e INERTE até os secrets existirem.** As duas metades:

1. `vercel.json` → `"git": { "deploymentEnabled": { "main": false } }`.
   Só a `main`; os previews das outras branches continuam automáticos, e é
   deles que a verificação do Maps depende.
2. `.github/workflows/ci.yml` → job `deploy`, com `needs: verify` e
   `if: push && refs/heads/main`. Publica com
   `vercel pull --environment=production` (traz as VITE_* de produção, senão o
   bundle subiria apontando para a base padrão), `vercel build --prod` e
   `vercel deploy --prebuilt --prod`.

**Meia trava é pior que nenhuma, porque parece uma** — por isso
`tests/unit/deploy-gate.test.js` (4 casos) falha se qualquer uma das duas
metades sumir, e também se o job deixar de depender do `verify` ou deixar de
estar preso à `main`. Visto vermelho antes: `expected undefined to be false`,
`não há job de deploy`, `expected ... to match /VERCEL_TOKEN/`.

**Sem o segredo o job FALHA, e não se pula.** Um deploy que se pula em silêncio
devolve o buraco inteiro por outro caminho: CI verde, ninguém olha, produção
parada no commit anterior sem uma linha dizendo por quê. O passo confere os três
secrets e sai com `::error::` nomeando o que falta.

**NÃO consegui criar o secret daqui:** não há `gh` nem `vercel` CLI nesta
máquina, e não existe `.vercel/`. O que o dono do repositório precisa criar
está escrito, passo a passo e com os nomes exatos, em
`docs/deploy-pelo-portao.md`:

| Onde | O quê |
|---|---|
| Vercel → Account Settings → Tokens | um token com escopo do time dono do projeto |
| Vercel → projeto → Settings → General | copiar **Project ID** e **Team ID** |
| GitHub → Settings → Secrets → Actions | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |
| Vercel → Settings → Git | CONFERIR que a `main` aparece como *deployment disabled* — quem decide de fato é o painel, e ele não foi consultado daqui |

As outras duas opções foram descartadas com o motivo escrito no `ci.yml`:
`ignoreCommand` é uma corrida perdida por construção (a Vercel começa o build
no instante do push, veria `pending`, pularia o deploy, e um CI que fica verde
depois não dispara deploy nenhum); proteção de branch fecha pela raiz certa mas
cobra PR para tudo e, em repositório privado, plano pago.

### pix-payment.spec.js:116 — apareceu no portão, corrigido pelo que dá para provar

**Vermelho** (portão 3): `cta.x - footer.x` deu **307,6** onde o assentado é 20,
com a largura (374) e a altura (45) do botão JÁ corretas.

**O que se mediu, e o que NÃO se explicou.** O CTA é `width:374px; margin:0
auto` — CENTRADO no rodapé. Então 20 é `(414 - 374) / 2`, e 414 é o
`max-width` do painel do Pix, que só vale ACIMA de 767px (abaixo disso um
`@media` o solta para 100%). Um offset de 307,6 implica um rodapé de ~989 px, e
essa largura não se reproduz: medido aqui, 1280 → 414 (offset 20), sem o teto →
1280 (offset 453), 390 → 390 (offset 16).

**A hipótese óbvia foi TESTADA E REPROVADA.** "Mediu no meio da animação de
entrada" parecia certa. Com a transição alongada para 4 s pelo lado do teste, os
dois braços (medir na hora / medir depois de assentar) deram **20** — porque
rodapé e botão viajam na MESMA transformação, e a distância entre eles não muda
enquanto o painel desliza. Sem o experimento eu teria escrito essa hipótese como
causa.

**O que foi corrigido, e é o que dá para defender:**
1. **A viewport passou a ser declarada.** O teste afirmava um número que depende
   da largura da tela e herdava a viewport padrão do projeto em silêncio. Um
   número esperado preso a uma largura que o teste não escreve anda sozinho no
   dia em que a largura mudar por qualquer motivo.
2. **Espera de assentamento** antes de medir geometria — o irmão logo acima já
   fazia, com o comentário escrito; este não fazia.

**A causa exata continua sem explicação** (o artefato daquela execução foi
sobrescrito pela execução seguinte). Está escrito assim no próprio teste. Ele
segue na LISTA DE OBSERVAÇÃO, não como resolvido.

### tenant-theme.spec.js:229 — o app não tinha subido, e a suíte inteira não sabia perguntar isso

**Vermelho** (g2-5): `cor de marca chumbada encontrada:` com quatro descrições,
todas lendo os **valores PADRÃO de `styles/tokens.css`** — `rgb(243,111,33)` e
`#fcd7c1`, o laranja do piloto.

**Causa, e ela é da suíte inteira, não deste teste.** A espera de boot que 40
arquivos usavam é
`page.waitForFunction(() => !document.body.classList.contains('app-booting'))`.
Ela é satisfeita TAMBÉM quando o boot **falha**: `showAppError()`
(`restaurant-page.js:390`) TIRA `app-booting` e põe `app-error`. E um boot que
falha nunca chega a `applyTheme()` — a página fica pintada na cor da
PLATAFORMA. O teste então acusa "cor chumbada", que aponta para o CSS quando o
problema foi a rede.

("Não está mais subindo" não é "subiu". As quatro descrições eram muitos
elementos: o scanner deduplica pela descrição, e `button.ui-btn.ui-btn-primary`
sozinho cobre dezenas.)

**Visto vermelho, dois braços, com o `/menu` respondendo 500:**
- BRAÇO A (espera antiga): **passa direto**, e 24 elementos estão no laranja do
  piloto — exatamente a assinatura da falha observada.
- BRAÇO B (espera nova): falha na hora, com
  `o app NÃO subiu: caiu na tela de erro de boot (body.app-error)`.

**Correção, e ela vale para a suíte inteira.** `esperarAppPronto(page)` em
`tests/e2e/helpers.js`: lança com a frase certa se `app-error` aparecer, e só
devolve quando o app SUBIU. Os **52 sítios** da espera cega em **40 arquivos**
foram migrados, mais as duas variantes combinadas (`addH2OToCart` no helpers e
`montarSacola` no branch-change-atomic).

É a mesma lição do `boot-smoke.spec.js`, que existe por isto: o problema nunca
foi cobertura, foi **diagnóstico**. Um app que não sobe já quebrava a suíte —
o que faltava era uma linha dizendo isso em vez de 200 timeouts (ou, aqui, uma
acusação falsa contra o CSS).

Verificação: lint 0 errors/78 warnings · typecheck ok · 296 unitários ·
**suíte completa exit 0 · 289 passed · 3 skipped · 6,3 min**.
