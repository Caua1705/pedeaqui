# pedeaqui_front

Front white-label de pedidos (Rapidex/PedeAqui). Duas páginas: `index.html`
(landing) e `restaurant.html` (o app inteiro).

## As três regras

**1. O front não calcula dinheiro.** O backend é a fonte de verdade de subtotal,
desconto, cashback e total. O payload de pedido leva **só inputs** — valores nem
existem no schema. O total pós-cupom vem pronto, no campo `total_after_coupon`.
Existe **um** dono do total: `cartTotals()` (`scripts/pages/restaurant-page.js`).
Somar preço fora dele é bug.

**2. Contrato é lido, não lembrado.** Antes de ler um campo da API, ache-o em
`scripts/types/api.d.ts` (gerado por `npm run api:generate`; não edite à mão).
Campo renomeado é a falha mais silenciosa daqui — já houve campo procurado por
anos que nunca existiu na API, lendo `undefined` e caindo no fallback sem acusar
nada.

**3. Teste que você não viu falhar não vale nada.** Reverta a correção, veja o
teste falhar, e confira **por que** ele falhou — já houve teste passando pelo
motivo errado. Um E2E verde não prova que uma rota existe: o mock devolve 200
para qualquer rota que o app invente.

## Não leia o `restaurant-page.js` inteiro

São ~7.200 linhas. Ache a função (`grep -n "function nomeDaCoisa"`) e leia a
vizinhança — ela pode estar num dos três módulos que saíram dele em 29/08/2026:
`restaurant-address-flow.js`, `restaurant-pix-flow.js` e `restaurant-auth-flow.js`.
Os comentários longos são histórico de defeito real — leia-os antes de
"simplificar".

Os três recebem o que precisam por `init(deps)`. **O que muda de valor vai por
acessor, não por valor**: uma cópia vira uma fotografia do boot, e o módulo passa
a decidir com dado velho sem acusar nada. A skill tem o idioma e as quatro
armadilhas do corte — inclusive a que derrubou o app no boot com lint, typecheck
e unitários verdes.

## Antes de mexer

Leia a skill **`pedeaqui-front`** (`.claude/skills/pedeaqui-front/SKILL.md`):
o mapa de onde mora cada coisa e as armadilhas comprovadas — o catch-all 200 do
mock, o fixture de filial sem cartão online, o SDK definido antes do boot, o
mock que aceita qualquer coisa, o cupom que grudava ao ser aberto, o 200 com
`valid: false`, a troca de filial que apagava a sacola guardada. Cada uma custou
um defeito em produção ou chegou perto.
