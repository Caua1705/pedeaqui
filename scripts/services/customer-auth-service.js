(function () {
  // Storage keys (shared across screens / sessions).
  const TOKEN_KEY = 'rapidex_customer_token';
  const CUSTOMER_KEY = 'rapidex_customer';

  const client = () => window.PedeAquiApiClient;
  const routes = () => window.PedeAquiApiRoutes || window.API_ROUTES;

  /* ---------- Token + customer storage ---------- */

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || null;
  }
  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function getStoredCustomer() {
    try {
      return JSON.parse(localStorage.getItem(CUSTOMER_KEY)) || null;
    } catch {
      return null;
    }
  }
  function setStoredCustomer(customer) {
    if (customer) localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  }
  function clearStoredCustomer() {
    localStorage.removeItem(CUSTOMER_KEY);
  }

  function isLoggedIn() {
    return Boolean(getToken());
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

  function authedRequest(path, options = {}) {
    return client().request(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
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
  function getCustomerOrders() {
    return authedGet(routes().customerOrders());
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
    getCustomerOrders,
    changeCustomerPassword,
    getCustomerAddresses,
    createCustomerAddress,
    updateCustomerAddress,
    deleteCustomerAddress,
    setDefaultCustomerAddress
  };
})();
