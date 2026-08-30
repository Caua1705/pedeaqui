# Rodada completa do front — FONTE DA VERDADE

Regras da rodada (do prompt do usuário, resumidas):
- Branch `rodada/front-completo`. NUNCA commitar na main. Um commit por item,
  verde, com push. Portão vermelho: conserta ou reverte antes do próximo item.
- Atualizar ESTE arquivo depois de CADA item, no mesmo commit.
- Ao retomar sessão: RELER este arquivo antes de qualquer coisa. Se ele e a
  memória discordarem, ELE está certo.
- Não perguntar nada ao usuário. Decisão faltante: anotar e seguir.
- Parar só se: mesmo portão vermelho 3x no mesmo item · item exige backend ·
  decisão de produto não escrita · escapes pendentes > 8.
- Fora da rodada: login Google, fluxo novo de cupons no checkout, backend, merge.

Portões (cada um numa chamada própria, ler a saída — lição da skill):
`npm run lint` · `npm run typecheck:cards` · `npm run test` · `npm run test:e2e`
Flakes conhecidos E2E: assistant-voice-session:294 e :437, pix-payment:116
(rodar isolado antes de arquivar como flake).
E2E vermelhos HERDADOS (item 4.3 conserta): order-flow:42, pix-payment:576, :736.

## Ordem de execução e status

Legenda: [ ] pendente · [~] em andamento · [x] feito+commitado+push · [!] bloqueado

### Fase 1 — enxergar antes de mexer
- [x] 1.1 helpers.js:177 `/customers/me*` → mock espelha o backend: SEM
      Authorization → 401 (guest continua guest); COM → fixtures do contrato
      (CUSTOMER, ORDERS, orderDetail(), addresses [], cashback, cards []);
      subrota desconhecida → catch-all 404 + rotasDesconhecidas. Specs que
      sobrepõem depois de mockApi() continuam vencendo. Exports novos:
      ORDERS, CUSTOMER, orderDetail(order, overrides).
      Portões: lint 0 err · typecheck ok · 252 unit · E2E 264 passed/3 skipped.
      ATENÇÃO: os "3 E2E vermelhos herdados" (4.3) NÃO apareceram vermelhos —
      suíte saiu 0. Conferir no 4.3 se são os 3 skipped ou se já foram consertados.
- [x] 1.2 capture-screens.mjs: logado() responde ORDERS/CUSTOMER/orderDetail
      (rota do detalhe registrada DEPOIS da lista — última vence). Tela nova
      perfil-pedido-detalhe. Provado rodando: 59 telas, perfil-pedidos 1516
      elementos, perfil-pedido-detalhe 1568. Baseline desta rodada:
      scratchpad da sessão, captura-1_2.json.
- [x] 1.3 tests/fixtures/orders.json — CustomerOrderHistoryItem[] com nomes DO
      CONTRATO. 3 pedidos: #3001 pending (ativo) c/ option_groups (unit_price_
      snapshot JÁ inclui o adicional: 117.5+8.5=126.0), #3002 delivered de OUTRA
      FILIAL (Varjota, pickup, cupom BEMVINDO10, strings decimais), #3003
      delivered c/ product_id NULL (produto saiu do cardápio). Números escolhidos
      para NÃO coincidir entre si (lição do fixture 22,14).
- [ ] 1.4 Auditoria de contrato do APP INTEIRO → tabela nesta página
- [ ] 1.5 Consertar TODOS os achados de 1.4, do mais barato ao mais caro,
      cada um com teste visto vermelho pelo motivo certo

### Fase 2 — o padrão de tela (pré-requisito da fase 3)
- [ ] 2.1 scripts/utils/screen-kit.js (14 ferramentas: esc, fmt, fallback, $,
      showEl, initials, onlyDigits, act, wait, setLoading, logAppError,
      releaseFocusFrom, getRestaurantSlug, TAB_LOADER_MIN_MS — invólucro de global)
- [ ] 2.2 appPort no restaurant-page.js — GETTERS sobre 13 estados (restaurant,
      cart, customer, products, branches, settings, appState, operationContext,
      isLogged, deliveryFee, restaurantInfoState, currentCustomerSnapshot,
      persistCustomer). Getter, nunca valor.
- [ ] 2.3 scripts/services/store-info-format.js — 8 formatadores puros de /info + unitários
- [ ] 2.4 Contrato: screens/<nome>-screen.js, IIFE, importado ANTES do
      restaurant-page.js no entry. Exporta mount(ctx) só. ctx={kit,app,shell}.
      Ações via RapidexActions.register(). Estado dentro do IIFE.
      Invariante: um estado = uma pergunta.
- [ ] 2.5 Escrever o padrão na skill NO MESMO commit de 2.4
- [ ] 2.6 fios-do-corte.mjs: contar CHAVES de ctx.app efetivamente lidas
      (se não der, registrar aqui que a métrica morreu)

### Fase 3 — telas
- [ ] 3.1 Inventário de TODAS as telas ainda no restaurant-page.js (linhas +
      dependências), ordem gravada aqui. PERFIL primeira, INÍCIO última.
