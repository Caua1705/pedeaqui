(function () {
  function createCart(settings = {}) {
    return window.PedeAquiCartState?.createCartState
      ? window.PedeAquiCartState.createCartState(settings)
      : null;
  }

  function calculateTotals(items = [], settings = {}, deliveryType = 'delivery') {
    const subtotal = items.reduce((sum, item) => {
      const unitPrice = Number(item.visual_unit_price ?? item.unit_price ?? item.price ?? 0);
      return sum + unitPrice * Number(item.qty || 0);
    }, 0);
    const deliveryFee = deliveryType === 'delivery' ? Number(settings.default_delivery_fee || 0) : 0;
    const serviceFee = settings.service_fee_enabled === false ? 0 : Number(settings.service_fee_amount || 0);
    return { subtotal, delivery: deliveryFee, svc: serviceFee, total: subtotal + deliveryFee + serviceFee };
  }

  function normalizeCartItem(product, qty = 1, obs = '', extras = {}) {
    return {
      ...product,
      qty: Number(qty || 1),
      obs: String(obs || ''),
      uid: Date.now(),
      ...extras
    };
  }

  window.PedeAquiCartService = {
    createCart,
    calculateTotals,
    normalizeCartItem
  };
})();
