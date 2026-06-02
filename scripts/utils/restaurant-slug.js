(function () {
  function getRestaurantSlugFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const querySlug = params.get('slug');

    if (querySlug) {
      return querySlug;
    }

    const parts = window.location.pathname.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1];

    if (lastPart && lastPart !== 'restaurant.html') {
      return lastPart;
    }

    return window.APP_CONFIG?.DEFAULT_RESTAURANT_SLUG || 'junior-da-picanha';
  }

  window.getRestaurantSlugFromUrl = getRestaurantSlugFromUrl;
  window.PedeAquiRestaurantSlug = { getRestaurantSlugFromUrl };
})();
