# Varredura de acabamento — 05/09/2026

Percurso do app inteiro como cliente novo, em **390×844** (a largura do cliente;
a padrão do Playwright é 1280 e esconde metade do CSS — §14.2). As 63 telas do
roteiro de `capture-screens.mjs` foram **fotografadas** e olhadas uma a uma, e o
que não deu para ver com o olho foi medido por sonda.

A primeira passada foi só LISTA, por instrução. Os seis achados foram
**consertados em seguida**, na ordem escolhida pelo dono (A, C, B, D, E, F) —
cada um com o teste visto vermelho antes.

---

## ANTES DA LISTA: o Storage de produção está RESTRITO, agora

Não é acabamento e não é do front, mas é o achado mais caro da varredura e a dez
dias da estreia. Medido com `curl` na URL exata que o app pede:

```
$ curl -sI .../storage/v1/object/public/restaurant-assets/junior-da-picanha/brand/logo.webp
HTTP/1.1 402 Payment Required

{"message":"Service for this project is restricted due to the following
 violations: exceed_cached_egress_quota. The project owner must upgrade
 their plan or remove spend caps to restore service."}
```

**Toda imagem do app responde 402** — logo, banners do herói, fotos de prato,
arte de cupom. O original E a derivada `/render/image/`, os dois.

Isso desarma o recuo da §23 por completo: `RapidexImageCdn.retreat(img)` existe
para que uma derivada quebrada caia no ORIGINAL em vez de a tela ficar branca —
e aqui o original está morto também. O recuo dispara, falha, e a imagem não
pinta. É exatamente o cenário "a tela fica GRANDE, nunca branca" com o alvo do
recuo fora do ar.

O que continua de pé, conferido no mesmo minuto: **`api.pederapidex.com` responde
200** e **`www.pederapidex.com` responde 200**. O app sobe, pede e paga; só que
sem foto nenhuma.

É a conta que o commit `2ff2d85` (as 10 URLs passando a pedir a largura da caixa)
e o `230ea3f` (a suíte parando de baixar o bucket de produção) foram escritos
para conter — 14,19 GB contra um teto de 5 GB. A contenção entrou; a cota já
tinha estourado.

**Ação é de quem cuida do projeto Supabase**, não de um commit de front: subir o
plano ou tirar o teto de gasto. Enquanto isso, as duas falhas de
`image-framing.spec.js` na suíte são consequência, não regressão — são os dois
únicos testes que pedem bytes de verdade.

### O alcance, medido — é COTA, não configuração

Três perguntas, três medidas.

**1. Quantas URLs o app pede numa visita de cardápio, e quantas transformam?**

Sonda numa visita típica (abrir o cardápio e rolar até o fim, soltando o
lazy-load), com o Storage respondendo 402 como responde agora:

| | |
|---|---|
| requisições ao Storage | **76** |
| URLs **distintas** | **72** |
| passando por transformação (`/render/image/`) | **61** (85%) |
| pedindo o original (`/object/public/`) | **11** |

Exemplo do que é pedido:
`.../render/image/public/.../brand/logo.webp?width=45&resize=contain&quality=72`.

Ou seja: a esmagadora maioria já pede a largura da caixa, que é o que os commits
`2ff2d85` e `230ea3f` construíram para conter o egress. **A contenção está no
lugar; a cota é que já tinha estourado antes dela.** Não é configuração errada —
`exceed_cached_egress_quota` é o plano, e o próprio corpo da resposta diz o
remédio ("upgrade their plan or remove spend caps").

**2. A suíte ainda bate no bucket de produção?**

O laço foi fechado em `230ea3f` e **não voltou**. Conferido nos quatro lugares
onde poderia ter escapado:

- **todo** spec chama `mockApi()` — zero exceções (`for f in tests/e2e/*.spec.js`);
- o dublê é `page.route('**/*.supabase.co/**')`, que casa original E derivada;
- só **`image-framing.spec.js`** pede bytes reais (`imagensReais: true`), e é a
  exceção documentada — é o único guarda contra o `resize` achatado, e com o
  pixel dublê ele passaria verde sem ter medido nada;
