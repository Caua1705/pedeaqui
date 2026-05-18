(function () {
  const API_BASE_URL = null;
  const USE_MOCK_DATA = true;

  async function getRestaurantMenu(slug) {
    if (!USE_MOCK_DATA && API_BASE_URL) {
      const response = await fetch(API_BASE_URL + '/restaurants/' + encodeURIComponent(slug) + '/menu');
      if (!response.ok) throw new Error('Restaurant menu request failed: ' + response.status);
      return response.json();
    }

    const response = await fetch('data/restaurants/' + encodeURIComponent(slug) + '.json');
    if (!response.ok) throw new Error('Local restaurant data not found for slug: ' + slug);
    return response.json();
  }

  async function createOrder(payload) {
    return {
      id: 'mock-' + Date.now(),
      order_number: Math.floor(1000 + Math.random() * 9000),
      status: 'submitted',
      created_at: new Date().toISOString(),
      ...payload
    };
  }

  async function getOrder(orderNumber) {
    const orders = JSON.parse(localStorage.getItem('pedeaqui.orders') || '[]');
    return orders.find(order => String(order.order_number) === String(orderNumber)) || null;
  }

  window.PedeAquiApi = { API_BASE_URL, USE_MOCK_DATA, getRestaurantMenu, createOrder, getOrder };
})();
