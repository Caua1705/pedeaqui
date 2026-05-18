(function () {
  function normalizeMenu(payload) {
    return payload.menu || [];
  }

  window.PedeAquiMenuService = { normalizeMenu };
})();
