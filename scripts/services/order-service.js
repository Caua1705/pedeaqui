(function () {
  async function createOrder(restaurantSlug, payload) {
    return window.PedeAquiApi.createOrder(restaurantSlug, payload);
  }

  async function getOrder(restaurantSlug, orderNumber, phone) {
    return window.PedeAquiApi.getOrder(restaurantSlug, orderNumber, phone);
  }

  window.PedeAquiOrderService = { createOrder, getOrder };
})();
