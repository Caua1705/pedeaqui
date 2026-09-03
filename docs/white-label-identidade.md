# Identidade do tenant fora da página

O que o cliente final vê **fora** da área de conteúdo — aba do browser, ícone da
tela inicial, preview do link compartilhado — e por que cada decisão é essa.

Dentro da página o app já era white-label: nome, cor, logo e tema vêm da API.
Fora dela não era. Este documento cobre o conserto e o que ficou em aberto.

## O campo do contrato

`GET /restaurants/{slug}/menu` já devolve a marca do restaurante em
`restaurant`, e **nada precisou ser pedido ao backend**:

| campo | exemplo | uso |
| --- | --- | --- |
| `logo_url` | `https://…supabase.co/…/brand/logo.webp` | favicon, apple-touch-icon, ícone do manifest, `og:image` |
| `logo_path` | `junior-da-picanha/brand/logo.webp` | caminho de bucket, **não** é URL — descartado |
| `primary_color` | `#D95C04` | fundo da marca gerada, `theme-color`, `theme_color` do manifest |
| `name` | `Júnior da Picanha` | título da aba, `short_name`, iniciais da marca gerada |
| `description` | `Churrascaria • Picanhas • Executivos` | `og:description`, `meta[name=description]` |

`logo_path` chega junto e é aceito como entrada por conveniência, mas
`remoteLogo()` só deixa passar http(s) absoluto — um caminho relativo cai fora e
o app usa a marca gerada. É o comportamento certo: um caminho de bucket sem host
viraria um ícone quebrado.

## O que vazava

| onde | o que era | por quê importa |
| --- | --- | --- |
| `<link rel="apple-touch-icon">` | fixo em `/assets/icons/pwa/app-192.png`, o mark do Rapidex | no **iOS** é esse link — não o manifest — que vira o ícone da tela inicial; e é ele que o WhatsApp usa de miniatura quando não há `og:image` |
| favicon | **nenhum** `<link rel="icon">` declarado | o browser cai no `/favicon.ico` da origem, que é uma só para todos os tenants: por definição nunca é o do restaurante |
| `manifest.icons` | os três PNGs da plataforma entravam no manifest de todo tenant | quem instalasse o app de uma loja sem logo, ou com a logo fora do ar, ficava com o nosso pin na tela inicial |
| `meta[theme-color]` | `#F36F21` no HTML estático | nossa cor de marca na barra do browser até o JS rodar |
| `initials()` | `name \|\| 'Rapidex'` | todo placeholder sem nome — logo, avatar da sacola, foto de produto — escrevia **"RA"** dentro do app de um restaurante |
| Open Graph | nenhuma tag | não vazava a nossa marca, mas o preview do link não tinha a do restaurante |

O título da aba **já estava certo** (`applyTheme` escrevia `<Nome> — Pedido
Online`); o que estava errado ao lado dele era o ícone.

## A regra

> Nada que a plataforma desenhou pode ser servido como ícone de restaurante,
> em nenhum degrau da degradação.

A cadeia tem dois degraus, e o terceiro — que era o nosso — deixou de existir:

1. **logo cadastrada** (`logo_url`);
2. **marca gerada**: as iniciais do restaurante sobre a cor dele, num SVG montado
   em runtime (`scripts/utils/tenant-identity.js`).

A cor da letra sai de `onBrandColor()`, a mesma guarda de contraste dos botões da
marca — uma loja de marca amarela não ganha letra branca ilegível.

É a mesma convenção que a tela já usava em `.mob-logo-fallback` e
`.cart-rest-avatar`: o app inteiro passa a degradar do mesmo jeito.

### Sem logo cadastrada, o comportamento é

Quadrado na `primary_color` da loja com até duas iniciais do nome. Sem nome
utilizável, o quadrado liso, sem letra — **nunca** uma letra emprestada.

