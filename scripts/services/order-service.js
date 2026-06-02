(function () {
  async function createOrder(restaurantSlug, payload) {
    return window.PedeAquiApiClient.post(window.PedeAquiApiRoutes.createOrder(restaurantSlug), payload);
  }

  async function getOrder(restaurantSlug, orderNumber, phone) {
    return window.PedeAquiApiClient.get(window.PedeAquiApiRoutes.getOrder(restaurantSlug, orderNumber, phone || ''));
  }

  window.PedeAquiOrderService = { createOrder, getOrder };
})();