- as **quatro ferramentas** que abrem browser (`capture-screens`, `css-usage`,
  `css-important`, `ui-inventory`) passam todas por `prepararTela()`, que chama
  `mockApi()` com o dublê ligado.

`coupon-detail-image`, `image-retreat` e `image-sizes` registram rotas próprias
de Supabase — e vencem por serem registradas depois, então também não escapam.

**3. O recuo tem um segundo nível?**

Tem — e ele **quase não chega**. Medido com o Storage em 402:

| | |
|---|---|
| `<img>` de Supabase no DOM | 140 |
| quebradas (`complete && naturalWidth === 0`) | **54** |
| placeholders de produto que apareceram | **5** |

O que o cliente vê no cardápio é o **ícone de imagem quebrada do navegador com
o `alt` cru ao lado** ("🖼 Picanha black angus"), em cada prato — não as
iniciais.

A causa é que o cardápio tem uma **cópia própria** do recuo
(`restaurant-page.js:593`, `handleError`) em vez de chamar
`RapidexImageCdn.retreat()`. E essa cópia faz `img.src = originalSrc` **sem
remover o `src` antes** — que é exatamente o que a §23.2 mediu como *não
recarregando*: o elemento fica `complete: true` com `naturalWidth: 0`, e o
`error` seguinte (o que chamaria `replaceFailedProductImage`) não vem.

Os LOGOS, que chamam o dono único, degradam certo: caem para as iniciais.

**Portanto o conserto que a instrução pedia existe pela metade**: não falta um
placeholder — falta o cardápio usar o recuo do dono único para chegar até ele.
Não foi feito nesta rodada (não estava na lista ordenada); é o candidato G.

---

## Os seis achados, com tamanho

**TODOS OS SEIS FORAM CONSERTADOS em 05/09/2026**, na ordem pedida (A, C, B, D,
E, F). O que segue é o registro do que cada um era.

A prova de que nada MAIS mudou é uma captura das 63 telas nos dois lados. Toda
diferença é um conserto, e cada conserto tem uma assinatura própria:

| mudança | quantas | qual |
|---|---|---|
| `zIndex` na pilha de conta (login, cadastro, verificação, recuperação) | 337 | **A** |
| `width` do rótulo de telefone, 194,9px -> 92,5px | 7 | **D** |
| `width` da caixa do loader (60 -> 280px) e do título/mensagem/botão | 7 | **B** |
| `backgroundColor` `rgb(197,32,32)` -> `rgb(217,92,4)` | 1 | **E** |
| `width` do `pixCountdownBar`, ±0,04px | 2 | ruído: a barra anima (§5.1-8) |

Nenhuma outra propriedade, em nenhum outro elemento. É o uso da ferramenta que a
§20.3 registra: ela não serve só para provar "nada mudou" — serve para provar
"mudou exatamente isto", que é a afirmação que se faz quando a mudança é
deliberada.

O **C** não aparece nessa lista de propósito: a captura lê estilo computado, não
texto. Ele foi conferido por foto — `undefined, 450 - Aldeota` virou
`Rua Silva Paulet, 450 - Aldeota` — e por unitário visto vermelho.

| # | o que | quem vê | tamanho |
|---|---|---|---|
| A | A folha de login do cartão abre POR BAIXO da tela de pagamento | quem acabou de se cadastrar e quer pagar no cartão | **M** |
| B | As duas telas de ERRO ficam espremidas numa coluna de 60 px | qualquer um que perca a rede, ou abra um link errado | **P** |
| C | `addressSummary()` escreve a palavra `undefined` na tela | quem tem endereço gravado sem `street` | **P** |
| D | O telefone da loja mostra dois números num link que liga para um | quem toca em "Ligar" na Ajuda ou em Informações | **P** |
| E | O "Ok" de um aviso que não apaga nada é vermelho de destruição | quem tenta excluir o endereço ativo | **P** (decisão) |
| F | Cadastrar não loga — e só o cartão cobra isso | todo cliente novo que pagar no cartão | **P** (decisão) |

---

### A — a folha de login do cartão abre por baixo da tela de pagamento  **[M]**

O pior da lista, e o único que eu chamaria de bloqueador para o dia 15.

