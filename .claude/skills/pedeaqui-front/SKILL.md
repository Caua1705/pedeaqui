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

Em 30/08/2026 o arquivo inteiro foi varrido de novo, procurando bloco que
ninguém tivesse olhado. Os sete candidatos, medidos com a MESMA conta (nomes
lidos de fora + nomes chamados de fora), contra a aferição do bloco já recusado:

| Bloco | linhas | fios | linhas por fio |
|---|---|---|---|
| operação/filial (JÁ RECUSADO, aferição) | 316 | 87 | 3,6 |
| Perfil: histórico de pedidos | 571 | 64 | **8,9** |
| Dados do cliente / senha | 228 | 28 | 8,1 |
| Informações da loja (modal + `info*`) | 250 | 34 | 7,4 |
| Cupom: folha de detalhe + helpers | 240 | 41 | 5,9 |
| Cashback | 81 | 16 | 5,1 |
| Produto: modal e opções | 185 | 41 | 4,5 |
| Confirmar pedido (folha) + submissão | 119 | 27 | 4,4 |

Os três cortes que DERAM certo (endereço, Pix, auth) tinham ~1.100 linhas para
~40 injeções — perto de 27 linhas por fio. O melhor candidato restante tem 8,9,
que é pior que a folha do cupom (9,0) já recusada por "mais fio que pano".
**Não sobrou bloco extraível.** Se você for tentar mesmo assim, meça antes e
compare com esta tabela: `node tools/fios-do-corte.mjs` (com `--detalhe`, ele
lista os nomes de cada lado). A aferição contra o bloco já recusado sai junto
de propósito — um número de densidade só quer dizer alguma coisa ao lado de
outro.

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

**A prova de cada corte** é `node tools/capture-screens.mjs`: 58 telas, 69
propriedades computadas de todos os ~1.500 elementos, antes e depois. Foi ela que
pegou a armadilha 1 — e só porque ela **lança** quando uma tela não abre, em vez
de registrar vazio.

Eram 14 telas até 30/08/2026, e por isso 1.628 declarações `!important` e 229
cores nunca tinham produzido evidência nenhuma: o Pix, o cartão, o Clube com
cupom desenhado, o extrato, a política, as subpáginas do perfil, o chat
respondido, o modo voz, as duas telas de erro e a landing estavam TODOS fora.
Cada tela declara um `setup(page)` opcional (token, rota sobreposta, outro
contexto de operação), e as quatro ferramentas que abrem telas chamam o mesmo
`prepararTela()` — repetir o preparo em cada laço vira divergência assim que
uma tela precisa de preparo próprio.

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

**E não é só o NOME: o VALOR PADRÃO também está no contrato.** A auditoria de
30/08 dispensou as cadeias de fallback com "o nome certo vem em primeiro, logo
o fallback é inalcançável". Isso vale quando o campo é obrigatório e não pode
ser falsy — e `sort_order` é as duas coisas ao contrário. `CategoryResponse`,
`ProductResponse` e `BannerResponse` declaram os três
`sort_order: number | null` com **`@default 0`**, e `Number(x.sort_order ||
index)` não distingue 0 de ausente: o item de MENOR ordem, o que tem de vir
primeiro, era justamente o que perdia a própria ordem e herdava a posição de
chegada no array. Passou invisível anos porque o backend costuma entregar a
lista já ordenada — e o contrato não promete ordem de array em lugar nenhum.
Corrigido em quatro sítios de `menu-service.js` (`??` no lugar de `||`), com
`tests/unit/menu-sort-order.test.js` visto vermelho.

