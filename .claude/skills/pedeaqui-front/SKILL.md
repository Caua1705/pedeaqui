---
name: pedeaqui-front
description: Mapa do front do PedeAqui/Rapidex e as armadilhas que já custaram dinheiro nele — pedido, pagamento (Pix e cartão), cupom, cashback, troca de filial, white-label e, principalmente, o que faz um teste passar sem valer nada. Leia ANTES de mexer em qualquer coisa deste repositório, e obrigatoriamente antes de escrever ou confiar num teste.
---

# PedeAqui / Rapidex — front

Escrito depois da auditoria de 27–29/08/2026, com o que só se descobre errando.
Cada afirmação aqui tem endereço no código; se divergirem, o código venceu e
esta skill está velha — conserte-a.

## 1. O terreno

App **white-label** de pedidos de restaurante. Duas páginas: `index.html`
(landing) e `restaurant.html` (o app inteiro). Vite constrói, `vite preview`
serve, Playwright roda contra o **bundle construído**.

Nada é ES module ainda. Todo arquivo em `scripts/` é uma IIFE que publica em
`window.PedeAqui*` / `window.Rapidex*` e depende de quem rodou antes.
`scripts/entry-restaurant.js` é a **ordem de carregamento** — ela substitui as
27 tags `<script>` antigas e **não pode ser reordenada** sem entender o que
depende de quê (os comentários no arquivo dizem). Não converta esses arquivos
para módulos de passagem; é fase própria.

Funções de tela são internas ao IIFE de `restaurant-page.js` e alcançáveis por
nome via `scripts/utils/actions.js` (delegação por `data-act-*`) e por um
`Object.assign(window, {...})` no fim do arquivo (`restaurant-page.js:7152`),
que é como os E2E dirigem o app (`window.openProduct`, `window.addToCart`,
`window.openModal`).

**Handler inline `on*=` é proibido** e há teste que barra
(`tests/unit/inline-handlers.test.js`): 269 deles obrigavam a CSP a liberar
`script-src 'unsafe-inline'`, e a sessão do cliente é global do Rapidex —
todos os tenants dividem a mesma origem.

## 2. Mapa — onde mora cada coisa

| Preciso mexer em… | Vá para |
|---|---|
| Payload de `POST /orders` | `scripts/services/order-payload.js` — **ponto único** |
| Totais da sacola | `restaurant-page.js:2692` `cartTotals()` — **dono único** |
| Endereço: escolha, lista, Maps, formulário | `scripts/pages/restaurant-address-flow.js` |
| Pix e acompanhamento do pedido | `scripts/pages/restaurant-pix-flow.js` |
| Entrar, cadastrar, verificar, recuperar senha | `scripts/pages/restaurant-auth-flow.js` |
| Rotas da API (strings) | `scripts/services/api-routes.js` |
| Chamada HTTP, erro, header | `scripts/services/api-client.js`, `utils/api-error.js` |
| Cupom e cashback (dados) | `scripts/services/club-service.js` |
| Cupom (tela) | `scripts/pages/restaurant-club.js` + a folha de detalhe em `restaurant-page.js` |
| Cartão: SDK e campos seguros | `scripts/services/mercado-pago-service.js` |
| Cartão: tela e checkout | `scripts/pages/payment-card-flow.js` |
| Cartões salvos | `scripts/services/customer-card-service.js` |
| Gateway habilitado no restaurante | `scripts/services/payment-config-service.js` |
| Chaves de localStorage | `scripts/utils/storage-keys.js` (leia o cabeçalho inteiro) |
| Tema do tenant | `scripts/utils/brand-theme.js`, `styles/tokens.css` |
| Tipos da API | `scripts/types/api.d.ts` + `openapi.json` (**gerados**, não edite) |
| Contrato de pedido/pagamento, em prosa | `docs/order-contract.md` |
| CSP de produção | `vercel.json` (+ `docs/csp-mercado-pago.md`) |

`scripts/pages/restaurant-page.js` tem ~7.200 linhas (eram 10.400 até 29/08/2026;
três blocos saíram para os módulos da tabela acima). Não leia inteiro:
`grep -n "function nomeDaCoisa"` e leia a vizinhança — e lembre que a função pode
estar num dos três módulos. Os comentários longos dele são histórico de defeito
real: leia antes de "simplificar".

### O que ainda NÃO saiu, e por quê

