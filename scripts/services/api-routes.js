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
      `/restaurants/${routeSlug(restaurantSlug)}/orders/${routeSlug(orderNumber)}?phone=${encodeURIComponent(phone)}`
  };

  window.API_ROUTES = API_ROUTES;
  window.PedeAquiApiRoutes = API_ROUTES;
})();
