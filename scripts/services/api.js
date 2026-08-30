(function () {
  const routes = () => window.PedeAquiApiRoutes || window.API_ROUTES;

  // Só o que tem chamador. Foram removidos daqui, na auditoria de 29/08/2026:
  //
  //   getHealth, getRestaurant, getCategoryProducts, getProduct — zero chamadas
  //   em todo o repositório desde que existem.
  //
  //   createOrder — SEGUNDA implementação da criação de pedido, sem
  //   Idempotency-Key. O caminho vivo é PedeAquiOrderService.createOrder(), que
  //   manda o cabeçalho e reaproveita a chave numa retentativa. Escolher a
  //   errada custava um pedido duplicado a cada falha de rede — e as duas
  //   estavam a um autocomplete de distância.
  //
  //   O ramo de dados locais de getRestaurantMenu — vivia atrás de
  //   USE_MOCK_DATA/STORAGE_MODE, que eram constantes `false`/`'api'` no
  //   app-config e não vinham de env nenhum. Era código inalcançável, e o
  //   getLocalJson que ele chamava saiu junto do api-client.

  async function getRestaurantMenu(slug, branchId) {
    return window.PedeAquiApiClient.get(routes().menu(slug, branchId));
  }

  function authOptions() {
    const headers = window.PedeAquiCustomerAuth?.authHeaders?.() || {};
    return Object.keys(headers).length ? { headers } : {};
  }

  function couponContextQuery({ subtotal, deliveryFee, orderType } = {}) {
    const params = new URLSearchParams();
    if (Number.isFinite(Number(subtotal))) params.set('subtotal', String(Number(subtotal)));
    if (Number.isFinite(Number(deliveryFee))) params.set('delivery_fee', String(Number(deliveryFee)));
    if (orderType) params.set('order_type', String(orderType));
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  // Sem token a rota responde só o que é público, e cada cupom volta com
  // `state: "login_required"` — por isso authOptions() é opcional aqui, e não
  // uma pré-condição.
  async function getCustomerCoupons({ restaurantSlug, subtotal, deliveryFee, orderType } = {}) {
    const path = routes().customerCoupons(restaurantSlug) + couponContextQuery({ subtotal, deliveryFee, orderType });
    return window.PedeAquiApiClient.request(path, { method: 'GET', ...authOptions() });
  }

  async function previewCoupon({ restaurantSlug, couponId, couponCode, subtotal, deliveryFee, orderType } = {}) {
    const body = {
      subtotal: Number(subtotal) || 0,
      delivery_fee: Number(deliveryFee) || 0,
      order_type: orderType || 'delivery'
    };
    if (couponId != null && couponId !== '') body.coupon_id = couponId;
    else if (couponCode) body.coupon_code = couponCode;
    return window.PedeAquiApiClient.request(routes().previewCoupon(restaurantSlug), {
      method: 'POST',
      body: JSON.stringify(body),
      ...authOptions()
    });
  }

  // A busca de pedido por telefone foi REMOVIDA da API. O acompanhamento passa
  // pelo tracking_token (window.PedeAquiOrderService.trackOrder) e o histórico
  // do cliente logado por /customers/me/orders — não há substituto aqui.

  window.PedeAquiApi = {
    getRestaurantMenu,
    getCustomerCoupons,
    previewCoupon
  };
})();
