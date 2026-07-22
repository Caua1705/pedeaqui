(function () {
  const routeSlug = value => encodeURIComponent(value);

  const API_ROUTES = {
    health: '/health',

    restaurant: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}`,

    restaurantInfo: (restaurantSlug, branchId) =>
      `/restaurants/${routeSlug(restaurantSlug)}/info${branchId ? `?branch_id=${routeSlug(branchId)}` : ''}`,

    menu: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/menu`,
    availableCoupons: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/coupons/available`,
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

    getOrder: (restaurantSlug, orderNumber, phone) =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders/${routeSlug(orderNumber)}?phone=${encodeURIComponent(phone)}`,

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
      `/customers/me/addresses/${routeSlug(addressId)}/default`
  };

  window.API_ROUTES = API_ROUTES;
  window.PedeAquiApiRoutes = API_ROUTES;
})();
