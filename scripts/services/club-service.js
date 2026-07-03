(function () {
  const CASHBACK_CACHE_TTL_MS = 7 * 60 * 1000;
  let activeSession = null;
  let cashbackState = {
    status: 'idle',
    data: null,
    updatedAt: null,
    error: null
  };
  let cashbackPromise = null;

  function sessionIdentity() {
    const auth = window.PedeAquiCustomerAuth;
    const token = auth?.getToken?.();
    if (!token) return null;
    const customer = auth?.getStoredCustomer?.();
    return String(customer?.id || customer?.customer_id || token);
  }

  function syncSession() {
    const identity = sessionIdentity();
    if (identity !== activeSession) {
      activeSession = identity;
      cashbackState = { status: 'idle', data: null, updatedAt: null, error: null };
      cashbackPromise = null;
    }
    return identity;
  }

  function parseBalance(value) {
    if (typeof value === 'string') {
      const normalized = value.includes(',')
        ? value.replace(/\./g, '').replace(',', '.')
        : value;
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
    return {
      ...payload,
      balance: parseBalance(rawBalance) ?? 0
    };
  }

  async function getCashback(options = {}) {
    if (!syncSession()) {
      return { status: 'anonymous', data: { balance: 0 }, updatedAt: null, fromCache: false };
    }

    const cacheIsValid = cashbackState.status === 'success'
      && cashbackState.updatedAt
      && Date.now() - cashbackState.updatedAt < CASHBACK_CACHE_TTL_MS;
    if (!options.force && cacheIsValid) return { ...cashbackState, fromCache: true };
    if (cashbackPromise) return cashbackPromise;

    const lastKnown = cashbackState.data;
    cashbackState = { ...cashbackState, status: 'loading', error: null };
    cashbackPromise = window.PedeAquiCustomerAuth.getCustomerCashback()
      .then(response => {
        cashbackState = {
          status: 'success',
          data: normalizeCashback(response),
          updatedAt: Date.now(),
          error: null
        };
        return { ...cashbackState, fromCache: false };
      })
      .catch(error => {
        cashbackState = {
          status: 'error',
          data: lastKnown,
          updatedAt: cashbackState.updatedAt,
          error
        };
        return { ...cashbackState, fromCache: false };
      })
      .finally(() => { cashbackPromise = null; });
    return cashbackPromise;
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

  window.PedeAquiClubService = {
    CASHBACK_CACHE_TTL_MS,
    getCashback,
    getClubData
  };
})();
