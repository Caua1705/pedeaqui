(function () {
  // Storage keys (shared across screens / sessions).
  const store = () => window.RapidexStorage;
  const TOKEN_KEY = store()?.KEYS.customerToken || 'rapidex.customer.token';
  const CUSTOMER_KEY = store()?.KEYS.customerProfile || 'rapidex.customer.profile';
  const readKey = (key) => store()?.readWithMigration
    ? store().readWithMigration(key)
    : localStorage.getItem(key);

  const client = () => window.PedeAquiApiClient;
  const routes = () => window.PedeAquiApiRoutes || window.API_ROUTES;
  // Migrates the legacy token in on first boot, so the pilot stays logged in.
  let sessionStatus = readKey(TOKEN_KEY) ? 'pending' : 'anonymous';

  /* ---------- Token + customer storage ---------- */

  function getToken() {
    return readKey(TOKEN_KEY) || null;
  }
  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStatus = 'authenticated';
    }
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStatus = 'anonymous';
  }

  // Sessão global do Rapidex: uma conta vale em todos os restaurantes, então
  // estas chaves NÃO levam slug. Todo acesso passa por RapidexStorage, que é a
  // fonte única (ver scripts/utils/storage-keys.js).
  function getStoredCustomer() {
    if (store()?.readSessionCustomer) return store().readSessionCustomer();
    try {
      return JSON.parse(readKey(CUSTOMER_KEY)) || null;
    } catch {
      return null;
    }
  }
  function setStoredCustomer(customer) {
    if (!customer) return;
    if (store()?.writeSessionCustomer) store().writeSessionCustomer(customer);
    else localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  }
  function clearStoredCustomer() {
    if (store()?.clearSessionCustomer) store().clearSessionCustomer();
    else localStorage.removeItem(CUSTOMER_KEY);
  }

  function isLoggedIn() {
    return Boolean(getToken());
  }
  function isSessionReady() {
    return sessionStatus !== 'pending';
  }
  function isAuthenticatedSession() {
    return sessionStatus === 'authenticated' && Boolean(getToken());
  }

  // Persist the result of a successful login.
  function saveSession({ access_token, customer }) {
    if (access_token) setToken(access_token);
    if (customer) setStoredCustomer(customer);
  }

  function logout() {
    clearToken();
    clearStoredCustomer();
  }

  /* ---------- Request helpers ---------- */

  function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function authedRequest(path, options = {}) {
    const result = await client().request(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    if (getToken()) sessionStatus = 'authenticated';
    return result;
  }
  const authedGet = path => authedRequest(path, { method: 'GET' });
  const authedPost = (path, body) =>
    authedRequest(path, { method: 'POST', body: JSON.stringify(body || {}) });
  const authedPatch = (path, body) =>
    authedRequest(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
  const authedDelete = path => authedRequest(path, { method: 'DELETE' });

  /* ---------- Public auth endpoints ---------- */

  function registerCustomer(payload) {
    return client().post(routes().authRegister(), payload);
  }
  function verifyEmailCode({ email, code }) {
    return client().post(routes().authVerifyEmailCode(), { email, code });
  }
  function resendEmailCode({ email }) {
    return client().post(routes().authResendEmailCode(), { email });
  }
  function loginCustomer({ login, password }) {
    return client().post(routes().authLogin(), { login, password });
  }
  function forgotPassword({ email }) {
    return client().post(routes().authForgotPassword(), { email });
  }
  function verifyResetCode({ email, code }) {
    return client().post(routes().authVerifyResetCode(), { email, code });
  }
  function resetPassword({ reset_token, new_password, confirm_password }) {
    return client().post(routes().authResetPassword(), {
      reset_token,
      new_password,
      confirm_password
    });
  }

  /* ---------- Authenticated customer endpoints ---------- */

  function getCurrentCustomer() {
    return authedGet(routes().customerMe());
  }
  function updateCurrentCustomer(payload) {
    return authedPatch(routes().customerMe(), payload);
  }
  function getCustomerOrders() {
    return authedGet(routes().customerOrders());
  }
  function getCustomerCashback() {
    return authedGet(routes().customerCashback());
  }
  function getCustomerCashbackTransactions({ limit = 20, offset = 0 } = {}) {
    return authedGet(routes().customerCashbackTransactions({ limit, offset }));
  }
  function changeCustomerPassword(payload) {
    return authedPatch(routes().customerPassword(), payload);
  }
  function getCustomerAddresses() {
    return authedGet(routes().customerAddresses());
  }
  function createCustomerAddress(payload) {
    return authedPost(routes().customerAddresses(), payload);
  }
  function importCustomerAddresses(addresses) {
    const list = Array.isArray(addresses) ? addresses : [];
    if (!getToken() || !list.length) return Promise.resolve({ addresses: [] });
    return authedPost(routes().customerAddressesImport(), { addresses: list });
  }
  function updateCustomerAddress(addressId, payload) {
    return authedPatch(routes().customerAddress(addressId), payload);
  }
  function deleteCustomerAddress(addressId) {
    return authedDelete(routes().customerAddress(addressId));
  }
  function setDefaultCustomerAddress(addressId) {
    return authedPatch(routes().customerAddressDefault(addressId), {});
  }

  window.PedeAquiCustomerAuth = {
    // storage
    TOKEN_KEY,
    CUSTOMER_KEY,
    getToken,
    setToken,
    clearToken,
    getStoredCustomer,
    setStoredCustomer,
    clearStoredCustomer,
    isLoggedIn,
    isSessionReady,
    isAuthenticatedSession,
    saveSession,
    logout,
    authHeaders,
    // public auth
    registerCustomer,
    verifyEmailCode,
    resendEmailCode,
    loginCustomer,
    forgotPassword,
    verifyResetCode,
    resetPassword,
    // authenticated
    getCurrentCustomer,
    updateCurrentCustomer,
    getCustomerOrders,
    getCustomerCashback,
    getCustomerCashbackTransactions,
    changeCustomerPassword,
    getCustomerAddresses,
    createCustomerAddress,
    importCustomerAddresses,
    updateCustomerAddress,
    deleteCustomerAddress,
    setDefaultCustomerAddress
  };
})();
