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
    items: [],
    deliveryType: 'delivery',
    paymentMethod: 'Pix',
    coupon: null,
    couponPreview: null,
    totals: { subtotal: 0, svc: 0, delivery: 0, total: 0 }
  };
  const listeners = new Set();

  function get() {
    return {
      ...state,
      items: [...state.items],
      totals: { ...state.totals }
    };
  }

  function emit(previous) {
    const current = get();
    listeners.forEach(listener => listener(current, previous));
    return current;
  }

  function set(partial = {}) {
    const previous = get();
    Object.assign(state, partial);
    if (partial.items) state.items = [...partial.items];
    if (partial.totals) state.totals = { ...partial.totals };
    return emit(previous);
  }

  function setItems(items) {
    const previous = get();
    state.items = Array.isArray(items) ? [...items] : [];
    return emit(previous);
  }

  function setTotals(totals) {
    const previous = get();
    state.totals = { ...state.totals, ...(totals || {}) };
    return emit(previous);
  }

  function clear() {
    const previous = get();
    state.items = [];
    state.coupon = null;
    state.couponPreview = null;
    state.totals = { subtotal: 0, svc: 0, delivery: 0, total: 0 };
    return emit(previous);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.PedeAquiCartStore = { get, set, setItems, setTotals, clear, subscribe };
})();