Quem acabou de se cadastrar tem cliente **local** e nenhuma sessão (ver F). Ao
tocar em **"Cadastrar novo cartão"**, o app faz a coisa certa — abre o
`#loginModal`, porque cartão salvo pertence a uma conta e a cobrança no cartão
exige Bearer do cliente. **Só que a folha abre debaixo da tela de pagamento, e a
tela não muda.** Sem toast, sem erro, sem navegação: a foto depois do toque é
idêntica à de antes.

Medido em 390×844:

```
#paymentMethodModal   z-index 280      <- por cima
#loginModal           z-index 200      <- a folha que o app quis mostrar
#cartModal            z-index 200

botão "Entrar" da folha:  x=18 y=417 354x45   (meio da tela)
document.elementFromPoint(centro do botão) -> DIV.payment-method-content
```

**Por que nenhum portão pegou:** a asserção natural é `toHaveClass(/active/)`, e
ela **passa** — o `#loginModal` REALMENTE recebe `active`, com `display:flex` e
`opacity:1`. Classe não é visibilidade quando há z-index no meio. Quem pega é
`elementFromPoint`, que é a única pergunta que o dedo do cliente faz.

É a família da §12.14 (`[hidden]` perdendo para o CSS) com o sinal trocado: lá o
DOM dizia escondido e o olho via; aqui o DOM diz aberto e o olho não vê.

Guarda já no repositório, marcada `test.fail()` de propósito:
`tests/e2e/percurso-completo.spec.js`, último teste. **No dia em que a camada
for corrigida ele fica vermelho dizendo "passou mas era esperado que falhasse"**
— e esse é o sinal para tirar o `test.fail()`.

### B — as duas telas de erro ficam numa coluna de 60 px  **[P]**

`styles/assistant.css:325` trava a caixa do loader:

```css
.app-loader-box {
  width: 60px !important;  min-width: 60px !important;
  height: 13.333px !important;  min-height: 13.333px !important;
}
```

Isso está **certo para o boot**: ali a caixa segura só os três pontinhos
(60 × 13,333). O problema é que o estado de ERRO reusa a MESMA caixa —
`body.app-error` devolve `display:block !important` ao título e à mensagem,
dentro de uma caixa que continua com 60 px de largura.

O resultado, nas duas telas:

- **"Não foi possível carregar"** (falha de rede): título quebrando a cada duas
  palavras, e o botão "Tentar novamente" com o rótulo em duas linhas vazando da
  pílula;
- **"Restaurante não encontrado"** (link errado): oito linhas de texto numa
  coluna estreita no meio de uma tela vazia.

São as duas telas que ninguém abre de propósito e todo cliente com rede ruim vê.
O conserto é um bloco sob `body.app-error` devolvendo a largura de
`restaurant.css:2072` (`min(280px, calc(100vw - 48px))`) e `height:auto` — com
captura dos dois lados, porque mexer em `!important` aqui é mexer na ordem entre
duas folhas (§5.1).

### C — `addressSummary()` escreve a palavra `undefined` na tela  **[P]**

`scripts/pages/restaurant-page.js:3933`:

```js
function addressSummary(a) {
  return a ? `${a.street}, ${a.number} - ${a.neighborhood}` : '';
}
```

Interpolação crua: campo ausente não vira string vazia, vira a **palavra**
`undefined`. Visto na tela de Unidades e Operação: `undefined, 450 - Aldeota`.

E o app **já tem** o montador seguro: `normalizeAddress()`
(`address-service.js:30`) constrói o mesmo resumo com `filter(Boolean)` e ainda
aceita `street_name` como sinônimo de `street`. São dois donos para a mesma
linha de texto — é a §3.1 ("existe UM dono") aplicada a texto em vez de
dinheiro, e o dono errado é o que ganha nos sítios que não normalizam
(`address.summary || addressSummary(address)`, 5 chamadas).

A lista de endereços do perfil, que passa pelo serviço, mostra
`Rua Silva Paulet, 450 - Aldeota` — certo. É só o caminho não normalizado.

### D — o telefone da loja mostra dois números num link que liga para um  **[P]**

