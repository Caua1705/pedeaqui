(function () {
  const routeSlug = value => encodeURIComponent(value);

  const API_ROUTES = {
    health: '/health',

    restaurant: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}`,

    restaurantInfo: (restaurantSlug, branchId) =>
      `/restaurants/${routeSlug(restaurantSlug)}/info${branchId ? `?branch_id=${routeSlug(branchId)}` : ''}`,

    restaurantPaymentConfig: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/payment-config`,

    // O cardápio é DA FILIAL desde 20/08/2026: produtos, categorias, preços e
    // `settings` saem todos da filial pedida, e cada loja tem os próprios ids.
    // Sem `branch_id` vale a filial padrão do backend — que é a resposta certa
    // só enquanto o cliente ainda não escolheu a loja.
    menu: (restaurantSlug, branchId) =>
      `/restaurants/${routeSlug(restaurantSlug)}/menu${branchId ? `?branch_id=${routeSlug(branchId)}` : ''}`,
    branchAvailability: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/branches/availability`,
    // Os cupons DESTA loja para QUEM ESTÁ OLHANDO. Substituiu
    // `/coupons/available`, que responde 404 desde 28/08/2026 — enquanto o
    // front chamou a rota velha, a tela do Clube ficou em "Não foi possível
    // carregar seus cupons" para todo mundo.
    //
    // Os parâmetros de contexto (subtotal, delivery_fee, order_type) são os
    // mesmos de antes: sem eles a resposta é a do Clube, com eles é a do
    // checkout. O que mudou é a RESPOSTA — cada cupom vem com `state`,
    // `discount_amount` e `missing_amount` já decididos (ver club-service.js).
    customerCoupons: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/coupons`,
    previewCoupon: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/coupons/preview`,
    deliveryEstimate: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/delivery/estimate`,

    productsByCategory: (restaurantSlug, categorySlug) =>
      `/restaurants/${routeSlug(restaurantSlug)}/categories/${routeSlug(categorySlug)}/products`,

    productDetail: (restaurantSlug, productSlug) =>
      `/restaurants/${routeSlug(restaurantSlug)}/products/${routeSlug(productSlug)}`,

    createOrder: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders`,

    // A consulta pública por telefone (?phone=) NÃO EXISTE MAIS na API. O único
    // jeito de um visitante alcançar o próprio pedido é o tracking_token que
    // POST /orders devolve — quem tem o token é quem fez o pedido. Cliente
    // logado usa customerOrder(orderId), que autoriza pelo Bearer.
    trackOrder: (restaurantSlug, trackingToken) =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders/track/${routeSlug(trackingToken)}`,

    startOrderPayment: (restaurantSlug, trackingToken) =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders/${routeSlug(trackingToken)}/payment`,

    // ---- Atendimento por voz ----
    // Só a emissão exige Bearer; as outras três são abertas. Quando a voz está
    // desligada na plataforma, TODAS respondem 404 — a rota deixa de existir.
    voiceSession: () => '/voice/session',
    voiceSessionConnected: sessionId =>
      `/voice/session/${routeSlug(sessionId)}/connected`,
    voiceSessionEnded: sessionId =>
      `/voice/session/${routeSlug(sessionId)}/ended`,
    voiceSearch: () => '/voice/search',

    // ---- Customer authentication ----
    authRegister: () => '/auth/register',
    authVerifyEmailCode: () => '/auth/verify-email-code',
    authResendEmailCode: () => '/auth/resend-email-code',
    authLogin: () => '/auth/login',
    authForgotPassword: () => '/auth/forgot-password',
    authVerifyResetCode: () => '/auth/verify-reset-code',
    authResetPassword: () => '/auth/reset-password',

    // ---- Authenticated customer ----
    customerMe: () => '/customers/me',
    customerOrders: () => '/customers/me/orders',
    customerOrder: orderId => `/customers/me/orders/${routeSlug(orderId)}`,
    customerCashback: () => '/customers/me/cashback',
    customerCashbackTransactions: ({ limit = 20, offset = 0 } = {}) => {
      const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
      const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
      return `/customers/me/cashback/transactions?limit=${safeLimit}&offset=${safeOffset}`;
    },
    customerPassword: () => '/customers/me/password',
    customerAddresses: () => '/customers/me/addresses',
    customerAddressesImport: () => '/customers/me/addresses/import',
    customerAddress: addressId =>
      `/customers/me/addresses/${routeSlug(addressId)}`,
    customerAddressDefault: addressId =>
      `/customers/me/addresses/${routeSlug(addressId)}/default`,
    customerCards: restaurantSlug =>
      `/customers/me/cards?restaurant_slug=${routeSlug(restaurantSlug)}`,
    customerCard: cardId =>
      `/customers/me/cards/${routeSlug(cardId)}`
  };

  window.API_ROUTES = API_ROUTES;
  window.PedeAquiApiRoutes = API_ROUTES;
})();
