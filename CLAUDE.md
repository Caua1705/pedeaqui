# pedeaqui_front

Front white-label de pedidos (Rapidex/PedeAqui). Duas páginas: `index.html`
(landing) e `restaurant.html` (o app inteiro).

## As três regras

**1. O front não calcula dinheiro.** O backend é a fonte de verdade de subtotal,
desconto, cashback e total. O payload de pedido leva **só inputs** — valores nem
existem no schema. O total pós-cupom vem pronto, no campo `total_after_coupon`.
Existe **um** dono do total: `cartTotals()` (`scripts/pages/restaurant-page.js`).
Somar preço fora dele é bug.

E **toda parcela do total tem LINHA na sacola** — subtotal, taxa de serviço,
taxa de entrega, desconto, total. Parcela sem linha é dinheiro sumindo: o
cliente com cupom lia `68,60 + 0,99 + 7,40` e um total de `69,13`, R$ 7,86 sem
explicação, até 01/09/2026. Parcela zerada é linha FORA, nunca um "R$ 0,00"
solto. A rede que trava a conta inteira é `tests/e2e/cart-money-chain.spec.js`
(13 testes); **antes de mexer em qualquer número da sacola, rode-a.**

**EM ABERTO, e é a pergunta mais cara aqui:** o front não envia `service_fee` no
`/coupons/preview` e não pode (`additionalProperties: false`), mas `cartTotals()`
troca o total INTEIRO pelo `total_after_coupon`. Se o backend orça só as duas
parcelas que recebeu, aplicar um cupom apaga a taxa de serviço do total. **Não
mude o número por aposta** — a §3.1 da skill tem as duas leituras e a assinatura
de log que resolve a dúvida em produção.

**2. Contrato é lido, não lembrado.** Antes de ler um campo da API, ache-o em
`scripts/types/api.d.ts` (gerado por `npm run api:generate`; não edite à mão).
Campo renomeado é a falha mais silenciosa daqui — já houve campo procurado por
anos que nunca existiu na API, lendo `undefined` e caindo no fallback sem acusar
nada.

**3. Teste que você não viu falhar não vale nada.** Reverta a correção, veja o
teste falhar, e confira **por que** ele falhou — já houve teste passando pelo
motivo errado. O mock respondia **200 com `{}`** a qualquer rota que o app
inventasse, e por isso um E2E verde não dizia nada sobre a rota existir; hoje
ele responde **404 e anota o endereço**, e `boot-smoke.spec.js` cobra a lista
vazia. Quem prova que a rota existe no contrato continua sendo
`api-contract.test.js`.

**Nenhum dos três portões rápidos executa o app.** `lint` lê a árvore sintática,
`typecheck:cards` confere quatro arquivos do cartão, e os unitários rodam em
`node` sem DOM. Uma linha no lugar errado já derrubou o app inteiro no boot com
os três verdes. Quem roda o app é o `test:e2e` — e, desde então,
`tests/unit/page-modules.test.js` (milissegundos) e `tests/e2e/boot-smoke.spec.js`
(11 s), que existem para dar a frase certa em vez de 200 timeouts.

## Não leia o `restaurant-page.js` inteiro

São ~7.185 linhas. Ache a função (`grep -n "function nomeDaCoisa"`) e leia a
vizinhança — ela pode estar num dos três módulos que saíram dele em 29/08/2026:
`restaurant-address-flow.js`, `restaurant-pix-flow.js` e `restaurant-auth-flow.js`.
Os comentários longos são histórico de defeito real — leia-os antes de
"simplificar".

Não procure o próximo corte sem medir: em 30/08/2026 os sete blocos restantes
foram medidos pela mesma conta que reprovou operação/filial, e o melhor deles
(histórico de pedidos do perfil, 571 linhas / 64 fios) é mais denso em fios que
a folha do cupom já recusada. A tabela está na skill, e a medida é
`node tools/fios-do-corte.mjs`.