A pergunta que fica: **`||` sobre número ou booleano do contrato é suspeito
sempre.** `??` distingue "não veio" de "veio zero"; `||` não.

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
npm run test                 # vitest, ~296 unitários
npm run test:e2e             # playwright; constrói e serve o bundle real
```

**Desde 31/08/2026 o portão manda no deploy.** Até essa data a integração Git da
Vercel publicava a `main` no INSTANTE do push, sem esperar pelo `ci.yml` — nada
impedia produção com o portão vermelho. Hoje `vercel.json` traz
`git.deploymentEnabled.main = false` e o `ci.yml` tem um job `deploy` com
`needs: verify`. **São duas metades, e meia trava é pior que nenhuma porque
parece uma:** `tests/unit/deploy-gate.test.js` falha se qualquer uma sumir. O
passo a passo dos três secrets está em `docs/deploy-pelo-portao.md`; enquanto
eles não existirem o job falha de propósito, em vez de se pular em silêncio.

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

**A LISTA DE FLAKES CONHECIDOS ACABOU** (31/08/2026). Os cinco nomeados e mais
quatro achados na caça foram investigados um a um; sete tinham causa e foram
corrigidos, e os dois restantes estão nomeados na §11 com o que se sabe e o que
não se sabe. **Se um teste falhou, trate como seu até provar o contrário** — a
§11 tem a taxonomia que distingue, em dez segundos, corrida de teste, estouro
de orçamento e máquina parada.

Antes de arquivar qualquer coisa como flake, RODE ISOLADO
(`npx playwright test <arquivo> --workers=1`) e confira que o que falhou não é
o eixo que você mexeu — `pix-payment.spec.js:116` afirma sobre a geometria do
CTA, e num commit que muda altura de botão "é o flake de sempre" é exatamente a
frase que deixa passar a regressão.

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

São ~18.700 linhas em 20 folhas (19 no `restaurant.html`, mais `landing.css`),
e o nome dos arquivos mente. Medido em 30/08/2026, e escrito no cabeçalho de
`styles/utilities.css`:

- **`utilities.css` não é folha de utilitários.** De 1.280 regras, UMA começava
  com `.u-` (foi para `markup.css`, a folha de utilitários de verdade). As
  outras são ajuste de tela escrito ali por um motivo só: carregar depois de
  `restaurant.css` e vencer.
- **Ela também não carrega por último.** Depois dela vêm operation, register,
  login, verify, button-theme, assistant, coupons-api, pix, payment-card e
  markup. O comentário que dizia isso estava errado havia muito tempo.
- **Por isso não dá para "levar cada regra para a folha certa".** 1.013 das
  1.280 (191 kB) tocam classes ou ids que outra folha também declara: estão numa
  disputa de ordem, e mover inverte quem vence. Só 267 falavam de tokens que
  mais ninguém declara — e **211 dessas já saíram**, em 30/08/2026, para
  `store-info.css` (134), `club.css` (61) e `policy.css` (16). Sobraram 1.055
  regras, 1.006 delas em disputa e 49 livres mas sem grupo (restos de
  `.delivery-widget-tab`, `.home-cart-pill`, `.highlight-*`, `.prof-payment-*`,
  `.payment-method-*`, espalhados entre as em disputa). O critério do recorte
  em bloco se esgotou; o que sobra é uma regra por vez, com captura a cada
  passo.
- **E juntar blocos repetidos também não é de graça.** 136 seletores estão
  escritos mais de uma vez no arquivo; só 12 grupos podem ser juntados sem que
  algo no meio dispute a mesma propriedade.

| Pergunta | Ferramenta | O que ela prova |
|---|---|---|
| Esta regra pode pintar algo? | `tools/css-usage.mjs` | Metade **estática** (o nome não existe fora do CSS → morto por construção) e metade **runtime** (casa nas 14 telas → termômetro). Só a estática autoriza apagar. |
| Este `!important` vence alguém? | `tools/css-important.mjs` | Adversário = outra regra declarando a mesma **família** de propriedade no mesmo elemento. Runtime + um **veto estático** grosseiro por token. |
| Quantos componentes DIFERENTES existem? | `tools/ui-inventory.mjs` | Agrupa por **valor computado**, não por classe. 18 classes de cabeçalho de 70px = 12 formas; 3 de 85px = 1 forma. |
| Nada mudou? | `tools/capture-screens.mjs` | 69 propriedades de ~1.500 elementos em **58 telas**, antes e depois. |

### ANTES DE CONFIAR NUM "Nenhuma diferenca": ela le 69 propriedades, nao todas

`getComputedStyle` devolve ~340 nomes. A captura le 69, escolhidas a mao. Isso
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
acrescente-a e recapture os dois lados — a lista e para crescer, e cresceu: em
30/08/2026 entraram 22 nomes porque um commit ia tirar `!important` de `inset`,
`background:linear-gradient`, `background-size`, `cursor` e
`-webkit-text-fill-color`, e a ferramenta teria respondido "Nenhuma diferenca"
sem ter olhado para nenhum deles. O que ainda NAO esta la:
`gridTemplateRows` e `borderRadius` por canto.

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
   rodam mesmo num commit que "só mexe em CSS". Em 30/08/2026 esta exata
   declaração entrou de novo numa lista de remoção e o marcador saiu; o
   `npm run test` barrou **depois do commit**, porque a saída dos três portões
   rápidos tinha sido engolida pelo shell (`&&` na mesma linha que jogava o
   e2e para background) e o número foi escrito na mensagem assim mesmo. Duas
   lições: **rode cada portão numa chamada própria e leia a saída**, e o veto
   virou da ferramenta — `css-important.mjs` tem hoje `vetado-por-teste`, que
   ignora qualquer declaração cuja propriedade apareça junto de `!important`
   numa linha de `tests/`.

7. **O corpus que se prova sozinho tem três camadas, não uma.** Já era conhecido
   que `css-usage.json` na raiz fazia toda classe "se provar" viva (armadilha 2).
   Faltavam duas: um **spec** que diz `expect(page.locator('.prod-card'))
   .toHaveCount(0)` NOMEIA a classe — e num corpus único ela se prova viva com a
   prova ao contrário na mão (12 regras pintavam um cartão de produto que o app
   parou de desenhar); e o **próprio comentário da ferramenta**, ao explicar o
   caso, recolocou o nome no corpus e ressuscitou a classe. Hoje `tests/` e
   `tools/` ficam fora do corpus que julga morte, e o que só aparece neles sai
   numa lista à parte, para conferência humana.

8. **Tela que sorteia é ruído que às vezes some.** O balão de "pensando" do
   assistente escolhe a frase com `Math.random`, e cada frase tem uma largura.
   Duas capturas seguidas da mesma build disseram "Nenhuma diferença" antes de
   a terceira acusar 4 elementos com `width: 118,391px -> 210,094px`. Um
   sorteio entre poucas opções acerta o mesmo valor com frequência suficiente
   para parecer estável — e só aparece no dia em que decide a favor de um falso
   positivo, que é o dia em que alguém está julgando um commit. Outras duas da
   mesma família, achadas na mesma rodada: o **carrossel do cabeçalho** anda por
   `setInterval` (não é transição, e congelar transição pelo CSSOM não alcança),
   e a **fonte chegando no meio da leitura** trocava a largura de 104 elementos
   por fração de pixel. As três estão neutralizadas em `estabilizar()` e no
   `go()` da tela.
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

## 9. O padrão de tela (fase de telas, 30/08/2026)

A partir desta fase, tela nova ou migrada mora em
`scripts/pages/screens/<nome>-screen.js` e segue UM contrato. Dois idiomas vão
conviver enquanto a migração anda — **copie este, não o antigo** (o antigo é o
`init(deps)` da §2.1, que continua valendo só para os módulos que já existem:
address, pix, auth).

```js
// scripts/pages/screens/exemplo-screen.js
(function () {
  // Estado DA TELA mora aqui dentro. Sem acessor de volta para o page:
  // se o page precisa ler o estado da tela, o corte está errado.
  let aberto = null;

  function mount(ctx) {
    const { kit, app, shell } = ctx;
    // kit  = window.PedeAquiScreenKit (esc, fmt, $, act, ...14 ferramentas)
    // app  = window.PedeAquiAppPort  (GETTERS sobre os 13 estados do app)
    // shell= o que o restaurant-page injeta desta tela em diante
    window.RapidexActions.register({ abrirExemplo, fecharExemplo });
  }

  window.PedeAquiExemploScreen = { mount };  // mount, e NADA mais
})();
```

As regras, cada uma com o defeito que a criou:

1. **IIFE importada em `entry-restaurant.js` ANTES do `restaurant-page.js`.**
   O page chama `mount(ctx)` no corpo dele; tela importada depois é
   `undefined` no boot (mesma classe do "p is not a function" da §2.1).
2. **Corpo do módulo não executa nada** além de definir e publicar.
   `page-modules.test.js` barra (armadilha 1 da §2.1) — acrescente a tela à
   lista `MODULOS` dele no MESMO commit da migração.
3. **`app` é porta de GETTERS** (`window.PedeAquiAppPort`): `app.cart` chama o
   getter a cada acesso. NUNCA copie no mount (`const cart = app.cart` no topo
   congela a fotografia do boot — a armadilha mais cara da §2.1). Os 13
   estados: restaurant, cart, customer, products, branches, settings,
   appState, operationContext, isLogged, deliveryFee, restaurantInfoState,
   currentCustomerSnapshot, persistCustomer.
4. **Saídas vão por `RapidexActions.register()`** — o registro MESCLA, o HTML
   não muda um byte (§2.1, "o markup não muda").
5. **Um estado responde a UMA pergunta.** Se a mesma variável diz "o que a
   lista mostra" E "qual item está aberto", separe — não conserte com clear
   no fechar. Foi assim que o cupom grudou (§4).
6. **Renderizador puro tem unitário com fixture montada do `api.d.ts`**, não
   do que o código espera — o fixture de profile-order-tracking já codificou
   o contrato ERRADO e confirmava a leitura errada por meses.
7. **Medida**: `node tools/fios-do-corte.mjs --tela scripts/pages/screens/X.js`
   conta CHAVES lidas de `app`/`shell` (kit é commodity e sai da conta). A
   régua da §2 continua: compare com a tabela antes de acreditar num corte.

Ferramentas da fase: `scripts/utils/screen-kit.js` (14 ferramentas, onze são
invólucro de global existente — leem o global NA CHAMADA, nunca no import) e
`scripts/services/store-info-format.js` (formatadores puros de /info, com
unitários — o horário já mostrou "0" e deslocou a semana em um por ignorar
`day_label` e usar um mapa 1..7 num contrato em que weekday é 0=SEGUNDA).


## 9.1 A fase de telas, executada (31/08/2026) — e as armadilhas novas

Seis telas saíram no contrato da §9, cada uma verificada com captura dos dois
lados e suíte completa:

| tela | arquivo | linhas | fios (--tela: app+shell) |
|---|---|---|---|
| Perfil: pedidos + roteador de subtelas | screens/profile-screen.js | 485 | 11 (44 l/fio) |
| Dados do cliente / senha | screens/customer-data-screen.js | 331 | 13 (25) |
| Informações da loja | screens/store-info-screen.js | 239 | 8 (30) |
| Cupom: folha de detalhe | screens/coupon-detail-screen.js | 221 | 15 (15) |
| Produto: modal e opções | screens/product-screen.js | 296 | 9 (33) |
| Início (rendering; SEM operação) | screens/home-screen.js | 388 | 16 (24) |

A régua antiga media 3,9–6,0 l/fio nesses blocos e os recusava. O que mudou a
conta NÃO foi o bloco: foi o desenho das portas — appPort por getter, kit
commodity fora da conta, e estado de tela morando NA tela. `node
tools/fios-do-corte.mjs --tela <arquivo>` é a medida desta fase.

**Dois blocos foram RECUSADOS de novo, com a régua nova na mão** — a medida
continua vencendo a vontade:

- **Confirmar pedido (folha)**: é CHECKOUT — lê forma de pagamento/cartão
  salvo/Pix em voo e ESCREVE o token de uso único; migrar exigiria ~15 portas
  de shell incluindo escrita de token. Fica ao lado do dono do dinheiro.
- **Cashback**: sobraram 13 linhas depois que o gêmeo morto saiu — módulo de
  13 linhas é cerimônia.

O padrão de comunicação page→tela é o REGISTRO DE AÇÕES como barramento:
o page anuncia (`resolve('renderStoreInfoState')?.(estado)`,
`resolve('renderHomeContent')?.()`) e a tela desenha o que é dela. O page não
importa nada de tela.

### Armadilhas NOVAS desta fase (todas sofridas aqui)

1. **Trampolim como `const` é TDZ.** Quando um nome migrado continua sendo
   chamado POR NOME no page (closeProfSub no authFlow.init, openCouponDetail
   no window), o page ganha um trampolim que resolve pelo registro NA
   CHAMADA. Ele TEM de ser `function` declarada: o `authFlow.init()` roda no
   MEIO do IIFE e passa o nome por valor — um `const` 1.100 linhas abaixo é
   Temporal Dead Zone, e o app inteiro morreu no boot com "Cannot access 'Vc'
   before initialization", com lint e unitários verdes. Quem deu a frase em
   segundos foi o boot-smoke.
2. **Trampolim NÃO entra no register do page.** Registrar o trampolim como
   ação e deixar a tela sobrescrever funciona… até a tela faltar — aí o
   trampolim resolve para si mesmo e vira recursão infinita muda. Falha
   barulhenta (ação ausente) vence loop.
3. **Extração por regex + spread.** O lookbehind `(?<![\w.$])` que protege
   `restaurant.name` de virar `app.restaurant.name` em `restaurant_name`
   TAMBÉM casa o terceiro ponto de `...fn()` — a chamada dentro de spread
   escapa da reescrita. O no-undef do lint pega (é a especialidade dele);
   rode-o antes de qualquer outra coisa após extração mecânica.
4. **Vigilância de lifecycle vai para mount().** `onVisibility`/`onTeardown`
   no corpo do módulo executam no import (armadilha 1 da §2.1, de novo). No
   mount() rodam no fim do IIFE do page — o mesmo instante de antes.
5. **Portão lido por `tail -1` não foi lido.** TRÊS commits desta rodada
   carregaram erro de lint porque a linha de erro ficou fora do recorte do
   pipe. `page-modules.test.js` e o hábito não bastam: leia a linha
   "N problems (N errors)" INTEIRA, sempre.

### Ruído novo da captura: o relógio de parede

"Realizado há X horas" (detalhe do pedido do Perfil) muda de largura quando a
hora vira — 3 elementos, fração de pixel, na MESMA tela, rodada após rodada.
É da família do §5.1-8 (ruído que às vezes some): reconheça o trio de
elementos antes de caçar fantasma. O fixture usa created_at fixo; a idade
relativa é que anda. E o ruído de FONTE do §5.1-8 reapareceu na rodada com a
mesma assinatura de sempre: 104 elementos, largura fracionária — recapturar
resolve.

## 10. O mock logado e o contrato dos pedidos (31/08/2026)

`mockApi()` responde `/customers/me*` como o backend: SEM header
Authorization → 401; COM → fixtures DO CONTRATO (`CUSTOMER`, `ORDERS` de
tests/fixtures/orders.json, `orderDetail()` com endereço FLAT e
status_history). Subrota não declarada cai no catch-all 404. Specs que
sobrepõem rotas depois de mockApi() continuam vencendo.

Nomes que a auditoria de 30-31/08 provou NUNCA terem existido em resposta
nenhuma (todos já consertados; não os recoloque): item.name / item.unit_price
/ selected_options_snapshot NO PEDIDO (o certo: product_name_snapshot,
unit_price_snapshot — que JÁ inclui adicionais — e
option_groups[].options[].option_name_snapshot); cancelled_at/refused_at
(status_history); endereço por objetos aninhados (address_street/_number/...
FLAT); display_name/day_name nos horários (day_label pronto; weekday é
0=SEGUNDA); opening_hours_text/closing_time; rapi_suggestions; res.customer/
res.access_token no verify (VerifyEmailCodeResponse = {message, verified} —
e 200 com verified:false é RECUSA). E o saldo gastável por loja é
by_restaurant[] filtrado por slug — o balance da raiz soma a conta inteira e
o schema avisa que a soma não é gastável.

## 11. A caça aos flakes (31/08/2026) — e o que ela ensinou sobre o portão

A lista de "flakes conhecidos" da §5 foi resolvida, e o resultado mais útil não
é a lista de correções: é a **taxonomia**. Nove execuções da suíte completa em
máquina limpa mostraram que "flake" era o nome de três coisas diferentes, e só
uma delas se conserta no teste.

### As três famílias, e como distinguir uma da outra em 10 segundos

| família | assinatura no log | o que fazer |
|---|---|---|
| **A. corrida do teste** | o teste falha em segundos, com uma asserção de valor (`Expected X, Received Y`) | achar a causa e corrigir. Todas as sete desta rodada eram isto |
| **B. estouro de orçamento** | duração **entre 31 e 40 s** e `Test timeout of 30000ms exceeded` | olhe a rodada INTEIRA antes de tocar no teste |
| **C. máquina parada** | um ou mais testes com duração em **MINUTOS**, e uma dezena de irmãos estourando o teto juntos | **descarte a execução.** Não é medição |

A rodada de 31/08/2026 teve uma execução de família C: quatro testes de
`assistant-voice.spec.js` levaram **15 a 16 minutos cada**, simultaneamente, e
os outros onze vermelhos eram estouros de 32–38 s. Nenhum valor de espera
conserta uma máquina parada por 16 minutos, e tratar aquilo como bug de teste
teria produzido correções contra fantasmas. A máquina desta sessão: 8 núcleos,
**8 GB de RAM**, Edge e WSL residentes, memória livre em 340–430 MB durante a
suíte, com `workers: undefined` = **4 Chromiums**.

### A causa que estava em SEIS testes ao mesmo tempo

**Esperar o COMEÇO do caminho e afirmar sobre o efeito do FIM dele.** Aparece em
duas roupas:

1. **`chamadas.X.length` cresce dentro do `page.route`** — ou seja, ANTES de o
   mock responder, antes de o `fetch` do app resolver e antes de a consequência
   acontecer. `expect.poll(() => chamadas.busca.length).toBe(1)` prova que o
   pedido SAIU, não que a resposta voltou.
2. **`emitir()` num RTCDataChannel de verdade** — mandar não é ter chegado.
   O recibo de que o app PROCESSOU o evento é um efeito observável do handler
   (no modo voz, o estado da tela: `response.created` → `is-speaking`,
   `response.done` → `is-listening`).

### As cinco armadilhas novas, cada uma com o teste que a revelou

1. **Afirmar sobre um INSTANTE governado por um relógio de parede.**
   `assistant-product-detail:4` fazia `waitForTimeout(120)` e perguntava o
   `display` DE FORA, enquanto o app devolve o `hidden` num `setTimeout(540)`.
   Sob carga a pergunta chegava depois. E `getAnimations()` tem o mesmo vício na
   direção oposta: só responde `true` enquanto a transição AINDA corre.
   **O padrão que substitui os dois:** uma sonda DENTRO da página que mede
   contra o relógio da PRÓPRIA animação — no `transitionrun`, ler
   `getComputedStyle(painel).transitionDuration` e contar em quadros quanto
   tempo o elemento continuou desenhado. Máquina lenta só aumenta o número
   medido, que é o lado seguro. De brinde, pega o defeito que o teste antigo não
   pegava: alongar a transição no CSS sem alongar o temporizador do JS.

2. **O teto sob teste matando o preparo do teste.**
   `assistant-voice-session:491` armava um teto de sessão de 2 s e depois
   chamava `conversar()`, que precisa de uma ida-e-volta pelo canal DEPOIS de o
   teto começar a correr. Se o que você está testando é um limite, o preparo não
   pode caber dentro dele.

3. **Um temporizador do APP solto no meio do gesto do teste.**
   `openVerifyScreen()` termina com `setTimeout(() => vfyDigits()[0].focus(), 60)`.
   `verify-email-code:58` tomava o foco por um clique e digitava; com a máquina
   ocupada o temporizador chegava NO MEIO da digitação, devolvia o foco ao
   dígito 0, e os seis caracteres se atropelavam.
   **A regra:** quando o app dá foco sozinho, ESPERE o foco dele
   (`toBeFocused`) em vez de tomar o foco. Esperar o efeito é esperar o
   temporizador ter corrido.

4. **Um número esperado que depende de uma largura que o teste não declara.**
   `pix-payment:116` afirma `cta.x - footer.x === 20`. Esse 20 é
   `(414 - 374) / 2`, e 414 é o `max-width` do painel, que só vale ACIMA de
   767 px. O teste herdava a viewport padrão do projeto em silêncio.
   Medido: 1280 → 20; sem o teto de 414 → 453; 390 → 16.

5. **Orçamento desigual por escolha de ferramenta.** Toda espera de boot da
   suíte usa `waitForFunction`, cujo teto é o do teste (30 s).
   `tenant-theme:161` precisou usar `expect` (o relógio da página está
   congelado, e o rAF do `waitForFunction` congela junto) e herdou o padrão de
   **5 s**. Quando um teto explícito é a correção certa, o argumento tem de ser
   este: *o defeito que o teste guarda torna a espera INFINITA, não lenta* —
   com o relógio congelado um piso de tempo nunca elapsa, então o teste falha
   com 5 s ou com 15, e o número só decide quem é acusado.

### "Não está mais subindo" NÃO é "subiu"

A pior das seis, porque estava em **52 sítios de 40 arquivos**:

```js
await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
```

Isto é satisfeito TAMBÉM quando o boot FALHA: `showAppError()`
(`restaurant-page.js:390`) TIRA `app-booting` e põe `app-error`. E um boot que
falha nunca chega a `applyTheme()` — a página fica pintada na cor da
PLATAFORMA. Foi assim que `tenant-theme:229` acusou "cor de marca chumbada"
num tenant azul: o CSS estava certo, o app é que não tinha subido.

Medido com o `/menu` respondendo 500: a espera antiga passa direto e **24
elementos** ficam no laranja do piloto (o scanner deduplica pela descrição, e as
"quatro" da mensagem eram dezenas). Hoje quem espera é
**`esperarAppPronto(page)`** (`tests/e2e/helpers.js`), que LANÇA com
`o app NÃO subiu: caiu na tela de erro de boot (body.app-error)`. Use-a; não
copie a espera crua.

É a mesma lição do `boot-smoke.spec.js`: o problema nunca foi cobertura, foi
**diagnóstico**.

### O experimento de DOIS BRAÇOS, que é o que faz a correção valer

Um flake de carga não se reinjeta como um bug comum: ele só aparece com a
máquina ocupada. O que funciona é **magnificar a corrida pelo lado do teste** e
rodar os dois braços lado a lado:

- foco: temporizador do app 60 → 400 ms e digitação a 120 ms/tecla;
- teto de sessão: 2 s → 50 ms;
- boot: `/menu` respondendo 500;
- animação: `transition-duration: 4s` por `addStyleTag`.

Em cada um, o braço A (jeito antigo) falha com **o texto idêntico ao da suíte** e
o braço B (jeito novo) passa. Sem isso não há prova, só esperança.

**E ele reprova hipóteses, que é o mais valioso.** Duas vezes nesta rodada:
- O primeiro remendo do `:491` tirava o `conversar()` inteiro — e o braço B
  ficou VERMELHO, porque `montar()` não abre a voz (quem clica no botão é o
  `conversar()`). Sem o experimento, isso teria virado um teste verde que não
  testava nada.
- Em `pix-payment:116`, "mediu no meio da animação" era a hipótese óbvia e
  estava ERRADA: com a transição em 4 s, os dois braços deram 20 — rodapé e
  botão viajam na MESMA transformação, e a distância entre eles não muda
  enquanto o painel desliza. A causa daquele 307,6 continua sem explicação, e
  está escrito assim no teste.

### Higiene de medição — três erros que custaram medições inteiras

1. **Matar node órfão e conferir a porta 4174 ANTES de medir.** Já registrado, e
   continua valendo.
2. **NÃO editar um spec no meio de um lote de execuções.** Um lote de 6 foi
   perdido nesta rodada por isso: as execuções passam a medir árvores
   diferentes e a sequência não quer dizer nada.
3. **Ler o portão inteiro.** O `esperarAssentar` de `pix-payment` foi commitado
   sem a CHAMADA numa das versões — quem pegou foi o `no-unused-vars` do lint,
   na linha que um `| tail` teria engolido.
4. **Não rode `npm run test` enquanto um lote de E2E está reconstruindo.** Um
   unitário caiu uma vez nessa condição e passou na chamada seguinte, sem nada
   ter mudado: `npm run test:e2e` roda `npm run build` a cada execução, e num
   PC com 8 GB isso basta para esfomear o vitest. Um vermelho que some sozinho
   é o pior tipo — ele ensina a repetir o comando em vez de ler.
