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

  const PROF_ORDER_ACTIVE_STATUSES = new Set([
    'pending', 'created', 'confirmed', 'accepted', 'preparing', 'ready', 'out_for_delivery'
  ]);
  const PROF_ORDER_STATUS_LABELS = {
    pending: 'Aguardando pagamento',
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
      label: PROF_ORDER_STATUS_LABELS[status] || (status ? status.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase()) : 'Status não informado')
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
            <span>${status.tone === 'active'
              ? 'Aguardando pagamento'
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
    const activeOrders = [];
    const orderHistory = [];
    profOrdersView.forEach((order, index) => {
      const entry = { order, index };
      if (PROF_ORDER_ACTIVE_STATUSES.has(profOrderStatus(order))) activeOrders.push(entry);
      else orderHistory.push(entry);
    });
    const renderEntries = entries => entries.map(({ order, index }) => renderProfOrderCard(order, index)).join('');
    body.innerHTML = `
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
          ? `<img class="order-details__item-image" src="${esc(imageUrl)}" alt="${esc(name)}">`
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
            ? `<img class="order-details__restaurant-logo" src="${esc(restaurantLogo)}" alt="">`
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
    `;
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
      loadProfPedidos,
      openProfOrderDetails,
      closeProfOrderDetails,
      openProfOrderHelp
    });
  }

  window.PedeAquiProfileScreen = { mount };
})();
