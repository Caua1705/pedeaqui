(function () {
  // Textos e valores neutros usados enquanto a API não respondeu, ou quando ela
  // não informa o campo. Nada aqui pode ser específico de um restaurante ou de
  // um segmento — isto é servido para TODOS os tenants.
  const FALLBACK_RESTAURANT_CONFIG = {
    restaurantName: 'Restaurante',
    restaurantDescription: 'Pedido online',
    branchName: index => `Unidade ${index + 1}`,
    // Sem prefixo de rede ("LJ."): o rótulo é o nome que a API deu à unidade.
    branchLabel: name => String(name || 'UNIDADE').toUpperCase(),
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
