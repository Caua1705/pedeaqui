# Os escapes pendentes e o flake `pix-payment:116` — rodada de 05/09/2026

Entraram **8**, saíram **6**. Dois fechados com teste visto vermelho; os quatro
que sobram são flakes nunca reproduzidos, e o motivo de não terem sido tocados
está escrito em cada um.

## Fechados

### `#profPasswordScreen` deixava a sobreposição armada — e eram DUAS telas

O escape nomeava uma. A sonda achou duas: `#profDataScreen` ("Meus dados") vaza
junto com o `.prof-data-backdrop` dele. E elas **acumulam** — abrindo "Meus
dados" e "Alterar senha" em rodadas seguidas de sair-e-voltar, as duas voltam
ativas, uma por cima da outra:

    [{profDataBackdrop, ativo}, {profDataScreen, ativo}, {profPasswordScreen, ativo}]

Corrigido em `openProfSub('meusdados')`, cada uma fechando pela porta dela (a de
senha recusa fechar no meio de um envio; as outras devolvem o foco — uma
varredura genérica de `.active` pularia as duas coisas). Quem guarda a QUINTA
sobreposição é o teste, que é genérico de propósito e varre por forma.

Guarda: `tests/e2e/profile-overlay-reset.spec.js`.

### `provider_error_code` não chegava à tela

São dois códigos: `code` é `PaymentErrorCode`, nosso, sete valores fechados;
`provider_error_code` é do catálogo do gateway (`2062`, `bad_request`). A tela
de recusa mostrava só o nosso — o cliente que liga para o Mercado Pago citava um
código do vocabulário daqui.

Guarda: dois unitários em `api-error.test.js` e um E2E em `pix-payment.spec.js`.

No mesmo lugar, duas coisas velhas que mentiam para quem lia: o comentário do
bloco afirmava que o schema **não** estava no OpenAPI (está — `PaymentErrorResponse`
em 400, 401, 502 e 503), e o fixture respondia **402**, que não é nenhum dos
quatro. Os dois corrigidos.

## O flake `pix-payment:116` — o que se descobriu, e por que não foi consertado

O mecanismo já estava provado: `offset = (larguraDoPainel − 374) / 2`, e o
307,59375 do vermelho de 31/08 exige um painel de **989,1875 px**, reproduzido
injetando `max-width:989.2px`. O gatilho — por que o painel ficaria assim —
continua aberto.

**Duas hipóteses novas foram testadas e as DUAS reprovaram.** Ficam escritas
porque hipótese reprovada é o que impede a próxima pessoa de gastar a mesma
tarde:

| hipótese | como foi medida | veredito |
|---|---|---|
| a folha ainda não tinha aplicado (a família da §17.10, que neste repositório é real) | `.overlay{display:flex}` e `#pixPaymentModal .modal{max-width:414px}` estão no **mesmo** arquivo do bundle (`restaurant-*.css`, 485 kB) | **reprovada** — não há janela em que uma valha e a outra não |
| o painel mediu pelo CONTEÚDO (ele é flex item, e o código Pix é longo) | `max-width:none;width:auto` → **414**; só `max-width:none` → **1280** (offset 453, o número que a §11 já conhecia) | **reprovada** — nenhum dos dois é 989,19 |

**E não reproduziu.** 6 execuções isoladas a 4 workers, mais 207 numa corrida de
cinco arquivos com `--repeat-each=3` a 4 workers — execução limpa pela régua da
§11 (2 testes acima de 10 s). Com as 20 de 02/09, são **233 execuções sem uma
recorrência** desde que a instrumentação entrou.

**Não foi forçado conserto**, e a razão é a regra 3: consertar um teste que não
se viu falhar troca um defeito conhecido por um desconhecido. O que o teste tem
hoje — a largura do rodapé afirmada ANTES do offset — faz a próxima recorrência
dizer `expected 414, received 989.2` em vez de um número sem dono.

## Os quatro que ficam abertos, e por quê

| escape | por que fica |
|---|---|
| `auth-screen-nav.spec.js:105` | nunca reproduzido. Passou nas 207 desta rodada. A hipótese escrita (leitura única de geometria logo depois do slide) continua sem vermelho que a prove |
| `order-flow.spec.js:163` | idem, e é guardião da Idempotency-Key reaproveitada na retentativa — que é dinheiro. Mexer nele às cegas é mexer no único teste que prova que um retry não duplica pedido |
| `profile-order-tracking.spec.js:403` | a hipótese da §13.2 (fração contra inteiro; fonte chegando no meio) foi **desmentida** por medida em 03/09: `rect.height` é 222 exato e `document.fonts.status` já é `loaded`. Sem hipótese e sem vermelho |
| `assistant-voice-session.spec.js:472` | números medidos (teto de inatividade de 8 s contra preparo com direito a 25 s). Não reproduzido |

`tenant-theme:244` saiu da lista: passou 3× nas 207 desta rodada, e o buraco
histórico dele (boot que falha deixando a página na cor da plataforma) está
fechado por `esperarAppPronto` + `freezeTransitions` desde 03/09.
