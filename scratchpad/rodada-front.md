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
- [~] 1.5 Consertar os achados de 1.4 (ordem na tabela). Progresso:
      · Conserto 1 (D14+D15) FEITO: bloco morto do extrato removido do page
        (7186→7055 linhas; sombreado por cashback-statement.js, que carrega
        depois e vence); labels do extrato agora são o enum do contrato
        (+cancelled, -used/-refund). Spec novo cashback-statement.spec.js
        (2 testes) visto VERMELHO (cancelled→'Movimentação de cashback') e
        verde após conserto. Captura 59 telas: 'Nenhuma diferença'.
      · Conserto 2 (D2 verified:false) FEITO: submitVerify lê `verified`
        (200 com false = recusa, mensagem do backend na tela); helpers mortos
        (tokenFromAuthResponse/customerFromAuthResponse) removidos. Spec
        verify-email-code.spec.js visto VERMELHO contra o dist velho (tela
        fechava como sucesso) e verde 6/6 (--repeat-each=3) após o conserto.
        Lição de spec: dígito com auto-avanço de foco não aceita fill() por
        campo — digitar pelo teclado (page.keyboard.type).
      · Conserto 3 (D1 Perfil + D3/D4/D6/D16 horários+email, UM commit — os
        dois lotes se misturaram no working tree; decisão anotada):
        - D1: profOrderAddress → address_* flat + fallback endereço salvo;
          option_groups[].options[].option_name_snapshot; product_name_snapshot;
          item.total só (sem re-somar); imagem só do cardápio local;
          status_history p/ data da recusa; logo local; Valores ganhou taxa de
          serviço/desconto/cashback (exibição, valores prontos).
          Specs: profile-order-contract.spec.js (5 novos, mock logado padrão),
          profile-order-tracking.spec.js reescrito p/ contrato (fixture era o
          contrato ERRADO). 6 vermelhos vistos contra dist velho → 18/18 verde.
          Suíte completa exit 0. Captura: só perfil-pedido-detalhe (29 elems).
        - D3/D4: day_label + weekday 0=SEGUNDA (mapa 1..7 mostrava "0" e
          deslocava TODOS os dias; dia destacado errado — visto no teste:
          'Quinta' onde devia 'Sexta'). infoTodayHours() novo.
        - D5 RECLASSIFICADO: #mobCloseTime NEM EXISTE no markup (só regra órfã
          .mob-close-time no utilities.css) — fantasma escrevendo em fantasma;
          código removido, chip de volta = decisão de produto (anotado).
        - D6: footerHours mostra 'Hoje: HH:MM às HH:MM' dos periods do /info
          (decisão: linha de hoje, não a semana). D16: cadeias mortas de email/
          service_fee_description removidas.
          store-hours.spec.js: 3 testes vistos vermelhos → 6/6 verde (2x).
          Captura: 10 telas, TODAS só footerHours display none→block.
      · D9 RECLASSIFICADO fallback-morto: image_url||...||image_path resolve
        sempre (ambos existem no contrato); title/subtitle são alt/fallback
        cosmético morto. Sem conserto.
      · D17 NÃO-DEFEITO: itens do Pix vêm da foto local (order-tracking), como
        o comentário do módulo já documenta; order?.items é o ramo morto
        intencional (sem foto o botão some).

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

## Auditoria de contrato (item 1.4) — CONCLUÍDA 30/08/2026

Método: agente varreu scripts/ inteiro (pages, services, state, utils) cruzando
cada leitura de campo de resposta de API com o schema da rota em api.d.ts, mais
varredura exaustiva de identificadores snake_case. Spot-check meu em 3 schemas
(BusinessHourDayResponse, VerifyEmailCodeResponse, BannerResponse) — bateram.
Sacola local, formulários, Google Places e eventos Realtime ficaram FORA (shape
próprio, não é API).

### DEFEITOS-VISÍVEIS (todos os nomes da cadeia inexistem, ou campo errado)