Os três recebem o que precisam por `init(deps)`. **O que muda de valor vai por
acessor, não por valor**: uma cópia vira uma fotografia do boot, e o módulo passa
a decidir com dado velho sem acusar nada. A skill tem o idioma e as quatro
armadilhas do corte — inclusive a que derrubou o app no boot com lint, typecheck
e unitários verdes.

## Se você vai mexer em CSS

São ~18.700 linhas em 20 folhas (19 no `restaurant.html`), e o nome dos arquivos
mente: `utilities.css` não é folha de utilitários (de 1.280 regras, **uma**
começava com `.u-`) e não carrega por último. Leia o cabeçalho dela antes de
mover qualquer coisa: das 1.055 regras que sobraram nela, **1.006 disputam
ordem** com outra folha, e "levar para a folha certa" inverte quem vence. As
211 que não disputavam já saíram (`store-info.css`, `club.css`, `policy.css`,
em 30/08/2026) — esse era o critério, e ele se esgotou.

Três ferramentas respondem por medida o que não dá para responder lendo:

| Pergunta | Ferramenta |
|---|---|
| Esta regra pode pintar alguma coisa? | `node tools/css-usage.mjs [--runtime]` |
| Este `!important` está vencendo alguém? | `node tools/css-important.mjs` |
| Quantos cabeçalhos/botões DIFERENTES existem? | `node tools/ui-inventory.mjs` |

E, fora do CSS, duas que respondem por medida o que dá para errar lendo:
`node tools/fios-do-corte.mjs` (vale a pena extrair este bloco?) e
`node tools/falsy-do-contrato.mjs` (onde um `0` ou um `false` legítimo do
contrato pode ser engolido por um fallback?). Nenhuma das duas julga sozinha.

**Nenhuma das três julga morte por conta própria.** `css-usage` só autoriza
apagar pela metade **estática** (o nome não existe no APP), e o corpus dela
exclui `tests/` e `tools/` de propósito: um spec que exige
`toHaveCount(0)` NOMEIA a classe, e num corpus único ela se provava viva com a
prova ao contrário na mão. `css-important` tem três vetos — runtime, token
estático e **um teste que exige o texto da regra** (o adversário nem sempre
está no CSS).

E a prova de que nada mudou continua sendo `node tools/capture-screens.mjs`
(antes, depois, `--diff`), hoje com **58 telas** e **69 propriedades** — não
todas. Antes de citar um "Nenhuma diferença" como prova, confira se a
propriedade que você mexeu está em `PROPS`: ela já leu `borderTopColor` sem as
outras três e assinou embaixo de uma troca de divisória em 239 elementos, e em
30/08/2026 quase assinou de novo embaixo de `inset`, `background-image`,
`cursor` e `-webkit-text-fill-color`. A lista é para crescer.

Ela pegou os dois erros de uma limpeza anterior — uma junção de blocos que
trocou a fonte de 934 elementos, e um `!important` removido que abriu 36px na
barra de baixo. Nas duas vezes o erro estava na ferramenta de análise, não no
CSS: **comentário colado na declaração** fazia o nome da propriedade chegar com
o comentário inteiro grudado na frente, e um nome assim não casa com família
nenhuma. Neste repositório o comentário colado na declaração é a regra, não a
exceção — quem lê CSS aqui tira comentário antes.

E ela mente quando a tela sorteia: o balão de "pensando" do assistente escolhe
a frase com `Math.random`, e cada frase tem uma largura. Duas capturas seguidas
disseram "Nenhuma diferença" antes de a terceira acusar 4 elementos sem que uma
linha de CSS tivesse mudado. Ruído que às vezes some é pior que ruído
constante: dá para acreditar nele.

## Antes de mexer

Leia a skill **`pedeaqui-front`** (`.claude/skills/pedeaqui-front/SKILL.md`):
o mapa de onde mora cada coisa e as armadilhas comprovadas — o catch-all do
mock, o fixture de filial sem cartão online, o SDK definido antes do boot, o
mock que aceita qualquer coisa, o cupom que grudava ao ser aberto, o 200 com
`valid: false`, a troca de filial que apagava a sacola guardada. Cada uma custou
um defeito em produção ou chegou perto.