Nota de consistência: se a API não mandar `primary_color`, o fundo cai no laranja
da plataforma, que é a convenção que `brand-theme.js` já aplica em todo o app
("a API não mandou cor"). O que está ali é a **inicial do restaurante**, não o
nosso mark. Trocar essa convenção é uma decisão maior, de todo o tema.

## PWA: dá com manifest estático?

**Dá, e já dava** — a arquitetura de duas camadas do `pwa.js` não mudou. Não é
preciso gerar manifest por slug no servidor, e portanto **o custo é zero**:

- **camada 1 (estática)**: um arquivo, `public/manifest.webmanifest`, com
  `start_url`/`scope` relativos (`"./"`). Servido em
  `/<slug>/manifest.webmanifest` por rewrite, o mesmo arquivo produz escopo por
  tenant. Um arquivo, N escopos.
- **camada 2 (runtime)**: quando `/menu` responde, o manifest é remontado em
  memória com nome, cor e ícones da loja e servido por um `blob:` URL.

O que mudou foi o **conteúdo dos ícones** nas duas camadas:

- a camada 1 **não declara mais ícone nenhum**. Ela serve todos os tenants ao
  mesmo tempo, então qualquer ícone nela é, por definição, o de nenhum
  restaurante. O preço é o browser só oferecer a instalação depois que a camada 2
  entra — que é o comportamento desejado: instalar antes de a marca chegar é
  exatamente o vazamento;
- a camada 2 leva a logo do lojista com `sizes: "any"`, seguida da marca gerada
  em `192x192`, `512x512` e `512x512 maskable`. A marca gerada cumpre os dois
  papéis que eram dos PNGs da plataforma: garante os tamanhos exigidos para a
  instalação e é a reserva de quando a logo remota não carrega.

Se o Chrome preferir a marca gerada à logo na hora de escolher, o cliente vê as
iniciais da loja na cor da loja — continua sendo o restaurante, que é a única
propriedade que precisa valer.

O `type` do ícone passou a sair da **extensão** da URL. Estava fixo em
`image/png` e o piloto cadastrou um `.webp`: o manifest afirmava um tipo que o
arquivo não tem, e o browser descarta ícone cujo `type` declarado ele não
suporta.

Os PNGs em `public/assets/icons/pwa/` e o `tools/generate-pwa-icons.mjs`
continuam no repo — são o mark da plataforma, e a landing pode querê-los. O que
saiu foi a referência a eles no app do consumidor.

## Open Graph: o que dá e o que não dá pelo front

**O crawler do WhatsApp não executa JavaScript.** Ele busca o HTML servido e lê o
que está lá. Como o app é estático na Vercel, nenhuma tag escrita em runtime
chega ao preview de link do WhatsApp, do Facebook ou do Telegram.

O que foi feito, e vale:

- o HTML estático ganhou Open Graph **neutro** (`og:title` = "Pedido Online").
  Não é a marca do restaurante, mas também não é a nossa — e sem o
  `apple-touch-icon` da plataforma, o crawler não tem mais de onde tirar o nosso
  pin como miniatura;
- em runtime, `applyTenantMeta()` **sobrescreve** essas tags com nome, descrição
  e logo da loja. Vale para quem executa JS: o navegador embutido do Instagram e
  do próprio WhatsApp ao **abrir** o link, o Web Share do Chrome, leitores e
  extensões. As tags neutras são adotadas e reescritas no lugar, nunca
  duplicadas — todo consumidor de Open Graph lê a primeira ocorrência.

### O que falta, e o que custa

Preview de link com a cara do restaurante exige **render no servidor**: uma
função de edge na Vercel que resolva o slug, busque `/menu` e injete
`og:title`/`og:image`/`og:description` no HTML antes de responder.

Custo, para decidir:

- a rota `/:slug` deixa de ser arquivo estático e passa a ser invocação de
  função — some o cache de borda puro e entra latência de uma chamada à API
  **no caminho de renderização da página**;
- a página passa a depender da API para servir o primeiro byte. Hoje, com a API
  fora do ar, o casco carrega e o app mostra erro à vista; com SSR, a página não
  responde. Dá para mitigar (timeout curto com fallback ao HTML neutro), mas é
  código novo num caminho crítico;