**Operação / filial** (~1.000 linhas, o `operationContext`) fica onde está. Medido:
62 nomes lidos de fora e 32 chamados de fora — 94 fios para mil linhas. Uma
"extração" assim é o mesmo fechamento com mais cerimônia, e é exatamente o bloco
onde mora a troca transacional de filial (b3c03ec), o defeito mais caro que a
auditoria consertou. Se você for tentar, meça antes.

A folha de detalhe do cupom (29 fios / 261 linhas) e o checkout da sacola
(14 / 67) ficaram fora pelo mesmo motivo: mais fio que pano.

## 2.1 Como um módulo conversa com o `restaurant-page.js`

Os três módulos saíram do MESMO fechamento, então precisaram de uma costura. Ela
tem um idioma só, e vale copiar em vez de inventar outro:

```js
// no módulo
let esc, closeModalId, /* ...os estáveis... */;
const S = {};                       // o que muda de valor
function init(deps) { ({ esc, closeModalId } = deps); /* ... */ }
window.PedeAquiXFlow = { init, ...portas };
```

**Estável vai por valor; o que muda vai por acessor.** Uma variável que o outro
lado reatribui, passada por valor, vira uma FOTOGRAFIA do boot — e a partir da
primeira troca de filial ou do primeiro login o módulo decide com dado velho, sem
erro nenhum na tela. `S.x` chama o getter a cada acesso. Quando o módulo também
ESCREVE (o auth limpa o cupom em leitura; o Pix zera a sessão de cobrança), o
acessor leva getter **e** setter.

`init()` recusa acessor faltando, em vez de seguir com `undefined`.

**O markup não muda.** `RapidexActions.register()` MESCLA num registro
compartilhado, então cada módulo registra as ações dele e os `data-act-*` do HTML
continuam iguais. Foi assim que 82 ações mudaram de arquivo sem uma linha de HTML.

### As quatro armadilhas deste tipo de corte

Todas custaram uma rodada, e as três primeiras passam por lint, typecheck e
unitários — nenhum deles executa o bundle.

1. **Instrução de topo muda de hora.** `onTeardown(stopVfyTimer)` no corpo do
   bloco rodava, no fechamento antigo, depois de tudo definido. Como módulo, roda
   **ao ser importado**, antes do `init()` — e derrubou o app inteiro no boot com
   "p is not a function", com os três gates verdes. Varra por profundidade de
   chaves: era a única em 3.800 linhas movidas. Instrução de topo vai para
   `init()`.

2. **`` não casa antes de `$`.** A varredura que monta a lista de dependências
   perdeu o `$` (o `getElementById` do app) nos DOIS primeiros módulos. Pior: no
   segundo, declarar `let $` no módulo deixou o **lint verde** com o `$` ainda
   faltando na chamada de `init()`. O lint vê a metade de baixo e não vê a de
   cima. Confira por script que **todo nome declarado aparece na chamada**.

3. **Varredura de identificador erra dos dois lados.** Sub-reporta o que chega
   por desestruturação (`const { openModal } = window.PedeAquiRestaurantUi`) e
   super-reporta nome de parâmetro (`fallback`), chave de objeto (`customer:`),
   string (`'mobNavProfile'`) e menção em comentário. Serve para começar; quem
   fecha a conta é o lint mais a conferência do item 2.

4. **Nem todo bloco vizinho é do mesmo assunto.** `showAppToast()` morava dentro
   do bloco do Pix e é o toast do app inteiro. Saiu do bloco ANTES do corte, num
   move dentro do mesmo arquivo — senão o módulo do Pix viraria dono do toast de
   tudo.

**A prova de cada corte** é `node tools/capture-screens.mjs`: 14 telas, 41
propriedades computadas de todos os ~1.500 elementos, antes e depois. Foi ela que
pegou a armadilha 1 — e só porque ela **lança** quando uma tela não abre, em vez
de registrar vazio.

## 3. As três regras que não se negociam

### 3.1 O front não calcula dinheiro. Ele exibe e confere.

O backend é a fonte de verdade de subtotal, desconto, cashback e total.
`buildOrderPayload()` manda **só inputs** (itens, opções, endereço, modalidade,
cupom, forma de pagamento) — valores nem existem no schema.

