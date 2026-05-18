(function () {
  async function createOrder(payload) {
    return window.PedeAquiApi.createOrder(payload);
  }

  async function getOrder(orderNumber) {
    return window.PedeAquiApi.getOrder(orderNumber);
  }

  window.PedeAquiOrderService = { createOrder, getOrder };
})();