- custo de invocação por crawl e por visita.

Recomendação: **não fazer agora**. O vazamento — que era a nossa marca aparecendo
— está fechado. O que falta é ganho de marketing (preview bonito no WhatsApp),
não correção de white-label, e ele cobra latência no boot de todo mundo. Vale
como tarefa própria, medida contra quanto tráfego chega por link compartilhado.

### Compartilhar um PRODUTO — frente própria, e é a que vale (anotado 03/09/2026)

Decidido: **não agora**. Fica escrito aqui porque é o caso de uso real por trás
do preview, e porque ele é mais caro do que o preview da loja — não menos.

O que o lojista quer mandar no grupo não é a loja: é *a picanha*, com a foto e o
preço. E o que existe hoje não faz isso:

- **não há URL de produto.** O app é uma página só; produto abre por
  `openProduct(id)` em JS, sem rota, sem `history.pushState`. Compartilhar a
  tela do produto compartilha a tela da LOJA, e quem clica cai no cardápio sem
  saber por que foi chamado;
- **e mesmo que houvesse, o crawler não a leria.** O motivo é o mesmo desta
  seção inteira: o WhatsApp busca o HTML servido e para por aí. Uma rota
  `/:slug/p/:produto` que só o JS entendesse daria preview neutro igual.

Então a frente inteira é: **uma rota que devolva HTML PRONTO por produto**, com
`og:title`, `og:image` e `og:description` daquele item já no corpo servido —
render no servidor, com todo o custo já listado acima (a rota deixa de ser
estática, entra latência de API no primeiro byte, e a página passa a depender da
API para responder).

O que ela acrescenta ao custo do preview da loja:

- **duas chamadas, não uma**: resolver o slug e resolver o produto dentro do
  cardápio daquela filial — e produto é POR FILIAL (`menu?branch_id=`), então a
  URL precisa carregar filial ou escolher uma, o que é decisão de produto;
- **cache com invalidação real**: o preview da loja envelhece devagar (nome,
  logo, cor). O de produto tem PREÇO e DISPONIBILIDADE dentro, e um link
  compartilhado que anuncia um preço velho é pior que um link sem preview;
- **o link precisa de destino de verdade**: quem clica tem de cair no produto
  ABERTO, não na Home. Isso é roteamento no app do cliente — `history` e
  deep-link —, que hoje não existe em lugar nenhum e é o pedaço que não some
  nem com SSR.

O que **não** precisa do backend: os campos já existem em `ProductResponse`
(`name`, `description`, `price`, `image_url`). O que falta é infraestrutura de
rota e de render, não contrato.

## Fora do escopo, mas anotado

- `restaurant.html` traz `Tecnologia de pedidos por Rapidex` no rodapé e no
  perfil. É atribuição deliberada ("powered by"), não vazamento — mas é decisão
  de produto, não técnica, se ela fica.
- `restaurant.html` tem `<span class="cart-rest-avatar">JdP</span>` chumbado no
  markup: as iniciais do restaurante **piloto** num arquivo servido a todos os
  tenants. É sobrescrito no boot e é `aria-hidden`, então não chega ao cliente —
  mas é marca de um tenant em markup compartilhado.

## Onde mexer

| arquivo | papel |
| --- | --- |
| `scripts/utils/tenant-identity.js` | fonte única: iniciais, marca gerada, tipo do ícone, favicon, apple-touch-icon, Open Graph |
| `scripts/utils/pwa.js` | manifest por tenant; consome `tenantIcons()` |
| `restaurant.html` | `<head>` neutro — nunca declarar ícone nem marca aqui |
| `public/manifest.webmanifest` | camada 1, sem ícones |
| `tests/unit/tenant-identity.test.js` | as funções puras |
| `tests/e2e/tenant-identity.spec.js` | o `<head>` real no browser, nos dois casos (com e sem logo) |
