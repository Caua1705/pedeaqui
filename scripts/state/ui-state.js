(function () {
  const state = {
    activeView: 'home',
    activeCategory: null,
    searchQuery: ''
  };

  function set(partial) {
    Object.assign(state, partial);
  }

  function get() {
    return { ...state };
  }

  window.PedeAquiUiState = { get, set };
})();
