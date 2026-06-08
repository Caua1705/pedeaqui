(function () {
  const routeSlug = value => encodeURIComponent(value);

  const API_ROUTES = {
    health: '/health',

    restaurant: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}`,

    menu: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/menu`,

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
    customerAddresses: () => '/customers/me/addresses',
    customerAddress: addressId =>
      `/customers/me/addresses/${routeSlug(addressId)}`,
    customerAddressDefault: addressId =>
      `/customers/me/addresses/${routeSlug(addressId)}/default`
  };

  window.API_ROUTES = API_ROUTES;
  window.PedeAquiApiRoutes = API_ROUTES;
})();
