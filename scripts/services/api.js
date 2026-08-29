(function () {
  const cfg = () => window.APP_CONFIG || {};
  const routes = () => window.PedeAquiApiRoutes || window.API_ROUTES;

  function useMockData() {
    return cfg().USE_MOCK_DATA === true || cfg().STORAGE_MODE === 'mock';
  }

  async function getRestaurant(slug) {
    return window.PedeAquiApiClient.get(routes().restaurant(slug));
  }

  async function getHealth() {
    return window.PedeAquiApiClient.get(routes().health);
  }

  async function getRestaurantMenu(slug, branchId) {
    if (!useMockData()) {
      return window.PedeAquiApiClient.get(routes().menu(slug, branchId));
    }

    const base = cfg().MOCK_DATA_BASE_PATH || 'data/restaurants';
    return window.PedeAquiApiClient.getLocalJson(`${base}/${encodeURIComponent(slug)}.json`);
  }

  async function getCategoryProducts(slug, categorySlug) {
    return window.PedeAquiApiClient.get(routes().productsByCategory(slug, categorySlug));
  }

  async function getProduct(slug, productSlug) {
    return window.PedeAquiApiClient.get(routes().productDetail(slug, productSlug));
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

  async function createOrder(slug, payload) {
    if (useMockData()) {
      return {
        id: 'mock-' + Date.now(),
        order_number: Math.floor(1000 + Math.random() * 9000),
        status: 'submitted',
        created_at: new Date().toISOString(),
        subtotal: payload.items?.length ? null : 0,
        ...payload
      };
    }

    return window.PedeAquiApiClient.post(routes().createOrder(slug), payload);
  }

  // A busca de pedido por telefone foi REMOVIDA da API. O acompanhamento passa
  // pelo tracking_token (window.PedeAquiOrderService.trackOrder) e o histórico
  // do cliente logado por /customers/me/orders — não há substituto aqui.

  window.PedeAquiApi = {
    getHealth,
    getRestaurant,
    getRestaurantMenu,
    getCategoryProducts,
    getProduct,
    getCustomerCoupons,
    previewCoupon,
    createOrder
  };
})();
