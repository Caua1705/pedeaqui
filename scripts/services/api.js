(function () {
  const cfg = () => window.APP_CONFIG || {};

  function useMockData() {
    return cfg().USE_MOCK_DATA === true || cfg().STORAGE_MODE === 'mock';
  }

  async function getRestaurant(slug) {
    return window.PedeAquiApiClient.get(`/restaurants/${encodeURIComponent(slug)}`);
  }

  async function getHealth() {
    return window.PedeAquiApiClient.get('/health');
  }

  async function getRestaurantMenu(slug) {
    if (!useMockData()) {
      return window.PedeAquiApiClient.get(`/restaurants/${encodeURIComponent(slug)}/menu`);
    }

    const base = cfg().MOCK_DATA_BASE_PATH || 'data/restaurants';
    return window.PedeAquiApiClient.getLocalJson(`${base}/${encodeURIComponent(slug)}.json`);
  }

  async function getCategoryProducts(slug, categorySlug) {
    return window.PedeAquiApiClient.get(
      `/restaurants/${encodeURIComponent(slug)}/categories/${encodeURIComponent(categorySlug)}/products`
    );
  }

  async function getProduct(slug, productSlug) {
    return window.PedeAquiApiClient.get(
      `/restaurants/${encodeURIComponent(slug)}/products/${encodeURIComponent(productSlug)}`
    );
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

    return window.PedeAquiApiClient.post(`/restaurants/${encodeURIComponent(slug)}/orders`, payload);
  }

  async function getOrder(slug, orderNumber, phone) {
    if (useMockData()) {
      const orders = JSON.parse(localStorage.getItem('pedeaqui.orders') || '[]');
      return orders.find(order => String(order.order_number) === String(orderNumber)) || null;
    }

    const query = phone ? `?phone=${encodeURIComponent(phone)}` : '';
    return window.PedeAquiApiClient.get(
      `/restaurants/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderNumber)}${query}`
    );
  }

  window.PedeAquiApi = {
    getHealth,
    getRestaurant,
    getRestaurantMenu,
    getCategoryProducts,
    getProduct,
    createOrder,
    getOrder
  };
})();
