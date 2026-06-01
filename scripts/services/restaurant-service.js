(function () {
  async function getRestaurant(slug) {
    return window.PedeAquiApi.getRestaurant(slug);
  }

  async function getRestaurantMenu(slug) {
    return window.PedeAquiMenuService.getRestaurantMenu(slug);
  }

  window.PedeAquiRestaurantService = { getRestaurant, getRestaurantMenu };
})();
