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
  // A MESMA ROTA PARA DOIS USOS, e o `google_link_ticket` é quem decide.
  //
  // Sem ticket: o cadastro por e-mail, sem nenhuma mudança — marca
  // `email_verified_at`, responde `{verified, message}` e NÃO devolve token.
  //
  // Com ticket: o caso (b) do "entrar com Google" — o `sub` é novo e o e-mail já
  // tem conta aqui. O código certo LIGA a identidade ao cliente que já existe
  // (nunca cria outro) e a resposta traz `access_token`, `token_type`,
  // `customer` e `linked_provider`.
  //
  // O ticket sozinho não liga nada: quem autoriza é o CÓDIGO, que só chega na
  // caixa de entrada. É essa prova a mais que fecha o furo de juntar contas por
  // e-mail — sem ela, quem tivesse se cadastrado antes com o endereço de outra
  // pessoa receberia a conta dela pronta quando ela entrasse com o Google.
  //
  // O campo só entra no corpo quando existe. `VerifyEmailCodeRequest` não é de
  // esquema fechado, mas mandar `null` onde o backend espera ausência é a
  // mesma classe do §12.10 pela porta de trás — e aqui não custa nada evitar.
  function verifyEmailCode({ email, code, google_link_ticket }) {
    const body = { email, code };
    if (google_link_ticket) body.google_link_ticket = google_link_ticket;
    return client().post(routes().authVerifyEmailCode(), body);
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

  /* ---------- Entrar com Google ---------- */

  // O par que abre um login. `nonce` vai para o Google (que o copia ASSINADO
  // para dentro do `id_token`) e `nonce_token` volta para nós junto dele — um
  // sem o outro não serve para nada, e é essa a defesa contra um `id_token`
  // legítimo capturado em outro lugar. Vale 10 minutos.
  function createGoogleNonce() {
    return client().post(routes().authGoogleNonce(), {});
  }

  // Mande o `id_token` (o campo `credential` do Google Identity Services),
  // NUNCA o `accessToken` — são coisas diferentes e o backend recusa o segundo.
  // Leia o `status` da resposta: ver os três desfechos em api-routes.js.
  function signInWithGoogle({ id_token, nonce_token }) {
    return client().post(routes().authGoogle(), { id_token, nonce_token });
  }

  // Conclui o caso `profile_required` e devolve a sessão. `phone` e
  // `birth_date` são NOT NULL em `customers` e o Google não manda nenhum dos
  // dois; `marketing_opt_in` e `name` são opcionais — sem `name`, fica o do
  // Google. A conta nasce com o e-mail já verificado e SEM senha utilizável.
  function completeGoogleSignup(payload) {
    return client().post(routes().authGoogleCompleteSignup(), payload);
  }

  /* ---------- Contas conectadas ---------- */

  function listSocialAccounts() {
    return authedGet(routes().customerSocialAccounts());
  }

  // CONECTAR sem sair da conta. Devolve a lista JÁ COM o provedor novo — é ela
  // que a tela redesenha, e é por isso que não há uma segunda ida à rede aqui.
  //
  // Os três campos são os de `LinkGoogleAccountRequest`, e a senha é o que
  // prova que quem está conectando é o dono da conta e não um token roubado.
  // NÃO HÁ prova por código nesta rota — o contrato não declara campo nenhum
  // para ela (§3.2: contrato é lido, não lembrado).
  //
  // As três recusas que a tela precisa saber ler: 400 sem senha ou com conta
  // `password_set: false` (a frase do backend já ensina o caminho), 401 com
  // senha errada ou `id_token`/nonce inválido, e 409 quando aquele Google já
  // pertence a OUTRA conta. Ligar de novo o MESMO Google responde 200 com a
  // lista igual — não é erro.
  function linkGoogleAccount({ id_token, nonce_token, password }) {
    return authedPost(routes().customerSocialLinkGoogle(), { id_token, nonce_token, password });
  }

  // Desconectar mexe em FORMA DE ENTRAR, então pede a senha atual — do mesmo
  // jeito que conectar. Devolve a lista que sobrou.
  //
  // A trava mora no backend e a tela tem de antecipá-la: conta com
  // `password_set: false` e UM único provedor recebe 400, porque sem senha e sem
  // provedor a pessoa não entra mais. Ver `renderConnectedAccounts()`.
  function unlinkSocialAccount(provider, { password } = {}) {
    return authedRequest(routes().customerSocialProvider(provider), {
      method: 'DELETE',
      body: JSON.stringify(password ? { password } : {})
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
    // entrar com Google
    createGoogleNonce,
    signInWithGoogle,
    completeGoogleSignup,
    listSocialAccounts,
    linkGoogleAccount,
    unlinkSocialAccount,
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
