(function () {
  const STORAGE_KEY = 'pedeaqui.orders';

  function listOrders() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }

  function saveOrder(order) {
    const orders = [order, ...listOrders()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    window.dispatchEvent(new CustomEvent('pedeaqui:order-confirmed', { detail: { order } }));
    return order;
  }

  function clearOrders() {
    localStorage.removeItem(STORAGE_KEY);
  }

  window.PedeAquiOrderState = { listOrders, saveOrder, clearOrders };
})();
