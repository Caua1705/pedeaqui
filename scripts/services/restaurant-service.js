(function () {
  async function getRestaurantMenu(slug) {
    return window.PedeAquiApi.getRestaurantMenu(slug);
  }

  window.PedeAquiRestaurantService = { getRestaurantMenu };
})();
