# Chips de forma de pagamento chumbados no markup (restaurant.html, #profSubpagamento)

**Registrado em 31/08/2026, na rodada completa do front. Decisão da rodada:
registrar, NÃO consertar agora.**

## O quê

`restaurant.html` (região do `#profSubpagamento`, ~linhas 458–472) traz seis
chips de forma de pagamento escritos no HTML:

Pix · Cartão de crédito · Cartão de débito · Vale-refeição ·
Vale-alimentação · Dinheiro

É o markup de UM tenant (o piloto) servindo de esqueleto para todos.

## Por que hoje não é um defeito visível

`renderProfilePaymentScreen()` (restaurant-page.js) SOBRESCREVE esse bloco com
os métodos reais do `/info` (`branch_payment_methods`) assim que a resposta
chega. Os chips chumbados só aparecem:

- no intervalo entre abrir a subtela e o `/info` responder (flash), e
- se o `/info` falhar (o erro também re-renderiza, mas há caminhos de corrida).

## Por que é bug esperando acontecer

1. **White-label**: um restaurante que só aceita Pix mostra, por um flash (ou
   numa falha de rede), seis formas que ele não aceita — a mesma classe do
   defeito "todo restaurante nascia laranja do piloto" (skill §7).
2. A frase acima dos chips ("O pagamento é realizado diretamente no
   estabelecimento...") também é do tenant piloto e também é sobrescrita —
   mesmo problema.

## O conserto (quando for feito)

Esqueleto NEUTRO no markup (placeholder "Carregando formas de pagamento...",
como o `#profSubinfo` já faz), e os chips só nascem do dado do `/info`.
É mexer em markup + no estado de carregamento da subtela de pagamento do
Perfil — hoje renderizada por `renderProfilePaymentScreen()` no
restaurant-page e pelos chips compartilhados `profilePaymentChips()`.

## Referências

- `restaurant.html` — bloco `#profSubpagamento`.
- `renderProfilePaymentScreen()` / `profilePaymentChips()` em
  `scripts/pages/restaurant-page.js`.
- Skill §7 (white-label: nada do piloto pode ser o padrão de todos).
