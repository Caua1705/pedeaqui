(function () {
  const store = () => window.RapidexStorage;
  const STORAGE_KEY = store()?.KEYS.orders || 'rapidex.orders';

  function listOrders() {
    if (store()?.readJson) return store().readJson(STORAGE_KEY, []) || [];
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function saveOrder(order) {
    const orders = [order, ...listOrders()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    window.dispatchEvent(new CustomEvent('rapidex:order-confirmed', { detail: { order } }));
    return order;
  }

  function clearOrders() {
    localStorage.removeItem(STORAGE_KEY);
  }

  window.PedeAquiOrderState = { listOrders, saveOrder, clearOrders };
})();
