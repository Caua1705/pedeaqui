(function () {
  const routes = {
    landing: 'index.html',
    restaurant: slug => `restaurant.html?slug=${encodeURIComponent(slug)}`
  };

  window.PedeAquiRoutes = routes;
})();