| # | arquivo:linha | lê | certo (contrato) |
|---|---|---|---|
| D1 | restaurant-page.js:6702-6788 (bloco Perfil, já conhecido) | item.name/unit_price/selected_options_snapshot/line_total/image_url; endereço 9 candidatos; cancelled_at etc; restaurant_logo_url | product_name_snapshot / unit_price_snapshot / option_groups[].options[].option_name_snapshot / total; address_street…; status_history; logo local |
| D2 | restaurant-auth-flow.js:616-620 | verifyEmailCode → customer/user/token (8 nomes); `verified` NUNCA lido | VerifyEmailCodeResponse = {message, verified} — 200 com verified:false vira sucesso hoje |
| D3 | restaurant-page.js:1182,1189 | item.display_name/day_name/label (horários) | day_label (obrigatório, pronto) |
| D4 | restaurant-page.js:1289 | compara weekday por texto normalizado | weekday é NÚMERO; current_day_label existe e ninguém lê |
| D5 | restaurant-page.js:1593 | restaurant.closing_time/settings.closing_time/close_time | business_hours[].periods[].closes_at (/info) ou current_period.closes_at (availability) |
| D6 | restaurant-page.js:1677-79 | opening_hours_text/business_hours_text | business_hours[] de /info |
| D7 | restaurant-page.js:4755 + menu-service.js:79-80 | branch.accepts_pickup/accepts_delivery (/menu) | não existe por filial no /menu; existe em RestaurantSettingsResponse da filial |
| D8 | restaurant-club.js:191 ← club-service.js:210 | cashback.data.balance (soma GLOBAL) como saldo da loja | by_restaurant[] filtrado por restaurant_slug (schema diz que a soma não é gastável) |
| D9 | menu-service.js:181-197 + page:1729,2017 | banner.title/subtitle/name/description/imageUrl/image/order | BannerResponse = banner_type,id,image_path,image_url,is_active,sort_order — SÓ imagem |
| D10 | restaurant-page.js:936 ← menu-service.js:154 | old_price/original_price/price_old/compare_at_price/list_price | NÃO existe — preço riscado nunca renderiza (backend-blocked p/ ter o recurso) |
| D11 | restaurant-assistant.js:337 | data.options[] (chips) | ChatResponse não tem options (mas enum response_type tem 'options') — backend-blocked |
| D12 | restaurant-assistant.js:824 | rapi_suggestions | não existe — substituído pelo item 4.4 (botões fixos) |
| D13 | restaurant-assistant.js:1044-46 | product.recommendation_reason/reason/_reason | não existe — frase genérica sempre; backend-blocked p/ frase real |
| D14 | restaurant-page.js:552 | transactions.data como ARRAY | é {balance,currency,transactions}; código morto (cashback-statement.js:64 é quem vive e está certo) |
| D15 | cashback-statement.js:8-9 | type 'used'/'refund' | enum: earned/redeemed/expired/cancelled/adjustment ('used' é STATUS) |
| D16 | restaurant-page.js:1566/1686 | restaurant.email/settings.email; service_fee_description | branch.email (/info); não existe |
| D17 | restaurant-pix-flow.js:397+452 | item.name/unit_price em items||order.items | CreateOrderResponse NÃO tem items — rastrear fonte (entrada local?) no conserto |
| D18 | order-tracking.js:123 | order.payment_method de CreateOrderResponse | não existe — entrada grava sempre null |

### FALLBACK-MORTO (primeiro nome certo, resto nunca existiu) — NÃO consertar
Lista completa no relatório do agente (menu-service, club-service, address-
service, delivery-service, branch-availability, coupon chains :2668/:2688,
restaurant-club, api-error). DECISÃO: remoção de fallback defensivo com o nome
certo em primeiro é limpeza sem teste possível (nada muda), não conserto —
fica fora do 1.5, anotado. EXCEÇÕES que entram no 1.5: D14/D15 (comportamento
errado alcançável) e o que o conserto de um D vizinho tocar de graça.

### Fora do contrato de propósito (não mexer)
- /voice/* (4 rotas): isentas em api-contract.test.js:138-141.
- delivery.reason: string livre; closed_reason TEM enum e ninguém lê (nota).
- api-error.js:82-85: prosa desatualizada (PaymentErrorResponse hoje está no
  spec) — campos lidos existem; corrigir comentário se passar perto.

### Campos que existem e ninguém lê (munição p/ consertos)
day_label, current_day_label, closed_reason, current_period.opens_at/closes_at,
status_history, accepts_delivery_now, by_restaurant[], email_verified.

### Ordem do 1.5 (barato → caro), um commit cada salvo mesma tela
1. D14 (código morto) + D15 (labels do extrato) — baratos, mesmo assunto cashback
2. D2 verified:false — pequeno e grave
3. D1 bloco do Perfil inteiro (+ atualizar profile-order-tracking.spec.js que
   codifica o contrato ERRADO, + D17 se a fonte for API)
4. D9 banners (imagem certa, tirar title/subtitle fantasma)
5. D3+D4+D5+D6 horários (mesma vizinhança /info)
6. D16 email/service_fee_description (vizinho dos horários)
7. D7 accepts_* por filial
8. D8 cashback por restaurante
9. D18 payment_method no tracking (gravar null honesto ou tirar o campo)
10. D10/D11/D12/D13 → anotar bloqueado-por-backend (D12 morre no 4.4)

## Inventário de telas (item 3.1) — a preencher
(pendente)

## Escapes pendentes (manter ≤ 8)
(nenhum ainda)

## Bloqueados por backend
(nenhum ainda)

## Decisões tomadas sem o usuário
(nenhuma ainda)
