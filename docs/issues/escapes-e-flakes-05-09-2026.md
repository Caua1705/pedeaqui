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

---

# Segunda rodada, 05/09/2026 (tarde): os seis, sob CONDIÇÃO ADVERSA

O pedido foi atacar os seis que sobraram e, no `pix-payment`, tentar uma última
vez em condição adversa — CPU limitada, rede lenta, execução paralela — e fechar
como documentado se não reproduzisse.

## O que foi montado

`mockApi()` ganhou instrumentação temporária por variável de ambiente (removida
antes do commit; a cópia intacta foi para o scratchpad ANTES de injetar, §12.15):
CDP `Emulation.setCPUThrottlingRate` e `Network.emulateNetworkConditions`. Ela
entra em `mockApi()` porque os seis specs passam por lá — é o ponto único.

## O resultado, e por que ele precisou de DOIS BRAÇOS

**Braço A — 4 workers, CPU 4×, rede a 400 kbps com 200 ms de latência**, os 6
arquivos com `--repeat-each=3` = **279 execuções**, 20,2 min:

    11 falhas, TODAS em pix-payment.spec.js, agrupadas na tela de cobrança
    (linhas 517–806). Máxima: 57,8 s. 24 testes acima de 28 s.

Onze falhas num arquivo só parece achado. **Não é**, e o segundo braço é o que
mostra isso.

**Braço B — 1 worker, o MESMO estrangulamento de CPU 4×, sem rede lenta**,
`pix-payment.spec.js` inteiro, 4,9 min:

    24 de 24 verdes. Máxima 35,5 s, e apenas 10 testes acima de 10 s.

Os mesmos testes que caíram no braço A (`:517`, `:549`, `:768`, `:806`) passam
em **7–9 s** no braço B. A variável que mudou não foi a CPU: foi a CONTENÇÃO.

E houve um braço intermediário que teve de ser **descartado** — CPU 4× com 4
workers e sem rede lenta produziu 22 falhas com durações de **1,2 a 1,5 minuto**.
Pela taxonomia da §11 isso é **família C, máquina parada: não é medição**, e
tratá-lo como bug de teste teria produzido correções contra fantasmas.

**Conclusão: as 11 falhas do braço A são contenção, não corrida do app.** A régua
da §11 (contar testes acima de 10 s) diz a mesma coisa por outro caminho: 189 de
279 no braço A contra 10 de 24 no braço B.

## Os seis, um a um

| escape | veredito |
|---|---|
| `pix-payment:116` (hoje `:137`) | **FECHADO como documentado.** Passou 3/3 no braço A, em 13,5–14,2 s. Com as 233 anteriores são **236 execuções sem uma recorrência** — agora incluindo condição adversa de verdade. Não foi tocado |
| `auth-screen-nav:105` | passou 3/3 sob carga. Não reproduzido |
| `order-flow:163` | passou 3/3 sob carga. Não reproduzido |
| `profile-order-tracking:403` | passou 3/3 sob carga. Não reproduzido; a hipótese da §13.2 já estava desmentida por medida em 03/09 |
| `assistant-voice-session:472` | passou 3/3 sob carga. Não reproduzido |
| `tenant-theme:244` | passou 3/3 sob carga. Confirma a saída da lista em 05/09 |

**Nenhum foi consertado, e a razão é a regra 3**: mexer num teste que não se viu
falhar troca um defeito conhecido por um desconhecido.

## O que NÃO foi feito, e por quê

`auth-screen-nav` tem, escrita, a assinatura exata da §13.4 — uma margem numérica
(`Math.abs(after.y - before.y) <= 1`) guardando um fato BINÁRIO que a linha
`expect(before?.y).toBe(0)`, duas linhas acima, já prova sem número nenhum. É o
mesmo padrão que reprovou o CI em 03/09 e que a §13.4 manda procurar no resto da
suíte.

Apertar aquela margem para zero seria, provavelmente, a correção certa. **Não foi
feita nesta rodada porque o teste não foi visto falhar** — nem sob 4 workers com
CPU estrangulada e rede de 400 kbps. Apertar uma margem sem um vermelho na mão é
adivinhar em qual direção ela estava errada. Fica escrito aqui para quem tiver o
vermelho: o fato já está provado duas linhas acima, e a tolerância só pode
esconder a próxima regressão.

**Escapes: 6 na entrada, 5 na saída** — sai o `pix-payment:116`, fechado como
documentado por 236 execuções sem recorrência.
