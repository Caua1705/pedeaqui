(function () {
  const FALLBACK_RESTAURANT_CONFIG = {
    defaultRestaurantSlug: window.APP_CONFIG?.DEFAULT_RESTAURANT_SLUG || '',
    restaurantName: 'Restaurante',
    restaurantDescription: 'Pedido online',
    branchName: index => `Unidade ${index + 1}`,
    branchLabel: name => `LJ. ${String(name || 'UNIDADE').toUpperCase()}`,
    branchLabelText: 'UNIDADE',
    mainBranchText: 'Unidade principal',
    categoryName: 'Categoria',
    productName: 'Produto',
    productUnavailablePrice: 'Consultar',
    defaultServiceFee: 0,
    defaultDeliveryFee: 0,
    defaultDeliveryTimeMin: 0,
    defaultDeliveryTimeMax: 0,
    pickupTimeText: '~30 min',
    orderSubmittedStatus: 'Enviado',
    openStatusText: 'Aberto agora',
    closedStatusText: 'Fechado no momento',
    paymentMethods: {
      credit: ['American Express', 'Elo', 'Hiper', 'Mastercard', 'Visa'],
      debit: ['Elo', 'Hiper', 'Mastercard', 'Visa']
    },
    club: {
      cashback: null,
      points: null,
      benefits: []
    }
  };

  window.FALLBACK_RESTAURANT_CONFIG = FALLBACK_RESTAURANT_CONFIG;
  window.PedeAquiFallbackConfig = FALLBACK_RESTAURANT_CONFIG;
})();
