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

  async function getRestaurantMenu(slug) {
    if (!useMockData()) {
      return window.PedeAquiApiClient.get(routes().menu(slug));
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

  async function getAvailableCoupons({ restaurantSlug, subtotal, deliveryFee, orderType } = {}) {
    const path = routes().availableCoupons(restaurantSlug) + couponContextQuery({ subtotal, deliveryFee, orderType });
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

  async function getOrder(slug, orderNumber, phone) {
    if (useMockData()) {
      const orders = JSON.parse(localStorage.getItem('pedeaqui.orders') || '[]');
      return orders.find(order => String(order.order_number) === String(orderNumber)) || null;
    }

    return window.PedeAquiApiClient.get(routes().getOrder(slug, orderNumber, phone || ''));
  }

  window.PedeAquiApi = {
    getHealth,
    getRestaurant,
    getRestaurantMenu,
    getCategoryProducts,
    getProduct,
    getAvailableCoupons,
    previewCoupon,
    createOrder,
    getOrder
  };
})();
