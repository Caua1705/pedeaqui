# Rodada da sacola e do checkout — FONTE DA VERDADE (rodada/sacola)

Sessão iniciada 01/09/2026. Branch `rodada/sacola`, a partir de `89ed3a1`
(`rodada/checkout`). NUNCA commitar na `main`.

Antecessores lidos antes de mover: `CLAUDE.md`, a skill `pedeaqui-front`
inteira, `scratchpad/rodada-front.md` e `scratchpad/rodada-checkout.md` — em
especial os 8 escapes pendentes, os 4 testes de dinheiro
(`tests/e2e/cart-money-chain.spec.js`) e a recusa por medida das quatro
variáveis de pagamento.

## Regras desta rodada (do prompt)

- Um commit por item, verde, com push. Este arquivo atualizado no MESMO commit.
- **Portão lido SEM pipe.** `| tail` engole a linha do erro e já mentiu 4 vezes.
- **Antes de medir E2E:** matar node órfão e conferir a porta 4174 livre.
- **REGRA DE DINHEIRO (seção 3):** nenhum commit de movimento pode mudar um
  valor que o cliente vê ou paga. Número que muda = defeito achado = commit
  SEPARADO, com teste próprio. Nunca mover e corrigir no mesmo commit.
- Parar se: um número de dinheiro mudar sem motivo conhecido · escapes > 8 ·
  o mesmo portão vermelho 3x no mesmo item · precisar mexer no backend.

## Ordem de execução e status

Legenda: [ ] pendente · [~] em andamento · [x] feito+commitado+push · [!] bloqueado

### Item 1 — o desconto que some (INDEPENDENTE, PRIMEIRO)
- [~] 1.0 leitura e cálculo: era defeito ou texto?

### Item 2 — o falsy legítimo (a régua tinha um buraco)
- [ ] 2.1 varredura de `||` / `??` / ternário sobre valor da API
- [ ] 2.2 correção dos que mudam comportamento alcançável, com teste

### Item 3 — sacola e checkout
- [ ] 3.1 ampliar a rede do dinheiro (cupom %, cupom fixo, taxa de serviço,
      pedido mínimo, e a combinação de todos)
- [ ] 3.2 documentar as 4 variáveis de pagamento e os 5 blocos que escrevem
- [ ] 3.3 migração por `mount(ctx)`, do mais isolado ao mais entrelaçado
- [ ] 3.4 folha de confirmação: migrar ou recusar por medida
- [ ] 3.5 troca de filial: a ÚLTIMA

## Estado inicial medido

`scripts/pages/restaurant-page.js`: **5.628 linhas**.
