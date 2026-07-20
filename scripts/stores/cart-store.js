(function () {
  const state = {
    items: [],
    deliveryType: 'delivery',
    paymentMethod: 'Pix',
    totals: { subtotal: 0, svc: 0, delivery: 0, total: 0 }
  };
  const listeners = new Set();

  function get() {
    return {
      ...state,
      items: [...state.items],
      totals: { ...state.totals }
    };
  }

  function emit(previous) {
    const current = get();
    listeners.forEach(listener => listener(current, previous));
    return current;
  }

  function set(partial = {}) {
    const previous = get();
    Object.assign(state, partial);
    if (partial.items) state.items = [...partial.items];
    if (partial.totals) state.totals = { ...partial.totals };
    return emit(previous);
  }

  function setItems(items) {
    const previous = get();
    state.items = Array.isArray(items) ? [...items] : [];
    return emit(previous);
  }

  function setTotals(totals) {
    const previous = get();
    state.totals = { ...state.totals, ...(totals || {}) };
    return emit(previous);
  }

  function clear() {
    const previous = get();
    state.items = [];
    state.totals = { subtotal: 0, svc: 0, delivery: 0, total: 0 };
    return emit(previous);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.PedeAquiCartStore = { get, set, setItems, setTotals, clear, subscribe };
})();