- [ ] 3.2 Migrar cada tela (a→g do prompt: mover, ações, MODULOS no
      page-modules.test.js, unitários com fixture do api.d.ts, captura dos
      dois lados, 4 portões, scratchpad+commit+push)
- [ ] 3.4 Meta: restaurant-page.js → casca (boot, appPort, roteamento).
      Se sobrar >800 linhas, explicar no relatório.

### Fase 4 — pendências decididas (um commit cada, depois das telas)
- [ ] 4.1 Taxa de serviço R$ 0,99 visível na seção "Valores" da sacola
- [ ] 4.2 Texto da saída do Pix → "Sair e pagar depois" (comportamento fica)
- [ ] 4.3 Os 3 E2E vermelhos herdados (order-flow:42, pix-payment:576, :736)
- [ ] 4.4 Assistente (só front): aviso prévio no botão de voz, motivo no login,
      volta ao chat com mic pronto, menos cor (3 lugares), botões de sugestão
      (2 fixos + 1 situacional; só o que o assistente SABE responder)
- [ ] 4.5 Maps: AutocompleteService → AutocompleteSuggestion (não testável em
      dev; marcar "verificar em preview")
- [ ] 4.6 Registrar issue (sem consertar): chips de pagamento chumbados em
      restaurant.html:462-470

### Relatório final
- [ ] Relatório no fim deste arquivo + skill atualizada (padrão + armadilhas novas)

## Reconhecimento já feito (30/08/2026, antes do item 1.1)

Contrato lido em api.d.ts:
- GET /customers/me/orders → **CustomerOrderHistoryItem[]** (array puro).
  Campos: id, order_number, order_type, status, branch_name, restaurant_name,
  created_at?, subtotal, delivery_fee, service_fee, total (numbers),
  coupon_code?, coupon_discount_amount/discount_total/cashback_redeemed_amount
  (STRING decimal), items: OrderItemResponse[].
  **NÃO tem**: endereço, cancelled_at, updated_at, logo, payment_status.
- GET /customers/me/orders/{id} → **OrderDetailResponse**: endereço FLAT
  (address_street/_number/_neighborhood/_city/_state/_zipcode/_complement/
  _reference), customer_address_id, payment_status/flow/method,
  status_history[], updated_at, paid_at, notes, branch_id, restaurant_id.
- **OrderItemResponse**: product_name_snapshot, unit_price_snapshot (JÁ inclui
  adicionais — não re-somar), total, quantity, observation?, product_id?
  (nullable = produto pode ter saído do cardápio), product_code_snapshot?,
  product_description_snapshot?, option_groups?[]:
  {option_group_id, option_group_name_snapshot, options[]:
  {id, option_id, option_name_snapshot, additional_price_snapshot}}.
  **NÃO tem imagem** de item — imagem só via cardápio local por product_id.

Defeitos já vistos no código (a confirmar/completar na auditoria 1.4):
- restaurant-page.js:6723 `item.name || item.product_name || ...` → product_name_snapshot
- restaurant-page.js:6716 `item.unit_price ?? item.price ?? item.product_price` → unit_price_snapshot
- restaurant-page.js:6702 `item.selected_options_snapshot` (na RESPOSTA) → option_groups[]...
- restaurant-page.js:6714 `item.line_total ?? item.subtotal ?? item.total_price` → total
- restaurant-page.js:6724 `item.image_url || ...` → não existe na API
- restaurant-page.js:6663-6671 profOrderAddress lê 9 candidatos inexistentes
  (delivery_address_snapshot etc.) → address_street/... do OrderDetailResponse
- restaurant-page.js:6761 cancelled_at/canceled_at/refused_at/rejected_at/
  status_updated_at → não existem; há status_history[] e updated_at
- restaurant-page.js:6788 restaurant_logo_url/restaurant_logo → não existem
- restaurant-pix-flow.js:397 `item.name` — conferir a fonte (sacola local ou API)
- ATENÇÃO: sacola LOCAL usa name/unit_price/selected_options_snapshot como
  shape próprio (buildCartItem, :2643) — NÃO é defeito; só onde a fonte é API.
- order-service.js:90 defensivo `result?.orders || result?.items || result?.data`
  — contrato diz array puro; anotar na auditoria.

Mock e captura:
- tests/e2e/helpers.js:177 → `/customers/me` (regex pega tudo de /customers/me*)
  responde 401. Catch-all: 404 + rotasDesconhecidas (manter).
- tools/capture-screens.mjs:156-157 → addresses e orders respondem json([]).
- Não existe tests/fixtures/orders.json ainda (só coupons.json, info.json, menu.json).
- helpers.js exporta successOrder()/pixOrder() com shape de CreateOrderResponse.

## Auditoria de contrato (item 1.4) — tabela a preencher
(pendente)

## Inventário de telas (item 3.1) — a preencher
(pendente)

## Escapes pendentes (manter ≤ 8)
(nenhum ainda)

## Bloqueados por backend
(nenhum ainda)

## Decisões tomadas sem o usuário
(nenhuma ainda)
