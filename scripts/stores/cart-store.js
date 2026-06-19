(function () {
  const state = {
    items: [],
    deliveryType: 'delivery',
    paymentMethod: 'Pix',
    totals: { subtotal: 0, svc: 0, delivery: 0, total: 0 }
  };

  function get() {
    return {
      ...state,
      items: [...state.items],
      totals: { ...state.totals }
    };
  }

  function set(partial = {}) {
    Object.assign(state, partial);
    if (partial.items) state.items = [...partial.items];
    if (partial.totals) state.totals = { ...partial.totals };
    return get();
  }

  function setItems(items) {
    state.items = Array.isArray(items) ? [...items] : [];
    return get();
  }

  function setTotals(totals) {
    state.totals = { ...state.totals, ...(totals || {}) };
    return get();
  }

  function clear() {
    state.items = [];
    state.totals = { subtotal: 0, svc: 0, delivery: 0, total: 0 };
    return get();
  }

  window.PedeAquiCartStore = { get, set, setItems, setTotals, clear };
})();