- Desconto de cupom vem de `CouponPreviewResponse`. O total pós-cupom se chama
  **`total_after_coupon`**. Refazer a conta no browser
  (`beforeDiscount - discount`) é fallback, não caminho: com teto de desconto ou
  arredondamento os números divergem e a tela mente.
- Existe **um** dono do total: `cartTotals()`. Já houve uma segunda
  implementação morta (`cart-service.calculateTotals()`) com 5 testes verdes e
  já divergente do dono vivo — conta de dinheiro em dois lugares é divergência
  esperando acontecer, e com testes só no lado morto é divergência com álibi.
  Se você se pegar somando preço fora de `cartTotals()`, pare.
- **Não existe rota que orce um pedido.** Conferido no OpenAPI:
  `/coupons/preview` só responde com cupom aplicado e `/delivery/estimate` só
  devolve a taxa. Quando o total do servidor chega, o pedido **já existe** e o
  total dele é o que vale. Por isso o app congela o total mostrado no instante
  do toque e **compara** com `order.total` (tolerância de 1 centavo — somar
  reais em `Number` erra na 15ª casa). Ele avisa, não bloqueia; e a comparação
  é amarrada ao **id do pedido**, senão vaza para o pedido seguinte.

### 3.2 Contrato é lido, não lembrado

`api.d.ts` e `openapi.json` são gerados por `npm run api:generate` e conferidos
por `tests/unit/api-contract.test.js`, que também exige que **toda rota que o
front chama exista no spec**. Esse teste nasceu de um incidente: o backend
trocou `/coupons/available` por `/coupons`, o front continuou na rota velha, a
tela do Clube ficou em "Não foi possível carregar seus cupons" para todo mundo —
e lint, 253 unitários e 243 E2E passaram.

Renome de campo é a classe de bug mais silenciosa daqui. Já aconteceu:
`is_public` virou **`visibility`** (revisão 20260828_0043). E campos que o front
procurava — `final_total`, `total_after_discount`, `discounted_total`,
`payable_amount`, `coupon.eligible` — **nunca existiram em lugar nenhum da API**:
o código lia `undefined` e caía no fallback em 100% das chamadas, sem nunca
acusar nada.

Antes de ler um campo, ache-o em `scripts/types/api.d.ts`. `npm run
typecheck:cards` é o único portão que pega renome no caminho do cartão antes do
runtime — está no CI, mantenha assim.

### 3.3 Teste que você não viu falhar não vale nada

O procedimento, sem atalho:

1. Escreva o teste.
2. **Reverta a correção** (ou insira o defeito) e rode o teste.
3. Se ele não falhar, ele não cobre nada — conserte o teste, não a expectativa.
4. Restaure e rode de novo.

E confira **por que** ele falhou. Já houve teste que passava pelo motivo errado
(sacola vazia esconde o rótulo, então a limpeza que ele "provava" não era
provada). Uma sonda antes do teste custa dois minutos e evita um teste-fantasma
que dá cobertura de mentira por anos.

## 4. Armadilhas comprovadas

Todas foram encontradas com o defeito já em produção ou a um commit de chegar lá.

**O catch-all do mock — corrigido em 30/08/2026, e o que ele ainda não faz.**
Até essa data a última linha de `mockApi()` (`tests/e2e/helpers.js`) devolvia
`{}` com **200** para qualquer rota que o app inventasse. A intenção era boa (a
suíte não pode escapar para a rede), mas o efeito era que **um E2E verde não
dizia nada sobre a rota existir**: o app podia chamar uma rota que o backend
removeu, receber 200 vazio, cair no fallback e o teste passar — que é
exatamente o incidente que criou o `api-contract.test.js`.

Hoje o catch-all responde **404** e empurra o endereço para
`rotasDesconhecidas`, que sai junto com os outros arrays de `mockApi()`. Quem
lê essa lista é o terceiro teste de `boot-smoke.spec.js`, que percorre as dez
telas e exige a lista **vazia** — visto falhando com `/coupons/available`
reinjetada de propósito, e ele nomeia a rota na mensagem.

Isso **não substitui** `api-contract.test.js`: são perguntas diferentes. Lá é
"esta rota existe no OpenAPI?"; aqui é "o app chamou alguma coisa que ninguém
declarou?". Uma rota montada por concatenação em runtime só aparece aqui. E
rota que morreu continua merecendo um `410`/`404` explícito **antes** do
catch-all, com o motivo escrito — como já está para a consulta por telefone e
para `/menu` de filial alheia.

