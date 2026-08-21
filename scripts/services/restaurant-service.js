(function () {
  async function getRestaurant(slug) {
    return window.PedeAquiApiClient.get(window.PedeAquiApiRoutes.restaurant(slug));
  }

  async function getRestaurantMenu(slug, branchId) {
    return window.PedeAquiMenuService.getRestaurantMenu(slug, branchId);
  }

  window.PedeAquiRestaurantService = { getRestaurant, getRestaurantMenu };
})();
