# Login com Google — verificação contra PRODUÇÃO (05/09/2026)

Feita em `www.pederapidex.com/junior-da-picanha` e `api.pederapidex.com`, com o
navegador de verdade e com `curl`. O que segue é etapa por etapa, com o que
passou, o que não passou e o que **não deu para verificar** — que é a parte que
importa mais, porque é onde alguém vai supor que passou.

## O que PASSOU

| etapa | como foi medido | resultado |
|---|---|---|
| **client id chega ao bundle** | `window.APP_CONFIG.GOOGLE_CLIENT_ID` na página servida | presente, `745490334962-…apps.googleusercontent.com` |
| **o serviço se liga** | `PedeAquiGoogleIdentity.isEnabled()` | `true` |
| **o SDK baixa** | `accounts.google.com/gsi/client` na rede | **200** |
| **a ORIGEM está cadastrada** | o botão renderizou **personalizado** ("Continuar como *nome* / *e-mail*") | ✔ — origem não cadastrada não renderiza botão nenhum e loga erro de origem; esta é a prova mais forte que existe sem completar o login |
| **`POST /auth/google` existe e valida** | `curl` com `id_token` inválido | **401** `{"detail":"Credenciais inválidas"}` em 215 ms — frase de cliente, não código |
| **`POST /auth/google/nonce`** | `curl` | **200**, com `nonce` e `nonce_token` |
| **`POST /auth/google/complete-signup`** | `curl` com ticket inválido | **400** `{"detail":"Esta confirmação não vale mais. Entre com Google novamente."}` |
| **CSP libera o Google** | `curl -I` na página de produção | `script-src`, `frame-src`, `connect-src` ✔ |

## O que FALHOU, e já está corrigido

**`style-src` recusava `https://accounts.google.com/gsi/style`** — em toda
abertura da tela de login, desde que o login social subiu. O `gsi/client`
injeta essa folha para o botão, e o navegador a negava em silêncio.

Passou pelas três diretivas da skill §18.6 porque elas foram escolhidas
olhando para *"o botão apareceu?"*, e este bloqueio não muda essa resposta: o
botão é um iframe e leva o estilo dele dentro.

**"Corrigido" aqui era falso, e ficou falso por um dia inteiro — 06/09/2026.**
A diretiva entrou na `vercel.json`, o `google-identity.test.js` passou a
exigi-la, o `npm test` ficou verde e esta linha foi escrita. **A produção
continuou servindo o header antigo**, recusando o `gsi/style` em toda visita,
porque o commit nunca tinha sido empurrado — a `main` local estava 22 commits à
frente da `origin/main`, e a `main` não publica sozinha (`deploy-gate.test.js`:
quem publica é o CI).

Nenhum teste daqui podia ter pego: **todos leem a `vercel.json` do disco, e o
arquivo do disco não é o header que o navegador recebe.** Entre um e outro há um
push, um CI, um `vercel deploy` e um alias de domínio. Quem fecha esse vão agora
é `tools/csp-em-producao.mjs`, chamado pelo `ci.yml` **depois** de publicar
(`npm run csp:prod` para rodar à mão) — ele pede o header à produção e compara
diretiva por diretiva. Escrever "corrigido" a partir de um teste verde continua
sendo o erro; a prova é o header servido.

**E o que a correção NÃO promete:** este bloqueio é silencioso — o botão
renderiza mesmo com ele. Se a trava na tela de escolha de conta persistir depois
do deploy, ela é outro defeito, e a correção do `style-src` não é candidata.

Registrado e **não** corrigido, porque não é nosso:
`static.cloudflareinsights.com/beacon.min.js` também é bloqueado por
`script-src`, em toda visita. É o beacon do Cloudflare, injetado pelo proxy do
domínio — nenhum código nosso pede por ele, e o efeito é que o Web Analytics
não coleta nada. Liberar `script-src` para um analytics de terceiro é decisão
de quem cuida do domínio.

## O que NÃO deu para verificar, e por quê

**As etapas que exigem uma credencial de verdade.** São três, e as três param
no mesmo lugar:

- `id_token` emitido pelo Google;
- o desfecho `profile_required` (conta nova pedindo telefone e nascimento);
- o desfecho `link_confirmation_required` (e-mail que já tem conta aqui).

O botão personalizado abre a janela de escolha de conta do Google **fora do
grupo de abas** que a automação alcança, e completar aquele passo é entrar numa
conta real. Não é limitação de ferramenta que se contorne: é um passo de
credencial, e ele é de quem é dono da conta.

**Como fechar essas três em cinco minutos, e o que anotar:** abra a tela de
login em produção com o DevTools na aba Network, filtro `auth/google`, toque no
botão e escolha a conta. O `status` do corpo da resposta diz qual dos três
caminhos você caiu:

| `status` da resposta | significa | a tela deve |
|---|---|---|
| `authenticated` | o `sub` já é conhecido | entrar direto |
| `profile_required` | e-mail sem conta | abrir o formulário de telefone + nascimento |
| `link_confirmation_required` | e-mail JÁ tem conta aqui | pedir o **código de 6 dígitos** do e-mail — e **ninguém foi logado ainda** |

O terceiro é o que se erra: ele parece login e não é. Quem chegou provou ter o
mesmo endereço de e-mail no Google, não ser o dono da conta daqui.

## WEBVIEW — o que foi medido, e o risco que continua aberto

O pedido era testar o navegador embutido, "por onde o cliente chega, pelo link
da bio e do WhatsApp".

**Medido** contra produção, com três user agents (Chrome Android normal,
Instagram in-app, e WebView puro `…; wv…`):

| UA | SDK | botão | altura |
|---|---|---|---|
| Chrome Android | 200 | iframe renderizado | 44 px |
| Instagram in-app | 200 | iframe renderizado | 44 px |
| WebView puro (`wv`) | 200 | iframe renderizado | 44 px |

Ou seja: **o botão aparece nos três.** Nenhum erro nosso na tela.

**O que isso NÃO prova, e é justamente o risco:** o Google restringe login em
navegador embutido no passo da CREDENCIAL, não no da renderização. Trocar o
user agent não reproduz um webview de verdade — não há popup real, não há o
cookie jar do Instagram, não há a decisão do Google sobre aquele ambiente.

E o app **não tem detecção nem alternativa** para esse caso: varrido o
`scripts/` inteiro, não existe nenhum tratamento de webview no caminho do
Google (há para clipboard e para o SDK do Mercado Pago, e só). Se o Google
recusar ali, o cliente que veio da bio toca no botão e não acontece nada —
a mesma figura do botão de voz que levava a um muro sem avisar.

**NÃO foi construído um detector**, de propósito: seria construir sobre uma
premissa não medida, que é o erro que a §12.6 registra. O que fecha isso é uma
sonda de dois minutos com um aparelho de verdade:

> Abra `https://www.pederapidex.com/junior-da-picanha` **pelo link da bio do
> Instagram** (não pelo "abrir no navegador"), vá em Entrar, toque no botão do
> Google e diga o que acontece: (a) entrou, (b) abriu a tela do Google e voltou,
> (c) nada aconteceu, (d) apareceu uma mensagem do Google.

Com a resposta na mão o caminho é curto: se for (c) ou (d), o botão vira um
aviso ("abra no navegador para entrar com o Google") mais o caminho de e-mail e
senha em destaque — e aí sim com teste, porque haverá o que reproduzir.