**O fixture de filial não aceita cartão online.** `tests/fixtures/info.json` é
cópia fiel da produção, e lá `credit_card` existe só no grupo `delivery` (a
maquininha na porta). Quem decide o `payment_flow` é o backend, olhando
`branch_payment_methods` da **filial** — não o `payment_method` que a UI mandou.
Resultado do bug: cartão tokenizado, nenhuma cobrança, e o pedido indo para a
cozinha como "paga na entrega". Todo teste de cartão precisa de
`seedOnlineCardBranch(page)`, chamado **depois** de `mockApi()` (no Playwright a
rota registrada por último vence). E a pergunta "o restaurante tem gateway?"
(`/payment-config`, `card_enabled`) **não é** a pergunta "a filial habilitou
cartão online?" (`/info`) — a segunda é a que decide, e falha **fechada**:
esconder um cartão que caberia custa um toque, mostrar um que não cabe custa o
pedido.

**O SDK definido antes do boot.** `card-payment-flow.spec.js` define
`window.MercadoPago` num `addInitScript`. `loadSdk()` começa com
`if (window.MercadoPago) return Promise.resolve(...)` — então lá ele **nunca
baixa nada**, e o atraso e a falha do download passaram batidos pela suíte
inteira. Quem exercita o download real é `payment-card-loading-state.spec.js`
(de propósito, com chave inválida), e quem roda o SDK real **sob a CSP real de
produção** é `mercado-pago-secure-fields.spec.js`. Este último **se pula em
silêncio** sem `PAYMENT_PUBLIC_KEY` — e são exatamente os testes que pegam
bloqueio de `connect-src` (o SDK faz `fetch` em `secure-fields.mercadopago.com`
antes de montar o iframe; estar só no `frame-src` não basta). Se você mexeu em
CSP ou no SDK e a suíte ficou verde rápido demais, confira se eles rodaram.

**O mock que aceita qualquer coisa.** O `createCardToken` falso aceitava
qualquer `cardId`. O gateway real recusa qualquer `card_id` que não seja o id do
cartão **dentro da conta dele** (`400 invalid card_id`, `E201`) — e nós
mandávamos nosso UUID. O teste passava, a tela quebrava. O mock hoje imita a
recusa. Regra geral: **um mock que só aceita é um teste que só concorda.**
Quando imitar um serviço externo, imite as recusas dele primeiro.

**Fixture vazio esconde a tela inteira.** `/coupons` respondia `{coupons: []}` e
nenhum E2E chegava a **desenhar** um card. Por essa fresta passaram oito
defeitos juntos (rota morta, filtro que se auto-desligava, "0% OFF", tarja fixa,
botão igual nos três estados, ler-aplicava, recusado-virava-aplicado, total
recalculado). `tests/fixtures/coupons.json` hoje traz os três estados do
contrato — `applicable`, `missing_amount`, `login_required` — com os **tipos de
produção**: `min_order_value`, `discount_amount` e `missing_amount` chegam como
**string decimal**. Isso é parte do teste.

**Fixture cujos números coincidem.** No E2E, `3 × 7,05 + 0,99 = 22,14` dá o
mesmo resultado dos dois lados, então divergência de total era invisível. Se o
teste é sobre dois números concordarem, **faça-os discordar** no fixture.

**O cupom que grudava ao ser aberto.** `selectedCoupon` fazia dois trabalhos:
"o que a folha está mostrando" e "o que está aplicado à sacola".
`openCouponDetail()` escrevia nela só de abrir. Quem tocasse num card para
**ler** as regras saía com o cupom armado — desconto na tela sem ninguém
confirmar, `coupon_id` no `POST /orders`, e num cupom de uso único isso o
**queima**. A correção é a separação (`couponDetailCoupon` = aberto para
leitura; `selectedCoupon` = aplicado; só `confirmCouponDetail()` promove um ao
outro), **não** um `clear` no fechar: `clear` conserta o sintoma e quebra de
novo no dia em que alguém acrescentar outra saída da folha. Fechar a leitura
também não desaplica o que já valia — abrir um segundo cupom para comparar não
pode custar o primeiro. Quando um estado responde a duas perguntas, ele já está
errado; separe.

