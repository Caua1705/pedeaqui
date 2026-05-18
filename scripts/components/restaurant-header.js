(function () {
  function renderRestaurantHeaderModel(restaurant) {
    return {
      name: restaurant.name,
      logoPath: restaurant.logo_path,
      coverPath: restaurant.cover_path,
      isOpen: restaurant.is_open
    };
  }

  window.PedeAquiRestaurantHeader = { renderRestaurantHeaderModel };
})();
