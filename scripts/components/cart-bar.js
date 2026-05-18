(function () {
  function shouldShowCartBar(items) {
    return Array.isArray(items) && items.length > 0;
  }

  window.PedeAquiCartBar = { shouldShowCartBar };
})();
