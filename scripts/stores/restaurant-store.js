(function () {
  const state = {
    restaurant: null,
    settings: {},
    branches: [],
    categories: [],
    products: [],
    banners: [],
    highlightBanners: [],
    coupons: [],
    productsByCategory: null,
    clubData: null,
    homeLoaded: false,
    menuLoaded: false,
    clubLoaded: false,
    loading: {
      app: false,
      home: false,
      menu: false,
      club: false,
      profile: false
    }
  };

  function get() {
    return {
      ...state,
      loading: { ...state.loading }
    };
  }

  function set(partial = {}) {
    Object.assign(state, partial);
    return get();
  }

  function setLoading(scope, active) {
    state.loading[scope] = Boolean(active);
    return get();
  }

  function setMenu({ categories = [], products = [] } = {}) {
    state.categories = categories;
    state.products = products;
    state.productsByCategory = categories.reduce((acc, category) => {
      acc[category.slug] = products.filter(product => product.is_available !== false && (
        product.category_slug === category.slug ||
        product.category_slug === category.id ||
        product.category === category.name
      ));
      return acc;
    }, {});
    state.menuLoaded = true;
    return get();
  }

  function setClubData(data) {
    state.clubData = data || null;
    state.clubLoaded = true;
    return get();
  }

  window.PedeAquiRestaurantStore = { get, set, setLoading, setMenu, setClubData };
})();
