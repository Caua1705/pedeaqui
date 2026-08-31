(function () {
  const CASHBACK_CACHE_TTL_MS = 3 * 60 * 1000;
  const listeners = new Set();
  let activeSession = Symbol('uninitialized');
  let cashbackPromise = null;
  let transactionsPromise = null;
  let transactionsRequestKey = '';
  let cashbackState = createState();
  let transactionsState = createState(createTransactionsPayload());

  function createState(data = null) {
    return { status: 'idle', data, updatedAt: null, error: null };
  }

  function createTransactionsPayload() {
    return { balance: null, currency: 'BRL', transactions: [] };
  }

  function snapshot() {
    return {
      cashback: { ...cashbackState },
      transactions: { ...transactionsState }
    };
  }

  function notify() {
    const state = snapshot();
    listeners.forEach(listener => {
      try { listener(state); } catch (error) { console.error('[PedeAqui] Cashback listener failed', error); }
    });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function sessionIdentity() {
    const auth = window.PedeAquiCustomerAuth;
    const token = auth?.getToken?.();
    return token ? String(token) : null;
  }

  function syncSession() {
    const identity = sessionIdentity();
    if (identity !== activeSession) {
      activeSession = identity;
      cashbackPromise = null;
      transactionsPromise = null;
      transactionsRequestKey = '';
      cashbackState = identity ? createState() : { ...createState({ balance: 0 }), status: 'anonymous' };
      transactionsState = identity ? createState(createTransactionsPayload()) : { ...createState(createTransactionsPayload()), status: 'anonymous' };
      notify();
    }
    return identity;
  }

  function parseAmount(value) {
    if (typeof value === 'string') {
      const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeCashback(response) {
    const payload = response?.data ?? response ?? {};
    const rawBalance = payload.cashback_balance
      ?? payload.balance
      ?? payload.available_balance
      ?? payload.wallet_balance
      ?? payload.cashback;
    return { ...payload, balance: parseAmount(rawBalance) ?? 0 };
  }

  /**
   * O saldo GASTÁVEL NESTA loja. `CashbackBalanceResponse.balance` é a SOMA da
   * conta inteira — todos os restaurantes do Rapidex — e o próprio schema
   * avisa que a soma não é gastável. Quem responde pela loja é
   * `by_restaurant[]`, filtrado pelo slug. Loja sem entrada = R$ 0,00 aqui,
   * por mais que a conta tenha saldo em outra loja: mostrar saldo alheio como
   * gastável é prometer desconto que o pedido não vai ter.
   */
  function restaurantCashbackBalance(restaurantSlug, payload = cashbackState.data) {
    const porLoja = Array.isArray(payload?.by_restaurant) ? payload.by_restaurant : [];
    const entry = porLoja.find(item => item?.restaurant_slug === restaurantSlug);
    return parseAmount(entry?.balance) ?? 0;
  }

  function normalizeTransaction(transaction = {}, index = 0) {
    return {
      ...transaction,
      id: transaction.id || transaction.transaction_id || `cashback-${index}`,
      type: String(transaction.type || transaction.transaction_type || transaction.kind || 'adjustment').toLowerCase(),
      amount: parseAmount(transaction.amount ?? transaction.value ?? transaction.cashback_amount) ?? 0,
      description: String(transaction.description || '').trim(),
      restaurant_name: String(transaction.restaurant_name || transaction.merchant_name || '').trim(),
      expires_at: transaction.expires_at || null,
      created_at: transaction.created_at || transaction.date || transaction.transaction_date || null
    };
  }

  function normalizeTransactionsResponse(response) {
    const payload = response?.data ?? response ?? {};
    const list = Array.isArray(payload) ? payload : payload.transactions;
    return {
      balance: parseAmount(payload.balance ?? payload.cashback_balance),
      currency: String(payload.currency || 'BRL').toUpperCase(),
      transactions: Array.isArray(list) ? list.map(normalizeTransaction) : []
    };
  }

  function cacheIsValid(state) {
    return state.status === 'success'
      && state.updatedAt
      && Date.now() - state.updatedAt < CASHBACK_CACHE_TTL_MS;
  }

  async function getCashback(options = {}) {
    const auth = window.PedeAquiCustomerAuth;
    if (!syncSession()) return { ...cashbackState, fromCache: false };
    if (!auth?.isSessionReady?.()) return { ...cashbackState, fromCache: false };
    if (!options.force && cacheIsValid(cashbackState)) return { ...cashbackState, fromCache: true };
    if (cashbackPromise) return cashbackPromise;

    const lastKnown = cashbackState.data;
    cashbackState = { ...cashbackState, status: 'loading', error: null };
    notify();
    cashbackPromise = auth.getCustomerCashback()
      .then(response => {
        cashbackState = { status: 'success', data: normalizeCashback(response), updatedAt: Date.now(), error: null };
        notify();
        return { ...cashbackState, fromCache: false };
      })
      .catch(error => {
        cashbackState = { status: 'error', data: lastKnown, updatedAt: cashbackState.updatedAt, error };
        notify();
        return { ...cashbackState, fromCache: false };
      })
      .finally(() => { cashbackPromise = null; });
    return cashbackPromise;
  }

  async function getCashbackTransactions({ limit = 20, offset = 0, force = false } = {}) {
    const auth = window.PedeAquiCustomerAuth;
    if (!syncSession()) return { ...transactionsState, fromCache: false };
    if (!auth?.isSessionReady?.()) return { ...transactionsState, fromCache: false };
    const requestKey = `${limit}:${offset}`;
    if (!force && requestKey === transactionsRequestKey && cacheIsValid(transactionsState)) return { ...transactionsState, fromCache: true };
    if (transactionsPromise && requestKey === transactionsRequestKey) return transactionsPromise;

    const lastKnown = transactionsState.data;
    transactionsRequestKey = requestKey;
    transactionsState = { ...transactionsState, status: 'loading', error: null };
    notify();
    transactionsPromise = auth.getCustomerCashbackTransactions({ limit, offset })
      .then(response => {
        transactionsState = { status: 'success', data: normalizeTransactionsResponse(response), updatedAt: Date.now(), error: null };
        notify();
        return { ...transactionsState, fromCache: false };
      })
      .catch(error => {
        transactionsState = { status: 'error', data: lastKnown, updatedAt: transactionsState.updatedAt, error };
        notify();
        return { ...transactionsState, fromCache: false };
      })
      .finally(() => { transactionsPromise = null; });
    return transactionsPromise;
  }

  function getTransactions(options = {}) {
    return getCashbackTransactions(options);
  }

  /** Estados que o card pode ter. Fora desta lista, o cupom não é desenhável. */
  const COUPON_STATES = new Set(['applicable', 'missing_amount', 'login_required']);

  /**
   * A lista já vem RESOLVIDA do backend, e é por isso que aqui não há filtro.
   *
   * O filtro que existia procurava `coupon.eligible === true` — campo que a
   * rota nova não tem e a antiga só tinha às vezes. Como ele se auto-desligava
   * quando o campo faltava ("backendSentEligibility"), o resultado prático era
   * nenhum filtro: cupom inelegível entrava na tela com aparência de usável.
   *
   * O contrato novo resolve isso na origem: cupom sem conserto NESTA sacola
   * (vencido, de outro segmento, primeira-compra para quem já comprou, teto
   * estourado, cooldown correndo) simplesmente não vem na lista. O que vem é o
   * que a pessoa consegue mudar agora — pôr mais coisa na sacola
   * (`missing_amount`) ou entrar na conta (`login_required`). Refiltrar aqui
   * só poderia esconder cupom bom.
   *
   * O que ainda é nosso é descartar linha quebrada: sem `id` não há como
   * abrir o detalhe, e com `state` desconhecido não há botão que faça sentido.
   */
  function normalizeCustomerCoupons(response) {
    const payload = response?.data ?? response ?? {};
    const list = Array.isArray(payload) ? payload : (payload.coupons || []);
    if (!Array.isArray(list)) return [];
    return list.filter(coupon => coupon?.id && COUPON_STATES.has(coupon?.state));
  }

  async function getCustomerCoupons(options = {}) {
    const response = await window.PedeAquiApi.getCustomerCoupons(options);
    return normalizeCustomerCoupons(response);
  }

  async function previewCoupon(options = {}) {
    return window.PedeAquiApi.previewCoupon(options);
  }

  async function getClubData(restaurantSlug, context = {}) {
    const [cashback, coupons] = await Promise.all([
      getCashback(),
      getCustomerCoupons({ restaurantSlug, ...context })
    ]);
    return {
      restaurant_slug: restaurantSlug,
      coupons,
      cashback_balance: cashback.status === 'success'
        ? restaurantCashbackBalance(restaurantSlug, cashback.data)
        : null,
      cashback_status: cashback.status,
      cashback_updated_at: cashback.updatedAt
    };
  }

  function getState() {
    syncSession();
    return snapshot();
  }

  window.PedeAquiClubService = {
    CASHBACK_CACHE_TTL_MS,
    subscribe,
    getState,
    getCashback,
    getCashbackTransactions,
    getTransactions,
    getCustomerCoupons,
    previewCoupon,
    getClubData,
    restaurantCashbackBalance
  };
})();
