(function () {
  function createCartState(settings = {}) {
    let items = [];
    const listeners = new Set();

    function emit() {
      const snapshot = api.getSnapshot();
      listeners.forEach(listener => listener(snapshot));
    }

    const api = {
      addItem(item) {
        items = [...items, item];
        emit();
      },
      removeItem(uid) {
        items = items.filter(item => item.uid !== uid);
        emit();
      },
      updateQuantity(uid, qty) {
        items = items.map(item => item.uid === uid ? { ...item, qty } : item).filter(item => item.qty > 0);
        emit();
      },
      clear() {
        items = [];
        emit();
      },
      getItems() {
        return [...items];
      },
      getSummary(deliveryType = 'delivery', serviceFeeEnabled = true) {
        const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
        const deliveryFee = deliveryType === 'delivery' ? Number(settings.default_delivery_fee || 0) : 0;
        const serviceFee = serviceFeeEnabled && settings.service_fee_enabled !== false ? Number(settings.service_fee_amount || 0) : 0;
        return { subtotal, deliveryFee, serviceFee, total: subtotal + deliveryFee + serviceFee };
      },
      getSnapshot() {
        return { items: api.getItems() };
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };

    return api;
  }

  window.PedeAquiCartState = { createCartState };
})();
