# Rodada noturna — 02/09/2026

**Fonte da verdade desta rodada.** Ao retomar depois de compactação: releia este
arquivo INTEIRO antes de qualquer coisa e continue do que ele diz, nunca da
lembrança.

Branch: `rodada/noturna`. Nunca commitar na `main`. Um commit por item, verde,
com push. Portão sem pipe (`| tail` engole o exit code — §5.1 armadilha 5 e
§11 higiene 3 da skill).

## Regras desta rodada (do prompt)

- O job de **deploy do CI está quebrado de propósito** e vai ficar vermelho.
  Não mexer no `ci.yml`, não tentar consertar. O que importa é o `verify`.
- FORA da rodada: sacola · checkout · `cartTotals` · folha de confirmação ·
  troca de filial · `ci.yml`/deploy · login com Google · voz no app · tela do
  assistente · merge na main.
- PARAR se: número de dinheiro mudar sem motivo conhecido · decisão de produto
  não escrita · mesmo portão vermelho 3× no mesmo item · precisar mexer no
  backend.

## Higiene de medição (§11 da skill)

- Antes de medir E2E: matar node órfão de `vite preview`/playwright e conferir a
  porta **4174** livre. `reuseExistingServer` faz o Playwright reaproveitar um
  `preview` velho e **nunca reconstruir** — o sintoma é experimento que não
  reprova o que deveria.
- NÃO editar spec no meio de um lote.
- Distribuição decide se a execução presta: contar testes acima de 10 s.

---

## Estado dos itens

| item | assunto | estado |
|---|---|---|
| 0 | scratchpad + branch | **feito** |
| 1 | os 8 escapes pendentes | em curso |
| 2 | `pix-payment:116` | não começou |
| 3 | testes dependentes da hora | não começou |
| 4 | chips chumbados `restaurant.html:462-470` | não começou |
| 5 | fluxo de cupons | não começou |

---

## Item 1 — os 8 escapes herdados

Lista de partida (de `rodada-sacola.md` §6, que já fechou o antigo #4):

| # | escape | herdado de | estado ao entrar |
|---|---|---|---|
| 1 | `auth-screen-nav.spec.js:105` | checkout | nomeado, nunca reproduzido |
| 2 | `order-flow.spec.js:163` | checkout | caiu 1× dentro de travamento de máquina |
| 3 | `pix-payment.spec.js:116` | checkout | `307,6` sem explicação → **é o item 2 desta rodada** |
| 5 | `restaurant-club.js:146` precedência latente | checkout | inofensivo hoje, inverte quando o backend publicar |
| 6 | `address-service.js:25` precedência DE PROPÓSITO | checkout | documentado |
| 7 | `menu-service.js:181,193` cadeias fantasma | checkout | inofensivas |
| 8 | `provider_error_code` existe e ninguém lê | checkout | melhoria da tela de recusa |
| 9 | `assistant-voice-session.spec.js:472` | sacola | teto de 8 s com preparo de 25 s |

(Numeração preservada de propósito — o antigo #4 fechou na rodada da sacola.)

_(análise item a item abaixo, à medida que sai)_
