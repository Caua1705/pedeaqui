(function () {
  const state = {
    activeView: 'home',
    activeCategory: null,
    searchQuery: '',
    bottomNav: 'home',
    modals: {}
  };

  function get() {
    return {
      ...state,
      modals: { ...state.modals }
    };
  }

  function set(partial = {}) {
    Object.assign(state, partial);
    if (partial.modals) state.modals = { ...state.modals, ...partial.modals };
    window.PedeAquiUiState?.set?.(partial);
    return get();
  }

  function setActiveView(activeView) {
    return set({ activeView });
  }

  function setBottomNav(bottomNav) {
    return set({ bottomNav });
  }

  window.PedeAquiUiStore = { get, set, setActiveView, setBottomNav };
})();