**200 não é sucesso.** `CouponPreviewResponse` responde **200 com
`valid: false`** e `ineligibility_reason` — ler só o HTTP fazia a tela dizer
"Cupom aplicado. Desconto de R$ 0,00" e mandar o `coupon_id` de um cupom que o
backend já tinha recusado. `StartPaymentResponse` numa recusa não tem campo de
mensagem: o motivo vem em `status_detail`, cru do gateway. E o classificador do
Pix ("não sei = pending = siga esperando") **não serve para cartão**, onde a
autorização é síncrona e "não sei" tem de cair para **não pago**. Leia sempre o
campo de veredito, nunca só o status.

**Trocar de filial é transacional.** Ids de produto não se repetem entre
filiais. Um `catch` que só logava deixava `restoreCart()` conferir a sacola da
loja **nova** contra o cardápio da **antiga**: nada casava, o carrinho virava
vazio — e a última linha de `restoreCart()` gravava esse vazio **por cima** da
sacola guardada. O cliente perdia o pedido montado por uma falha de rede, sem
uma palavra na tela. Ou tudo muda (contexto, cardápio, sacola) ou nada muda, com
rollback e aviso. E o **cupom não atravessa**: ele foi calculado contra os
preços daquela filial. Pagamento e cartão tokenizado caem junto.

**Corridas no E2E.** `confirmOperation()` dispara `handleMenuBranchChange()`
**sem await**, de propósito (a tela fecha na hora e o cardápio chega por trás).
Afirmar logo depois do clique passa sozinho e falha com a máquina ocupada.
Espere um efeito observável do **fim** do caminho (ex.: o número de linhas da
sacola depois do `restoreCart()`), nunca um `waitForTimeout`. E
`confirmOrderSheet(page)` é obrigatório: um spec que clique só no CTA da sacola
**nunca vê o `POST /orders`**.

**Ordem das rotas importa.** Em `mockApi()`, `/coupons/preview` (POST) é testado
antes de `/coupons`, senão a lista responde pela validação. Em `page.route`, a
**última registrada vence** — é por isso que `seedOnlineCardBranch()` vem depois
de `mockApi()`.

## 5. Como verificar de verdade

```
npm run lint
npm run typecheck:cards      # o único portão que pega renome de campo no cartão
npm run test                 # vitest, ~248 unitários
npm run test:e2e             # playwright; constrói e serve o bundle real
```

Rode os quatro. O E2E leva minutos — rode em background e espere uma vez, não em
laço.

### NENHUM DOS TRÊS PRIMEIROS EXECUTA O APP

Isto não é detalhe de infraestrutura: é o formato do buraco por onde passou o
pior defeito de 29/08/2026 — uma linha que derrubava o app INTEIRO no boot,
com `lint`, `typecheck:cards` e 239 unitários **verdes**.

| Portão | O que ele de fato lê |
|---|---|
| `lint` | a árvore sintática. Nome sem declaração, variável sem uso |
| `typecheck:cards` | tipos de **quatro** arquivos do cartão contra `api.d.ts` |
| `test` (vitest) | funções puras importadas uma a uma, ambiente `node`, **sem DOM** |
| `test:e2e` | o bundle real, no browser. **O único que roda o app** |

Consequência prática: se você mexeu em ordem de carga, em `entry-restaurant.js`,
ou moveu código entre arquivos, **os três rápidos não têm opinião sobre isso**.
Verde neles não é sinal de nada nesse eixo.

E o E2E pega, sim — medido, com o defeito reinjetado de propósito: 9 de 10
testes de dois arquivos quaisquer quebram. O problema nunca foi cobertura, foi
**diagnóstico e prazo**: 200 falhas de timeout, nenhuma linha dizendo "o app não
subiu", e a causa só apareceu depois de um build com sourcemap para traduzir
`p is not a function`.

Foi por isso que existem agora dois portões novos, e é neles que se começa a
depurar quando tudo está vermelho:

**`tests/unit/page-modules.test.js`** — milissegundos, sem browser, dentro do
`npm run test`. Três verificações, cada uma vista falhando com o defeito
recolocado:

1. **Importar cada módulo de tela não pode executar nada.** É o ambiente `node`
   sem DOM que torna isto possível: no import, as injeções ainda são `undefined`
   — a condição exata do defeito. `TypeError: onTeardown is not a function`, com
   o nome real, em 40 ms.
2. **Nenhuma instrução executável no corpo do módulo.** Pega a classe inteira,
   com arquivo e linha, inclusive a instrução que hoje não usa injeção nenhuma e
   amanhã passa a usar.
