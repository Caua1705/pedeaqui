// ============================================================================
//  Por que ESTA store fica, enquanto customer-store e ui-store foram apagadas.
//
//  As quatro stores eram escritas por restaurant-page.js e por mais ninguém, o
//  que faz parecer que as quatro eram enfeite. Não eram as quatro:
//
//    customer-store e ui-store: zero leitores, em qualquer arquivo. Escrever
//    estado que ninguém lê é pior que não escrever — no dia em que alguém
//    LESSE, leria uma cópia que já podia estar atrasada em relação ao dono.
//    (ui-store ainda repassava para ui-state, que também não tinha leitor:
//    dois níveis de estado morto empilhados.) Apagadas.
//
//    restaurant-store e cart-store: têm leitor de verdade, e ele não é o
//    escritor. É scripts/pages/restaurant-assistant.js, que vive noutro IIFE e
//    não alcança o fechamento de restaurant-page.js. A store é a única costura
//    entre os dois — e no caso do carrinho é `subscribe()` que mantém o botão
//    de sacola do assistente em dia. Os E2E também dirigem por aqui.
//
//  E por que o escritor NÃO passa a ler daqui: dentro de restaurant-page.js o
//  dono do estado é o próprio fechamento. Ler de volta pela store criaria uma
//  SEGUNDA fonte de verdade para os mesmos dados, que é exatamente a classe de
//  defeito da regra 1 do CLAUDE.md (o total que existia em dois lugares e já
//  divergia). O sentido é um só, de propósito: o dono escreve, quem está fora
//  lê. Store aqui é canal de publicação, não cache.
// ============================================================================
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
