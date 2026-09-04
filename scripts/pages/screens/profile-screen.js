// ============================================================================
//  Tela do Perfil: histórico de pedidos, detalhe do pedido e o roteador das
//  subtelas (openProfSub/closeProfSub). Primeira tela do contrato mount(ctx)
//  — skill §9. O corpo deste arquivo NÃO executa nada (page-modules.test.js
//  barra); tudo de efeito acontece em mount(), chamado pelo restaurant-page
//  no fim do IIFE dele.
//
//  Estado da tela (profOrdersView, profOrderDetailRequest) mora AQUI. O que
//  vem do app entra por ctx.app (getters — ler a cada acesso, nunca copiar) e
//  por ctx.shell (as cinco funções que continuam do page: openLoginScreen,
//  syncCustomerSession, syncCartStickyForActiveView, renderProfileHelpContacts,
//  ensureRestaurantInfo). Ferramentas por ctx.kit.
// ============================================================================
(function () {
  let $, esc, fmt, act, initials, fallback, releaseFocusFrom, logAppError, getRestaurantSlug;
  let app, shell;

  // 40x40 nas DUAS imagens do detalhe do pedido — a foto do item e o logo da
  // loja (styles/utilities.css:5654 e :5708). Até 05/09/2026 as duas pediam o
  // ORIGINAL, e um detalhe de pedido com seis itens baixava seis fotos em
  // tamanho de catálogo para desenhar seis quadrados de 40px.
  const PEDIDO_BOX = { w: 40, h: 40 };

  const PROF_ORDER_ACTIVE_STATUSES = new Set([
    'pending', 'created', 'confirmed', 'accepted', 'preparing', 'ready', 'out_for_delivery'
  ]);
  const PROF_ORDER_STATUS_LABELS = {
    // `pending` é o pedido criado esperando confirmação — NÃO é "aguardando
    // pagamento". No contrato ele é o primeiro dos oito `ORDER_STATUSES`, e a
    // tela do entregador o traduz como "Aguardando o restaurante"; o dinheiro
    // mora noutro campo (`payment_status`), que `CustomerOrderHistoryItem` nem
    // publica — esta lista não tem como saber dele. A frase é sobre o PEDIDO, e
    // é a mesma que o detalhe já usa.
    pending: 'Aguardando confirmação',
    created: 'Criado',
    confirmed: 'Confirmado',
    accepted: 'Aceito',
    preparing: 'Preparando',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    completed: 'Finalizado',
    delivered: 'Entregue',
    finished: 'Finalizado',
    cancelled: 'Recusado',
    canceled: 'Recusado',
    refused: 'Recusado',
    rejected: 'Recusado'
  };
  const PROF_ORDER_SUCCESS_STATUSES = new Set(['completed', 'delivered', 'finished']);
  const PROF_ORDER_DANGER_STATUSES = new Set(['cancelled', 'canceled', 'refused', 'rejected']);

  // ==========================================================================
  //  AGUARDANDO PAGAMENTO NÃO É "EM ANDAMENTO".
  //
  //  `orders.status = 'pending'` é o MESMO valor para quatro situações que
  //  pedem coisas diferentes do cliente, e quem as separa é `payment_status` —
  //  publicado em `CustomerOrderHistoryItem` em 04/09/2026 para isto. A tabela
  //  é do contrato:
  //
  //      paid         pago, esperando a loja   ele espera
  //      on_delivery  paga na entrega          ele espera
  //      failed       cobrança recusada        ele TENTA OUTRO CARTÃO
  //      pending      nunca chegou a pagar     ele FINALIZA O PAGAMENTO
  //
  //  Os dois de baixo não têm nada em andamento: têm algo PARADO esperando
  //  uma ação dele. Contá-los junto era o "(39)" que não descrevia a lista —
  //  e, sem o campo, a tela não tinha como saber que ele podia resolver.
  //
  //  `in_review` fica de FORA desta lista de propósito: ali quem está fazendo
  //  alguma coisa é o gateway, e não há ação do cliente para oferecer.
  //
  //  E NULO NÃO ENTRA: `payment_status` é `string | null`, e pedido antigo —
  //  gravado antes de o campo existir — não vira "aguardando pagamento" por
  //  ausência. É a mesma armadilha do `sort_order`: `!campo` não distingue
  //  "não veio" de "veio dizendo que está tudo certo".
  // ==========================================================================
  const PROF_PAYMENT_WAITING_STATUSES = new Set(['pending', 'failed']);
  const PROF_PAYMENT_LABELS = {
    pending: 'Aguardando pagamento',
    failed: 'Pagamento recusado'
  };

  function profPaymentStatus(order) {
    return String(order?.payment_status || '').trim().toLowerCase();
  }

  /** O pedido ATIVO cujo pagamento espera uma ação do cliente. */
  function profWaitingPayment(order) {
    return PROF_ORDER_ACTIVE_STATUSES.has(profOrderStatus(order))
      && PROF_PAYMENT_WAITING_STATUSES.has(profPaymentStatus(order));
  }
  let profOrdersView = [];
  let profOrderDetailRequest = 0;

  function profOrderStatus(order) {
    return String(order?.status || '').trim().toLowerCase();
  }

  function profOrderStatusInfo(order) {
    const status = profOrderStatus(order);
    const tone = PROF_ORDER_DANGER_STATUSES.has(status)
      ? 'danger'
      : (PROF_ORDER_SUCCESS_STATUSES.has(status) ? 'success' : 'active');
    return {
      status,
      tone,
      // QUANDO O PAGAMENTO É QUE ESTÁ PARADO, é DELE que o cartão fala: o
      // cliente precisa saber se conclui um pagamento ou se tenta outro cartão,
      // e "Aguardando confirmação" não distingue os dois.
      //
      // Depois vem a tabela de status. E o último fallback ERA
      // `status.replace(/_/g, ' ')`, que enfeitava o código do backend e o
      // entregava em inglês ("Out for delivery"): a tabela cobre os oito de
      // `ORDER_STATUSES`, então a frase genérica só alcança um status NOVO — e
      // informa o mesmo sem expor o vocabulário interno.
      label: (profWaitingPayment(order) && PROF_PAYMENT_LABELS[profPaymentStatus(order)])
        || PROF_ORDER_STATUS_LABELS[status]
        || (status ? 'Em andamento' : 'Status não informado')
    };
  }

  function profOrderDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return 'Data não informada';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit'
    }).format(date);
  }

  function renderProfOrderCard(order, index) {
    const status = profOrderStatusInfo(order);
    const isActive = PROF_ORDER_ACTIVE_STATUSES.has(status.status);
    const icon = status.tone === 'danger'
      ? '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5.5"/><path d="m4.2 4.2 3.6 3.6m0-3.6-3.6 3.6"/></svg>'
      : '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5.5"/><path d="m3.5 6.2 1.7 1.7 3.4-3.8"/></svg>';
    const statusClass = status.status.replace(/[^a-z0-9_-]/g, '');
    return `
      <article class="prof-order-card prof-order-card--${statusClass} prof-order-card--${status.tone}-tone">
        <div class="prof-order-card-main">
          <strong class="prof-order-number">Pedido #${esc(order.order_number ?? '')}</strong>
          <div class="prof-order-status prof-order-status--${status.tone}">
            ${status.tone === 'active' ? '' : `<span class="prof-order-status-icon" aria-hidden="true">${icon}</span>`}
            <span>${isActive
              ? esc(status.label)
              : `${esc(status.label)} ${esc(profOrderDate(order.created_at))}`}</span>
          </div>
        </div>
        <button class="prof-order-details-button" type="button" ${act('click', 'openProfOrderDetails', index)}>${isActive ? 'Acompanhar' : 'Ver detalhes'}</button>
      </article>
    `;
  }

  function renderProfPedidos(orders = app.appState.customerOrders || []) {
    const body = $('profSubPedidosBody');
    if (!body) return;
    profOrdersView = Array.isArray(orders) ? orders : [];
    // TRÊS BALDES, e cada cabeçalho conta o SEU. A contagem e a lista sempre
    // saíram do mesmo array (medido: 25 e 25 numa sonda de 40 pedidos), então o
    // "(39) que não bate" nunca foi aritmética — era o CONJUNTO: pedidos que o
    // cliente nunca chegou a pagar contados como "em andamento". Ver a tabela
    // de `payment_status` lá em cima.
    const awaitingPayment = [];
    const activeOrders = [];
    const orderHistory = [];
    profOrdersView.forEach((order, index) => {
      const entry = { order, index };
      if (!PROF_ORDER_ACTIVE_STATUSES.has(profOrderStatus(order))) orderHistory.push(entry);
      else if (profWaitingPayment(order)) awaitingPayment.push(entry);
      else activeOrders.push(entry);
    });
    const renderEntries = entries => entries.map(({ order, index }) => renderProfOrderCard(order, index)).join('');
    // A seção do pagamento vem PRIMEIRO porque é a única em que o cliente tem
    // o que fazer — as outras duas ele acompanha. E ela some quando está
    // vazia: seção vazia anunciando ausência é a mesma linha gasta do "Telefone
    // não informado".
    const secaoPagamento = awaitingPayment.length
      ? `
      <section class="prof-orders-awaiting">
        <h2>Aguardando pagamento (${awaitingPayment.length})</h2>
        <div class="prof-orders-list">${renderEntries(awaitingPayment)}</div>
      </section>`
      : '';
    body.innerHTML = `
      ${secaoPagamento}
      <section class="prof-orders-current">
        <h2>Pedidos em andamento (${activeOrders.length})</h2>
        ${activeOrders.length
          ? `<div class="prof-orders-list">${renderEntries(activeOrders)}</div>`
          : '<p>Você não possui pedidos em andamento</p>'}
      </section>
      <section class="prof-orders-history">
        <h2>Histórico de pedidos (${orderHistory.length})</h2>
        ${orderHistory.length
          ? `<div class="prof-orders-list">${renderEntries(orderHistory)}</div>`
          : '<p class="prof-orders-history-empty">Nenhum pedido encontrado</p>'}
      </section>
    `;
  }

  function renderProfPedidosLoading() {
    const body = $('profSubPedidosBody');
    if (body) body.innerHTML = '<div class="prof-orders-feedback">Carregando pedidos...</div>';
  }

  function renderProfPedidosError() {
    const body = $('profSubPedidosBody');
    if (!body) return;
    body.innerHTML = `
      <div class="prof-orders-feedback prof-orders-feedback--error">
        <p>Não foi possível carregar seus pedidos.</p>
        <button type="button" ${act('click', 'loadProfPedidos')}>Tentar novamente</button>
      </div>
    `;
  }

  async function loadProfPedidos() {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) {
      shell.openLoginScreen();
      return;
    }
    renderProfPedidosLoading();
    try {
      const orders = await window.PedeAquiOrderService.getCustomerOrders();
      app.appState.customerOrders = Array.isArray(orders) ? orders : [];
      renderProfPedidos(app.appState.customerOrders);
    } catch (error) {
      if (error?.status === 401) {
        await shell.syncCustomerSession();
        return;
      }
      logAppError('Falha ao carregar pedidos do cliente', error);
      renderProfPedidosError();
    }
  }

  function profOrderRelativeDate(value) {
    const created = new Date(value);
    if (!value || Number.isNaN(created.getTime())) return 'Pedido realizado';
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - created.getTime()) / 60000));
    if (elapsedMinutes < 1) return 'Realizado agora';
    if (elapsedMinutes < 60) return `Realizado há ${elapsedMinutes} minuto${elapsedMinutes === 1 ? '' : 's'}`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `Realizado há ${elapsedHours} hora${elapsedHours === 1 ? '' : 's'}`;
    return `Realizado em ${profOrderDate(value)}`;
  }

  function profOrderDateTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    const part = type => parts.find(entry => entry.type === type)?.value || '';
    return `${part('day')}/${part('month')}/${part('year')} - ${part('hour')}:${part('minute')}`;
  }

  // O contrato só conhece UMA forma de endereço no pedido: os campos FLAT do
  // OrderDetailResponse (address_street, address_number, address_neighborhood,
  // address_city, address_state). A LISTA (CustomerOrderHistoryItem) não traz
  // endereço nenhum — ele chega na segunda chamada (GET do detalhe) e o merge
  // de openProfOrderDetails o acrescenta. Antes disto, NOVE candidatos que a
  // API nunca teve (delivery_address_snapshot, customer_address, shipping_
  // address...) eram testados um a um — todos undefined — e a tela dizia
  // "Endereço não informado" para TODO pedido de entrega, em produção. O
  // fallback pelo endereço salvo fica: o detalhe guarda customer_address_id,
  // e os campos de CustomerAddressResponse têm os MESMOS nomes.
  function profOrderAddress(order) {
    const linhas = source => {
      const firstLine = [source.street, source.number].filter(Boolean).join(', ');
      const cityState = [source.city, source.state].filter(Boolean).join(' / ');
      return { firstLine, secondLine: [source.neighborhood, cityState].filter(Boolean).join(' - ') };
    };
    if (order.address_street || order.address_number || order.address_neighborhood || order.address_city) {
      return linhas({
        street: order.address_street,
        number: order.address_number,
        neighborhood: order.address_neighborhood,
        city: order.address_city,
        state: order.address_state
      });
    }
    const savedAddress = (app.appState.customerAddresses || []).find(address =>
      String(address.id || '') === String(order.customer_address_id || ''));
    if (savedAddress) return linhas(savedAddress);
    return { firstLine: '', secondLine: '' };
  }

  // Um item da comanda é OrderItemResponse, e os adicionais chegam AGRUPADOS:
  // option_groups[].{option_group_name_snapshot, options[].option_name_snapshot}.
  // O nome antigo aqui (selected_options_snapshot) é o shape da SACOLA local —
  // nunca existiu em resposta de API — então todo pedido abria sem NENHUMA
  // opção escolhida no detalhe, em produção, e ninguém via porque nenhum
  // fixture tinha adicionais.
  function profOrderSelectedOptions(item) {
    const groups = Array.isArray(item.option_groups) ? item.option_groups : [];
    return groups.flatMap(group => (Array.isArray(group.options) ? group.options : [])
      .map(option => ({
        group: group.option_group_name_snapshot || '',
        name: option.option_name_snapshot || ''
      }))
    ).filter(option => option.group || option.name);
  }

  // `total` é obrigatório no contrato e JÁ vem com adicionais dentro (assim
  // como unit_price_snapshot). Não refazemos a conta aqui: o front não calcula
  // dinheiro — se o campo faltar, o preço não aparece, em vez de aparecer
  // errado.
  function profOrderItemTotal(item) {
    const total = Number(item.total);
    return Number.isFinite(total) && item.total != null ? total : null;
  }

  function profOrderItemMarkup(item) {
    const quantity = Number(item.quantity ?? 1) || 1;
    // product_id é anulável DE PROPÓSITO: o produto pode ter saído do
    // cardápio, e o pedido antigo continua existindo. A API não manda imagem
    // de item — a foto é a do cardápio local, quando o produto ainda está lá.
    const menuProduct = app.products.find(product => String(product.id) === String(item.product_id || ''));
    const name = item.product_name_snapshot || 'Item';
    const imageUrl = menuProduct?.image_url || menuProduct?.image_path || '';
    const total = profOrderItemTotal(item);
    const options = profOrderSelectedOptions(item);
    return `
      <div class="order-details__item">
        ${imageUrl
          ? `<img class="order-details__item-image" src="${esc(imageUrl)}"${window.RapidexImageCdn?.attrs?.(imageUrl, { box: PEDIDO_BOX }) || ''} alt="${esc(name)}" ${act('error', 'retreatImage', '$this')}>`
          : `<div class="order-details__item-image order-details__item-image--fallback"><span>${esc(initials(name))}</span></div>`}
        <div class="order-details__item-copy">
          <div class="order-details__item-title"><strong>${quantity}x</strong><span>${esc(name)}</span></div>
          ${options.map(option => `
            <div class="order-details__item-option">
              ${option.group ? `<strong>${esc(option.group)}</strong>` : ''}
              ${option.name ? `<span>${esc(option.name)}</span>` : ''}
            </div>
          `).join('')}
          ${total == null ? '' : `<strong class="order-details__item-price">${fmt(total)}</strong>`}
        </div>
      </div>
    `;
  }

  function profOrderWaitingMarkup(status) {
    if (!PROF_ORDER_ACTIVE_STATUSES.has(status.status)) return '';
    return `
      <section class="order-details__waitingPayment" aria-live="polite">
        <span class="order-details__waiting-spinner" aria-hidden="true"></span>
        <div class="order-details__waiting-copy">
          <strong>Aguardando confirmação</strong>
          <p>Aguarde alguns segundos enquanto revisamos o pagamento. <strong>Não saia desta tela</strong> até a confirmação.</p>
        </div>
      </section>
    `;
  }

  function profOrderCancelledMarkup(order, status) {
    if (!PROF_ORDER_DANGER_STATUSES.has(status.status)) return '';
    // O contrato não tem cancelled_at/refused_at: o instante da recusa mora em
    // status_history[] (OrderDetailResponse), na entrada cujo status é o de
    // recusa. updated_at é o fallback — na lista, antes do detalhe chegar,
    // nem ele existe, e a data some em vez de mentir.
    const historico = Array.isArray(order.status_history) ? order.status_history : [];
    const recusa = historico.filter(entry =>
      PROF_ORDER_DANGER_STATUSES.has(String(entry.status || '').trim().toLowerCase())).pop();
    const dateTime = profOrderDateTime(recusa?.created_at || order.updated_at || '');
    return `
      <section class="order-details__finishedOrder" aria-label="Pedido recusado">
        <div class="order-details__finished-header">
          <span class="order-details__finished-status-icon" aria-hidden="true">
            <svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="7"/><path d="m5.2 5.2 3.6 3.6m0-3.6-3.6 3.6"/></svg>
          </span>
          <strong>Pedido recusado${dateTime ? ` em ${esc(dateTime)}` : ''}</strong>
          <button class="order-details__finished-help" type="button" ${act('click', 'openProfOrderHelp')} aria-label="Abrir Ajuda">
            <span aria-hidden="true">?</span> Ajuda
          </button>
        </div>
        <p>Sentimos muito por isso. O estabelecimento teve que recusar o seu pedido. Tente em outro momento!</p>
      </section>
    `;
  }

  // ==========================================================================
  //  CANCELAR O PRÓPRIO PEDIDO — a janela, o token e o que a tela promete.
  //
  //  A rota (`POST .../orders/track/{token}/cancel`) existia no contrato e o
  //  front nunca a chamou. Ela é a pendência que o `docs/order-contract.md`
  //  chama de "a mais cara": numa recusa de cartão o pedido já está gravado, e
  //  até 02/09/2026 não havia como o cliente desfazê-lo.
  //
  //  ## Duas condições, e as duas são necessárias
  //
  //  1. **A JANELA.** O backend só aceita em `pending` e `accepted`; de
  //     `preparing` em diante o insumo saiu do estoque e ele responde 409.
  //     Mostrar o botão fora da janela seria oferecer o que vai falhar — o
  //     mesmo defeito que o fluxo do cupom passou a rodada consertando.
  //  2. **O TOKEN.** Quem autoriza é o `tracking_token`, e ele **não vem no
  //     `OrderDetailResponse`**: só existe no `localStorage` deste aparelho,
  //     gravado quando ESTE aparelho criou o pedido (`state/order-tracking.js`).
  //     Um pedido feito no celular não pode ser cancelado pelo computador.
  //
  //  A segunda condição FOI RESOLVIDA no mesmo dia, e vale escrever como:
  //  a primeira versão desta tela procurava o `tracking_token` no
  //  `localStorage`, porque ele era a única autorização existente — e por isso
  //  o botão só aparecia no aparelho que fez o pedido. Isso virou pedido de
  //  backend, e o backend publicou
  //  `POST /customers/me/orders/{order_id}/cancel`, que autoriza pelo Bearer.
  //
  //  **Aqui usamos SÓ a porta do Bearer, e o motivo é que a outra é
  //  inalcançável desta tela:** `openProfSub('pedidos')` exige login
  //  (`:566`), então quem chega ao detalhe do pedido SEMPRE tem conta. Um ramo
  //  que escolhesse o token quando ele existisse seria um caminho que nunca se
  //  toma — código que mente para quem lê.
  //
  //  A porta do `tracking_token` continua viva em `orderService.cancelOrder`,
  //  com unitários próprios: ela é a única saída do CONVIDADO, e serve à tela
  //  de acompanhamento que ainda não existe.
  // ==========================================================================
  const PROF_ORDER_CANCELAVEL = new Set(['pending', 'accepted']);

  /**
   * Cancelavel = dentro da janela E com alguma porta para autorizar.
   *
   * SÃO DUAS PORTAS, e a segunda chegou em 02/09/2026: o cliente LOGADO
   * cancela por `order_id` com o Bearer, de qualquer aparelho; o convidado
   * continua cancelando pelo `tracking_token`, que só existe no aparelho que
   * fez o pedido.
   *
   * Até a segunda existir, quem pedia pelo celular e abria o app no computador
   * via o pedido em `accepted` e não tinha como desistir — a única saída era
   * ligar para o restaurante, que é o custo que esta tela existe para eliminar.
   */
  function profOrderCancelavel(order, status) {
    if (!PROF_ORDER_CANCELAVEL.has(status.status)) return false;
    return Boolean(order?.id && window.PedeAquiCustomerAuth?.getToken?.());
  }

  /**
   * O que o cancelamento faz com o dinheiro, o cupom e o cashback DESTE pedido.
   *
   * Sai do pedido, e não de uma lista fixa: prometer estorno num pedido que se
   * paga na entrega é mentir para quem nunca pagou, e omitir o estorno num Pix
   * já pago é esconder a única informação que faz a pessoa clicar sem medo.
   */
  function profOrderCancelConsequencias(order) {
    const linhas = [];
    const fluxo = String(order?.payment_flow || '').trim().toLowerCase();
    const pago = String(order?.payment_status || '').trim().toLowerCase() === 'paid';
    if (fluxo === 'online') {
      linhas.push(pago
        ? 'O valor pago é estornado para você.'
        : 'A cobrança é cancelada e nada é debitado.');
    } else {
      linhas.push('Nada foi cobrado: este pedido seria pago na entrega.');
    }
    if (String(order?.coupon_code || '').trim()) {
      linhas.push(`O cupom ${String(order.coupon_code).trim()} volta a ficar disponível.`);
    }
    if (Number(order?.cashback_redeemed_amount) > 0) {
      linhas.push(`O cashback usado (${fmt(Number(order.cashback_redeemed_amount))}) volta para o seu saldo.`);
    }
    return linhas;
  }

  /** O pedido que a folha de confirmação está mirando. */
  let profOrderCancelAlvo = null;

  function profOrderCancelErro(mensagem) {
    const alvo = $('orderCancelError');
    if (!alvo) return;
    alvo.textContent = mensagem || '';
    alvo.hidden = !mensagem;
  }

  function openOrderCancelConfirm() {
    const order = profOrderCancelAlvo;
    const overlay = $('orderCancelConfirm');
    if (!order || !overlay) return;
    const lista = $('orderCancelConsequences');
    if (lista) {
      lista.innerHTML = profOrderCancelConsequencias(order)
        .map(linha => `<li>${esc(linha)}</li>`).join('');
    }
    profOrderCancelErro('');
    const botao = $('orderCancelGo');
    if (botao) { botao.disabled = false; botao.textContent = 'Sim, cancelar pedido'; }
    overlay.hidden = false;
  }

  function closeOrderCancelConfirm(event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    const overlay = $('orderCancelConfirm');
    if (overlay) overlay.hidden = true;
  }

  async function confirmOrderCancel() {
    const order = profOrderCancelAlvo;
    const botao = $('orderCancelGo');
    if (!order?.id || !window.PedeAquiCustomerAuth?.getToken?.()) {
      profOrderCancelErro('Entre na sua conta para cancelar este pedido.');
      return;
    }
    if (botao) { botao.disabled = true; botao.textContent = 'Cancelando...'; }
    profOrderCancelErro('');
    try {
      const cancelado = await window.PedeAquiOrderService.cancelCustomerOrder(order.id);
      // A resposta É o pedido atualizado (OrderDetailResponse). Redesenhar com
      // ela evita uma segunda ida ao servidor só para descobrir o que já veio.
      const atualizado = { ...order, ...(cancelado || {}), status: cancelado?.status || 'cancelled' };
      profOrderCancelAlvo = atualizado;
      // Se ESTE aparelho fez o pedido, a entrada local sabe o status antigo —
      // sem isto a barra de "pagamento pendente" da Home continuaria oferecendo
      // pagar um pedido que acabou de ser cancelado.
      const local = (window.RapidexOrderTracking?.list?.(getRestaurantSlug()) || [])
        .find(entrada => String(entrada.order_id || '') === String(order.id));
      if (local) window.RapidexOrderTracking?.update?.(getRestaurantSlug(), local.tracking_token, { status: atualizado.status });
      closeOrderCancelConfirm();
      renderProfOrderDetails(atualizado);
      // A LISTA tambem: sem isto o cartão de trás continua dizendo "Aceito", e
      // a pessoa volta do detalhe para uma tela que discorda dele.
      const indice = profOrdersView.findIndex(item => String(item?.id || '') === String(order.id || ''));
      if (indice >= 0) {
        profOrdersView[indice] = { ...profOrdersView[indice], status: atualizado.status };
        renderProfPedidos(profOrdersView);
      }
    } catch (error) {
      if (botao) { botao.disabled = false; botao.textContent = 'Sim, cancelar pedido'; }
      // 409 NÃO é "tente de novo": é o pedido tendo saído da janela. Oferecer
      // retentativa aqui é oferecer o que nunca mais vai dar certo.
      if (error?.status === 409) {
        profOrderCancelErro('O restaurante já começou a preparar este pedido. Fale com ele pela Ajuda.');
        return;
      }
      if (error?.status === 404) {
        profOrderCancelErro('Não encontramos este pedido. Ele pode já ter sido cancelado.');
        return;
      }
      logAppError('Falha ao cancelar pedido', error);
      profOrderCancelErro('Não foi possível cancelar agora. Tente de novo em instantes.');
    }
  }

  function renderProfOrderDetails(order) {
    const body = $('profOrderDetailBody');
    if (!body) return;
    const status = profOrderStatusInfo(order);
    const items = Array.isArray(order.items) ? order.items : [];
    const address = profOrderAddress(order);
    const orderNumber = order.order_number ?? '';
    const restaurantName = order.restaurant_name || app.restaurant.name || fallback().restaurantName || 'Restaurante';
    // A API não manda logo no pedido; a marca é a do restaurante carregado.
    const restaurantLogo = app.restaurant.logo_url || app.restaurant.logo_path || '';
    const subtotal = Number(order.subtotal) || 0;
    const deliveryFee = Number(order.delivery_fee) || 0;
    // Os quatro abaixo EXISTEM no contrato (lista e detalhe) e não apareciam:
    // com taxa de serviço ou desconto, Subtotal + Entrega não fechava com o
    // Total na tela — e o cliente confere essa conta. Só exibição: os valores
    // vêm prontos (os descontos como string decimal, por isso o Number()).
    const orderServiceFee = Number(order.service_fee) || 0;
    const discountTotal = Number(order.discount_total) || Number(order.coupon_discount_amount) || 0;
    const cashbackRedeemed = Number(order.cashback_redeemed_amount) || 0;
    const total = Number(order.total) || 0;
    const isPickup = String(order.order_type || '').toLowerCase() === 'pickup';
    const addressTitle = isPickup ? 'Local de retirada' : 'Endereço de entrega';
    const firstAddressLine = address.firstLine || (isPickup ? order.branch_name : '') || 'Endereço não informado';
    const secondAddressLine = address.secondLine || '';
    const title = $('profOrderDetailTitle');
    if (title) title.textContent = `Pedido #${orderNumber}`;
    body.innerHTML = `
      ${profOrderCancelledMarkup(order, status)}
      ${profOrderWaitingMarkup(status)}
      <section class="order-details__card order-details__address">
        <h2>${addressTitle}</h2>
        <div class="order-details__divider"></div>
        <div class="order-details__address-row">
          <img class="order-details__address-map" src="/assets/icons/cart/cart-location-guest@2x.webp" alt="">
          <div class="order-details__address-copy">
            <span>${isPickup ? 'Retirar em' : 'Receber em'}</span>
            <strong>${esc(firstAddressLine)}</strong>
            ${secondAddressLine ? `<strong>${esc(secondAddressLine)}</strong>` : ''}
          </div>
        </div>
      </section>
      <section class="order-details__card order-details__order-card">
        <h2>Seu pedido</h2>
        <div class="order-details__divider"></div>
        <div class="order-details__restaurant">
          ${restaurantLogo
            ? `<img class="order-details__restaurant-logo" src="${esc(restaurantLogo)}"${window.RapidexImageCdn?.attrs?.(restaurantLogo, { box: PEDIDO_BOX }) || ''} alt="" ${act('error', 'retreatImage', '$this')}>`
            : `<div class="order-details__restaurant-logo order-details__restaurant-logo--fallback">${esc(initials(restaurantName))}</div>`}
          <div><strong>${esc(restaurantName)}</strong><span>${esc(profOrderRelativeDate(order.created_at))}</span></div>
        </div>
        <div class="order-details__divider"></div>
        <div class="order-details__items">
          ${items.length ? items.map(profOrderItemMarkup).join('') : '<p class="order-details__items-empty">Nenhum item informado.</p>'}
        </div>
      </section>
      <section class="order-details__card order-details__totalContainer">
        <h2>Valores</h2>
        <div class="order-details__divider"></div>
        <dl>
          <div><dt>Subtotal</dt><dd>${fmt(subtotal)}</dd></div>
          <div><dt>Taxa de entrega</dt><dd>${fmt(deliveryFee)}</dd></div>
          ${orderServiceFee > 0 ? `<div><dt>Taxa de serviço</dt><dd>${fmt(orderServiceFee)}</dd></div>` : ''}
          ${discountTotal > 0 ? `<div><dt>Desconto${order.coupon_code ? ` (${esc(order.coupon_code)})` : ''}</dt><dd>-${fmt(discountTotal)}</dd></div>` : ''}
          ${cashbackRedeemed > 0 ? `<div><dt>Cashback usado</dt><dd>-${fmt(cashbackRedeemed)}</dd></div>` : ''}
          <div class="order-details__total"><dt>Total</dt><dd>${fmt(total)}</dd></div>
        </dl>
      </section>
      ${PROF_ORDER_DANGER_STATUSES.has(status.status)
        ? ''
        : `<button class="order-details__help" type="button" ${act('click', 'openProfOrderHelp')}>Ajuda</button>`}
      ${profOrderCancelavel(order, status)
        ? `<button class="order-details__cancel" type="button" ${act('click', 'openOrderCancelConfirm')}>Cancelar pedido</button>`
        : ''}
    `;
    // O alvo da folha de confirmação é o pedido que está desenhado AGORA. Ele é
    // gravado no render, e não no clique, porque `openProfOrderDetails` redesenha
    // quando o detalhe completo chega do servidor — e é o completo que traz
    // `payment_flow`, `coupon_code` e `cashback_redeemed_amount`, que são as três
    // coisas que a confirmação promete.
    profOrderCancelAlvo = order;
  }

  async function openProfOrderDetails(index) {
    const order = profOrdersView[index];
    const detail = $('profOrderDetail');
    if (!order || !detail) return;
    const ordersScreen = $('profSubpedidos');
    const requestId = ++profOrderDetailRequest;
    detail.dataset.orderId = String(order.id || index);
    renderProfOrderDetails(order);
    detail.scrollTop = 0;
    detail.style.setProperty('--prof-order-detail-top', `${ordersScreen?.scrollTop || 0}px`);
    detail.classList.add('active');
    detail.setAttribute('aria-hidden', 'false');
    if (!order.id || !window.PedeAquiOrderService?.getCustomerOrder) return;
    try {
      const fullOrder = await window.PedeAquiOrderService.getCustomerOrder(order.id);
      if (requestId !== profOrderDetailRequest || !detail.classList.contains('active') || !fullOrder) return;
      renderProfOrderDetails({ ...order, ...fullOrder });
    } catch (error) {
      if (error?.status === 401) await shell.syncCustomerSession();
      else logAppError('Falha ao atualizar detalhes do pedido', error);
    }
  }

  function closeProfOrderDetails() {
    const detail = $('profOrderDetail');
    profOrderDetailRequest += 1;
    releaseFocusFrom(detail);
    detail?.classList.remove('active');
    detail?.setAttribute('aria-hidden', 'true');
  }

  function openProfOrderHelp() {
    // Pedido, detalhe, backdrop e Ajuda mudam no mesmo quadro: esta troca não
    // representa "voltar" e por isso não deve executar nenhuma transição.
    document.body.classList.add('prof-order-help-instant');
    // Ativa o destino primeiro: assim a tela de Pedidos não reaparece nem por
    // um quadro entre o detalhe lateral e a página completa de Ajuda.
    const helpPromise = openProfSub('ajuda', { instant: true });
    // Pedidos é montado diretamente no body para sustentar a transição
    // lateral; portanto ele fica fora da limpeza de `.prof-sub` do Perfil.
    $('profSubpedidos')?.classList.remove('active');
    closeProfOrderDetails();
    $('profOrdersBackdrop')?.classList.remove('active');
    return helpPromise;
  }

  // ==========================================================================
  //  CONTAS CONECTADAS
  //
  //  Duas respostas decidem esta tela, e nenhuma delas sozinha basta:
  //  `GET /customers/me/social` (quais provedores) e o `password_set` de
  //  `GET /customers/me` (se há senha).
  //
  //  A TRAVA: conta SEM senha utilizável e com UM único provedor não pode
  //  desconectar esse provedor — sem senha e sem provedor ninguém entra mais. O
  //  backend responde 400, e a tela tem de mostrar isso ANTES do clique: a
  //  pessoa não descobriria no botão, e sim na próxima vez que tentasse entrar,
  //  sem nenhuma pista.
  //
  //  `password_set` É BOOLEANO COM `@default true` NO CONTRATO, e por isso é
  //  lido com `??` e não com `||` nem com `!`. Resposta antiga, sem o campo,
  //  significa "tem senha" — e um `!me.password_set` a trataria como conta sem
  //  senha, desabilitando o botão de quem podia clicar. É a família do
  //  `sort_order` (§3.2 da skill).
  //
  //  O BOTÃO DE CONECTAR EXISTE, e a decisão que o impedia foi REVERTIDA em
  //  04/09/2026 — não por o contrato ter mudado, mas por a objeção ter sido
  //  medida e não se sustentar. Ela dizia: "`POST /customers/me/social/google`
  //  exige A SENHA ATUAL, e quem entrou por código não tem uma para digitar; o
  //  botão ficaria mudo para parte das contas". Só que `password_set: false`
  //  tem UMA origem só no backend (`_create_customer` do cadastro pelo Google),
  //  e ela grava a identidade do Google na MESMA transação: conta sem senha é
  //  conta que JÁ TEM o Google conectado, e essa não vê oferta de conectar.
  //  Quem vê a oferta tem senha, por construção.
  //
  //  A prova por CÓDIGO continua não existindo nesta rota — `LinkGoogleAccount
  //  Request` declara `id_token`, `nonce_token` e `password`, e nada mais
  //  (conferido em 04/09/2026 com o `--check` do backend em dia). Se ela
  //  aparecer um dia, o que muda é o diálogo; a oferta e o redesenho da lista
  //  ficam como estão.
  //
  //  E se um provedor NOVO nascer (Apple), uma conta pode passar a existir sem
  //  senha e sem Google. Aí a oferta aparece e o backend responde 400 com a
  //  frase que ensina o caminho ("Defina uma senha antes de conectar outra
  //  conta"), que é o que o diálogo mostra. Antecipar esse 400 hoje seria
  //  markup de um caso que não existe — a §12.6 na direção contrária.
  // ==========================================================================

  const SOCIAL_PROVIDER_LABELS = { google: 'Google' };
  let _unlinkProvider = null;
  let _unlinkSubmitting = false;

  function socialDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  /**
   * O corpo da tela de contas conectadas.
   *
   * `googleDisponivel` é passado, e não lido aqui de `PedeAquiGoogleIdentity`,
   * porque este renderizador é chamado por três caminhos (abrir a tela, ligar,
   * desligar) e um deles não pode divergir do outro em quem responde a
   * pergunta. Quem lê o global é `ofertaDeConectarGoogle()`, uma vez.
   */
  function renderConnectedAccountsHtml(contas, { temSenha = true, googleDisponivel = false } = {}) {
    const lista = Array.isArray(contas) ? contas : [];
    // A OFERTA SÓ EXISTE PARA QUEM NÃO TEM O PROVEDOR. Ligar de novo o mesmo
    // Google é inócuo no backend (200 com a lista igual), mas um botão que se
    // oferece a fazer o que já está feito é a tela mentindo sobre o estado.
    const jaTemGoogle = lista.some(conta => String(conta?.provider || '') === 'google');
    const oferta = googleDisponivel && !jaTemGoogle
      ? `<div class="prof-info-card">
          <div class="prof-social-offer">
            <div class="prof-social-info">
              <div class="prof-social-name">Google</div>
              <div class="prof-social-detail">Entre com um toque, sem digitar a senha.</div>
            </div>
            <button class="prof-social-connect" type="button" ${act('click', 'openLinkGoogleConfirm')}>Conectar</button>
          </div>
        </div>`
      : '';
    if (!lista.length) {
      return `
        <div class="prof-placeholder-card">
          <div class="prof-placeholder-title">Nenhuma conta conectada</div>
          <div class="prof-placeholder-text">Esta conta abre s&oacute; por e-mail e senha.</div>
        </div>${oferta}`;
    }
    // A trava é por LISTA, não por linha: o que a impede é ser a última porta.
    const ultimaPorta = !temSenha && lista.length === 1;
    const linhas = lista.map(conta => {
      const provider = String(conta?.provider || '');
      const nome = SOCIAL_PROVIDER_LABELS[provider] || provider;
      const desde = socialDate(conta?.linked_at);
      const ultimo = socialDate(conta?.last_login_at);
      const detalhe = [
        desde ? `Conectado em ${desde}` : '',
        ultimo ? `&Uacute;ltimo acesso em ${ultimo}` : ''
      ].filter(Boolean).join(' &middot; ');
      return `
        <div class="prof-social-row">
          <div class="prof-social-info">
            <div class="prof-social-name">${esc(nome)}</div>
            <div class="prof-social-detail">${detalhe}</div>
          </div>
          <button class="prof-social-unlink" type="button"
            ${ultimaPorta ? 'disabled' : act('click', 'openUnlinkConfirm', provider)}>Desconectar</button>
        </div>
        ${ultimaPorta ? '<div class="prof-social-locked">Esta &eacute; a &uacute;nica forma de entrar na sua conta. Defina uma senha em "Esqueci minha senha" para poder desconectar.</div>' : ''}
      `;
    }).join('');
    return `<div class="prof-info-card">${linhas}</div>${oferta}`;
  }

  /** O botão do Google só é oferecido onde ele pode funcionar (§18.3). */
  const googleDisponivel = () => Boolean(window.PedeAquiGoogleIdentity?.isEnabled?.());

  async function renderConnectedAccounts() {
    const body = $('profConnectedBody');
    if (!body) return;
    body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Carregando contas conectadas...</div></div>';
    try {
      const auth = window.PedeAquiCustomerAuth;
      const [contas, me] = await Promise.all([
        auth.listSocialAccounts(),
        auth.getCurrentCustomer()
      ]);
      body.innerHTML = renderConnectedAccountsHtml(contas, {
        temSenha: me?.password_set ?? true,
        googleDisponivel: googleDisponivel()
      });
    } catch (error) {
      logAppError('Falha ao carregar contas conectadas', error);
      body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">N&atilde;o foi poss&iacute;vel carregar suas contas conectadas.</div></div>';
    }
  }

  // ------------------------------------------------------------------------
  //  CONECTAR O GOOGLE (o diálogo)
  //
  //  A ORDEM DOS GESTOS É A SENHA PRIMEIRO, O GOOGLE DEPOIS, e ela não é
  //  estética: o `id_token` do Google é de uso único e o par de nonce vale 10
  //  minutos. Se o toque no Google viesse antes, uma senha em branco gastaria a
  //  credencial e a pessoa teria de tocar de novo sem entender por quê.
  //
  //  Quando isso acontece mesmo assim (o campo em branco, ou a senha errada, ou
  //  o 409), o botão é REARMADO — com `limparErro: false`, senão a frase que
  //  acabou de ser escrita some no rearme e o cliente volta para um diálogo mudo
  //  logo depois de um erro que EXIGE um segundo toque. É a armadilha 5 da
  //  §18.4, e ela vale igual aqui.
  // ------------------------------------------------------------------------

  let _linkArmando = false;
  let _linkSubmitting = false;

  function setLinkGoogleError(msg) {
    const el = $('linkGoogleErr');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', Boolean(msg));
  }
  function clearLinkGoogleError() { setLinkGoogleError(''); }

  async function armLinkGoogleButton({ limparErro = true } = {}) {
    const bloco = $('linkGoogleBlock');
    const alvo = $('linkGoogleButton');
    const gid = window.PedeAquiGoogleIdentity;
    if (!bloco || !alvo) return false;
    if (!gid?.isEnabled()) { bloco.hidden = true; return false; }
    if (_linkArmando) return false;
    _linkArmando = true;
    if (limparErro) setLinkGoogleError('');
    try {
      const ok = await gid.armarBotao(alvo, {
        onCredential: submitLinkGoogle,
        onError: erro => {
          // O botão SOME quando o Google não pôde ser armado, pela mesma razão
          // do client id ausente: um botão que não funciona é pior que nenhum.
          bloco.hidden = true;
          setLinkGoogleError('Não foi possível falar com o Google agora. Tente mais tarde.');
          logAppError('Não foi possível preparar o Conectar Google', erro);
        }
      });
      bloco.hidden = !ok;
      return ok;
    } finally {
      _linkArmando = false;
    }
  }

  function openLinkGoogleConfirm() {
    if ($('linkGooglePassword')) $('linkGooglePassword').value = '';
    setLinkGoogleError('');
    // QUEM ABRE ESTE DIÁLOGO É A CLASSE `.active`, não o `aria-hidden` — o
    // mesmo motivo escrito em `openUnlinkConfirm()`.
    const dialogo = $('linkGoogleConfirm');
    if (dialogo) {
      dialogo.inert = false;
      dialogo.removeAttribute('inert');
      dialogo.setAttribute('aria-hidden', 'false');
      dialogo.classList.add('active');
    }
    // Sem await: o diálogo abre na hora e o botão do Google chega por trás — ele
    // depende de uma ida à rede (o nonce), e prender a abertura nela faria o
    // toque parecer perdido.
    armLinkGoogleButton();
    setTimeout(() => $('linkGooglePassword')?.focus(), 60);
  }

  function closeLinkGoogleConfirm() {
    const dialogo = $('linkGoogleConfirm');
    releaseFocusFrom(dialogo, null);
    if (dialogo) {
      dialogo.classList.remove('active');
      dialogo.inert = true;
      dialogo.setAttribute('inert', '');
      dialogo.setAttribute('aria-hidden', 'true');
    }
  }

  async function submitLinkGoogle({ id_token, nonce_token }) {
    if (_linkSubmitting) return;
    const senha = $('linkGooglePassword')?.value || '';
    // A senha é conferida pelo BACKEND; a checagem daqui só evita gastar uma ida
    // à rede com o campo vazio — nunca decide se ela vale.
    if (!senha) {
      setLinkGoogleError('Informe sua senha');
      await armLinkGoogleButton({ limparErro: false });
      return;
    }
    _linkSubmitting = true;
    try {
      const contas = await window.PedeAquiCustomerAuth.linkGoogleAccount({
        id_token, nonce_token, password: senha
      });
      // A rota DEVOLVE a lista já com o provedor novo: redesenhar com ela evita
      // uma segunda ida à rede e, principalmente, evita a tela discordar do
      // servidor.
      const me = await window.PedeAquiCustomerAuth.getCurrentCustomer().catch(() => null);
      const body = $('profConnectedBody');
      if (body) body.innerHTML = renderConnectedAccountsHtml(contas, {
        temSenha: me?.password_set ?? true,
        googleDisponivel: googleDisponivel()
      });
      closeLinkGoogleConfirm();
    } catch (error) {
      // As frases do backend já são texto de cliente: 400 ensina o caminho de
      // quem não tem senha, 401 é senha errada, 409 é "este Google é de outra
      // conta". Nenhuma delas é código (§14.5).
      setLinkGoogleError(window.PedeAquiApiError?.errorMessage?.(error, 'Não foi possível conectar o Google.') || 'Não foi possível conectar o Google.');
      await armLinkGoogleButton({ limparErro: false });
    } finally {
      _linkSubmitting = false;
    }
  }

  // ------------------------------------------------------------------------
  //  A TELA, e por que ela é IRMÃ da de senha em vez de uma `.prof-sub`
  //
  //  Ela sai de "Gerenciar perfil > Configurar conta", ao lado de "Alterar
  //  senha" — a mesma família, e o mesmo gesto de voltar. Uma `.prof-sub`
  //  fecharia para o MENU do Perfil, dois níveis acima de onde a pessoa tocou:
  //  o "Voltar" tem de devolver para onde se veio.
  //
  //  Ela deixou de ser linha do menu em 04/09/2026, e a ausência é decisão:
  //  com um provedor só, "Google: conectado" não paga uma linha de primeiro
  //  nível. Volta para lá quando houver mais de um — o porquê está em
  //  `scratchpad/contas-conectadas-no-menu.md`, para quem mexer depois não
  //  desfazer sem saber.
  // ------------------------------------------------------------------------

  function openConnectedAccountsScreen() {
    // A mesma guarda de `openCustomerPasswordScreen`: a tela lê
    // `/customers/me/social` e `/customers/me`, e sem token as duas são 401.
    if (!app.isLogged()) { shell.openLoginScreen(); return; }
    const screen = $('profConnectedScreen');
    screen?.classList.add('active');
    screen?.setAttribute('aria-hidden', 'false');
    // Sem await: a tela abre na hora e a lista chega por trás, com o
    // "Carregando..." que `renderConnectedAccounts` já escreve.
    renderConnectedAccounts();
  }

  function closeConnectedAccountsScreen() {
    const screen = $('profConnectedScreen');
    releaseFocusFrom(screen);
    screen?.classList.remove('active');
    screen?.setAttribute('aria-hidden', 'true');
  }

  function setUnlinkError(msg) {
    const el = $('unlinkErr');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', Boolean(msg));
  }
  function clearUnlinkError() { setUnlinkError(''); }

  function openUnlinkConfirm(provider) {
    _unlinkProvider = String(provider || '');
    const nome = SOCIAL_PROVIDER_LABELS[_unlinkProvider] || _unlinkProvider || 'a conta';
    if ($('unlinkConfirmTitle')) $('unlinkConfirmTitle').textContent = `Desconectar o ${nome}?`;
    if ($('unlinkPassword')) $('unlinkPassword').value = '';
    setUnlinkError('');
    // QUEM ABRE ESTE DIÁLOGO É A CLASSE `.active`, não o `aria-hidden`: em
    // `.addr-delete-confirm` (operation.css) a visibilidade pende dela. Mexer só
    // no atributo deixava o diálogo montado, acessível e INVISÍVEL — e o clique
    // no "Desconectar" não fazia nada na tela.
    const dialogo = $('unlinkConfirm');
    if (dialogo) {
      dialogo.inert = false;
      dialogo.removeAttribute('inert');
      dialogo.setAttribute('aria-hidden', 'false');
      dialogo.classList.add('active');
    }
    setTimeout(() => $('unlinkPassword')?.focus(), 60);
  }

  function closeUnlinkConfirm() {
    const dialogo = $('unlinkConfirm');
    releaseFocusFrom(dialogo, null);
    if (dialogo) {
      dialogo.classList.remove('active');
      dialogo.inert = true;
      dialogo.setAttribute('inert', '');
      dialogo.setAttribute('aria-hidden', 'true');
    }
    _unlinkProvider = null;
  }

  async function confirmUnlinkSocial() {
    if (!_unlinkProvider || _unlinkSubmitting) return;
    const senha = $('unlinkPassword')?.value || '';
    // A senha é conferida pelo BACKEND, e a checagem daqui é só para não gastar
    // uma ida à rede com o campo vazio — nunca para decidir se ela vale.
    if (!senha) { setUnlinkError('Informe sua senha'); return; }
    _unlinkSubmitting = true;
    const btn = document.querySelector('#unlinkConfirm .addr-delete-yes');
    if (btn) btn.disabled = true;
    try {
      const restantes = await window.PedeAquiCustomerAuth.unlinkSocialAccount(_unlinkProvider, { password: senha });
      // A rota DEVOLVE a lista que sobrou: redesenhar com ela evita uma segunda
      // ida à rede e, principalmente, evita a tela discordar do servidor.
      const me = await window.PedeAquiCustomerAuth.getCurrentCustomer().catch(() => null);
      const body = $('profConnectedBody');
      if (body) body.innerHTML = renderConnectedAccountsHtml(restantes, {
        temSenha: me?.password_set ?? true,
        googleDisponivel: googleDisponivel()
      });
      closeUnlinkConfirm();
    } catch (error) {
      setUnlinkError(window.PedeAquiApiError?.errorMessage?.(error, 'Não foi possível desconectar.') || 'Não foi possível desconectar.');
    } finally {
      _unlinkSubmitting = false;
      if (btn) btn.disabled = false;
    }
  }

  async function openProfSub(subId, { instant = false } = {}) {
    if (!app.isLogged() && ['cupons', 'meusdados', 'seguranca', 'pedidos'].includes(subId)) {
      shell.openLoginScreen();
      return;
    }
    document.querySelectorAll('#mobViewProfile .prof-sub').forEach(el => el.classList.remove('active'));
    const sub = $('profSub' + subId);
    if (!sub) return;
    if (!instant) document.body.classList.remove('prof-order-help-instant');
    sub.classList.toggle('prof-sub--instant', subId === 'ajuda' && instant);
    if (subId === 'pedidos') $('profOrdersBackdrop')?.classList.add('active');
    // ENTRAR EM "Gerenciar perfil" MOSTRA A LISTA DE OPÇÕES, sempre. A tela de
    // contas conectadas é uma sobreposição DENTRO desta subtela e guarda o
    // próprio `.active`: sem esta linha, quem a deixasse aberta e trocasse de
    // aba voltaria direto nela — a subtela reaberta com a sobreposição de
    // antes, sem ter tocado em nada.
    if (subId === 'meusdados') closeConnectedAccountsScreen();
    sub.classList.add('active');
    // O Perfil principal aplica estilos `!important` inline para flutuar a
    // sacola. Remova-os ao entrar numa subpágina; CSS sozinho não os vence.
    shell.syncCartStickyForActiveView();
    if (subId === 'pedidos') await loadProfPedidos();
    if (subId === 'ajuda') {
      shell.renderProfileHelpContacts(app.restaurantInfoState.status === 'success' ? app.restaurantInfoState.data : null);
      const info = await shell.ensureRestaurantInfo();
      if (info) shell.renderProfileHelpContacts(info);
    }
    if (subId === 'pagamento') {
      const body = document.querySelector('#profSubpagamento .prof-sub-body');
      if (body && app.restaurantInfoState.status !== 'success') body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Carregando formas de pagamento...</div></div>';
      await Promise.all([
        shell.ensureRestaurantInfo(),
        window.PedeAquiPaymentConfigService?.getPaymentConfig?.(getRestaurantSlug()).catch(() => null)
      ]);
      await window.PedeAquiCardFlow?.refreshProfilePaymentMethods?.();
    }
    if (subId === 'info') {
      const body = document.querySelector('#profSubinfo .prof-sub-body');
      if (body && app.restaurantInfoState.status !== 'success') body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Carregando informações...</div></div>';
      await shell.ensureRestaurantInfo();
    }
  }
  function closeProfSub() {
    const wasInstantOrderHelp = document.body.classList.contains('prof-order-help-instant');
    closeProfOrderDetails();
    $('profOrdersBackdrop')?.classList.remove('active');
    document.querySelectorAll('#mobViewProfile .prof-sub, #profSubpedidos').forEach(el => el.classList.remove('active'));
    shell.syncCartStickyForActiveView();
    if (wasInstantOrderHelp) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.remove('prof-order-help-instant');
      }));
    }
  }
  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('profile-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, fmt, act, initials, fallback, releaseFocusFrom, logAppError, getRestaurantSlug } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['openLoginScreen', 'syncCustomerSession', 'syncCartStickyForActiveView', 'renderProfileHelpContacts', 'ensureRestaurantInfo']) {
      if (typeof shell[nome] !== 'function') throw new Error(`profile-screen: shell.${nome} ausente`);
    }
    window.RapidexActions.register({
      openProfSub,
      closeProfSub,
      openUnlinkConfirm,
      closeUnlinkConfirm,
      confirmUnlinkSocial,
      clearUnlinkError,
      openConnectedAccountsScreen,
      closeConnectedAccountsScreen,
      openLinkGoogleConfirm,
      closeLinkGoogleConfirm,
      clearLinkGoogleError,
      loadProfPedidos,
      openProfOrderDetails,
      closeProfOrderDetails,
      openProfOrderHelp,
      openOrderCancelConfirm,
      closeOrderCancelConfirm,
      confirmOrderCancel
    });
  }

  window.PedeAquiProfileScreen = { mount };
})();