3. **Toda injeção declarada é passada no `init()`.** É a metade que o lint não
   vê (§2.1, armadilha 2).

**`tests/e2e/boot-smoke.spec.js`** — 11 s, roda o bundle real. Não acrescenta
cobertura; acrescenta uma frase. Afirma que o app sai do loader, que as dez
telas principais abrem, que cada ação existe no registro — e, o que a suíte
inteira não faz, que **nenhuma exceção não capturada** foi emitida. Um app que
sobe com uma exceção engolida passa em todo o resto e falha só aqui.

**E a ferramenta de captura, no CI?** Não como portão. `capture-screens.mjs`
compara contra uma linha de base, e uma base versionada mudaria a cada mudança
legítima de tela — viraria ruído e seria desligada em duas semanas. O que dela
cabe no CI é a parte SEM base ("toda tela abre"), e essa parte é o
`boot-smoke.spec.js`. A comparação continua sendo ferramenta de refactor: rode-a
à mão, antes e depois, quando o commit disser "só movi código".

**Flakes conhecidos** (passam isolados, caem sob carga paralela; não são seus):
`assistant-voice-session.spec.js:294` e `pix-payment.spec.js:116` (geometria).
Se falhou outra coisa, é sua.

`tenant-theme.spec.js:188` SAIU desta lista em 29/08/2026 — ele não era flaky de
paralelismo: media tempo de parede e falhava até em série (`--workers=1`, 900
contra um teto de `< 900`), com o `retries: 1` do CI escondendo. Hoje ele congela
o relógio da página (`clock.install` + **`pauseAt`** — `install()` sozinho não
para o relógio, e a versão sem `pauseAt` passou com um piso de 900ms injetado de
propósito). Não há mais nenhuma asserção de `Date.now()` na suíte.

## 4.1 `.addr-delete-yes` e `.addr-delete-cancel` TROCAM DE PAPEL entre telas

NÃO renomeie, não "corrija", não unifique por nome. As duas classes nomeiam a
POSIÇÃO no par de botões, não a função:

| Tela | `.addr-delete-yes` | `.addr-delete-cancel` |
|---|---|---|
| `#addrPickerModal` (apagar endereço) | **vermelho**, apaga | secundário, volta |
| Sacola (remover item) | **vermelho**, remove | secundário, volta |
| `#logoutConfirm` (sair da conta) | secundário, **fica** | **primário laranja**, SAI |

No logout os dois invertem: quem tem `yes` no nome é o botão de FICAR, e quem
tem `cancel` é o que executa a saída. A folha de cada tela repinta por cima
(`utilities.css`, `#logoutConfirm ...`), e é só por isso que a tela está certa.

Duas consequências práticas:

1. Um `grep .addr-delete-yes` sugere "o botão destrutivo" e está errado em uma
   das três telas. Antes de mexer, abra a tela.
2. Uma classe de componente por PAPEL (`.ui-btn-danger`) não pode ser aplicada
   a essas duas por nome — teria de ser por tela. É exatamente por isso que
   `styles/components.css` separa FORMA (`.ui-btn`) de PAPEL
   (`.ui-btn-primary` / `-secondary` / `-danger`): a forma é a mesma nas três
   telas, o papel não.

Consertar isso é mexer em markup e em três telas de confirmação, e é decisão de
produto — foi levantado e deixado de propósito em 30/08/2026.

## 5.1 O CSS, e as quatro ferramentas que respondem por medida

São ~18.700 linhas em 17 folhas, e o nome dos arquivos mente. Medido em
30/08/2026, e escrito no cabeçalho de `styles/utilities.css`:

- **`utilities.css` não é folha de utilitários.** De 1.280 regras, UMA começava
  com `.u-` (foi para `markup.css`, a folha de utilitários de verdade). As
  outras são ajuste de tela escrito ali por um motivo só: carregar depois de
  `restaurant.css` e vencer.
- **Ela também não carrega por último.** Depois dela vêm operation, register,
  login, verify, button-theme, assistant, coupons-api, pix, payment-card e
  markup. O comentário que dizia isso estava errado havia muito tempo.
- **Por isso não dá para "levar cada regra para a folha certa".** 1.013 das
  1.280 (191 kB) tocam classes ou ids que outra folha também declara: estão numa
  disputa de ordem, e mover inverte quem vence. Só 267 falam de tokens que mais
  ninguém declara.
