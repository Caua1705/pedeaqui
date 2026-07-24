(function () {
  function createCart(settings = {}) {
    return window.PedeAquiCartState?.createCartState
      ? window.PedeAquiCartState.createCartState(settings)
      : null;
  }

  function calculateTotals(items = [], settings = {}, deliveryType = 'delivery', deliveryEstimate = null) {
    const subtotal = items.reduce((sum, item) => {
      const unitPrice = Number(item.visual_unit_price ?? item.unit_price ?? item.price ?? 0);
      return sum + unitPrice * Number(item.qty || 0);
    }, 0);
    const rawDeliveryFee = deliveryEstimate?.delivery_fee;
    const estimatedDeliveryFee = rawDeliveryFee == null || rawDeliveryFee === '' ? NaN : Number(rawDeliveryFee);
    const deliveryFee = deliveryType === 'delivery' && Number.isFinite(estimatedDeliveryFee) ? estimatedDeliveryFee : 0;
    const serviceFee = settings.service_fee_enabled === false ? 0 : Number(settings.service_fee_amount || 0);
    return { subtotal, delivery: deliveryFee, svc: serviceFee, total: subtotal + deliveryFee + serviceFee };
  }

  // uid identifica a LINHA do carrinho (para editar/remover), não o produto.
  // Date.now() colidia quando dois itens eram adicionados no mesmo milissegundo
  // — e aí remover um apagava o outro.
  function newCartItemUid() {
    return window.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeCartItem(product, qty = 1, obs = '', extras = {}) {
    return {
      ...product,
      qty: Number(qty || 1),
      obs: String(obs || ''),
      uid: newCartItemUid(),
      ...extras
    };
  }

  window.PedeAquiCartService = {
    createCart,
    calculateTotals,
    normalizeCartItem,
    newCartItemUid
  };
})();
