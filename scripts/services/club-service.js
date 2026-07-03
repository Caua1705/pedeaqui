(function () {
  const CASHBACK_CACHE_TTL_MS = 3 * 60 * 1000;
  const listeners = new Set();
  let activeSession = Symbol('uninitialized');
  let cashbackPromise = null;
  let transactionsPromise = null;
  let cashbackState = createState();
  let transactionsState = createState([]);

  function createState(data = null) {
    return { status: 'idle', data, updatedAt: null, error: null };
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
      cashbackState = identity ? createState() : { ...createState({ balance: 0 }), status: 'anonymous' };
      transactionsState = identity ? createState([]) : { ...createState([]), status: 'anonymous' };
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

  function normalizeTransaction(transaction = {}, index = 0) {
    return {
      ...transaction,
      id: transaction.id || transaction.transaction_id || `cashback-${index}`,
      type: String(transaction.type || transaction.transaction_type || transaction.kind || 'adjustment').toLowerCase(),
      amount: parseAmount(transaction.amount ?? transaction.value ?? transaction.cashback_amount) ?? 0,
      description: transaction.description || transaction.restaurant_name || transaction.merchant_name || transaction.order_number || '',
      created_at: transaction.created_at || transaction.date || transaction.transaction_date || null
    };
  }

  function normalizeTransactions(response) {
    const payload = response?.data ?? response ?? {};
    const list = Array.isArray(payload)
      ? payload
      : (payload.transactions || payload.items || payload.results || []);
    return Array.isArray(list) ? list.map(normalizeTransaction) : [];
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

  async function getTransactions(options = {}) {
    const auth = window.PedeAquiCustomerAuth;
    if (!syncSession()) return { ...transactionsState, fromCache: false };
    if (!auth?.isSessionReady?.()) return { ...transactionsState, fromCache: false };
    if (!options.force && cacheIsValid(transactionsState)) return { ...transactionsState, fromCache: true };
    if (transactionsPromise) return transactionsPromise;

    const lastKnown = transactionsState.data;
    transactionsState = { ...transactionsState, status: 'loading', error: null };
    notify();
    transactionsPromise = auth.getCustomerCashbackTransactions()
      .then(response => {
        transactionsState = { status: 'success', data: normalizeTransactions(response), updatedAt: Date.now(), error: null };
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

  async function getClubData(restaurantSlug, context = {}) {
    const cashback = await getCashback();
    return {
      restaurant_slug: restaurantSlug,
      coupons: Array.isArray(context.coupons) ? context.coupons : [],
      cashback_balance: cashback.data?.balance ?? null,
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
    getTransactions,
    getClubData
  };
})();