- **E juntar blocos repetidos também não é de graça.** 136 seletores estão
  escritos mais de uma vez no arquivo; só 12 grupos podem ser juntados sem que
  algo no meio dispute a mesma propriedade.

| Pergunta | Ferramenta | O que ela prova |
|---|---|---|
| Esta regra pode pintar algo? | `tools/css-usage.mjs` | Metade **estática** (o nome não existe fora do CSS → morto por construção) e metade **runtime** (casa nas 14 telas → termômetro). Só a estática autoriza apagar. |
| Este `!important` vence alguém? | `tools/css-important.mjs` | Adversário = outra regra declarando a mesma **família** de propriedade no mesmo elemento. Runtime + um **veto estático** grosseiro por token. |
| Quantos componentes DIFERENTES existem? | `tools/ui-inventory.mjs` | Agrupa por **valor computado**, não por classe. 18 classes de cabeçalho de 70px = 12 formas; 3 de 85px = 1 forma. |
| Nada mudou? | `tools/capture-screens.mjs` | 41 propriedades de ~1.500 elementos em 14 telas, antes e depois. |

### ANTES DE CONFIAR NUM "Nenhuma diferenca": ela le 44 propriedades, nao todas

`getComputedStyle` devolve ~340 nomes. A captura le 44, escolhidas a mao. Isso
e correto — ler tudo afogaria a diferenca que importa em ruido legitimo — mas
tem uma consequencia que custou caro em 30/08/2026 e que voce precisa saber
antes de citar a saida dela como prova:

**A ferramenta lia `borderTopColor`, e so ela, das quatro cores de borda.**

A suposicao era razoavel: quem escreve `border:1px solid #eee` pinta os quatro
lados, entao a de cima denuncia as outras tres. Ela e errada NESTE app, que
quase nao usa borda inteira — ele usa DIVISORIA, e divisoria e `border-bottom`
sozinha: a linha sob o titulo de toda tela cheia, sob cada linha de lista, sob
cada aba. E o lugar onde este CSS mais desenha, e era exatamente o lugar onde a
ferramenta nao olhava.

O flagrante: um commit trocou o cinza da divisoria de sete cabecalhos, em 239
elementos, e a captura respondeu `Nenhuma diferenca` nas 14 telas. Corrigido
(`borderRightColor`, `borderBottomColor`, `borderLeftColor` entraram em
`PROPS`), a mesma troca aparece inteira.

Um verificador que nao olha onde o app desenha e PIOR que nenhum: sem ele voce
confere a mao; com ele voce para de conferir, e ele assina embaixo. Ele tinha
assinado embaixo de tres commits de limpeza — que estavam certos, conferido
depois com a lista corrigida (0 elementos entre 5d2618c e 2455388), mas isso
foi sorte de ninguem ter mexido em `border-bottom`, nao garantia.

**A regra que fica:** antes de aceitar um `Nenhuma diferenca` como prova de que
uma mudanca especifica nao mudou nada, confira se a PROPRIEDADE que voce mexeu
esta em `PROPS` (topo de `tools/capture-screens.mjs`). Se nao estiver,
acrescente-a e recapture os dois lados — a lista e para crescer. O que ainda
NAO esta la, e que alguem vai precisar um dia: `outlineColor`, `fill`,
`stroke`, `textDecoration*`, `backgroundImage` (gradiente), `objectFit`,
`gridTemplateRows`, `borderRadius` por canto.

### As armadilhas destas ferramentas (todas custaram uma rodada)

1. **Comentário colado na declaração.** `declaracoes()` lia
   `/* Zera o gap */
  gap:0!important` e devolvia a propriedade
   `"...*/
  gap"`. Nome assim não casa com família nenhuma: o adversário não
   foi encontrado, o marcador saiu, e a barra de baixo abriu `gap:0 36px` com os
   botões passando de 74,8px para 46px em 14 telas. Neste repositório o
   comentário colado é a REGRA — quem lê CSS aqui tira comentário antes de tudo.
2. **A ferramenta lendo a própria saída.** `css-usage.json` fica na raiz e tem
   todos os seletores dentro. Na segunda rodada ele entrou no corpus, toda
   classe "se provou" viva, e 426 regras mortas viraram **0**. Zero é uma
   resposta plausível demais para levantar suspeita.
