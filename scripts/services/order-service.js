(function () {
  // Attach the customer's Bearer token when one is available, so the backend
  // can link the order to the logged-in customer via the JWT (no customer_id
  // is ever sent from the frontend).
  function authOptions() {
    const headers = window.PedeAquiCustomerAuth?.authHeaders?.() || {};
    return Object.keys(headers).length ? { headers } : {};
  }

  async function createOrder(restaurantSlug, payload) {
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.createOrder(restaurantSlug),
      { method: 'POST', body: JSON.stringify(payload), ...authOptions() }
    );
  }

  async function getOrder(restaurantSlug, orderNumber, phone) {
    return window.PedeAquiApiClient.get(window.PedeAquiApiRoutes.getOrder(restaurantSlug, orderNumber, phone || ''));
  }

  async function getCustomerOrders() {
    const result = await window.PedeAquiCustomerAuth?.getCustomerOrders?.();
    return Array.isArray(result) ? result : (result?.orders || result?.items || result?.data || []);
  }

  window.PedeAquiOrderService = { createOrder, getOrder, getCustomerOrders };
})();
