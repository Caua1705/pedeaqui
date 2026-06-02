(function () {
  async function getRestaurant(slug) {
    return window.PedeAquiApiClient.get(window.PedeAquiApiRoutes.restaurant(slug));
  }

  async function getRestaurantMenu(slug) {
    return window.PedeAquiMenuService.getRestaurantMenu(slug);
  }

  window.PedeAquiRestaurantService = { getRestaurant, getRestaurantMenu };
})();