3. **Família de propriedade fina demais.** `gap` e `column-gap` em famílias
   diferentes; `width` e `flex` também. Duas propriedades de nomes diferentes
   decidem o mesmo pixel o tempo todo — o agrupamento tem de ser grosso, e errar
   para o lado de agrupar demais custa um `!important` que fica, enquanto errar
   para o outro custa a tela.
4. **A chave do diff com a classe dentro.** Era `caminho|id|classe`, e assim um
   elemento que troca de classe some de um lado e nasce do outro — a comparação
   de estilo dele nunca acontece. Num commit de componentização é exatamente o
   elemento que se precisa conferir. Hoje a classe é relatada à parte: "11 com
   classe trocada, 0 com valor diferente".
5. **O adversário pode não estar no CSS.** `tests/unit/mark-contrast.test.js` lê
   o TEXTO da regra e exige `opacity:.82!important` no bloco de movimento
   reduzido. Nenhuma varredura de folha acha esse adversário — ele está num
   teste. Foi o `npm run test` que barrou, e é por isso que os quatro portões
   rodam mesmo num commit que "só mexe em CSS".
6. **Blocos repetidos não são redundância.** Juntar move declarações de cima
   para baixo. `body,button,input,textarea,select{font-family:...!important}` da
   linha 394 juntado ao bloco igual 1.500 linhas abaixo trocou a fonte de 934
   elementos: havia uma terceira regra no meio que vencia a de cima e perdeu
   para a de baixo. A repetição É o mecanismo de ordem.

Guardas que existem para barrar reincidência — se uma delas te barrar, ela
provavelmente está certa: `css-duplicate-declarations` (a folha não pode brigar
com ela mesma), `inline-handlers`, `mark-contrast`, `tenant-theme.spec.js`,
`visual-consistency.spec.js`, `csp.spec.js`, `api-contract.test.js`.

## 6. Estado no cliente

Namespace `rapidex.*`. **A conta é do Rapidex, não do restaurante** — o backend
é assim (`customers.phone` é único na tabela inteira). Então token, perfil,
endereços e pedidos são **globais**; carrinho, contexto de operação e
`orderTracking` são **por slug**. O carrinho é o único dado que não pode vazar
entre lojas. A sessão só é tocada por `readSession`/`writeSession`/
`clearSession` — um dia ela vira cookie de domínio, e essas três funções são a
costura.

`tracking_token` é a **única** forma de um visitante alcançar o próprio pedido
(a consulta pública por telefone não existe mais na API). Ele é persistido por
slug em `scripts/state/order-tracking.js` **antes** de qualquer renderização de
confirmação.

## 7. White-label

Cor chumbada no CSS é bug. ~250 delas (86 sob `!important`) venciam as custom
properties que `applyTheme()` escrevia, e todo restaurante novo nascia
parcialmente laranja do piloto — o que travava comercialmente o cadastro do
segundo cliente. Use tokens (`styles/tokens.css`); `tenant-theme.spec.js` falha
se a regressão voltar.

Cor de estado (âmbar, vermelho) num tenant azul é **cor de ninguém**: prefira
peso, borda e hierarquia. Cor de marca sobre fundo claro passa pela guarda de
contraste (`--brand-mark-light` / `--brand-mark-deep`), nunca pela primária crua.

## 8. Antes de fechar

- [ ] O teste novo foi visto **falhando** com a correção revertida, e pelo motivo certo.
- [ ] `lint`, `typecheck:cards`, `test`, `test:e2e` — com os números no commit.
      Lembre que os três primeiros NÃO executam o app (§5): verde neles não diz
      nada sobre ordem de carga nem sobre código movido entre arquivos.
- [ ] Nenhum valor de dinheiro calculado fora de `cartTotals()`; nenhum campo lido sem estar em `api.d.ts`.
- [ ] Rota nova? Ela existe no spec (`api-contract.test.js` prova) e o mock **não** a atende por acidente pelo catch-all.
- [ ] Pendência de backend virou texto. `docs/order-contract.md` tem a lista, e a mais cara continua aberta: **numa recusa de cartão o pedido já está gravado e não há rota de cliente para cancelá-lo.**

A mensagem de commit deste repo conta **o defeito**, não a mudança: o que a
pessoa via, por que ninguém pegou, o que passa a valer, e a verificação com
números no fim. Siga o formato — foi ele que tornou esta auditoria possível.