O campo do lojista no piloto é `"(85) 3025-3303 / (85) 3025-7808"` — dois
números, como ele digitou. A §16.2 consertou o **href** (o primeiro grupo com
tamanho plausível), mas o **rótulo** continua mostrando os dois. Em Perfil >
Ajuda e em Informações o cliente lê dois números num link só e liga para o
primeiro sem saber qual foi.

Conserto: mostrar o grupo que o link de fato disca, ou renderizar um link por
número. O separador já é conhecido por `contact-link.js`.

### E — o "Ok" de um aviso que não apaga nada é vermelho  **[P, decisão]**

`#addrPickerModal`, ao tentar excluir o endereço ativo: *"Atenção — Não é
possível excluir o endereço que está ativo neste momento."* com um botão **Ok**
em `--state-danger-strong`.

Pela §7 o vermelho é do que **apaga** ou do estado negativo. Aqui o app está
justamente **recusando** apagar, e o Ok não faz nada além de fechar. O botão
herda a cor pela posição (`.addr-delete-yes`, §4.1 — a classe nomeia POSIÇÃO, e
quem dá o papel é a folha de cada tela), então o conserto é por tela, não por
renome.

Registrado como decisão porque dá para argumentar que o vermelho aqui é "atenção"
e não "destruição" — mas então é o único vermelho do app que significa isso.

### F — cadastrar não loga, e só o cartão cobra isso  **[P, decisão]**

`RegisterCustomerResponse` **não tem `access_token`** (o contrato traz
`customer_id, email, message, requires_email_verification` e nada mais), e
`VerifyEmailCodeResponse` só devolve sessão **com ticket do Google**. O próprio
`restaurant-auth-flow.js:737` escreve o desfecho: *"Não vem token: verificação
não loga."*

Na prática, quem se cadastra sai com um cliente **local** e seque para o
checkout. E aí os dois caminhos de pagamento divergem:

- **Pix**: paga normalmente, sem entrar. O `tracking_token` é a porta dele para
  o próprio pedido (§6). Percorrido e verde nas quatro combinações.
- **Cartão**: exige a conta, e pede login — que é correto, mas é um passo que o
  cliente não esperava, logo depois de ele ter acabado de criar a conta e
  digitar um código de seis dígitos.

Não é defeito; é uma regra que hoje ninguém escreveu. Vale decidir se o cadastro
deve emitir sessão (pergunta de backend) ou se a tela deve explicar o passo.

---

## O que foi medido e NÃO é defeito

Vale tanto quanto a lista, porque impede a próxima varredura de gastar a mesma
tarde:

- **Nenhuma mensagem em inglês chega à tela.** 9 candidatos, os 9 são
  `console.warn` com prefixo `[PedeAqui]` — log de desenvolvedor.
  Dinamicamente, os códigos do backend já passam por tabela nominal
  (`coupon-reason.js`, `validation-message.js`, `status_detail`).
- **Nenhuma tela rola na horizontal em 390 px.** O transbordo que existe é
  intencional e vive dentro de `overflow-x` (carrossel do herói, trilho de
  categorias). Uma régua que ignore o ancestral rolável acusa 62 de 63 telas e
  não serve para nada.
- **63 de 63 telas abrem, com ZERO exceção não capturada.**
- **Os `catch` que "só logam" são deliberados e comentados.** A varredura achou
  69; os do caminho do dinheiro (`Pedido criado, mas falhou ao exibir a
  confirmação`, `Falha ao guardar o tracking_token`) são silêncio de propósito —
  o pedido já existe, e um erro de renderização virando mensagem de falha faria
  o cliente pedir de novo.
- **Nenhum botão de rede sem estado de espera.** Os dois candidatos
  (`loadProfPedidos`, `openProfOrderDetails`) têm estado próprio
  (`renderProfPedidosLoading`, e o segundo desenha o resumo antes de enriquecer,
  com guarda de corrida por `requestId`).
- **`infoPaymentType()` não adivinha o contrato.** Ele recebe `method_type`
  primeiro e normaliza; os 7 valores do enum
  (`pix, credit_card, debit_card, cash, voucher, meal_voucher, other`) caem
  todos no rótulo certo.
