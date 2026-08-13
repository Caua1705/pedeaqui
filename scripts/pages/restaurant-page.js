(function () {
  // C3 — todo listener de vida longa em document/window carrega este signal, e
  // um único abort() no teardown remove os que estiverem pendurados nele. É o
  // que evita ter de guardar referência de cada handler só para poder removê-lo
  // (metade deles é função anônima). Ver scripts/utils/lifecycle.js.
  const LIFECYCLE_SIGNAL = window.RapidexLifecycle?.signal;
  const onTeardown = (dispose) => window.RapidexLifecycle?.onTeardown(dispose);

  const fmt = window.PedeAquiCurrency?.formatCurrency || ((val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const storageKeys = () => window.RapidexStorage;
  const STORAGE_ADDRESS = storageKeys()?.KEYS.customerAddress || 'rapidex.customerAddress';
  const STORAGE_ADDRESS_LIST = storageKeys()?.KEYS.customerAddressList || 'rapidex.customerAddresses.local';
  const readStorageKey = (key) => storageKeys()?.readWithMigration
    ? storageKeys().readWithMigration(key)
    : localStorage.getItem(key);
  // Sessão do cliente: global, chave única. Esta página gravava o mesmo cliente
  // numa segunda chave (rapidex.customer.local) que podia divergir da do auth.
  const readSessionCustomer = () => storageKeys()?.readSessionCustomer?.() || null;

  let payload = {};
  let restaurant = {};
  let settings = {};
  let branches = [];
  let categories = [];
  let products = [];
  let banners = [];
  let highlightBanners = [];
  let coupons = [];
  let deliveryEstimate = { status: 'idle', key: null, data: null, updatedAt: null };
  let deliveryEstimatePromise = null;
  let restaurantInfoState = { status: 'idle', key: null, data: null, updatedAt: null };
  let restaurantInfoPromise = null;
  let availableCheckoutPaymentKeys = new Set();
  let cart = [];
  let currentProd = null;
  let pmQty = 1;
  let pmSelectedOptions = {};
  let editingCartItemUid = null;
  let productScrollIndicatorReady = false;
  let deliveryType = 'delivery';
  // paymentMethod = rótulo exibido ("Pix"); paymentMethodKey = chave da UI ("pix");
  // paymentApiTypeByKey mapeia a chave da UI para o method_type do backend
  // ("credit" -> "credit_card"), que é o valor enviado em POST /orders.
  let paymentMethod = '';
  let paymentMethodKey = '';
  const paymentApiTypeByKey = new Map();
  const paymentScopeByKey = new Map();
  let selectedCoupon = null;
  let selectedCouponPreview = null;
  let couponPreviewPromise = null;
  let couponPreviewKey = '';
  let pendingCartItemDeleteUid = null;
  let couponDetailScrollY = 0;
  let customer = window.PedeAquiCustomerService?.getStoredCustomer?.() || readSessionCustomer();
  let customerAddress = window.PedeAquiAddressService?.readSelectedAddress?.() || JSON.parse(readStorageKey(STORAGE_ADDRESS) || 'null');
  let submittedOrder = null;
  let heroBannerIndex = 0;
  let heroBannerTimer = null;
  let heroSwipeReady = false;
  let heroDragStartX = 0;
  let heroDragDeltaX = 0;
  const appState = {
    restaurant: null,
    homeLoaded: false,
    menuLoaded: false,
    clubLoaded: false,
    profileLoaded: false,
    productsByCategory: null,
    customer: customer,
    customerOrders: null,
    customerAddresses: null,
    clubData: null,
    loading: {
      app: false,
      home: false,
      menu: false,
      club: false,
      profile: false
    }
  };
  let bootPromise = null;
  let menuLoadPromise = null;
  let profileLoadPromise = null;
  let menuRenderSignature = '';
  let menuScrollSpyReady = false;
  let searchReady = false;
  let menuHeaderHideReady = false;
  let pageRubberBandReady = false;
  let menuSectionsCache = [];
  let categoryButtonsCache = [];
  let bannersRenderSignature = '';
  let couponsRenderSignature = '';
  let highlightsRenderSignature = '';
  const HERO_BANNER_INTERVAL_MS = 5000;
  const TAB_LOADER_MIN_MS = 500;

  const $ = window.PedeAquiDom?.byId || ((id) => document.getElementById(id));

  // Mostrar/esconder passa por classe, não por style.display.
  //
  // O estado inicial escondido vinha de style="display:none" no HTML, e era o
  // que obrigava a CSP a liberar style-src 'unsafe-inline'. Sem o atributo, um
  // `style.display = ''` não desfaz mais nada — quem esconde agora é .u-hidden,
  // então quem mostra tem que tirar a classe.
  const showEl = (element, shown) => element?.classList.toggle('u-hidden', !shown);

  const dialogFocusOrigins = new WeakMap();

  function releaseFocusFrom(container, fallback) {
    const active = document.activeElement;
    if (!container || !active || !container.contains(active)) return;
    active.blur();
    if (fallback?.isConnected && typeof fallback.focus === 'function') fallback.focus({ preventScroll: true });
    else document.body?.focus?.({ preventScroll: true });
  }

  function setAccessibleDialogState(dialog, open, focusSelector) {
    if (!dialog) return;
    if (open) {
      const active = document.activeElement;
      if (active && active !== document.body && !dialog.contains(active)) dialogFocusOrigins.set(dialog, active);
      dialog.inert = false;
      dialog.removeAttribute('inert');
      dialog.setAttribute('aria-hidden', 'false');
      dialog.classList.add('active');
      requestAnimationFrame(() => dialog.querySelector(focusSelector || 'button')?.focus({ preventScroll: true }));
      return;
    }
    const active = document.activeElement;
    if (active && dialog.contains(active)) active.blur();
    const origin = dialogFocusOrigins.get(dialog);
    if (origin?.isConnected && typeof origin.focus === 'function') origin.focus({ preventScroll: true });
    else document.body?.focus?.({ preventScroll: true });
    dialog.classList.remove('active');
    dialog.inert = true;
    dialog.setAttribute('inert', '');
    dialog.setAttribute('aria-hidden', 'true');
    dialogFocusOrigins.delete(dialog);
  }

  function initializeDismissedDialogs() {
    ['addrDeleteConfirm', 'cartItemDeleteConfirm', 'logoutConfirm'].forEach(id => {
      const dialog = $(id);
      if (!dialog || dialog.getAttribute('aria-hidden') !== 'true') return;
      dialog.inert = true;
      dialog.setAttribute('inert', '');
    });
  }
  const fallback = () => window.PedeAquiFallbackConfig || {};
  const isLogged = () => Boolean(customer || window.PedeAquiCustomerService?.isLoggedIn?.());
  const serviceFee = () => Number(settings.service_fee_amount ?? fallback().defaultServiceFee ?? 0);
  const asFiniteNumber = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const currentDeliveryEstimateFee = () => {
    if (deliveryEstimate.status !== 'success' || deliveryEstimate.data?.serviceable === false) return null;
    return asFiniteNumber(deliveryEstimate.data?.delivery_fee);
  };
  const deliveryFee = () => deliveryType === 'delivery' ? (currentDeliveryEstimateFee() ?? 0) : 0;
  const initials = (name) => (name || 'Rapidex').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const slug = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const esc = window.PedeAquiDom?.escapeHtml || ((text) => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])));

  // Atributo de ação para markup gerado em template (ver scripts/utils/actions.js).
  // Passe o valor CRU: a spec vira JSON e só então é escapada, então uma aspa
  // dentro de um id é neutralizada duas vezes e volta intacta na leitura — nem
  // quebra o parse, nem escapa do atributo.
  const act = (event, name, ...args) =>
    `data-act-${event}="${esc(args.length ? JSON.stringify([name, ...args]) : name)}"`;
  // Sequência de ações (ex.: parar a propagação e então abrir algo).
  const actAll = (event, steps) => `data-act-${event}="${esc(JSON.stringify(steps))}"`;
  const formatProductTitle = (value) => {
    const minorWords = new Set(['a','à','ao','aos','as','às','com','da','das','de','do','dos','e','em','na','nas','no','nos','ou','para','por']);
    let firstWord = true;
    let segmentStart = true;
    return String(value || '').toLocaleLowerCase('pt-BR').split(/(\s+|\|)/).map(token => {
      if (!token || /^\s+$/.test(token)) return token;
      if (token === '|') { segmentStart = true; return token; }
      const word = token.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+|[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+$/g, '');
      const keepLowercase = minorWords.has(word) && !firstWord && !segmentStart;
      const formatted = keepLowercase ? token : token.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]/, letter => letter.toLocaleUpperCase('pt-BR'));
      firstWord = false;
      segmentStart = false;
      return formatted;
    }).join('');
  };
  const onlyDigits = window.PedeAquiValidators?.onlyDigits || ((value) => String(value ?? '').replace(/\D/g, ''));
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
  const restaurantStore = () => window.PedeAquiRestaurantStore;
  const customerStore = () => window.PedeAquiCustomerStore;
  const cartStore = () => window.PedeAquiCartStore;
  const uiStore = () => window.PedeAquiUiStore;
  const productOptionGroups = (product) => Array.isArray(product?.option_groups) ? product.option_groups : [];
  const optionGroupSelections = (group) => pmSelectedOptions[String(group.id)] || [];
  const optionAdditionalPrice = (option) => Number(option?.additional_price || 0);
  const cartItemUnitPrice = (item) => Number(item.visual_unit_price ?? item.unit_price ?? item.price ?? 0);
  // Delegates to the canonical uid generator in cart-service (Fase 1). Previously
  // this file called a bare newCartItemUid() that was never in scope here — a
  // latent ReferenceError on the uid-less restore path, surfaced by ESLint.
  const newCartItemUid = () =>
    window.PedeAquiCartService?.newCartItemUid?.() ||
    (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const maxFiniteNumber = (...values) => values.reduce((max, value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);

  function persistCustomer(nextCustomer) {
    customer = nextCustomer || null;
    appState.customer = customer;
    customerStore()?.setCustomer?.(customer);
    if (customer) storageKeys()?.writeSessionCustomer?.(customer);
    else storageKeys()?.clearSessionCustomer?.();
    return customer;
  }

  function persistCustomerAddress(address) {
    if (!address) return null;
    customerAddress = window.PedeAquiAddressService?.saveSelectedAddress?.(address) || address;
    customerStore()?.setSelectedAddress?.(customerAddress);
    return customerAddress;
  }

  function currentCustomerSnapshot() {
    return customer || window.PedeAquiCustomerService?.getStoredCustomer?.() || null;
  }

  function setLoading(scope, active) {
    if (appState.loading[scope] === active) return;
    appState.loading[scope] = active;
    restaurantStore()?.setLoading?.(scope, active);
  }

  function logAppError(message, error) {
    console.error(`[PedeAqui] ${message}`, error);
  }

  /**
   * Toda mensagem de erro de API desta página passa por aqui. O `detail` chega
   * como string, array (422) ou objeto (pagamento), e só o PedeAquiApiError sabe
   * ler os três — interpolar o valor cru mostraria "[object Object]" ao cliente.
   * O fallback é sempre uma frase em português: se não houver texto legível, é
   * ele que vai para a tela.
   */
  function apiErrorMessage(error, fallback) {
    return window.PedeAquiApiError?.errorMessage?.(error, fallback) || fallback;
  }

  /** Texto legível de um `detail` cru (string | array | objeto). '' se não houver. */
  function detailText(value) {
    return window.PedeAquiApiError?.detailText?.(value) || '';
  }

  function setAppBooting(active) {
    setLoading('app', active);
    document.body.classList.toggle('app-booting', active);
    if (active) document.body.classList.remove('app-error');
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function resetRuntimeStateForPageLoad() {
    payload = {};
    restaurant = {};
    settings = {};
    branches = [];
    categories = [];
    products = [];
    banners = [];
    highlightBanners = [];
    coupons = [];
    restaurantInfoState = { status: 'idle', key: null, data: null, updatedAt: null };
    restaurantInfoPromise = null;
    availableCheckoutPaymentKeys = new Set();
    paymentMethod = '';
    paymentMethodKey = '';
    paymentApiTypeByKey.clear();
    paymentScopeByKey.clear();
    currentProd = null;
    editingCartItemUid = null;
    selectedCoupon = null;
    selectedCouponPreview = null;
    couponPreviewPromise = null;
    couponPreviewKey = '';
    heroBannerIndex = 0;
    stopHeroAutoplay();
    menuLoadPromise = null;
    profileLoadPromise = null;
    menuRenderSignature = '';
    bannersRenderSignature = '';
    couponsRenderSignature = '';
    highlightsRenderSignature = '';
    menuSectionsCache = [];
    categoryButtonsCache = [];
    appState.restaurant = null;
    appState.homeLoaded = false;
    appState.menuLoaded = false;
    appState.clubLoaded = false;
    appState.profileLoaded = false;
    appState.productsByCategory = null;
    appState.customerOrders = null;
    appState.customerAddresses = null;
    appState.clubData = null;
    appState.loading = {
      app: false,
      home: false,
      menu: false,
      club: false,
      profile: false
    };
    restaurantStore()?.set?.({
      restaurant: null,
      settings: {},
      branches: [],
      categories: [],
      products: [],
      banners: [],
      highlightBanners: [],
      coupons: [],
      homeLoaded: false,
      menuLoaded: false,
      clubData: null
    });
  }

  // Erro lançado quando a URL não corresponde a um restaurante existente/ativo.
  // Marcado para que showAppError() o distinga de uma falha de rede: aqui
  // "tentar novamente" não resolve nada.
  function restaurantNotFoundError(slugValue) {
    const error = new Error('Restaurante não encontrado');
    error.isRestaurantNotFound = true;
    error.slug = slugValue || '';
    return error;
  }

  function showAppError(error) {
    setLoading('app', false);
    document.body.classList.remove('app-booting');
    document.body.classList.add('app-error');
    const notFound = error?.isRestaurantNotFound === true;
    document.body.classList.toggle('app-error--not-found', notFound);
    if ($('appLoaderTitle')) {
      $('appLoaderTitle').textContent = notFound ? 'Restaurante não encontrado' : 'Não foi possível carregar';
    }
    if ($('appLoaderMessage')) {
      $('appLoaderMessage').textContent = notFound
        ? 'Confira o endereço que você acessou. Este link não corresponde a nenhum restaurante ativo no Rapidex.'
        : 'Verifique sua conexão e tente novamente.';
    }
    // Retry só faz sentido para falha transitória; um slug errado continuaria errado.
    if ($('appLoaderRetry')) $('appLoaderRetry').hidden = notFound;
    logAppError(notFound ? 'Restaurante não encontrado' : 'Falha ao carregar restaurante', error);
  }

  function renderSectionLoader(targetId, message, className = 'section-loader') {
    const target = $(targetId);
    if (!target) return;
    target.innerHTML = `<div class="${className}">${esc(message)}</div>`;
  }

  // `retryAction` é o NOME de uma ação registrada, não um trecho de código:
  // o botão declara data-act-click e o despachante resolve. Antes isto era uma
  // string de JS costurada dentro de onclick="".
  function renderSectionError(targetId, message, retryAction) {
    const target = $(targetId);
    if (!target) return;
    target.innerHTML = `
      <div class="section-loader section-loader-error">
        <div>
          <div>${esc(message)}</div>
          ${retryAction ? `<button class="section-loader-retry" type="button" ${act('click', retryAction)}>Tentar novamente</button>` : ''}
        </div>
      </div>`;
  }

  function renderTabLoader(targetId, message) {
    renderSectionLoader(targetId, message, 'tab-loader tab-loader--dots');
  }

  const clubController = window.PedeAquiRestaurantClub.createRestaurantClubController({
    appState,
    getRestaurantSlug,
    getCouponContext: () => {
      const totals = cartTotals();
      return { subtotal: totals.subtotal, deliveryFee: totals.delivery, orderType: deliveryType };
    },
    restaurantStore,
    setLoading,
    logAppError,
    handleUnauthorized: async () => {
      await syncCustomerSession();
      openLoginScreen('club');
    },
    esc
  });

  let cashbackSubscriptionReady = false;

  function cashbackValueText(cashbackState) {
    const auth = window.PedeAquiCustomerAuth;
    if (!auth?.getToken?.()) return fmt(0);
    if (cashbackState?.status === 'loading' || cashbackState?.status === 'idle') return 'R$ --,--';
    const balance = Number(cashbackState?.data?.balance);
    return Number.isFinite(balance) ? fmt(balance) : fmt(0);
  }

  function renderSharedCashbackState(state = window.PedeAquiClubService?.getState?.()) {
    const text = cashbackValueText(state?.cashback);
    if ($('homeCartTotal')) $('homeCartTotal').textContent = text;
    if ($('clubCashbackBalance')) $('clubCashbackBalance').textContent = text;
    if ($('cashbackStatementBalance')) $('cashbackStatementBalance').textContent = text;
  }

  function initCashbackState() {
    if (cashbackSubscriptionReady) return;
    cashbackSubscriptionReady = true;
    $('homeCartTotal')?.closest('button')?.setAttribute('aria-label', 'Abrir Clube');
    window.PedeAquiClubService?.subscribe?.(renderSharedCashbackState);
  }

  function loadCashbackForHome(options = {}) {
    initCashbackState();
    const auth = window.PedeAquiCustomerAuth;
    renderSharedCashbackState();
    if (!auth?.getToken?.() || !auth?.isSessionReady?.()) return Promise.resolve(null);
    return window.PedeAquiClubService?.getCashback?.(options) || Promise.resolve(null);
  }

  function cashbackTransactionLabel(type) {
    return ({
      earned: 'Cashback recebido',
      redeemed: 'Cashback utilizado',
      expired: 'Cashback expirado',
      cancelled: 'Cashback cancelado',
      adjustment: 'Ajuste de cashback'
    })[String(type || '').toLowerCase()] || 'Movimentação de cashback';
  }

  function cashbackTransactionDate(value) {
    if (!value) return '';
    const source = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(source) ? new Date(`${source}T12:00:00`) : new Date(source);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
  }

  function cashbackTransactionAmount(value) {
    const amount = Number(value || 0);
    if (amount > 0) return `+${fmt(amount)}`;
    if (amount < 0) return `-${fmt(Math.abs(amount))}`;
    return fmt(0);
  }

  function cashbackTransactionDescription(transaction) {
    return transaction.description
      || transaction.restaurant_name
      || transaction.merchant_name
      || (transaction.order_number ? `Pedido #${transaction.order_number}` : '')
      || '';
  }

  function renderCashbackStatement(state = window.PedeAquiClubService?.getState?.()) {
    renderSharedCashbackState(state);
    const body = $('cashbackStatementBody');
    if (!body) return;
    const transactions = state?.transactions;
    if (!transactions || transactions.status === 'idle' || transactions.status === 'loading') {
      body.innerHTML = `<div class='cashback-statement-state'>Carregando extrato...</div>`;
      return;
    }
    if (transactions.status === 'error') {
      body.innerHTML = `<div class='cashback-statement-state'>Não foi possível carregar o extrato.<button class='cashback-statement-retry' type='button' ${act('click', 'retryCashbackStatement')}>Tentar novamente</button></div>`;
      return;
    }
    const items = Array.isArray(transactions.data) ? transactions.data : [];
    if (!items.length) {
      body.innerHTML = `<div class='cashback-statement-state'>Você ainda não possui movimentações de cashback.</div>`;
      return;
    }
    body.innerHTML = items.map(transaction => {
      const amount = Number(transaction.amount || 0);
      const description = cashbackTransactionDescription(transaction);
      const date = cashbackTransactionDate(transaction.created_at);
      return `<article class='cashback-statement-row'>
        <div class='cashback-statement-copy'>
          ${date ? `<time>${esc(date)}</time>` : ''}
          <strong>${esc(cashbackTransactionLabel(transaction.type))}</strong>
          ${description ? `<span>${esc(description)}</span>` : ''}
        </div>
        <div class='cashback-statement-amount ${amount > 0 ? 'positive' : amount < 0 ? 'negative' : ''}'>${esc(cashbackTransactionAmount(amount))}</div>
      </article>`;
    }).join('');
  }

  function configureCashbackStatementLayout() {
    const overlay = $('cashbackStatementModal');
    const modal = overlay?.querySelector('.cashback-statement-modal');
    if (!overlay || !modal) return;
    const properties = ['display', 'align-items', 'justify-content', 'padding', 'background', 'z-index'];
    const modalProperties = ['position', 'top', 'right', 'bottom', 'left', 'width', 'max-width', 'height', 'max-height', 'margin', 'transform', 'transition'];
    properties.forEach(property => overlay.style.removeProperty(property));
    modalProperties.forEach(property => modal.style.removeProperty(property));
    if (!$('mobViewClub')?.classList.contains('active')) return;
    overlay.style.setProperty('display', 'flex', 'important');
    overlay.style.setProperty('align-items', 'flex-start', 'important');
    overlay.style.setProperty('justify-content', 'center', 'important');
    overlay.style.setProperty('padding', '10px 14px calc(95px + var(--safe-bottom))', 'important');
    overlay.style.setProperty('background', 'transparent', 'important');
    overlay.style.setProperty('z-index', '125', 'important');
    modal.style.setProperty('position', 'relative', 'important');
    modal.style.setProperty('top', '0', 'important');
    modal.style.setProperty('width', '386px', 'important');
    modal.style.setProperty('max-width', '100%', 'important');
    modal.style.setProperty('height', 'calc(100dvh - 105px)', 'important');
    modal.style.setProperty('max-height', 'none', 'important');
    modal.style.setProperty('margin', '0', 'important');
    modal.style.setProperty('transform', 'translateX(100%)', 'important');
    modal.style.setProperty('transition', 'transform .28s cubic-bezier(.4,0,.2,1)', 'important');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (overlay.classList.contains('active')) modal.style.setProperty('transform', 'translateX(0)', 'important');
    }));
  }

  function closeCashbackStatement(event) {
    if (event && event.target !== event.currentTarget) return;
    const overlay = $('cashbackStatementModal');
    const modal = overlay?.querySelector('.cashback-statement-modal');
    if (!overlay?.classList.contains('active') || !modal) return;
    modal.style.setProperty('transform', 'translateX(100%)', 'important');
    setTimeout(() => closeUiModalId('cashbackStatementModal'), 280);
  }

  async function openCashbackStatement() {
    const auth = window.PedeAquiCustomerAuth;
    if (!auth?.getToken?.()) {
      openLoginScreen();
      return;
    }
    openModal('cashbackStatementModal');
    configureCashbackStatementLayout();
    if (!auth.isSessionReady?.()) await syncCustomerSession();
    if (!auth.getToken?.()) {
      closeModalId('cashbackStatementModal');
      openLoginScreen();
      return;
    }
    const service = window.PedeAquiClubService;
    const balancePromise = service?.getCashback?.() || Promise.resolve(null);
    const transactionsPromise = service?.getTransactions?.() || Promise.resolve(null);
    renderCashbackStatement(service?.getState?.());
    await Promise.all([balancePromise, transactionsPromise]);
    renderCashbackStatement(service?.getState?.());
  }

  async function retryCashbackStatement() {
    const service = window.PedeAquiClubService;
    const request = service?.getTransactions?.({ force: true }) || Promise.resolve(null);
    renderCashbackStatement(service?.getState?.());
    await request;
    renderCashbackStatement(service?.getState?.());
  }

  function handleHomeLoginPromptClick() {
    if (isLogged()) return;
    openLoginScreen();
  }

  function renderHomeLoginPrompt() {
    const loginPrompt = $('homeLoginPrompt');
    if (!loginPrompt) return;
    const logged = isLogged();
    const name = firstName(customer?.name);
    loginPrompt.textContent = logged ? `Olá, ${name || 'Cliente'}` : 'Entre ou cadastre-se';
    loginPrompt.dataset.actClick = 'handleHomeLoginPromptClick';
    loginPrompt.disabled = logged;
    loginPrompt.setAttribute('aria-disabled', String(logged));
  }

  // Sem fallback: se a URL não identifica um restaurante, o slug é vazio e o
  // boot para com "Restaurante não encontrado". Servir outro tenant no lugar
  // (o que acontecia com DEFAULT_RESTAURANT_SLUG) é falha de isolamento.
  function getRestaurantSlug() {
    return window.RapidexTenant?.resolveSlug?.() || '';
  }

  function normalizePayload(raw) {
    return window.PedeAquiMenuService?.normalizeMenuPayload
      ? window.PedeAquiMenuService.normalizeMenuPayload(raw)
      : raw;
  }

  function imageAttrs({ lazy = true, priority = 'auto' } = {}) {
    const loading = lazy ? 'lazy' : 'eager';
    const fetchPriority = priority && priority !== 'auto' ? ` fetchpriority="${priority}"` : '';
    return `loading="${loading}" decoding="async"${fetchPriority}`;
  }

  function waitForImageReady(img) {
    if (!img || !img.src) return Promise.resolve();
    img.loading = 'eager';
    if (img.complete) {
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    }
    return new Promise(resolve => {
      const done = () => {
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        if (img.decode) img.decode().catch(() => {}).finally(resolve);
        else resolve();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  async function waitForHomeCriticalMedia(timeoutMs = 1400) {
    const selectors = [
      '.mob-logo img',
      '#restaurantHeroImg',
      '#restaurantHeroTrack img',
      '#couponRail img',
      '#highlightRail img'
    ];
    const images = Array.from(document.querySelectorAll(selectors.join(',')))
      .filter(img => img && img.src)
      .slice(0, 10);
    if (!images.length) return;
    await Promise.race([
      Promise.allSettled(images.map(waitForImageReady)),
      wait(timeoutMs)
    ]);
  }

  // Emite srcset para a foto de catálogo quando a origem é transformável.
  //
  // `box`: { w, h } em CSS px quando a caixa tem tamanho fixo — aí o DPR é a
  //        única variável e descritores `x` bastam, sem repetir o CSS num
  //        `sizes`. w e h são declarados SEPARADAMENTE de propósito: a arte do
  //        cupom é 168x90, e assumir caixa quadrada publicaria uma proporção
  //        intrínseca errada, que é justamente o reflow que queremos evitar.
  // `fluid`: { widths, sizes } quando a caixa acompanha a viewport.
  //
  // Sem nenhum dos dois — ou com uma URL que não é do Storage — devolve vazio e
  // a imagem sai exatamente como saía antes: só o original em src.
  function responsiveImageAttrs(url, { box, fluid } = {}) {
    const cdn = window.RapidexImageCdn;
    if (!cdn || !url) return '';

    if (box) {
      const set = cdn.srcsetByDpr(url, box.w);
      // width/height reservam a caixa antes do byte chegar. O CSS já fixa esses
      // mesmos lados, então não muda layout — só evita o reflow do carregamento.
      return set ? ` srcset="${esc(set)}" width="${box.w}" height="${box.h}"` : '';
    }
    if (fluid) {
      const set = cdn.srcsetByWidth(url, fluid.widths);
      return set ? ` srcset="${esc(set)}" sizes="${esc(fluid.sizes)}"` : '';
    }
    return '';
  }

  // O herói é full-bleed (aspect-ratio 1080/500 — styles/utilities.css:652) e a
  // arte é autorada a 1080 de largura, então a grade para aí.
  const HERO_FLUID = { widths: [480, 768, 1080, 1440], sizes: '(max-width: 1080px) 100vw, 1080px' };
  // .coupon-card tem 168px de largura (styles/utilities.css:1205) e a arte
  // dentro dela tem 90px de altura (.coupon-art — styles/utilities.css:768).
  const RAIL_BOX = { w: 168, h: 90 };
  // .highlight-banner troca de regime por breakpoint: 290px fixos no desktop,
  // 65%/78% da viewport no mobile (styles/utilities.css:857/1260/1414). Como
  // não é largura fixa em todo lugar, vai de `w` + sizes.
  const HIGHLIGHT_FLUID = {
    widths: [290, 440, 580, 780, 870],
    sizes: '(max-width: 900px) 78vw, 290px'
  };
  // .coupon-detail-art — width:min(100%,414px) (styles/utilities.css:237).
  const COUPON_DETAIL_FLUID = {
    widths: [414, 620, 828, 1242],
    sizes: '(max-width: 414px) 100vw, 414px'
  };

  // Versão para <img> que JÁ existe no DOM (o herói é atualizado por
  // propriedade, não recriado por template).
  function applyResponsiveImage(img, url, { box, fluid } = {}) {
    const cdn = window.RapidexImageCdn;
    if (!img || !cdn) return;
    const set = fluid ? cdn.srcsetByWidth(url, fluid.widths) : cdn.srcsetByDpr(url, box.w);
    if (!set) {
      // Origem não transformável: limpa o srcset ANTERIOR. Sem isto, trocar o
      // banner por um de outro CDN deixaria o srcset velho no elemento e o
      // browser continuaria pintando a imagem antiga, ignorando o src novo.
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      return;
    }
    img.srcset = set;
    if (fluid) img.sizes = fluid.sizes;
    else img.removeAttribute('sizes');
  }

  function productImage(product, className = 'product-image', options = {}) {
    const image = product.image_url || product.image_path;
    if (image) {
      return `<img class="${className}" src="${esc(image)}"${responsiveImageAttrs(image, options)} alt="${esc(product.name)}" ${imageAttrs(options)}>`;
    }
    // initials() recorta a 1ª letra de cada palavra do nome vindo da API — e um
    // nome como "<img src=x>" faz esse recorte devolver "<I". Não dá para montar
    // um payload com dois caracteres, mas o "<" cru abre uma tag no parser e
    // corrompe o card. Aqui é innerHTML: passa pelo esc() como todo o resto.
    return `<div class="${className} product-image--placeholder"><span>${esc(initials(product.name))}</span></div>`;
  }

  let detailImageRenderSequence = 0;

  function readyCardImage(source, cardSelector, imageSelector) {
    const card = source?.closest?.(cardSelector);
    const image = card?.querySelector?.(imageSelector);
    return image?.complete && image.naturalWidth > 0 ? image : null;
  }

  function couponImageUrl(coupon = {}) {
    return coupon.image_url || coupon.image || coupon.image_path || coupon.banner_url || coupon.cover_url || '';
  }

  // A miniatura do card já está baixada e decodificada no momento do clique.
  // Ela ocupa o detalhe imediatamente; a variante maior só assume depois de
  // terminar o decode. Assim o fundo do contêiner nunca pisca entre as telas.
  function renderDetailImage(container, { url, alt, className, fluid, preview, fallbackMarkup = '' }) {
    if (!container) return;
    const renderId = String(++detailImageRenderSequence);
    container.dataset.detailImageRender = renderId;
    container.replaceChildren();

    const previewSrc = preview?.currentSrc || preview?.src || '';
    let previewImage = null;
    if (previewSrc) {
      previewImage = document.createElement('img');
      previewImage.className = `${className} detail-image-preview`;
      previewImage.alt = '';
      previewImage.setAttribute('aria-hidden', 'true');
      previewImage.decoding = 'sync';
      previewImage.src = previewSrc;
      container.appendChild(previewImage);
    }

    const fullImage = document.createElement('img');
    fullImage.className = `${className} detail-image-full`;
    fullImage.alt = alt || '';
    fullImage.loading = 'eager';
    fullImage.decoding = 'async';
    fullImage.fetchPriority = 'high';
    applyResponsiveImage(fullImage, url, { fluid });

    let settled = false;
    let retryingOriginal = false;
    const isCurrent = () => container.dataset.detailImageRender === renderId && fullImage.isConnected;
    const reveal = async () => {
      if (settled) return;
      settled = true;
      if (fullImage.decode) await fullImage.decode().catch(() => {});
      if (!isCurrent()) return;
      fullImage.classList.add('is-ready');
      previewImage?.remove();
    };
    const fail = () => {
      if (settled || !isCurrent()) return;
      if (!retryingOriginal && fullImage.hasAttribute('srcset')) {
        retryingOriginal = true;
        fullImage.removeAttribute('srcset');
        fullImage.removeAttribute('sizes');
        fullImage.src = url;
        return;
      }
      settled = true;
      fullImage.remove();
      if (!previewImage && fallbackMarkup) container.innerHTML = fallbackMarkup;
    };

    fullImage.addEventListener('load', reveal, { once: true });
    fullImage.addEventListener('error', fail);
    fullImage.src = url;
    container.appendChild(fullImage);
    if (fullImage.complete) {
      if (fullImage.naturalWidth > 0) reveal();
      else fail();
    }
  }

  function productOldPrice(product) {
    return product.old_price ?? product.original_price ?? product.price_old ?? product.compare_at_price ?? product.list_price ?? null;
  }

  function paymentMethodLabel(method) {
    const key = String(method || '').toLowerCase();
    const labels = {
      pix: 'Pix',
      credit_card: 'Cartão de crédito',
      debit_card: 'Cartão de débito',
      vr_va: 'Vale-refeição / alimentação',
      cash: 'Dinheiro'
    };
    return labels[key] || String(method || '').replace(/_/g, ' ');
  }

  function renderStoreInfoPayment() {
    renderRestaurantInfoPayment(restaurantInfoState.data);
  }

  function deliveryWindowText() {
    const min = settings.estimated_delivery_time_min ?? fallback().defaultDeliveryTimeMin ?? 0;
    const max = settings.estimated_delivery_time_max ?? fallback().defaultDeliveryTimeMax ?? 0;
    return `${min}-${max} min`;
  }

  function renderDeliveryMeta() {
    const estimateFee = currentDeliveryEstimateFee();
    const feeText = estimateFee == null ? 'Taxa indisponivel' : fmt(estimateFee);
    if ($('cartDeliveryFeeText')) $('cartDeliveryFeeText').textContent = feeText;
    renderDeliveryEstimate();
  }

  function setStoreInfoTab(tab = 'hours') {
    const order = { hours: 0, address: 1, payment: 2 };
    const modal = $('infoModal');
    const tabs = document.querySelector('#infoModal .store-info-tabs');
    if (modal) modal.dataset.storeInfoTab = tab;
    if (tabs) tabs.style.setProperty('--store-tab-index', order[tab] ?? 0);
    document.querySelectorAll('[data-store-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.storeTab === tab);
    });
    const map = {
      hours: document.querySelector('.store-hours-card'),
      address: document.querySelector('.store-address-card'),
      payment: $('storeInfoPayment')
    };
    Object.entries(map).forEach(([key, element]) => {
      if (element) element.style.display = key === tab ? '' : 'none';
    });
  }

  function initStoreInfoModal() {
    const header = document.querySelector('#infoModal .store-info-header');
    const close = document.querySelector('#infoModal .store-info-close');
    const title = document.querySelector('#infoModal .store-info-header h2');
    const tabs = document.querySelector('#infoModal .store-info-tabs');
    const addressCard = document.querySelector('#infoModal .store-address-card');
    const hoursCard = document.querySelector('#infoModal .store-hours-card');
    if (close) {
      close.setAttribute('aria-label', 'Voltar');
      close.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
    }
    if (title) title.textContent = 'Informações';
    if (header && close && title) {
      const spacer = header.querySelector('.store-info-spacer');
      header.insertBefore(close, header.firstElementChild);
      if (spacer) header.appendChild(spacer);
    }
    if (header) header.classList.add('store-info-header--reference');
    if (tabs) {
      tabs.innerHTML = [
        `<button class="active" type="button" data-store-tab="hours" ${act('click', 'setStoreInfoTab', 'hours')}>Horários</button>`,
        `<button type="button" data-store-tab="address" ${act('click', 'setStoreInfoTab', 'address')}>Endereço</button>`,
        `<button type="button" data-store-tab="payment" ${act('click', 'setStoreInfoTab', 'payment')}>Pagamento</button>`
      ].join('');
    }
    if (hoursCard) {
      hoursCard.innerHTML = '<div class="store-info-load-state">Carregando informações...</div>';
    }
    if (addressCard && !$('storeInfoPayment')) {
      addressCard.insertAdjacentHTML('afterend', '<section class="store-payment-card" id="storeInfoPayment"><h3>Pagamento</h3><p>Formas de pagamento não informadas</p></section>');
    }
    setStoreInfoTab('hours');
  }

  function infoPaymentType(value) {
    const key = normalizeAddressPart(value).replace(/[^a-z0-9]+/g, '_');
    if (key.includes('credit')) return 'credit';
    if (key.includes('credito')) return 'credit';
    if (key.includes('debit')) return 'debit';
    if (key.includes('debito')) return 'debit';
    if (key.includes('pix')) return 'pix';
    if (key.includes('cash') || key.includes('dinheiro')) return 'cash';
    if (key.includes('voucher') || key.includes('vale') || key === 'vr_va') return 'voucher';
    if (key.includes('card') || key.includes('cartao')) return 'card';
    return key;
  }

  function normalizeInfoPaymentMethods(source) {
    const entries = [];
    const add = (raw, fallbackType, fallbackBrand) => {
      if (raw === false || raw?.enabled === false || raw?.is_active === false) return;
      const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const methodType = infoPaymentType(object.method_type || object.type || object.code || object.method || fallbackType || object.name || raw);
      if (!methodType) return;
      const brands = object.brands || object.card_brands;
      if (Array.isArray(brands) && brands.length) {
        brands.forEach(brand => add({ ...object, brands: null, brand }, methodType));
        return;
      }
      entries.push({
        ...object,
        method_type: methodType,
        // method_type acima é a chave NORMALIZADA da UI (credit, debit, pix...).
        // O backend usa outra grafia (credit_card, debit_card...) e é ela que
        // precisa voltar em POST /orders.payment_method — por isso guardamos a
        // original aqui antes de perdê-la.
        api_method_type: String(object.method_type || object.type || object.code || object.method || fallbackType || '').trim(),
        brand: object.brand || object.card_brand || fallbackBrand || '',
        name: object.display_name || object.name || object.label || fallbackBrand || ''
      });
    };
    if (Array.isArray(source)) source.forEach(item => add(item));
    else if (source && typeof source === 'object') {
      Object.entries(source).forEach(([type, value]) => {
        if (Array.isArray(value)) value.forEach(item => typeof item === 'string' ? add({}, type, item) : add(item, type));
        else if (value === true) add({}, type);
        else if (value && typeof value === 'object') add(value, type);
      });
    }
    const seen = new Set();
    return entries.filter(entry => {
      const key = `${entry.method_type}:${normalizeAddressPart(entry.brand || entry.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function infoPaymentData(data = restaurantInfoState.data) {
    const methods = data?.payment_methods || {};
    return {
      online: normalizeInfoPaymentMethods(methods.online),
      delivery: normalizeInfoPaymentMethods(methods.delivery)
    };
  }

  function infoPaymentLabel(entry) {
    if (entry.name || entry.brand) return entry.name || entry.brand;
    return ({
      pix: 'PIX',
      credit: 'Cartão de crédito',
      debit: 'Cartão de débito',
      cash: 'Dinheiro',
      voucher: 'Vale-refeição / alimentação',
      card: 'Cartão'
    })[entry.method_type] || paymentMethodLabel(entry.method_type);
  }

  function infoBrandClass(value) {
    const key = normalizeAddressPart(value).replace(/[^a-z0-9]+/g, '');
    if (key.includes('amex') || key.includes('american')) return 'pay-brand--amex';
    if (key.includes('elo')) return 'pay-brand--elo';
    if (key.includes('hiper')) return 'pay-brand--hiper';
    if (key.includes('master')) return 'pay-brand--master';
    if (key.includes('visa')) return 'pay-brand--visa';
    return '';
  }

  function renderInfoPaymentEntries(entries) {
    return entries.map(entry => {
      const label = infoPaymentLabel(entry);
      return `<span><i class='pay-brand ${infoBrandClass(label)}'></i>${esc(label)}</span>`;
    }).join('');
  }

  function renderRestaurantInfoPayment(data) {
    const box = $('storeInfoPayment');
    if (!box) return;
    const groups = infoPaymentData(data);
    const sections = [];
    if (groups.online.length) {
      sections.push(`<p class='store-payment-title'>Pagamento online</p><div class='store-payment-grid'>${renderInfoPaymentEntries(groups.online)}</div>`);
    }
    const deliveryGroups = ['credit', 'debit', 'cash', 'pix', 'voucher']
      .map(type => [type, groups.delivery.filter(entry => entry.method_type === type)])
      .filter(([, entries]) => entries.length);
    if (deliveryGroups.length) {
      sections.push(`<p class='store-payment-title'>Pagamento na entrega</p>`);
      deliveryGroups.forEach(([type, entries]) => {
        const label = ({ credit: 'Crédito', debit: 'Débito', cash: 'Dinheiro', pix: 'PIX na entrega', voucher: 'Vale-refeição / alimentação' })[type];
        sections.push(`<p class='store-payment-group${type === 'debit' ? ' store-payment-group--debit' : ''}'>${label}</p><div class='store-payment-grid'>${renderInfoPaymentEntries(entries)}</div>`);
      });
    }
    box.innerHTML = sections.length ? sections.join('') : '<p>Formas de pagamento não informadas.</p>';
  }

  function infoWeekdayLabel(item) {
    if (item.display_name || item.day_name || item.label) return item.display_name || item.day_name || item.label;
    const labels = {
      monday: 'Segunda-feira', tuesday: 'Terça-feira', wednesday: 'Quarta-feira', thursday: 'Quinta-feira', friday: 'Sexta-feira', saturday: 'Sábado', sunday: 'Domingo',
      segunda: 'Segunda-feira', terca: 'Terça-feira', quarta: 'Quarta-feira', quinta: 'Quinta-feira', sexta: 'Sexta-feira', sabado: 'Sábado', domingo: 'Domingo'
    };
    const normalized = normalizeAddressPart(item.weekday);
    const isoLabels = { 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado', 7: 'Domingo' };
    return labels[normalized] || isoLabels[Number(item.weekday)] || String(item.weekday ?? '');
  }

  function infoTime(value) {
    return nonEmptyString(value)?.slice(0, 5) || '';
  }

  function infoHoursText(item) {
    if (item.is_closed === true) return 'Fechado';
    const periods = item.periods || item.intervals || item.ranges || [];
    const normalized = Array.isArray(periods) && periods.length ? periods : [item];
    const text = normalized.map(period => {
      const start = infoTime(period.open_time || period.opens_at || period.start || period.from);
      const end = infoTime(period.close_time || period.closes_at || period.end || period.to);
      return start && end ? `${start} às ${end}` : '';
    }).filter(Boolean);
    return text.length ? text.join(' - ') : 'Fechado';
  }

  function renderInfoLogo(url, name) {
    const container = $('infoStoreLogo');
    if (!container) return;
    container.replaceChildren();
    if (!url) {
      const fallbackElement = document.createElement('div');
      fallbackElement.className = 'mob-logo-fallback';
      fallbackElement.textContent = initials(name);
      container.appendChild(fallbackElement);
      return;
    }
    const image = document.createElement('img');
    image.src = url;
    image.alt = name || 'Restaurante';
    image.addEventListener('error', () => {
      const fallbackElement = document.createElement('div');
      fallbackElement.className = 'mob-logo-fallback';
      fallbackElement.textContent = initials(name);
      container.replaceChildren(fallbackElement);
    }, { once: true });
    container.appendChild(image);
  }

  function infoFullAddress(branch = {}) {
    if (nonEmptyString(branch.full_address)) return branch.full_address;
    const address = branch.address && typeof branch.address === 'object' ? branch.address : branch;
    if (nonEmptyString(address.full_address)) return address.full_address;
    if (typeof branch.address === 'string' && branch.address.trim()) return branch.address;
    return [
      [address.street || address.street_name, address.number].filter(Boolean).join(', '),
      address.neighborhood,
      address.city,
      address.state
    ].filter(Boolean).join(' - ');
  }

  function renderProfileRestaurantInfo(data) {
    const body = document.querySelector('#profSubinfo .prof-sub-body');
    if (!body) return;
    const branch = data?.branch || {};
    const hours = Array.isArray(data?.business_hours) ? data.business_hours : (Array.isArray(branch.business_hours) ? branch.business_hours : []);
    const methods = infoPaymentData(data);
    const whatsapp = onlyDigits(branch.whatsapp || '');
    const paymentEntries = [...methods.online, ...methods.delivery];
    body.innerHTML = `
      <div class='prof-info-card'>
        <div class='prof-info-card-header'><span class='prof-info-card-title'>${esc(branch.display_name || branch.name || 'Unidade')}</span></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>Endereço</div><div class='prof-info-row-val'>${esc(infoFullAddress(branch) || 'Endereço não informado')}</div></div></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>Telefone</div><div class='prof-info-row-val'>${esc(branch.phone || 'Telefone não informado')}</div></div></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>E-mail</div><div class='prof-info-row-val'>${esc(branch.email || 'E-mail não informado')}</div></div></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>WhatsApp</div>${whatsapp ? `<a class='prof-info-row-link' href='https://wa.me/${whatsapp.startsWith('55') ? whatsapp : `55${whatsapp}`}' target='_blank' rel='noopener'>${esc(branch.whatsapp)}</a>` : `<div class='prof-info-row-val'>WhatsApp não informado</div>`}</div></div>
      </div>
      <div class='prof-info-card'>
        <div class='prof-info-card-header'><span class='prof-info-card-title'>Horário de funcionamento</span></div>
        ${hours.length ? hours.map(item => `<div class='prof-info-row'><div><div class='prof-info-row-label'>${esc(infoWeekdayLabel(item))}</div><div class='prof-info-row-val'>${esc(infoHoursText(item))}</div></div></div>`).join('') : `<div class='prof-info-row-val'>Horários não informados.</div>`}
      </div>
      <div class='prof-info-card'>
        <div class='prof-info-card-header'><span class='prof-info-card-title'>Formas de pagamento</span></div>
        ${profilePaymentChips(paymentEntries)}
      </div>`;
  }

  function renderRestaurantInfo(data) {
    const apiRestaurant = data?.restaurant || {};
    const branch = data?.branch || {};
    const name = apiRestaurant.name || restaurant.name || 'Restaurante';
    renderInfoLogo(apiRestaurant.logo_url || apiRestaurant.logo_path || restaurant.logo_url || restaurant.logo_path, name);
    document.querySelectorAll('#infoModal .store-info-name').forEach(element => { element.textContent = name; });
    document.querySelectorAll('#infoModal .store-info-neighborhood').forEach(element => { element.textContent = branch.display_name || branch.name || ''; });
    document.querySelectorAll('#infoModal .store-info-phone').forEach(element => { element.textContent = branch.phone || 'Telefone não informado'; });
    document.querySelectorAll('#infoModal .store-info-email').forEach(element => { element.textContent = branch.email || 'E-mail não informado'; });
    document.querySelectorAll('#infoModal .store-info-whatsapp').forEach(element => { element.textContent = branch.whatsapp || 'WhatsApp não informado'; });
    document.querySelectorAll('#infoModal .store-contact-row--wa').forEach(element => {
      const phone = onlyDigits(branch.whatsapp || '');
      if (phone) element.href = `https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}`;
      else element.removeAttribute('href');
    });
    const currentWeekday = String(data?.current_weekday ?? '');
    const hours = Array.isArray(data?.business_hours) ? data.business_hours : (Array.isArray(branch.business_hours) ? branch.business_hours : []);
    const hoursCard = document.querySelector('#infoModal .store-hours-card');
    if (hoursCard) hoursCard.innerHTML = hours.length
      ? hours.map(item => `<div class='store-hours-row${normalizeAddressPart(item.weekday) === normalizeAddressPart(currentWeekday) ? ' active' : ''}'><span>${esc(infoWeekdayLabel(item))}</span><strong>${esc(infoHoursText(item))}</strong></div>`).join('')
      : '<div class="store-info-load-state">Horários não informados.</div>';
    if ($('storeInfoAddress')) $('storeInfoAddress').textContent = infoFullAddress(branch) || 'Endereço não informado';
    renderRestaurantInfoPayment(data);
    renderProfileRestaurantInfo(data);
    renderProfilePaymentScreen(data);
    renderProfileHelpContacts(data);
    renderCheckoutPaymentMethods(data);
  }

  function renderRestaurantInfoLoading() {
    const hours = document.querySelector('#infoModal .store-hours-card');
    if (hours) hours.innerHTML = '<div class="store-info-load-state">Carregando informações...</div>';
    if ($('storeInfoAddress')) $('storeInfoAddress').textContent = 'Carregando endereço...';
    if ($('storeInfoPayment')) $('storeInfoPayment').innerHTML = '<div class="store-info-load-state">Carregando formas de pagamento...</div>';
  }

  function renderRestaurantInfoError() {
    const hours = document.querySelector('#infoModal .store-hours-card');
    if (hours) hours.innerHTML = '<div class="store-info-load-state">Não foi possível carregar as informações.</div>';
    if ($('storeInfoAddress')) $('storeInfoAddress').textContent = 'Endereço indisponível.';
    if ($('storeInfoPayment')) $('storeInfoPayment').innerHTML = '<div class="store-info-load-state">Não foi possível carregar as formas de pagamento.</div>';
    const profileInfo = document.querySelector('#profSubinfo .prof-sub-body');
    if (profileInfo) profileInfo.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Não foi possível carregar as informações do restaurante.</div></div>';
    renderProfilePaymentError();
    renderCheckoutPaymentMethods(null);
  }

  function restaurantInfoKey() {
    return `${getRestaurantSlug()}::${operationContext?.branch_id || 'default'}`;
  }

  async function ensureRestaurantInfo(options = {}) {
    const restaurantSlug = getRestaurantSlug();
    if (!restaurantSlug || !appState.restaurant) return null;
    const branchId = operationContext?.branch_id || null;
    const key = restaurantInfoKey();
    if (!options.force && restaurantInfoState.status === 'success' && restaurantInfoState.key === key) return restaurantInfoState.data;
    if (restaurantInfoState.status === 'loading' && restaurantInfoState.key === key && restaurantInfoPromise) return restaurantInfoPromise;
    restaurantInfoState = { status: 'loading', key, data: null, updatedAt: null };
    renderRestaurantInfoLoading();
    restaurantInfoPromise = window.PedeAquiRestaurantInfoService.getInfo(restaurantSlug, branchId, options)
      .then(result => {
        if (restaurantInfoState.key !== key) return null;
        restaurantInfoState = { status: 'success', key, data: result.data, updatedAt: Date.now() };
        renderRestaurantInfo(result.data);
        return result.data;
      })
      .catch(error => {
        if (restaurantInfoState.key !== key) return null;
        console.error('[PedeAqui] Falha ao carregar informações do restaurante', error);
        restaurantInfoState = { status: 'error', key, data: null, updatedAt: Date.now() };
        renderRestaurantInfoError();
        return null;
      })
      .finally(() => {
        if (restaurantInfoState.key === key) restaurantInfoPromise = null;
      });
    return restaurantInfoPromise;
  }

  function openRestaurantInfo() {
    openModal('infoModal');
    ensureRestaurantInfo();
  }

  function handleRestaurantInfoContextChange(previousKey) {
    if (previousKey === restaurantInfoKey()) return;
    restaurantInfoState = { status: 'idle', key: null, data: null, updatedAt: null };
    restaurantInfoPromise = null;
    renderCheckoutPaymentMethods(null);
    const needsImmediateReload = $('infoModal')?.classList.contains('active')
      || $('checkoutModal')?.classList.contains('active')
      || $('profSubpagamento')?.classList.contains('active');
    if (needsImmediateReload) ensureRestaurantInfo();
  }

  function ProductCard(product) {
    const currentPrice = Number.isFinite(product.price) ? fmt(product.price) : fallback().productUnavailablePrice || '';
    const oldPrice = Number(productOldPrice(product));
    const hasOldPrice = Number.isFinite(oldPrice) && Number.isFinite(product.price) && oldPrice > product.price;
    return `
      <article class="product-card" data-product-id="${esc(product.id)}" ${act('click', 'openProduct', product.id, '$this')}>
        <div class="product-content">
          <h3 class="product-name">${esc(formatProductTitle(product.name))}</h3>
          ${product.description ? `<p class="product-description">${esc(product.description)}</p>` : ''}
          <div class="product-price-row">
            <span class="product-price">${Number.isFinite(product.price) ? `A partir de ${currentPrice}` : currentPrice}</span>
            ${hasOldPrice ? `<span class="product-old-price">${fmt(oldPrice)}</span>` : ''}
          </div>
        </div>
        <div class="product-image-frame">
          ${/* 110px fixos — body.menu-tab .product-image, styles/utilities.css:4655 */ ''}
          ${productImage(product, 'product-image', { box: { w: 110, h: 110 } })}
        </div>
      </article>
    `;
  }

  /* ---- Scroll-lock robusta para mobile (iOS / Android) ----
     overflow:hidden no body não basta no iOS — o conteúdo de fundo
     ainda recebe eventos de toque e desliza. A solução é fixar o body
     em position:fixed com top = -scrollY, e restaurar ao fechar. */
  const {
    currentScrollY,
    hasBlockingUiOpen,
    lockBodyScroll,
    unlockBodyScroll,
    unlockBodyScrollIfClear,
    openModal,
    openModalImmediately,
    closeModalId: closeUiModalId,
    closeModalImmediately,
    closeModal
  } = window.PedeAquiRestaurantUi;

  let loginReturnNavId = null;

  function resetMenuLoginState() {
    document.body.classList.remove('menu-login-open');
    $('loginModal')?.classList.remove('from-add-address', 'from-coupon', 'from-bottom-nav');
    if (loginReturnNavId && !isLogged() && document.body.classList.contains('menu-tab')) {
      setMobNavActive(loginReturnNavId);
    }
    loginReturnNavId = null;
  }

  function holdMenuScrollPosition(scrollY, durationMs = 720) {
    if (!document.body.classList.contains('menu-tab')) return;
    const startedAt = performance.now();
    const restore = () => window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
    restore();
    requestAnimationFrame(restore);
    const timer = setInterval(() => {
      if (performance.now() - startedAt >= durationMs || !document.body.classList.contains('menu-tab')) {
        clearInterval(timer);
        return;
      }
      restore();
    }, 80);
    setTimeout(restore, durationMs + 20);
  }

  function closeModalId(id) {
    const keepMenuCatsStable = id === 'loginModal' && document.body.classList.contains('menu-tab');
    const menuScrollY = keepMenuCatsStable ? currentScrollY() : 0;
    if (keepMenuCatsStable) document.body.classList.add('menu-login-closing');
    closeUiModalId(id);
    if (id === 'loginModal') {
      resetMenuLoginState();
      if (keepMenuCatsStable) holdMenuScrollPosition(menuScrollY);
      setTimeout(() => document.body.classList.remove('menu-login-closing'), 760);
    }
  }

  // O tema inteiro sai de UMA cor cadastrada pelo lojista. A derivação (hover,
  // ativo, tons claros, borda) e a guarda de contraste do texto sobre a marca
  // vivem em scripts/utils/brand-theme.js, que é puro e tem teste unitário.
  //
  // Um hex ausente ou inválido cai na cor da PLATAFORMA — que significa "a API
  // não mandou cor", nunca "use a marca do tenant X".
  function applyTheme() {
    const config = window.APP_CONFIG || {};
    window.RapidexTheme.applyBrandTheme(
      restaurant.primary_color || config.PLATFORM_BRAND_PRIMARY,
      restaurant.secondary_color || config.PLATFORM_BRAND_SECONDARY
    );
    // Sem o sufixo da plataforma: a aba é da loja, e o cliente que abriu isto
    // não sabe o que é Rapidex.
    document.title = `${restaurant.name || fallback().restaurantName || ''} — Pedido Online`;
    // Mesma cor e mesmo nome que acabaram de entrar na tela vão para o manifest:
    // o app instalado tem que ter a cara do restaurante, não a da plataforma.
    window.RapidexPWA?.applyTenantManifest({
      name: restaurant.name || fallback().restaurantName || '',
      themeColor: restaurant.primary_color || config.PLATFORM_BRAND_PRIMARY,
      logoUrl: restaurant.logo_url || restaurant.logo_path
    });
  }

  function renderRestaurantShell() {
    const branch = branches[0] || {};
    const restName = restaurant.name || fallback().restaurantName || '';
    document.querySelectorAll('.nav-title,.mob-rest-name,.cart-rest-name,.login-rest-name,.prof-hero-label,.hero-rest-name').forEach(el => el.textContent = restName);
    document.querySelectorAll('.mob-rest-name').forEach(el => {
      el.classList.toggle('mob-rest-name--compact', Array.from(restName).length > 12);
    });
    if ($('addrSearchHeaderTitle')) $('addrSearchHeaderTitle').textContent = restName;
    document.querySelectorAll('.hero-rest-desc').forEach(el => el.textContent = restaurant.description || fallback().restaurantDescription || '');
    document.querySelectorAll('.cart-rest-avatar').forEach(el => el.textContent = initials(restName));

    const logoUrl = restaurant.logo_url || restaurant.logo_path;
    const fallbackLogo = () => {
      const element = document.createElement('div');
      element.className = 'mob-logo-fallback';
      element.textContent = initials(restName);
      return element;
    };
    const renderLogo = container => {
      if (!container) return;
      container.replaceChildren();
      if (!logoUrl) {
        container.appendChild(fallbackLogo());
        return;
      }
      const image = document.createElement('img');
      image.src = logoUrl;
      image.alt = restName;
      image.loading = 'eager';
      image.decoding = 'async';
      image.fetchPriority = 'high';
      image.addEventListener('error', () => container.replaceChildren(fallbackLogo()), { once: true });
      container.appendChild(image);
    };
    renderLogo(document.querySelector('.mob-logo'));
    renderLogo($('loginLogo'));
    renderLogo($('infoStoreLogo'));

    // O cartão de conferência do Pix mostra a MARCA da loja, não as iniciais:
    // ali o cliente confere para quem está prestes a pagar, e uma sigla não
    // confirma nada. Não usa renderLogo() porque o fallback de lá é a caixa
    // .mob-logo-fallback, grande demais para um avatar de 32px — aqui o que
    // sobra são as iniciais que o loop acima já escreveu.
    const pixAvatar = $('pixOrderLogo');
    if (pixAvatar && logoUrl) {
      const avatarImage = document.createElement('img');
      avatarImage.src = logoUrl;
      avatarImage.alt = '';
      avatarImage.decoding = 'async';
      avatarImage.addEventListener(
        'error',
        () => { pixAvatar.textContent = initials(restName); },
        { once: true }
      );
      pixAvatar.replaceChildren(avatarImage);
    }

    const isOpen = settings.is_open ?? restaurant.is_open;
    const status = isOpen === false
      ? (fallback().closedStatusText || 'Fechado no momento')
      : (fallback().openStatusText || 'Aberto agora');
    const statusEl = document.querySelector('.mob-badge-open');
    if (statusEl) statusEl.textContent = status;
    document.querySelectorAll('.mob-pedido-min').forEach(el => el.textContent = `Mín ${fmt(settings.min_order_value || 0)}`);
    const loc = document.querySelector('.mob-loc');
    if (loc) loc.textContent = [branch.neighborhood, branch.city].filter(Boolean).join(' - ') || fallback().mainBranchText || 'Unidade principal';
    renderHomeLoginPrompt();
    document.querySelectorAll('.store-info-name').forEach(el => el.textContent = restName);
    document.querySelectorAll('.store-info-neighborhood').forEach(el => el.textContent = branch.neighborhood || branch.city || '');
    document.querySelectorAll('.store-info-phone').forEach(el => el.textContent = branch.phone || 'Telefone não informado');
    document.querySelectorAll('.store-info-email').forEach(el => el.textContent = restaurant.email || settings.email || 'E-mail não informado');
    document.querySelectorAll('.store-info-whatsapp').forEach(el => el.textContent = branch.whatsapp || 'WhatsApp não informado');
    document.querySelectorAll('.store-contact-row--wa').forEach(el => {
      const phone = onlyDigits(branch.whatsapp || branch.phone || '');
      if (phone) el.href = `https://wa.me/55${phone}`;
      else el.removeAttribute('href');
    });
    document.querySelectorAll('.pickup-restaurant-name').forEach(el => el.textContent = `${restName}${branch.name ? ' — ' + branch.name : ''}`);
    const infoAddress = $('storeInfoAddress');
    if (infoAddress) {
      const selectedBranch = branches.find(unit => String(unit.id) === String(operationContext?.branch_id)) || branch;
      infoAddress.textContent = [selectedBranch.address, selectedBranch.neighborhood, selectedBranch.city, selectedBranch.state]
        .filter(Boolean)
        .join(' - ') || 'Endereço não informado';
    }
    if (restaurantInfoState.status === 'success') renderRestaurantInfo(restaurantInfoState.data);
    else {
      renderRestaurantInfoLoading();
      renderCheckoutPaymentMethods(null);
    }
    const primaryAddress = [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(' - ');
    if ($('footerBranchPrimary')) $('footerBranchPrimary').textContent = primaryAddress || 'Endereço não informado';
    if ($('footerContactPrimary')) $('footerContactPrimary').textContent = branch.whatsapp || branch.phone || 'Contato não informado';
    if ($('footerBranchSecondary')) $('footerBranchSecondary').textContent = branches[1] ? [branches[1].address, branches[1].neighborhood, branches[1].city, branches[1].state].filter(Boolean).join(' - ') : 'Informações da loja';
    if ($('footerContactSecondary')) $('footerContactSecondary').textContent = branches[1]?.whatsapp || branches[1]?.phone || '';
    renderFooterInfo();
    renderProfileHelpContacts();
    const closeTime = restaurant.closing_time || settings.closing_time || settings.close_time || '';
    const closeEl = $('mobCloseTime');
    if (closeEl) {
      closeEl.style.display = isOpen === false || !closeTime ? 'none' : '';
      closeEl.textContent = closeTime ? `fecha às ${closeTime}` : '';
    }
    renderWidget();
    const highlightsTitle = $('homeHighlightsTitle');
    if (highlightsTitle) highlightsTitle.textContent = `Destaques ${restName}`;

    document.querySelectorAll('.delivery-time-text').forEach(el => {
      el.textContent = deliveryWindowText();
    });
    document.querySelectorAll('.delivery-fee-text').forEach(el => {
      const estimateFee = currentDeliveryEstimateFee();
      el.textContent = estimateFee == null ? 'Taxa indisponivel' : fmt(estimateFee);
    });
    renderDeliveryMeta();
  }

  const HELP_WHATSAPP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M9 8.7c.6 2.7 2.6 4.7 5.3 5.3"/></svg>';
  const HELP_PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>';

  function helpWhatsAppDigits(value) {
    const digits = onlyDigits(value);
    return digits && digits.length <= 11 ? `55${digits}` : digits;
  }

  // A tela exibe apenas a unidade escolhida pelo cliente. A resposta de /info
  // complementa o cardápio porque é nela que normalmente vêm e-mail e contato.
  function renderProfileHelpContacts(infoData = null) {
    const card = $('profHelpContacts');
    if (!card) return;
    const selectedMenuBranch = branches.find(unit => String(unit.id) === String(operationContext?.branch_id)) || branches[0] || {};
    const infoBranch = infoData?.branch || {};
    const branch = { ...selectedMenuBranch, ...infoBranch };
    const infoRestaurant = infoData?.restaurant || {};
    const name = infoRestaurant.name || restaurant.name || fallback().restaurantName || 'Restaurante';
    const branchName = branch.display_name || branch.name || '';
    const logoUrl = infoRestaurant.logo_url || infoRestaurant.logo_path || restaurant.logo_url || restaurant.logo_path || '';
    const phone = branch.phone || branch.whatsapp || '';
    const whatsapp = branch.whatsapp || branch.phone || '';
    const email = branch.email || infoRestaurant.email || restaurant.email || settings.email || '';
    const whatsappDigits = helpWhatsAppDigits(whatsapp);
    const phoneHref = onlyDigits(phone);
    const emailLabel = email ? String(email).toUpperCase() : 'E-MAIL NÃO INFORMADO';

    card.innerHTML = `
      <div class="help-store-logo" aria-hidden="true">
        ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : `<span>${esc(initials(name))}</span>`}
      </div>
      <div class="help-store-name">${esc(name)}</div>
      <div class="help-store-branch">${esc(branchName)}</div>
      <p class="help-store-intro">Se precisar de ajuda, entre em contato conosco pelos<br> seguintes meios:</p>
      <div class="help-store-divider"></div>
      <div class="help-store-contacts">
        <a class="help-store-contact" href="${phoneHref ? `tel:${esc(phoneHref)}` : '#'}">
          <span class="help-store-contact-icon">${HELP_PHONE_ICON}</span>
          <span>${esc(phone || 'Telefone não informado')}</span>
        </a>
        <a class="help-store-contact" href="${email ? `mailto:${esc(email)}` : '#'}">
          <span class="help-store-contact-icon help-store-contact-at" aria-hidden="true">@</span>
          <span>${esc(emailLabel)}</span>
        </a>
        <a class="help-store-contact help-store-contact--whatsapp" href="${whatsappDigits ? `https://wa.me/${esc(whatsappDigits)}` : '#'}" ${whatsappDigits ? 'target="_blank" rel="noopener"' : ''}>
          <span class="help-store-contact-icon">${HELP_WHATSAPP_ICON}</span>
          <span>${esc(whatsapp || 'WhatsApp não informado')}</span>
        </a>
      </div>`;

    const logo = card.querySelector('.help-store-logo');
    logo?.querySelector('img')?.addEventListener('error', () => {
      const fallbackElement = document.createElement('span');
      fallbackElement.textContent = initials(name);
      logo.replaceChildren(fallbackElement);
    }, { once: true });
  }

  // Coluna "Informações" do rodapé. Era markup fixo com o horário e o couvert de
  // um restaurante só; agora sai da API, e o que a API não informa não aparece.
  function renderFooterInfo() {
    const hoursEl = $('footerHours');
    if (hoursEl) {
      const hours = restaurant.opening_hours_text
        || settings.opening_hours_text
        || settings.business_hours_text
        || '';
      hoursEl.textContent = hours;
      hoursEl.hidden = !hours;
    }
    const feeEl = $('footerServiceFee');
    if (feeEl) {
      const feeAmount = asFiniteNumber(settings.service_fee_amount);
      const feeNote = settings.service_fee_description || settings.service_fee_note || '';
      const parts = [];
      if (feeAmount != null && feeAmount > 0) parts.push(`Taxa de serviço: ${fmt(feeAmount)}`);
      if (feeNote) parts.push(feeNote);
      feeEl.textContent = parts.join(' · ');
      feeEl.hidden = !parts.length;
    }
  }

  function renderBanners() {
    const img = $('restaurantHeroImg');
    const cover = $('restaurantHeroCover');
    const track = $('restaurantHeroTrack');
    const dots = $('restaurantHeroDots');
    const heroFallback = $('restaurantHeroFallback');
    if (!img || !cover) return;
    const nextSignature = JSON.stringify(banners.map(banner => [
      banner.image_url || banner.image_path || '',
      banner.title || '',
      banner.subtitle || ''
    ]));
    if (bannersRenderSignature === nextSignature) return;
    bannersRenderSignature = nextSignature;
    stopHeroAutoplay();
    heroBannerIndex = 1;
    const visualBanners = banners.filter(banner => banner.image_url || banner.image_path);

    if (!visualBanners.length) {
      cover.classList.remove('has-carousel');
      if (track) track.innerHTML = '';
      img.removeAttribute('src');
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.alt = restaurant.name || fallback().restaurantName || '';
      if (heroFallback) heroFallback.setAttribute('aria-hidden', 'false');
      if (dots) dots.innerHTML = '';
      return;
    }

    const first = visualBanners[0];
    const firstImage = first.image_url || first.image_path || '';
    img.src = firstImage;
    applyResponsiveImage(img, firstImage, { fluid: HERO_FLUID });
    img.alt = first.title || first.subtitle || restaurant.name || 'Banner promocional';
    img.loading = 'eager';
    img.decoding = 'async';
    img.fetchPriority = 'high';
    cover.classList.add('has-carousel');
    if (heroFallback) heroFallback.setAttribute('aria-hidden', 'true');

    if (track) {
      const mkSlide = banner => {
        const image = banner.image_url || banner.image_path || '';
        const alt = banner.title || banner.subtitle || restaurant.name || 'Banner';
        const responsive = responsiveImageAttrs(image, { fluid: HERO_FLUID });
        return `<div class="restaurant-hero-slide"><img src="${esc(image)}"${responsive} alt="${esc(alt)}" ${imageAttrs({ lazy: true })}></div>`;
      };
      const cloneLast  = mkSlide(visualBanners[visualBanners.length - 1]);
      const cloneFirst = mkSlide(visualBanners[0]);
      track.innerHTML  = cloneLast + visualBanners.map(mkSlide).join('') + cloneFirst;
      track.style.transition = 'none';
      track.style.transform  = 'translateX(-100%)';
      track.offsetHeight;
      track.style.transition = '';
      initHeroSwipe();
    }

    if (dots) {
      dots.innerHTML = visualBanners.length > 1
        ? visualBanners.map((_, index) => `<span class="${index === 0 ? 'active' : ''}" ${act('click', 'setHeroBanner', index)}></span>`).join('')
        : '';
    }

    if (visualBanners.length > 1) {
      startHeroAutoplay();
    }
  }

  function setHeroBanner(realIndex) {
    const track = $('restaurantHeroTrack');
    if (!track) return;
    const total = track.children.length;
    heroBannerIndex = Math.min(Math.max(realIndex + 1, 1), total - 2);
    updateHeroCarousel();
    startHeroAutoplay();
  }

  function updateHeroCarousel() {
    const track = $('restaurantHeroTrack');
    if (!track) return;
    track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
    const realIndex = heroBannerIndex - 1;
    document.querySelectorAll('#restaurantHeroDots span').forEach((dot, i) => {
      dot.classList.toggle('active', i === realIndex);
    });
  }

  function stopHeroAutoplay() {
    clearInterval(heroBannerTimer);
    heroBannerTimer = null;
  }

  function startHeroAutoplay() {
    const total = $('restaurantHeroTrack')?.children.length || 0;
    stopHeroAutoplay();
    if (total <= 3) return;
    // Aba oculta não anima. Sem esta guarda o intervalo continuaria girando o
    // carrossel — escrita no DOM e recálculo de estilo — numa página que
    // ninguém está vendo, e o usuário voltaria para um banner que "andou
    // sozinho" enquanto ele estava em outro lugar.
    if (document.visibilityState === 'hidden') return;
    heroBannerTimer = setInterval(() => {
      const track = $('restaurantHeroTrack');
      if (!track) return;
      const total = track.children.length;
      heroBannerIndex += 1;
      updateHeroCarousel();
      if (heroBannerIndex >= total - 1) {
        setTimeout(() => {
          heroBannerIndex = 1;
          track.style.transition = 'none';
          track.style.transform = 'translateX(-100%)';
          track.offsetHeight;
          track.style.transition = '';
        }, 490);
      }
    }, HERO_BANNER_INTERVAL_MS);
  }

  // O par que fecha o intervalo do hero: pausa quando a aba sai de vista, volta
  // quando ela retorna, e some de vez no teardown da página.
  window.RapidexLifecycle?.onVisibility({
    onHidden: stopHeroAutoplay,
    onVisible: () => {
      // Só reativa se o carrossel existe de fato — em restaurante sem banner o
      // startHeroAutoplay já sai pelo total <= 3, mas checar aqui evita a
      // chamada inteira a cada volta de aba.
      if ($('restaurantHeroTrack')) startHeroAutoplay();
    }
  });
  window.RapidexLifecycle?.onTeardown(stopHeroAutoplay);

  function initHeroSwipe() {
    const track = $('restaurantHeroTrack');
    if (!track || heroSwipeReady) return;
    heroSwipeReady = true;

    track.addEventListener('transitionend', () => {
      const total = track.children.length;
      if (heroBannerIndex <= 0 || heroBannerIndex >= total - 1) {
        track.style.transition = 'none';
        heroBannerIndex = heroBannerIndex <= 0 ? total - 2 : 1;
        track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
        track.offsetHeight;
        track.style.transition = '';
        const realIndex = heroBannerIndex - 1;
        document.querySelectorAll('#restaurantHeroDots span').forEach((dot, i) => {
          dot.classList.toggle('active', i === realIndex);
        });
      }
    });

    const endDrag = () => {
      if (!track.classList.contains('is-dragging')) return;
      const total = track.children.length;
      track.classList.remove('is-dragging');
      if (Math.abs(heroDragDeltaX) > 46) {
        const next = heroBannerIndex + (heroDragDeltaX < 0 ? 1 : -1);
        heroBannerIndex = Math.max(0, Math.min(next, total - 1));
      }
      heroDragDeltaX = 0;
      updateHeroCarousel();
      startHeroAutoplay();
    };

    track.addEventListener('pointerdown', event => {
      const total = track.children.length;
      if (total <= 3) return;
      // Se ainda estiver num clone (transitionend ainda não disparou),
      // faz o salto silencioso imediatamente antes de começar o novo drag
      if (heroBannerIndex <= 0 || heroBannerIndex >= total - 1) {
        track.style.transition = 'none';
        heroBannerIndex = heroBannerIndex <= 0 ? total - 2 : 1;
        track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
        track.offsetHeight;
        track.style.transition = '';
        const realIndex = heroBannerIndex - 1;
        document.querySelectorAll('#restaurantHeroDots span').forEach((dot, i) => {
          dot.classList.toggle('active', i === realIndex);
        });
      }
      stopHeroAutoplay();
      heroDragStartX = event.clientX;
      heroDragDeltaX = 0;
      track.classList.add('is-dragging');
      track.setPointerCapture?.(event.pointerId);
    });

    track.addEventListener('pointermove', event => {
      if (!track.classList.contains('is-dragging')) return;
      heroDragDeltaX = event.clientX - heroDragStartX;
      track.style.transform = `translateX(calc(-${heroBannerIndex * 100}% + ${heroDragDeltaX}px))`;
    });

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('lostpointercapture', endDrag);
  }

  function initMenuHeaderHide() {
    if (menuHeaderHideReady) return;
    menuHeaderHideReady = true;
    window.addEventListener('scroll', () => {
      if (!document.body.classList.contains('menu-tab')) return;
      document.body.classList.toggle('menu-scrolled', (window.scrollY || document.documentElement.scrollTop) > 40);
    }, { passive: true, signal: LIFECYCLE_SIGNAL });
  }

  function initPageRubberBand() {
    if (pageRubberBandReady) return;
    pageRubberBandReady = true;
    let startX = 0, startY = 0, delta = 0, tracking = false, isHoriz = false;
    const SKIP = '.coupon-rail,.highlight-rail,.restaurant-hero-cover,.restaurant-hero-track,.restaurant-hero-slide';
    const SNAP = 'transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94)';
    let movableEls = null;
    const movables = () => {
      if (!movableEls) movableEls = document.querySelectorAll('.restaurant-hero, .home-section, .home-separator');
      return movableEls;
    };

    const applyMove = tx => movables().forEach(el => {
      el.style.transition = 'none';
      el.style.transform = `translateX(${tx}px)`;
    });

    const snapBack = () => {
      if (!isHoriz) { tracking = false; return; }
      tracking = false; isHoriz = false; delta = 0;
      movables().forEach(el => {
        el.style.transition = SNAP;
        el.style.transform = 'translateX(0px)';
      });
    };

    document.addEventListener('touchstart', e => {
      if (document.body.classList.contains('modal-open')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      delta = 0; tracking = true; isHoriz = false;
    }, { passive: true, signal: LIFECYCLE_SIGNAL });

    document.addEventListener('touchmove', e => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!isHoriz) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) >= Math.abs(dx)) { tracking = false; return; }
        if (e.target.closest(SKIP)) { tracking = false; return; }
        isHoriz = true;
      }
      delta = dx;
      applyMove(parseFloat((delta * 0.18).toFixed(1)));
    }, { passive: true, signal: LIFECYCLE_SIGNAL });

    document.addEventListener('touchend', snapBack, { passive: true, signal: LIFECYCLE_SIGNAL });
    document.addEventListener('touchcancel', snapBack, { passive: true, signal: LIFECYCLE_SIGNAL });
  }

  function renderCoupons() {
    const wrap = $('couponRail');
    if (!wrap) return;
    const section = $('homeCouponsSection');
    if (section) section.style.display = coupons.length ? '' : 'none';
    const nextSignature = JSON.stringify(coupons.map(coupon => [
      coupon.code,
      coupon.title || coupon.name || '',
      couponImageUrl(coupon),
      coupon.discount_type || '',
      coupon.discount_value || ''
    ]));
    if (couponsRenderSignature === nextSignature && wrap.children.length) {
      updateHomePromoVisibility();
      return;
    }
    couponsRenderSignature = nextSignature;
    wrap.innerHTML = coupons.map(coupon => {
      const image = couponImageUrl(coupon);
      const discountType = String(coupon.discount_type || '').toLowerCase();
      const discount = ['percent', 'percentage'].includes(discountType)
        ? `${Number(coupon.discount_value || 0)}% off`
        : discountType === 'free_delivery'
          ? 'Frete gratis'
          : coupon.name || coupon.title || 'Cupom';
      // Fixed template: backend supplies the coupon artwork (image) + title.
      // The gradient + discount text is only a fallback when there's no image
      // (or it fails to load — onerror reverts to the fallback).
      return `
        <article class="coupon-card" ${act('click', 'openCouponDetail', coupon.code, '$this')}>
          <div class="coupon-art${image ? ' coupon-art--has-img' : ''}">
            ${image ? `<img src="${esc(image)}"${responsiveImageAttrs(image, { box: RAIL_BOX })} alt="${esc(coupon.name || coupon.title || 'Cupom')}" ${imageAttrs({ lazy: true })} ${act('error', 'couponArtImageFailed')}>` : ''}
            <span>Cupom</span>
            <strong>${esc(discount)}</strong>
          </div>
          <div class="coupon-title">${esc(coupon.title || coupon.name || coupon.code || 'Cupom')}</div>
          <div class="coupon-dash"></div>
          <button type="button" class="coupon-use-btn" ${actAll('click', [['$stop'], ['openCouponDetail', coupon.code, '$this']])}>Usar cupom</button>
        </article>
      `;
    }).join('');
    updateHomePromoVisibility();
  }

  function renderHighlights() {
    const wrap = $('highlightRail');
    if (!wrap) return;
    const highlightItems = getHomeHighlightItems();
    const section = $('homeHighlightsSection');
    if (section) section.style.display = highlightItems.length ? '' : 'none';
    const nextSignature = JSON.stringify(highlightItems.map(highlight => [
      highlight.image_url || highlight.image_path || '',
      highlight.title || '',
      highlight.subtitle || ''
    ]));
    if (highlightsRenderSignature === nextSignature && wrap.children.length) {
      updateHomePromoVisibility();
      return;
    }
    highlightsRenderSignature = nextSignature;
    wrap.innerHTML = highlightItems.map(highlight => {
      const image = highlight.image_url || highlight.image_path || '';
      const alt = highlight.title || highlight.subtitle || restaurant.name || 'Destaque';
      return `
        <article class="highlight-banner">
          ${image
            ? `<img src="${esc(image)}"${responsiveImageAttrs(image, { fluid: HIGHLIGHT_FLUID })} alt="${esc(alt)}" ${imageAttrs({ lazy: true })}>`
            : `<div class="highlight-fallback"><strong>${esc(highlight.title || 'Destaque')}</strong><span>${esc(highlight.subtitle || restaurant.name || '')}</span></div>`}
        </article>
      `;
    }).join('');
    updateHomePromoVisibility();
  }

  function getHomeHighlightItems() {
    return highlightBanners;
  }

  function updateHomePromoVisibility() {
    const hasCoupons = coupons.length > 0;
    const hasHighlights = getHomeHighlightItems().length > 0;
    const couponSection = $('homeCouponsSection');
    const highlightsSection = $('homeHighlightsSection');
    const heroSeparator = $('homeHeroSeparator');
    const separator = $('homeSeparator');
    showEl(couponSection, hasCoupons);
    showEl(highlightsSection, hasHighlights);
    showEl(heroSeparator, true);
    showEl(separator, hasCoupons && hasHighlights);
  }

  function renderMenu() {
    const nav = $('catNav');
    const container = $('menuContainer');
    if (!nav || !container) return;
    const nextSignature = JSON.stringify({
      categories: categories.map(cat => [cat.id, cat.slug, cat.name]),
      products: products.map(product => [
        product.id,
        product.category_id,
        product.category_slug,
        product.category,
        product.name,
        product.price,
        product.image_url || product.image_path,
        product.is_available
      ])
    });
    if (menuRenderSignature === nextSignature && container.querySelector('.menu-section')) {
      appState.menuLoaded = true;
      return;
    }
    const productsByCategory = categories.reduce((acc, cat) => {
      acc[cat.slug] = products.filter(p => p.is_available !== false && (
        p.category_slug === cat.slug ||
        p.category_slug === cat.id ||
        p.category_id === cat.id ||
        slug(p.category) === cat.slug
      ));
      return acc;
    }, {});
    nav.innerHTML = '';
    container.innerHTML = '';
    let renderedCategoryCount = 0;

    categories.forEach(cat => {
      const catProducts = productsByCategory[cat.slug] || [];
      if (!catProducts.length) return;
      const isFirstRenderedCategory = renderedCategoryCount === 0;
      // The slug is carried in a data attribute and bound below with
      // addEventListener: inside onclick="" it would be a JS-string injection
      // point that HTML escaping alone does not close.
      nav.insertAdjacentHTML('beforeend', `<button class="cat ${isFirstRenderedCategory ? 'active' : ''}" data-cat-slug="${esc(cat.slug)}">${esc(cat.name)}</button>`);
      container.insertAdjacentHTML('beforeend', `
        <section class="menu-section" id="${esc(cat.slug)}">
          <h2 class="menu-section-title">${esc(cat.name)}</h2>
          <div class="products-grid">
            ${catProducts.map(product => ProductCard(product)).join('')}
          </div>
        </section>
      `);
      renderedCategoryCount += 1;
    });
    menuSectionsCache = Array.from(container.querySelectorAll('.menu-section'));
    categoryButtonsCache = Array.from(nav.querySelectorAll('.cat'));
    categoryButtonsCache.forEach(btn => {
      btn.addEventListener('click', () => scrollToCategory(btn.dataset.catSlug, btn));
    });
    setFirstCategoryActive();
    appState.menuLoaded = true;
    appState.productsByCategory = productsByCategory;
    menuRenderSignature = nextSignature;
    restaurantStore()?.setMenu?.({ categories, products });
  }

  async function ensureMenuLoaded() {
    if (appState.menuLoaded && $('menuContainer')?.querySelector('.menu-section')) return;
    if (appState.menuLoaded) {
      renderMenu();
      return;
    }
    if (products.length && categories.length) {
      renderMenu();
      initScrollSpy();
      initProductPressFeedback();
      setFirstCategoryActive();
      return;
    }
    if (menuLoadPromise) return menuLoadPromise;
    setLoading('menu', true);
    if ($('catNav')) $('catNav').innerHTML = '';
    renderSectionLoader('menuContainer', 'Carregando cardápio...', 'menu-skeleton');
    menuLoadPromise = (async () => {
      try {
        if (!products.length || !categories.length) {
          const fresh = await window.PedeAquiRestaurantService.getRestaurantMenu(getRestaurantSlug());
          payload = fresh || {};
          restaurant = payload.restaurant || restaurant || {};
          settings = payload.settings || settings || {};
          branches = Array.isArray(payload.branches) ? payload.branches : branches;
          categories = Array.isArray(payload.categories) ? payload.categories : categories;
          products = Array.isArray(payload.products) ? payload.products : products;
          banners = Array.isArray(payload.banners) ? payload.banners : banners;
          highlightBanners = Array.isArray(payload.highlight_banners) ? payload.highlight_banners : highlightBanners;
          coupons = Array.isArray(payload.coupons) ? payload.coupons : coupons;
        }
        await wait(TAB_LOADER_MIN_MS);
        renderMenu();
        initScrollSpy();
        initProductPressFeedback();
        setFirstCategoryActive();
      } catch (error) {
        appState.menuLoaded = false;
        logAppError('Falha ao carregar cardápio', error);
        renderSectionError('menuContainer', 'Não foi possível carregar o cardápio.', 'retryMenuLoad');
      } finally {
        setLoading('menu', false);
        menuLoadPromise = null;
      }
    })();
    return menuLoadPromise;
  }

  let isClickScrolling = false;
  function setFirstCategoryActive() {
    const firstCat = categoryButtonsCache[0] || document.querySelector('.cat');
    if (!firstCat) return;
    (categoryButtonsCache.length ? categoryButtonsCache : Array.from(document.querySelectorAll('.cat')))
      .forEach(btn => btn.classList.toggle('active', btn === firstCat));
  }

  function showHomeTab() {
    document.body.classList.remove('menu-tab', 'menu-scrolled');
    document.body.classList.add('home-tab');
    uiStore()?.set?.({ activeView: 'home', bottomNav: 'home' });
    setMobNavActive('mobNavHome');
  }

  function showMenuTab() {
    document.body.classList.remove('home-tab');
    document.body.classList.add('menu-tab');
    uiStore()?.set?.({ activeView: 'menu', bottomNav: 'menu' });
    setMobNavActive('mobNavMenu');
    setFirstCategoryActive();
    initCatStuckObserver();
  }

  let _catStuckObserver = null;
  function initCatStuckObserver() {
    if (_catStuckObserver) return;
    const sentinel = $('searchCat');
    const catNav   = $('catNav');
    if (!sentinel || !catNav) return;
    _catStuckObserver = new IntersectionObserver(([entry]) => {
      catNav.classList.toggle('is-stuck', !entry.isIntersecting);
    }, { threshold: 0 });
    _catStuckObserver.observe(sentinel);
    onTeardown(() => {
      _catStuckObserver?.disconnect();
      _catStuckObserver = null;
    });
  }

  let scrollAnimationToken = 0;

  function jumpToTop() {
    scrollAnimationToken += 1;
    const html = document.documentElement;
    const previousHtmlBehavior = html.style.scrollBehavior;
    const previousBodyBehavior = document.body.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      html.style.scrollBehavior = previousHtmlBehavior;
      document.body.style.scrollBehavior = previousBodyBehavior;
    });
  }

  function scrollToFast(targetTop, duration = 260) {
    const token = ++scrollAnimationToken;
    const startTop = window.pageYOffset || document.documentElement.scrollTop || 0;
    const distance = targetTop - startTop;
    const startedAt = performance.now();
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    function step(now) {
      if (token !== scrollAnimationToken) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      window.scrollTo(0, startTop + distance * easeOutCubic(progress));
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  function scrollToMenu() {
    closeMobViews();
    showMenuTab();
    ensureMenuLoaded();
    jumpToTop();
  }

  function scrollToHome() {
    closeMobViews();
    showHomeTab();
    jumpToTop();
  }

  function findCategoryButton(slugValue) {
    const buttons = categoryButtonsCache.length ? categoryButtonsCache : Array.from(document.querySelectorAll('.cat'));
    return buttons.find(b => b.dataset.catSlug === slugValue) || null;
  }

  // Mantém a aba ativa visível na barra horizontal enquanto o scroll da página
  // troca a categoria. É feito por scrollLeft, e NÃO por scrollIntoView: este
  // último rola todos os ancestrais roláveis, incluindo a própria página, e
  // brigaria com o scroll que acabou de disparar o scrollspy.
  function revealActiveCategory() {
    const nav = $('catNav');
    if (!nav) return;
    const active = nav.querySelector('.cat.active');
    if (!active) return;
    // Alvo: botão centralizado no trilho, limitado às bordas.
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    const max = nav.scrollWidth - nav.clientWidth;
    const next = Math.max(0, Math.min(target, max));
    if (Math.abs(next - nav.scrollLeft) < 2) return;
    nav.scrollTo({ left: next, behavior: 'smooth' });
  }

  function scrollToCategory(id, btn) {
    isClickScrolling = true;
    (categoryButtonsCache.length ? categoryButtonsCache : Array.from(document.querySelectorAll('.cat')))
      .forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    revealActiveCategory();
    const el = $(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 92, behavior: 'smooth' });
    setTimeout(() => { isClickScrolling = false; }, 700);
  }

  function initScrollSpy() {
    if (menuScrollSpyReady) return;
    menuScrollSpyReady = true;
    window.addEventListener('scroll', () => {
      if (isClickScrolling) return;
      let currentId = '';
      const sections = menuSectionsCache.length ? menuSectionsCache : Array.from(document.querySelectorAll('.menu-section'));
      const buttons = categoryButtonsCache.length ? categoryButtonsCache : Array.from(document.querySelectorAll('.cat'));
      sections.forEach(sec => {
        if (sec.getBoundingClientRect().top <= 150) currentId = sec.id;
      });
      if (!currentId) {
        setFirstCategoryActive();
        revealActiveCategory();
        return;
      }
      // O vínculo botão -> seção é o data-cat-slug. Até a Fase 0 era o texto do
      // onclick="scrollToCategory('...')", que 5618157 removeu ao trocar o
      // handler inline por addEventListener — e como este trecho continuou
      // lendo getAttribute('onclick'), a busca passou a devolver null para todo
      // botão e NENHUM ficava ativo. Ler o mesmo atributo que o clique usa
      // (findCategoryButton) mantém os dois caminhos com uma fonte só.
      buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.catSlug === currentId);
      });
      revealActiveCategory();
    }, { passive: true, signal: LIFECYCLE_SIGNAL });
  }

  function initProductPressFeedback() {
    if (window.__pedeAquiProductPressFeedbackReady) return;
    window.__pedeAquiProductPressFeedbackReady = true;
    let pressedElement = null;
    const clearPressed = () => {
      pressedElement?.classList.remove('is-pressing');
      pressedElement = null;
    };
    document.addEventListener('pointerdown', event => {
      if (event.button !== 0 || document.body.classList.contains('modal-open')) return;
      const target = event.target.closest?.('.no-press-feedback');
      if (!target) return;
    }, { passive: true, signal: LIFECYCLE_SIGNAL });
    document.addEventListener('pointerup', clearPressed, { passive: true, signal: LIFECYCLE_SIGNAL });
    document.addEventListener('pointercancel', clearPressed, { passive: true, signal: LIFECYCLE_SIGNAL });
    window.addEventListener('scroll', clearPressed, { passive: true, signal: LIFECYCLE_SIGNAL });
  }
  function initSearch() {
    if (searchReady) return;
    searchReady = true;
    let searchFrame = null;
    $('searchInput')?.addEventListener('input', (e) => {
      const input = e.target;
      const q = input.value.toLowerCase();
      input.closest('.search-bar')?.classList.toggle('has-value', Boolean(q));
      if (searchFrame) cancelAnimationFrame(searchFrame);
      searchFrame = requestAnimationFrame(() => {
        let foundAny = false;
        const sections = menuSectionsCache.length ? menuSectionsCache : Array.from(document.querySelectorAll('.menu-section'));
        sections.forEach(sec => {
          let secFound = false;
          sec.querySelectorAll('.product-card').forEach(card => {
            const match = card.textContent.toLowerCase().includes(q);
            card.style.display = match ? 'flex' : 'none';
            secFound = secFound || match;
            foundAny = foundAny || match;
          });
          sec.style.display = secFound ? 'block' : 'none';
        });
        showEl($('emptySearch'), !foundAny);
        searchFrame = null;
      });
    });
  }

  function openProduct(id, source) {
    currentProd = products.find(p => String(p.id) === String(id));
    if (!currentProd) return;
    editingCartItemUid = null;
    pmQty = 1;
    pmSelectedOptions = {};
    $('pmName').textContent = currentProd.name;
    $('pmDesc').textContent = currentProd.description || '';
    $('pmPrice').innerHTML = Number.isFinite(currentProd.price)
      ? `<span class="pm-price-value">${esc(fmt(currentProd.price))}</span>`
      : esc(fallback().productUnavailablePrice || '');
    $('pmObs').value = '';
    bindProductObservationCounter();
    updateProductObservationCount();
    const hero = $('pmHero');
    // O herói do modal é a única foto FLUIDA: 100% da largura do modal, que no
    // celular é a viewport inteira. Por isso `w` + sizes, e não descritores x.
    if (hero) {
      const image = currentProd.image_url || currentProd.image_path || '';
      const sourceCard = source?.closest?.('.product-card')
        || Array.from(document.querySelectorAll('.product-card')).find(card => String(card.dataset.productId) === String(id));
      const preview = readyCardImage(sourceCard, '.product-card', '.product-image');
      if (image) {
        renderDetailImage(hero, {
          url: image,
          alt: currentProd.name,
          className: 'pm-hero-photo',
          fluid: { widths: [360, 480, 640, 960, 1280], sizes: '(max-width: 560px) 100vw, 560px' },
          preview,
          fallbackMarkup: `<div class="pm-hero-photo product-image--placeholder"><span>${esc(initials(currentProd.name))}</span></div>`
        });
      } else {
        hero.innerHTML = productImage(currentProd, 'pm-hero-photo');
      }
    }
    showEl($('pmWarning'), !Number.isFinite(currentProd.price));
    $('pmForm').style.display = Number.isFinite(currentProd.price) ? 'block' : 'none';
    $('pmFooter').style.display = Number.isFinite(currentProd.price) ? 'flex' : 'none';
    renderProductOptions();
    updatePmUI();
    openModal('productModal');
    initProductScrollIndicator();
    const body = $('productModal')?.querySelector('.modal-body');
    if (body) body.scrollTop = 0;
    requestAnimationFrame(syncProductScrollIndicator);
  }

  function optionInstruction(group) {
    const min = Number(group.min_select || 0);
    const max = Math.max(1, Number(group.max_select || 1));
    if (max === 1) return min > 0 ? 'Selecione 1' : 'Selecione at\u00e9 1';
    if (min > 0 && min !== max) return `Selecione de ${min} a ${max}`;
    if (min > 0 && min === max) return `Selecione ${max}`;
    return `Selecione at\u00e9 ${max}`;
  }

  function renderProductOptions() {
    const target = $('pmOptionGroups');
    if (!target) return;
    const groups = productOptionGroups(currentProd);
    target.innerHTML = groups.map(group => renderProductOptionGroup(group)).join('');
    requestAnimationFrame(syncProductScrollIndicator);
  }

  function initProductScrollIndicator() {
    if (productScrollIndicatorReady) return;
    const body = $('productModal')?.querySelector('.modal-body');
    if (!body) return;
    productScrollIndicatorReady = true;
    body.addEventListener('scroll', syncProductScrollIndicator, { passive: true, signal: LIFECYCLE_SIGNAL });
    window.addEventListener('resize', syncProductScrollIndicator, { signal: LIFECYCLE_SIGNAL });
  }

  function syncProductScrollIndicator() {
    const modal = $('productModal')?.querySelector('.modal--product');
    const body = $('productModal')?.querySelector('.modal-body');
    if (!modal || !body) return;
    const scrollable = body.scrollHeight - body.clientHeight;
    const hasOverflow = scrollable > 1;
    modal.classList.toggle('has-product-scroll', hasOverflow);
    modal.classList.toggle('product-no-scroll', !hasOverflow);
    body.style.overflowY = hasOverflow ? 'auto' : 'hidden';
    if (!hasOverflow) body.scrollTop = 0;
  }

  function renderProductOptionGroup(group) {
    const groupId = String(group.id);
    const selections = optionGroupSelections(group);
    const max = Math.max(1, Number(group.max_select || 1));
    const isSingle = max === 1;
    const options = Array.isArray(group.options) ? group.options : [];
    return `
      <section class="pm-option-group" data-option-group-id="${esc(groupId)}">
        <div class="pm-option-head">
          <div class="pm-option-title">${esc(group.name)}</div>
          <div class="pm-option-meta">
            <span>${esc(optionInstruction(group))}</span>
            <span>${selections.length} selec</span>
          </div>
        </div>
        <div class="pm-option-list">
          ${options.map(option => renderProductOption(group, option, isSingle, selections)).join('')}
        </div>
      </section>
    `;
  }

  function renderProductOption(group, option, isSingle, selections) {
    const groupId = String(group.id);
    const optionId = String(option.id);
    const selected = selections.includes(optionId);
    const price = optionAdditionalPrice(option);
    return `
      <button class="pm-option-row ${selected ? 'selected' : ''}" type="button" ${act('click', 'toggleProductOption', groupId, optionId)}>
        <span class="pm-option-copy">
          <span class="pm-option-name">${esc(option.name)}</span>
          ${option.description ? `<span class="pm-option-desc">${esc(option.description)}</span>` : ''}
          ${price > 0 ? `<span class="pm-option-price">${fmt(price)}</span>` : ''}
        </span>
        <span class="${isSingle ? 'pm-option-radio' : 'pm-option-toggle'}" aria-hidden="true">${isSingle ? '' : (selected ? '-' : '+')}</span>
      </button>
    `;
  }

  function toggleProductOption(groupId, optionId) {
    const group = productOptionGroups(currentProd).find(item => String(item.id) === String(groupId));
    if (!group) return;
    const max = Math.max(1, Number(group.max_select || 1));
    const current = [...(pmSelectedOptions[groupId] || [])];
    if (max === 1) {
      pmSelectedOptions[groupId] = current[0] === optionId ? [] : [optionId];
    } else if (current.includes(optionId)) {
      pmSelectedOptions[groupId] = current.filter(id => id !== optionId);
    } else if (current.length < max) {
      pmSelectedOptions[groupId] = [...current, optionId];
    }
    renderProductOptions();
    updatePmUI();
  }

  function productOptionsValid() {
    return productOptionGroups(currentProd).every(group => {
      const selected = optionGroupSelections(group).length;
      const min = Number(group.min_select || 0);
      const max = Math.max(1, Number(group.max_select || 1));
      const required = group.is_required === true || min > 0;
      if (!required && selected === 0) return true;
      return selected >= min && selected <= max;
    });
  }

  function selectedOptionsSnapshot() {
    return productOptionGroups(currentProd).flatMap(group => {
      const options = Array.isArray(group.options) ? group.options : [];
      return optionGroupSelections(group).map(optionId => {
        const option = options.find(item => String(item.id) === String(optionId));
        if (!option) return null;
        return {
          group_name: group.name || '',
          option_name: option.name || '',
          additional_price: optionAdditionalPrice(option)
        };
      }).filter(Boolean);
    });
  }

  function selectedOptionsPayload() {
    return productOptionGroups(currentProd).flatMap(group => optionGroupSelections(group).map(optionId => ({
      option_group_id: String(group.id),
      option_id: String(optionId)
    })));
  }

  function productVisualUnitPrice() {
    if (!currentProd || !Number.isFinite(currentProd.price)) return 0;
    return Number(currentProd.price) + selectedOptionsSnapshot().reduce((sum, option) => sum + Number(option.additional_price || 0), 0);
  }

  function restoreSelectedOptions(item) {
    pmSelectedOptions = {};
    (item.selected_options || []).forEach(selection => {
      const groupId = String(selection.option_group_id || '');
      const optionId = String(selection.option_id || '');
      if (!groupId || !optionId) return;
      pmSelectedOptions[groupId] = [...(pmSelectedOptions[groupId] || []), optionId];
    });
    renderProductOptions();
  }

  function cartOptionsHtml(item) {
    const snapshot = Array.isArray(item.selected_options_snapshot) ? item.selected_options_snapshot : [];
    if (!snapshot.length) return '';
    return `<div class="cir-options">${snapshot.map(option => `
      <div class="cir-option">
        <span>${esc(option.group_name)}: ${esc(option.option_name)}</span>
        ${Number(option.additional_price || 0) > 0 ? `<small>+ ${fmt(option.additional_price)}</small>` : ''}
      </div>
    `).join('')}</div>`;
  }

  function changeQty(delta) {
    pmQty = Math.max(1, pmQty + delta);
    updatePmUI();
  }

  function bindProductObservationCounter() {
    const obs = $('pmObs');
    if (!obs || obs.dataset.counterReady === 'true') return;
    obs.dataset.counterReady = 'true';
    obs.addEventListener('input', updateProductObservationCount);
  }

  function updateProductObservationCount() {
    const obs = $('pmObs');
    const count = $('pmObsCount');
    if (!obs || !count) return;
    if (obs.value.length > 128) obs.value = obs.value.slice(0, 128);
    count.textContent = `${obs.value.length}/128`;
  }

  function updatePmUI() {
    if ($('pmQty')) $('pmQty').textContent = pmQty;
    if ($('pmAddBtn') && currentProd) {
      $('pmAddBtn').textContent = `Adicionar (${fmt(productVisualUnitPrice() * pmQty)})`;
      $('pmAddBtn').disabled = !Number.isFinite(currentProd.price) || !productOptionsValid();
    }
  }

  function addToCart() {
    if (!currentProd || !Number.isFinite(currentProd.price) || !productOptionsValid()) return;
    const unitPrice = productVisualUnitPrice();
    const selected_options = selectedOptionsPayload();
    const selected_options_snapshot = selectedOptionsSnapshot();
    const cartItem = window.PedeAquiCartService?.normalizeCartItem?.(currentProd, pmQty, $('pmObs').value.trim())
      || { ...currentProd, qty: pmQty, obs: $('pmObs').value.trim(), uid: newCartItemUid() };
    if (editingCartItemUid) cart = cart.filter(item => item.uid !== editingCartItemUid);
    editingCartItemUid = null;
    cart.push({
      ...cartItem,
      price: Number(currentProd.price),
      base_price: Number(currentProd.price),
      unit_price: unitPrice,
      visual_unit_price: unitPrice,
      selected_options,
      selected_options_snapshot
    });
    closeModalId('productModal');
    updateCartUI();
  }

  function couponPreviewData() {
    const payload = selectedCouponPreview?.data ?? selectedCouponPreview ?? {};
    return payload.preview ?? payload;
  }

  function couponDiscountAmount() {
    const preview = couponPreviewData();
    const value = Number(preview.discount_amount ?? preview.total_discount ?? preview.discount_total ?? preview.delivery_discount ?? preview.discount ?? preview.coupon_discount ?? preview.discount_value ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function couponPreviewTotal() {
    const preview = couponPreviewData();
    const value = Number(preview.final_total ?? preview.total_after_discount ?? preview.discounted_total ?? preview.payable_amount);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function cartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + cartItemUnitPrice(item) * item.qty, 0);
    const svc = settings.service_fee_enabled === false ? 0 : serviceFee();
    const delivery = deliveryFee();
    const beforeDiscount = subtotal + svc + delivery;
    const discount = couponDiscountAmount();
    const previewTotal = couponPreviewTotal();
    const total = selectedCouponPreview
      ? (previewTotal ?? Math.max(0, beforeDiscount - discount))
      : beforeDiscount;
    return { subtotal, svc, delivery, discount, total };
  }

  function hasValidDeliveryEstimateFee() {
    return deliveryType !== 'delivery'
      || (deliveryEstimate.status === 'success'
        && deliveryEstimate.data?.serviceable !== false
        && currentDeliveryEstimateFee() != null);
  }

  function minimumOrderValue() {
    return maxFiniteNumber(
      settings.minimum_order_value,
      settings.min_order_value,
      restaurant.minimum_order_value,
      restaurant.min_order_value,
      payload.minimum_order_value,
      payload.min_order_value,
      payload.settings?.minimum_order_value,
      payload.settings?.min_order_value,
      payload.restaurant?.minimum_order_value,
      payload.restaurant?.min_order_value
    );
  }

  function currentCartAddress() {
    return operationContext?.address || null;
  }

  // A unidade é exibida com o nome que a API deu. O prefixo "LJ." era a
  // convenção de UMA rede; num restaurante de unidade única, ou que chame suas
  // unidades de outra coisa, ele inventa um rótulo que não existe.
  function currentCartBranchLabel() {
    const label = operationContext?.branch_label || operationContext?.branch_name || branches[0]?.name || fallback().branchLabelText || '';
    return String(label).toUpperCase();
  }

  function cartEtaText() {
    return deliveryEstimateText();
  }

  // Rua/número/bairro e cidade-estado separados: o widget da sacola quebra os
  // dois em linhas, a folha de confirmação os escreve seguidos.
  function cartAddressParts(address) {
    const branch = branchById(operationContext?.branch_id) || branches[0] || {};
    const cityState = [address.city || branch.city, address.state || branch.state].filter(Boolean).join(' - ');
    const line1 = [
      [address.street, address.number].filter(Boolean).join(', '),
      address.neighborhood
    ].filter(Boolean).join(', ');
    return { line1: line1 || address.summary || addressSummary(address), cityState };
  }

  function cartAddressHtml(address) {
    if (!address) return '';
    const { line1, cityState } = cartAddressParts(address);
    return cityState ? `${esc(line1)}<span>${esc(cityState)}</span>` : esc(line1);
  }

  function cartAddressLine(address) {
    if (!address) return '';
    const { line1, cityState } = cartAddressParts(address);
    return [line1, cityState].filter(Boolean).join(', ');
  }

  // Unidade onde o pedido é retirado. Em retirada é ELA que ocupa o lugar do
  // endereço de entrega no widget do carrinho.
  function currentPickupBranch() {
    return branchById(operationContext?.branch_id) || branches[0] || {};
  }

  function pickupBranchText() {
    const branch = currentPickupBranch();
    return branch.full_address
      || [branch.address, branch.neighborhood, branch.city].filter(Boolean).join(', ')
      || branch.name
      || '';
  }

  function selectedPaymentSummary() {
    const key = paymentMethodKey || infoPaymentType(paymentMethod);
    const scope = paymentScopeByKey.get(key) || (String(key).includes(':') ? 'delivery' : 'online');
    const type = String(key).split(':')[0] || infoPaymentType(paymentMethod);
    const typeLabel = ({
      credit: 'Crédito',
      debit: 'Débito',
      cash: 'Dinheiro',
      voucher: 'Vale-refeição / alimentação',
      card: 'Cartão'
    })[type] || paymentMethod;
    return {
      scope,
      title: scope === 'delivery' ? 'Pagar na entrega' : 'Pagar online',
      detail: type === 'pix'
        ? 'PIX'
        : (scope === 'delivery' && typeLabel !== paymentMethod
          ? `${typeLabel} - ${paymentMethod}`
          : paymentMethod)
    };
  }

  function handleCartCta() {
    // O pedido Pix já existe, mas a confirmação continua fazendo parte do
    // fluxo: ela volta a mostrar destino, benefício, pagamento e valor antes
    // de reabrir a cobrança existente.
    if (hasCreatedCartPixPayment()) {
      openOrderConfirm();
      return;
    }
    const address = currentCartAddress();
    const hasAddress = Boolean(address?.summary || addressSummary(address));
    const needsAddress = deliveryType !== 'pickup' && !hasAddress;
    if (needsAddress) {
      closeModalImmediately('cartModal');
      openAddressChoiceDirect(false);
      return;
    }
    if (!isLogged()) {
      openLoginScreen('cart');
      return;
    }
    const minOrderValue = minimumOrderValue();
    if (minOrderValue > 0 && cartTotals().subtotal < minOrderValue) return;
    hideCartOrderError();
    if (paymentMethod) {
      openOrderConfirm();
      return;
    }
    openCheckout();
  }

  /* ---------------- Folha de confirmação do pedido ----------------

     Último passo antes de POST /orders. Ela existe para o cliente conferir sem
     sair da sacola PARA ONDE vai, COMO paga e QUANTO — os três dados que ele
     não pode mais corrigir depois que o pedido nasce.

     Nada aqui é fonte de dado: cada linha lê o que a sacola já mostra, para os
     dois não poderem divergir. */

  // "sem benefício" é uma AFIRMAÇÃO sobre o pedido, não um rótulo fixo: com
  // cupom aplicado ela seria mentira escrita na tela do cliente.
  function orderConfirmActionLabel() {
    return selectedCoupon || couponDiscountAmount() > 0
      ? 'Confirmar pedido'
      : 'Confirmar sem benefício';
  }

  function orderConfirmAddressNote(address) {
    return [address?.complement, address?.reference]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' · ');
  }

  function syncOrderConfirmSheet() {
    const setText = (id, value) => { if ($(id)) $(id).textContent = value; };
    const isPickup = deliveryType === 'pickup';
    const address = currentCartAddress();
    const label = orderConfirmActionLabel();
    const summary = paymentMethod ? selectedPaymentSummary() : null;
    const isPix = infoPaymentType(paymentMethod) === 'pix';

    setText('orderConfirmTitle', label);
    setText('orderConfirmCta', label);
    setText('orderConfirmWhereLabel', isPickup ? 'Retirada' : 'Entrega');
    setText('orderConfirmWhereText', isPickup ? pickupBranchText() : cartAddressLine(address));

    const note = $('orderConfirmWhereNote');
    if (note) {
      note.textContent = isPickup ? '' : orderConfirmAddressNote(address);
      note.hidden = !note.textContent;
    }

    // O mapa aqui é SEMPRE o do alfinete, e não o que a sacola está mostrando:
    // o widget dela troca para o mapa do cliente logado (a pessoa andando), que
    // fala de quem é o cliente. Nesta linha o dado que está sendo conferido é
    // para ONDE o pedido vai — o alfinete é o desenho desse dado. Com visitante
    // é o mesmo arquivo do widget, então o navegador já o tem.
    const map = $('orderConfirmMapImage');
    const mapStem = 'assets/icons/cart/cart-location-guest';
    const mapSource = `${mapStem}@1x.webp`;
    if (map && map.getAttribute('src') !== mapSource) {
      // srcset junto com src: com os dois presentes quem decide é o srcset, e
      // um src novo sozinho seria ignorado.
      map.srcset = `${mapStem}@1x.webp 1x, ${mapStem}@2x.webp 2x`;
      map.src = mapSource;
    }
    const benefit = $('orderConfirmBenefitCopy');
    const cartBenefit = document.querySelector('#cartModal .cart-benefit-card .cart-benefit-copy');
    if (benefit && cartBenefit) benefit.textContent = cartBenefit.textContent;

    // "Pagamento online/na entrega" e não o "Pagar online" do cartão da sacola:
    // aqui o texto titula um dado que está sendo conferido, não um botão que
    // leva a escolher.
    setText('orderConfirmPaymentTitle', summary
      ? (summary.scope === 'delivery' ? 'Pagamento na entrega' : 'Pagamento online')
      : 'Forma de pagamento');
    setText('orderConfirmPaymentDetail', summary?.detail || '');
    // toggleAttribute, e não `.hidden =`: o ícone do cartão é um <svg>, e
    // SVGElement não reflete a propriedade `hidden` — a atribuição viraria um
    // campo solto no objeto e os dois ícones apareceriam sobrepostos.
    $('orderConfirmPixIcon')?.toggleAttribute('hidden', !isPix);
    $('orderConfirmCardIcon')?.toggleAttribute('hidden', isPix);
    setText('orderConfirmTotal', fmt(cartTotals().total));
  }

  function openOrderConfirm() {
    syncOrderConfirmSheet();
    setAccessibleDialogState($('orderConfirmSheet'), true, '.order-confirm-cta');
  }

  /** "Alterar dados": a folha desce e a sacola continua exatamente como estava. */
  function closeOrderConfirm() {
    // Com o pedido em voo não há o que alterar: ele já saiu daqui.
    if (orderSubmitInFlight) return;
    setOrderConfirmLoading(false);
    setAccessibleDialogState($('orderConfirmSheet'), false);
  }

  function setOrderConfirmLoading(loading) {
    const cta = $('orderConfirmCta');
    const back = $('orderConfirmBack');
    if (cta) {
      cta.classList.toggle('is-loading', Boolean(loading));
      cta.disabled = Boolean(loading);
    }
    if (back) back.disabled = Boolean(loading);
  }

  // O benefício continua levando ao Clube, como na sacola — só que agora a
  // folha desce antes, senão ela reapareceria por cima da próxima tela.
  function openConfirmBenefits() {
    setAccessibleDialogState($('orderConfirmSheet'), false);
    openCartBenefits();
  }

  async function confirmOrderFromSheet() {
    if (orderSubmitInFlight) return;
    if (hasCreatedCartPixPayment()) {
      closeOrderConfirm();
      resumeCreatedCartPixPayment();
      return;
    }
    setOrderConfirmLoading(true);
    try {
      await submitOrder();
    } finally {
      // Em caso de sucesso a folha já desceu junto com a sacola; o que sobra
      // aqui é devolver o botão quando a criação falhou e o cliente continua
      // na mesma tela.
      setOrderConfirmLoading(false);
    }
  }

  function syncCartLocationState() {
    const totals = cartTotals();
    const minOrderValue = minimumOrderValue();
    const isBelowMinimumOrder = minOrderValue > 0 && totals.subtotal < minOrderValue;
    const address = currentCartAddress();
    const hasAddress = Boolean(address?.summary || addressSummary(address));
    // Em retirada o cliente vai até a loja: exigir endereço de entrega aqui
    // travava o pedido por um dado que o fluxo não usa.
    const isPickup = deliveryType === 'pickup';
    const needsAddress = !isPickup && !hasAddress;
    const widget = $('cartLocationWidget');
    widget?.classList.toggle('has-address', hasAddress || isPickup);
    const locationImage = $('cartLocationImage');
    if (locationImage) {
      const stem = isLogged()
        ? 'assets/icons/cart/cart-location-customer'
        : 'assets/icons/cart/cart-location-guest';
      const imageSource = `${stem}@1x.webp`;
      if (locationImage.getAttribute('src') !== imageSource) {
        // srcset precisa ser trocado JUNTO com src: quando os dois existem, o
        // browser resolve pelo srcset e um src novo sozinho seria ignorado —
        // o ícone ficaria travado no do estado anterior.
        locationImage.srcset = `${stem}@1x.webp 1x, ${stem}@2x.webp 2x`;
        locationImage.src = imageSource;
      }
    }
    const alert = $('cartLocationAlert');
    if (alert) alert.style.display = needsAddress ? 'flex' : 'none';
    const eta = $('cartLocationEta');
    if (eta) {
      eta.style.display = isPickup || hasAddress ? 'block' : 'none';
      eta.textContent = cartEtaText();
    }
    if ($('cartLocationLabel')) {
      $('cartLocationLabel').textContent = isPickup
        ? 'Retirada na loja'
        : (hasAddress ? 'Endereço de entrega' : 'Não há endereço definido');
    }
    if ($('cartLocationText')) {
      if (isPickup) $('cartLocationText').textContent = pickupBranchText();
      else if (hasAddress) $('cartLocationText').innerHTML = cartAddressHtml(address);
      else $('cartLocationText').textContent = '';
    }
    if ($('cartAddrText')) $('cartAddrText').textContent = hasAddress ? (address.summary || addressSummary(address)) : 'Defina seu endereço para entrega';
    if ($('cartLocationStoreTag')) $('cartLocationStoreTag').textContent = currentCartBranchLabel();
    if ($('cartLocationModeTag')) $('cartLocationModeTag').textContent = isPickup ? 'RETIRADA' : 'DELIVERY';
    const paymentCard = document.querySelector('#cartModal .cart-payment-card');
    if (paymentCard) {
      showEl(paymentCard, (isPickup || hasAddress) && isLogged());
      const paymentKey = infoPaymentType(paymentMethod);
      const hasSelectedPayment = Boolean(paymentMethod);
      const isPixSelected = paymentKey === 'pix';
      const summary = hasSelectedPayment ? selectedPaymentSummary() : null;
      paymentCard.classList.toggle('has-selected-payment', hasSelectedPayment);
      paymentCard.classList.toggle('is-pix-payment', isPixSelected);
      if ($('cartPaymentTitle')) {
        $('cartPaymentTitle').hidden = isPixSelected;
        $('cartPaymentTitle').textContent = isPixSelected
          ? ''
          : (summary?.title || 'Escolher forma de pagamento');
      }
      if ($('cartPaymentLabel')) $('cartPaymentLabel').textContent = summary?.detail || 'Selecione a forma de pagamento';
      if ($('cartPaymentPixIcon')) $('cartPaymentPixIcon').hidden = !isPixSelected;
      if ($('cartPaymentDefaultIcon')) $('cartPaymentDefaultIcon').hidden = isPixSelected;
    }
    const cta = $('cartCtaBtn');
    if (cta) {
      // O clique é delegado exclusivamente para handleCartCta. Manter também
      // um onclick por estado executava DUAS ações: login e openCheckout.
      cta.onclick = null;
      cta.disabled = orderSubmitInFlight;
      cta.classList.remove('cart-cta-btn--minimum-required');
      if (orderSubmitInFlight) {
        cta.textContent = 'Enviando pedido...';
        cta.classList.remove('cart-cta-btn--address-required', 'cart-cta-btn--login-required');
      } else if (needsAddress) {
        cta.textContent = 'Informe seu endereço';
        cta.classList.add('cart-cta-btn--address-required');
        cta.classList.remove('cart-cta-btn--login-required');
      } else if (!isLogged()) {
        cta.textContent = 'Entre ou cadastre-se';
        cta.classList.remove('cart-cta-btn--address-required');
        cta.classList.add('cart-cta-btn--login-required');
      } else if (isBelowMinimumOrder) {
        cta.textContent = `Valor abaixo do pedido mínimo (${fmt(minOrderValue)})`;
        cta.disabled = true;
        cta.classList.remove('cart-cta-btn--address-required');
        cta.classList.remove('cart-cta-btn--login-required');
        cta.classList.add('cart-cta-btn--minimum-required');
      } else {
        cta.textContent = paymentMethod ? 'Efetuar pagamento' : 'Escolher forma de pagamento';
        cta.classList.remove('cart-cta-btn--address-required');
        cta.classList.remove('cart-cta-btn--login-required');
      }
    }
  }

  function updateCartUI() {
    const qty = cart.reduce((sum, item) => sum + item.qty, 0);
    if (qty === 0 && selectedCouponPreview) {
      selectedCouponPreview = null;
      couponPreviewKey = '';
    }
    const totals = cartTotals();
    persistCart(); // ponto único de gravação: toda mutação do carrinho passa aqui
    cartStore()?.set?.({ items: cart, deliveryType, paymentMethod, coupon: selectedCoupon, couponPreview: selectedCouponPreview, totals });
    const cartItemCountLabel = $('cartItemCountLabel');
    if (cartItemCountLabel) {
      cartItemCountLabel.textContent = qty === 1 ? '1 item' : String(qty) + ' itens';
      cartItemCountLabel.hidden = qty === 0;
      cartItemCountLabel.closest('.cart-hdr')?.classList.toggle('is-empty', qty === 0);
    }
    $('cartCountTop') && ($('cartCountTop').textContent = qty);
    $('cartCountTop')?.classList.toggle('show', qty > 0);
    $('cartSticky')?.classList.toggle('show', qty > 0);
    if ($('cartCountSticky')) {
      $('cartCountSticky').textContent = qty;
      $('cartCountSticky').dataset.count = qty;
    }
    if ($('cartTotalSticky')) $('cartTotalSticky').textContent = fmt(totals.total);
    syncSecondaryViewCartSticky();
    renderSharedCashbackState();

    if ($('cartContent')) $('cartContent').style.display = 'block';
    if ($('cartFooter')) $('cartFooter').style.display = 'block';
    if ($('cartOrderCard')) $('cartOrderCard').style.display = qty ? '' : 'none';
    syncCartLocationState();

    $('cartList').innerHTML = cart.map(item => `
      <div class="cart-item-row">
        ${/* 48px fixos — #cartModal .cir-photo, styles/restaurant.css:212 */ ''}
        <div class="cir-photo">${productImage(item, 'cir-photo-img', { box: { w: 48, h: 48 } })}</div>
        <div class="cir-info">
          <div class="cir-name"><span>${item.qty}x</span> ${esc(item.name)}</div>
          ${cartOptionsHtml(item)}
          ${item.obs ? `<div class="cir-obs">Obs: ${esc(item.obs)}</div>` : ''}
          <div class="cir-actions">
            <button class="cir-edit-btn" ${act('click', 'editCartItem', item.uid)} aria-label="Editar item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="cir-remove-btn" ${act('click', 'openCartItemDeleteConfirm', item.uid)} aria-label="Remover item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>
            </button>
          </div>
          <div class="cir-price">${fmt(cartItemUnitPrice(item) * item.qty)}</div>
        </div>
      </div>
    `).join('');
    $('csSub').textContent = fmt(totals.subtotal);
    $('csSvcFeeBtn').textContent = fmt(totals.svc);
    $('csDelivery').textContent = deliveryType === 'delivery' ? fmt(totals.delivery) : 'Grátis';
    $('csTotal').textContent = fmt(totals.total);
    if (qty > 0 && selectedCoupon) previewSelectedCoupon({ silent: true });
  }

  function handleHomeCartValueClick() {
    if (!isLogged()) {
      openLoginScreen();
      return;
    }
    mobNavClub();
  }

  function openCartBenefits() {
    if (!isLogged()) {
      openLoginScreen('cart');
      return;
    }
    closeModalId('cartModal');
    mobNavClub();
  }

  function setCartItemDeleteConfirm(open) {
    const confirm = $('cartItemDeleteConfirm');
    setAccessibleDialogState(confirm, Boolean(open), '.addr-delete-yes');
  }

  function openCartItemDeleteConfirm(uid) {
    pendingCartItemDeleteUid = uid;
    setCartItemDeleteConfirm(true);
  }

  function closeCartItemDeleteConfirm() {
    setCartItemDeleteConfirm(false);
  }

  function cancelCartItemDelete() {
    pendingCartItemDeleteUid = null;
    closeCartItemDeleteConfirm();
  }

  function confirmCartItemDelete() {
    const uid = pendingCartItemDeleteUid;
    pendingCartItemDeleteUid = null;
    closeCartItemDeleteConfirm();
    if (uid == null) return;
    removeCartItem(uid);
  }

  function removeCartItem(uid) {
    cart = cart.filter(i => i.uid !== uid);
    updateCartUI();
  }

  function editCartItem(uid) {
    const item = cart.find(i => i.uid === uid);
    if (!item) return;
    openProduct(item.id);
    editingCartItemUid = uid;
    pmQty = item.qty;
    restoreSelectedOptions(item);
    $('pmObs').value = item.obs || '';
    updateProductObservationCount();
    updatePmUI();
  }

  function setCartTab(type) {
    deliveryType = type;
    syncOrderTypeFromCart(type);
    $('cartTabEntrega')?.classList.toggle('active', type === 'delivery');
    $('cartTabRetirada')?.classList.toggle('active', type === 'pickup');
    if ($('cartAddrBlock')) $('cartAddrBlock').style.display = type === 'delivery' ? 'block' : 'none';
    if ($('cartDeliveryOpt')) $('cartDeliveryOpt').style.display = type === 'delivery' ? 'block' : 'none';
    showEl($('cartPickupBlock'), type === 'pickup');
    if ($('csDeliveryRow')) $('csDeliveryRow').style.display = type === 'delivery' ? 'flex' : 'none';
    syncCartLocationState();
    updateCartUI();
  }

  async function openCheckout() {
    if (!isLogged()) {
      openLoginScreen('cart');
      return;
    }
    const selectedAddress = currentCartAddress();
    if (deliveryType === 'delivery' && !selectedAddress) {
      closeModalId('cartModal');
      openAddressScreen();
      return;
    }
    const checkoutCustomer = currentCustomerSnapshot();
    if (checkoutCustomer) {
      $('chkName').value = checkoutCustomer.name || '';
      $('chkPhone').value = checkoutCustomer.phone || '';
    }
    if (selectedAddress) fillCheckoutAddress(selectedAddress);
    setDeliveryType(deliveryType);
    requestDeliveryEstimate();
    await ensureRestaurantInfo();
    openPaymentMethodScreen();
  }

  function fillCheckoutAddress(address) {
    $('chkRua').value = address.street || '';
    $('chkNum').value = address.number || '';
    $('chkBairro').value = address.neighborhood || '';
    $('chkComp').value = address.complement || '';
  }

  function backToCart() {
    closeModalId('checkoutModal');
    setTimeout(() => openCartModal(), 180);
  }


  function setDeliveryType(type) {
    deliveryType = type;
    syncOrderTypeFromCart(type);
    $('btnDel')?.classList.toggle('active', type === 'delivery');
    $('btnPick')?.classList.toggle('active', type === 'pickup');
    if ($('addressGroup')) $('addressGroup').style.display = type === 'delivery' ? 'block' : 'none';
    updateCartUI();
  }

  function profilePaymentChips(entries) {
    if (!entries.length) return '<div class="prof-placeholder-text">Nenhum método disponível.</div>';
    return `<div class='prof-pay-chips'>${entries.map(entry => `<div class='prof-pay-chip'><div class='prof-pay-chip-dot'></div>${esc(infoPaymentLabel(entry))}</div>`).join('')}</div>`;
  }

  function profileDeliveryPaymentGroups(entries) {
    const labels = { credit: 'Crédito', debit: 'Débito', cash: 'Dinheiro', pix: 'PIX na entrega', voucher: 'Vale-refeição / alimentação' };
    const groups = ['credit', 'debit', 'cash', 'pix', 'voucher']
      .map(type => [type, entries.filter(entry => entry.method_type === type)])
      .filter(([, items]) => items.length);
    if (!groups.length) return '<div class=prof-placeholder-text>Nenhum método disponível.</div>';
    return groups.map(([type, items]) => `<div class='prof-payment-method-group'><div class='prof-payment-method-title'>${labels[type]}</div>${profilePaymentChips(items)}</div>`).join('');
  }

  function renderProfilePaymentScreen(data) {
    const body = document.querySelector('#profSubpagamento .prof-sub-body');
    if (!body) return;
    const groups = infoPaymentData(data);
    body.innerHTML = `
      <div class='prof-payment-tabs'>
        <button class='active' type='button' data-profile-payment-tab='online' ${act('click', 'setProfilePaymentTab', 'online')}>Pagamento online</button>
        <button type='button' data-profile-payment-tab='delivery' ${act('click', 'setProfilePaymentTab', 'delivery')}>Pagamento na entrega</button>
      </div>
      <section class='prof-payment-panel' data-profile-payment-panel='online'>
        <div class='prof-info-card'>${profilePaymentChips(groups.online)}</div>
        <button class='prof-card-coming-soon' type='button' ${act('click', 'showCardComingSoon')}>Cadastrar novo cartão <span>Em breve</span></button>
      </section>
      <section class='prof-payment-panel' data-profile-payment-panel='delivery' hidden>
        <div class='prof-info-card'>${profileDeliveryPaymentGroups(groups.delivery)}</div>
      </section>`;
  }

  function renderProfilePaymentError() {
    const body = document.querySelector('#profSubpagamento .prof-sub-body');
    if (body) body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Não foi possível carregar as formas de pagamento.</div></div>';
  }

  function setProfilePaymentTab(tab) {
    document.querySelectorAll('[data-profile-payment-tab]').forEach(button => button.classList.toggle('active', button.dataset.profilePaymentTab === tab));
    document.querySelectorAll('[data-profile-payment-panel]').forEach(panel => { panel.hidden = panel.dataset.profilePaymentPanel !== tab; });
  }

  function showCardComingSoon() {
    alert('Cadastro de cartão estará disponível em breve.');
  }

  function syncPaymentMethodFooter() {
    const onlineTabActive = document.querySelector('[data-payment-screen-tab=online]')?.classList.contains('active');
    const onlineSelection = document.querySelector('.payment-method-option[data-payment-scope=online].active');
    if ($('paymentMethodFooter')) $('paymentMethodFooter').hidden = !(onlineTabActive && onlineSelection);
  }

  function setPaymentScreenTab(tab) {
    document.querySelectorAll('[data-payment-screen-tab]').forEach(button => {
      const active = button.dataset.paymentScreenTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-payment-screen-panel]').forEach(panel => {
      panel.hidden = panel.dataset.paymentScreenPanel !== tab;
    });
    syncPaymentMethodFooter();
  }

  function openPaymentMethodScreen() {
    const overlay = $('paymentMethodModal');
    const confirmedKey = paymentMethodKey || infoPaymentType(paymentMethod);
    const confirmedButton = paymentMethod
      ? Array.from(document.querySelectorAll('.payment-method-option')).find(button => !button.disabled && button.dataset.paymentKey === confirmedKey)
      : null;
    setPaymentScreenTab(confirmedButton?.dataset.paymentScope || 'online');
    document.querySelectorAll('.payment-method-option').forEach(button => {
      const active = button === confirmedButton;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (overlay && confirmedButton) {
      overlay.dataset.paymentValue = paymentMethod;
      overlay.dataset.paymentKey = confirmedKey;
    } else {
      overlay?.removeAttribute('data-payment-value');
      overlay?.removeAttribute('data-payment-key');
    }
    syncPaymentMethodFooter();
    overlay?.classList.remove('is-entered', 'is-closing');
    openModal('paymentMethodModal');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (overlay?.classList.contains('active')) overlay.classList.add('is-entered');
    }));
  }

  function closePaymentMethodScreen() {
    const overlay = $('paymentMethodModal');
    if (!overlay?.classList.contains('active')) return;
    overlay.classList.remove('is-entered', 'is-closing');
    closeModalId('paymentMethodModal');
  }

  function checkoutDeliveryEntryKey(entry) {
    const type = entry.method_type || 'payment';
    const identity = slug(entry.name || entry.brand || '');
    return identity ? `${type}:${identity}` : type;
  }

  function checkoutDeliveryIcon(entry, label) {
    const brandClass = infoBrandClass(entry.brand || label);
    if (brandClass) return `<span class='payment-brand-icon ${brandClass}' aria-hidden='true'></span>`;
    if (entry.method_type === 'pix') return `<img class='payment-pix-icon' src='assets/icons/payment/pix.png' alt=''>`;
    if (entry.method_type === 'cash') return `<span class='payment-cash-icon' aria-hidden='true'>R$</span>`;
    return `<span class='payment-card-icon' aria-hidden='true'><svg viewBox='0 0 24 24'><rect x='2.5' y='5' width='19' height='14' rx='2'/><path d='M2.5 10h19'/></svg></span>`;
  }

  function renderCheckoutDeliveryGroups(entries) {
    const container = $('paymentDeliveryGroups');
    const keyedEntries = entries.map(entry => ({
      ...entry,
      checkout_key: checkoutDeliveryEntryKey(entry)
    }));
    const knownOrder = ['credit', 'debit', 'cash', 'pix', 'voucher', 'card'];
    const presentTypes = [...new Set(keyedEntries.map(entry => entry.method_type))];
    const typeOrder = [
      ...knownOrder.filter(type => presentTypes.includes(type)),
      ...presentTypes.filter(type => !knownOrder.includes(type))
    ];
    const groupLabels = {
      credit: 'Cr\u00e9dito',
      debit: 'D\u00e9bito',
      cash: 'Dinheiro',
      pix: 'PIX na entrega',
      voucher: 'Vale-refei\u00e7\u00e3o / alimenta\u00e7\u00e3o',
      card: 'Cart\u00e3o'
    };
    if (container) {
      container.innerHTML = typeOrder.map(type => {
        const groupEntries = keyedEntries.filter(entry => entry.method_type === type);
        const title = groupLabels[type] || infoPaymentLabel({ method_type: type });
        return `<section class='payment-delivery-group' data-payment-delivery-group='${esc(type)}'>
          <h3 class='payment-delivery-title'>${esc(title)}</h3>
          <div class='payment-delivery-options'>${groupEntries.map(entry => {
            const label = infoPaymentLabel(entry);
            return `<button class='payment-method-option payment-method-option--delivery' type='button' data-payment-scope='delivery' data-payment-key='${esc(entry.checkout_key)}' data-payment-type='${esc(entry.method_type)}' data-payment-value='${esc(label)}' aria-pressed='false' ${act('click', 'setPayment', '$this', label)}>${checkoutDeliveryIcon(entry, label)}<span class='payment-method-option-label'>${esc(label)}</span></button>`;
          }).join('')}</div>
        </section>`;
      }).join('');
    }
    return keyedEntries;
  }

  function renderCheckoutPaymentMethods(data) {
    const groups = data ? infoPaymentData(data) : { online: [], delivery: [] };
    const onlineKeys = new Set(groups.online.map(entry => entry.method_type));
    const deliveryEntries = renderCheckoutDeliveryGroups(groups.delivery);
    const deliveryKeys = new Set(deliveryEntries.map(entry => entry.checkout_key));
    const deliveryTypes = new Set(deliveryEntries.map(entry => entry.method_type));
    // chave da UI -> method_type do backend, para o payload do pedido
    paymentApiTypeByKey.clear();
    paymentScopeByKey.clear();
    groups.online.forEach(entry => {
      if (entry.method_type) {
        paymentApiTypeByKey.set(entry.method_type, entry.api_method_type || entry.method_type);
        paymentScopeByKey.set(entry.method_type, 'online');
      }
    });
    deliveryEntries.forEach(entry => {
      paymentApiTypeByKey.set(entry.checkout_key, entry.api_method_type || entry.method_type);
      paymentScopeByKey.set(entry.checkout_key, 'delivery');
    });
    if (deliveryTypes.has('pix')) {
      onlineKeys.add('pix');
      const deliveryPix = deliveryEntries.find(entry => entry.method_type === 'pix');
      if (!paymentApiTypeByKey.has('pix') && deliveryPix) paymentApiTypeByKey.set('pix', deliveryPix.api_method_type || 'pix');
      paymentScopeByKey.set('pix', 'online');
    }
    availableCheckoutPaymentKeys = new Set([...onlineKeys, ...deliveryKeys]);
    const buttons = Array.from(document.querySelectorAll('.payment-method-option[data-payment-key]'));
    buttons.forEach(button => {
      const scopeKeys = button.dataset.paymentScope === 'online' ? onlineKeys : deliveryKeys;
      const available = scopeKeys.has(button.dataset.paymentKey);
      button.disabled = !available;
      button.classList.toggle('is-unavailable', !available);
      button.setAttribute('aria-disabled', available ? 'false' : 'true');
      button.title = available ? '' : 'Forma de pagamento indisponível';
    });
    const selectedKey = paymentMethodKey || infoPaymentType(paymentMethod);
    if (paymentMethod && !availableCheckoutPaymentKeys.has(selectedKey)) {
      paymentMethod = '';
      paymentMethodKey = '';
    }
    buttons.forEach(button => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    if ($('checkoutPaymentLabel')) $('checkoutPaymentLabel').textContent = paymentMethod || 'Selecione a forma de pagamento';
  }

  function commitPaymentMethod(value, key) {
    paymentMethod = value;
    paymentMethodKey = key;
    if ($('checkoutPaymentLabel')) $('checkoutPaymentLabel').textContent = value;
    hideCartOrderError();
    updateCartUI();
  }

  function returnToCartFromPayment() {
    closePaymentMethodScreen();
    if ($('checkoutModal')?.classList.contains('active')) closeModalImmediately('checkoutModal');
    if (!$('cartModal')?.classList.contains('active')) openCartModal();
  }

  function setPayment(btn, type) {
    const key = btn?.dataset.paymentKey || infoPaymentType(type);
    if (!btn || btn.disabled || !availableCheckoutPaymentKeys.has(key)) return;
    const overlay = $('paymentMethodModal');
    if (btn.dataset.paymentScope === 'delivery') {
      document.querySelectorAll('.payment-method-option').forEach(button => {
        const active = button === btn;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      commitPaymentMethod(type, key);
      returnToCartFromPayment();
      return;
    }
    if (btn.classList.contains('active')) {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
      overlay?.removeAttribute('data-payment-value');
      overlay?.removeAttribute('data-payment-key');
      syncPaymentMethodFooter();
      return;
    }
    document.querySelectorAll('.payment-method-option').forEach(button => {
      const active = button === btn;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (overlay) {
      overlay.dataset.paymentValue = type;
      overlay.dataset.paymentKey = key;
    }
    syncPaymentMethodFooter();
  }

  function confirmPaymentMethodSelection() {
    const overlay = $('paymentMethodModal');
    const selected = overlay?.querySelector('.payment-method-option.active');
    const type = overlay?.dataset.paymentValue || selected?.dataset.paymentValue || '';
    const key = overlay?.dataset.paymentKey || selected?.dataset.paymentKey || infoPaymentType(type);
    if (!selected || selected.dataset.paymentScope !== 'online' || !type || !availableCheckoutPaymentKeys.has(key)) return;
    commitPaymentMethod(type, key);
    returnToCartFromPayment();
  }

  // ============================================================
  //  Checkout — criação do pedido diretamente pela sacola
  // ============================================================

  function orderPaymentMethodForApi() {
    const key = paymentMethodKey || infoPaymentType(paymentMethod) || '';
    // Sem correspondência do backend, mandamos a chave da UI: um 422 legível é
    // melhor do que inventar um valor que o servidor não conhece.
    return paymentApiTypeByKey.get(key) || key;
  }

  function currentOrderState() {
    return {
      cart,
      operationContext: {
        branch_id: operationContext?.branch_id,
        order_type: deliveryType || operationContext?.order_type || 'delivery',
        address: currentCartAddress()
      },
      coupon: selectedCoupon,
      paymentMethod: orderPaymentMethodForApi(),
      customer: currentCustomerSnapshot(),
      isAuthenticated: Boolean(window.PedeAquiCustomerAuth?.isLoggedIn?.()),
      notes: null
    };
  }

  function buildCurrentOrderPayload() {
    return window.RapidexOrderPayload.buildOrderPayload(currentOrderState());
  }

  function validateCurrentOrder(orderPayload) {
    return window.RapidexOrderPayload.validateOrderPayload(orderPayload, {
      hasValidDeliveryFee: hasValidDeliveryEstimateFee(),
      isAuthenticated: Boolean(window.PedeAquiCustomerAuth?.isLoggedIn?.())
    });
  }

  function showCartOrderProblems(problems) {
    const message = problems.length === 1
      ? problems[0]
      : `Revise antes de continuar: ${problems.join(' · ')}`;
    showCartOrderError(message);
  }

  function showCartOrderError(message) {
    const box = $('cartOrderError');
    if (!box) return;
    box.hidden = false;
    box.textContent = message;
  }

  function hideCartOrderError() {
    const box = $('cartOrderError');
    if (!box) return;
    box.hidden = true;
    box.textContent = '';
  }

  // ============================================================
  //  Persistência do carrinho — rapidex.cart.<slug>
  //
  //  Namespaced por restaurante (carrinhos não se misturam entre lojas) e com
  //  TTL: um carrinho de dias atrás tem preços possivelmente vencidos, então
  //  expira em vez de ressuscitar. Só persistimos os campos necessários para
  //  reconstruir a linha — os valores continuam vindo do backend.
  // ============================================================
  const CART_TTL_MS = 24 * 60 * 60 * 1000;
  const cartStorageKey = () =>
    (storageKeys()?.PREFIXES.cart || 'rapidex.cart.') + getRestaurantSlug();

  // `cart` começa vazio no load. Se qualquer updateCartUI() rodasse antes da
  // restauração, persistCart() apagaria o carrinho salvo. Só gravamos depois
  // que restoreCart() teve sua chance.
  let cartRestored = false;

  function persistCart() {
    if (!cartRestored) return;
    try {
      if (!cart.length) {
        localStorage.removeItem(cartStorageKey());
        return;
      }
      localStorage.setItem(cartStorageKey(), JSON.stringify({
        saved_at: Date.now(),
        items: cart
      }));
    } catch {
      // Cota estourada / modo privativo: o carrinho em memória segue válido.
    }
  }

  function restoreCart() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(cartStorageKey()) || 'null'); }
    catch { stored = null; }
    cartRestored = true; // a partir daqui persistCart() pode gravar
    if (!stored || !Array.isArray(stored.items) || !stored.items.length) return;

    const savedAt = Number(stored.saved_at);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > CART_TTL_MS) {
      try { localStorage.removeItem(cartStorageKey()); } catch {}
      return;
    }

    // Só restaura itens ainda existentes e disponíveis no cardápio atual: um
    // produto removido/desativado não pode voltar pelo carrinho.
    const byId = new Map(products.map(product => [String(product.id), product]));
    cart = stored.items.reduce((accumulator, item) => {
      const product = byId.get(String(item.product_id ?? item.id));
      if (!product || product.is_available === false) return accumulator;
      // Preço SEMPRE recalculado a partir do cardápio recém-carregado: o valor
      // salvo pode estar velho. cartItemUnitPrice() prefere visual_unit_price,
      // então ele precisa ser refeito junto, senão a tela mostra preço antigo.
      const basePrice = Number(product.price);
      const optionsExtra = (Array.isArray(item.selected_options_snapshot) ? item.selected_options_snapshot : [])
        .reduce((sum, option) => sum + Number(option.additional_price || 0), 0);
      const unitPrice = basePrice + optionsExtra;
      accumulator.push({
        ...item,
        uid: item.uid || newCartItemUid(),
        qty: Math.max(1, Number.parseInt(item.qty, 10) || 1),
        price: basePrice,
        base_price: basePrice,
        unit_price: unitPrice,
        visual_unit_price: unitPrice
      });
      return accumulator;
    }, []);
    if (cart.length !== stored.items.length) persistCart();
  }

  // ---- Idempotency-Key ----
  // A chave identifica UMA tentativa de pedido. Ela é gerada no primeiro envio
  // pela sacola e permanece a MESMA em todas as retentativas do mesmo pedido — é
  // isso que torna seguro reenviar após um timeout. Ela só troca quando o
  // pedido deixa de ser o mesmo: sucesso, ou qualquer mudança no payload
  // (itens, endereço, cupom, pagamento). Assim um retry nunca duplica e uma
  // alteração de verdade nunca é confundida com a tentativa anterior.
  let orderIdempotencyKey = null;
  let orderIdempotencySignature = '';

  function newUuid() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    // Fallback para navegadores sem randomUUID (ou contexto não seguro).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
    });
  }

  function ensureOrderIdempotencyKey(orderPayload) {
    const signature = JSON.stringify(orderPayload);
    if (!orderIdempotencyKey || orderIdempotencySignature !== signature) {
      orderIdempotencyKey = newUuid();
      orderIdempotencySignature = signature;
    }
    return orderIdempotencyKey;
  }

  function resetOrderIdempotencyKey() {
    orderIdempotencyKey = null;
    orderIdempotencySignature = '';
  }

  let orderSubmitInFlight = false;

  function setOrderSubmitting(active) {
    orderSubmitInFlight = active;
    syncCartLocationState();
  }

  // Traduz a falha do createOrder em algo acionável. O carrinho NUNCA é tocado
  // aqui: erro não pode custar o pedido do cliente.
  function orderErrorMessage(error) {
    if (error?.name === 'TimeoutError') {
      return 'O servidor demorou para responder. Verifique sua conexão e toque em Efetuar pagamento novamente.';
    }
    if (error?.status === 409) {
      return apiErrorMessage(error, 'Este cupom não está mais disponível. Remova-o ou escolha outro para continuar.');
    }
    if (error?.status === 401 || error?.status === 403) {
      return 'Sua sessão expirou. Entre novamente para concluir o pedido.';
    }
    if (error?.name === 'NetworkError') {
      return 'Sem conexão com o servidor. Verifique sua internet e toque em Efetuar pagamento novamente.';
    }
    if (Number(error?.status) >= 500) {
      return 'O servidor não conseguiu processar o pedido agora. Tente novamente em instantes.';
    }
    if (error?.status === 422) {
      const detail = error.data?.detail;
      // O 422 do FastAPI vem como ARRAY de ValidationError — juntar os `msg` é
      // o que transforma isso em frase, em vez de "[object Object]".
      if (Array.isArray(detail) && detail.length) {
        const fields = detailText(detail);
        if (fields) return `Não foi possível criar o pedido: ${fields}`;
      }
      return apiErrorMessage(error, 'Alguns dados do pedido não foram aceitos. Revise e tente novamente.');
    }
    return apiErrorMessage(error, 'Não foi possível criar o pedido. Tente novamente.');
  }

  async function submitOrder() {
    if (orderSubmitInFlight) return; // trava de duplo-clique
    const orderPayload = buildCurrentOrderPayload();
    const problems = validateCurrentOrder(orderPayload);
    if (problems.length) {
      // O aviso mora na sacola, atrás da folha: mostrá-lo com a folha em cima
      // seria escrever para uma tela que o cliente não está vendo.
      closeOrderConfirm();
      showCartOrderProblems(problems);
      return;
    }

    hideCartOrderError();
    setOrderSubmitting(true);

    let response;
    try {
      response = await window.PedeAquiOrderService.createOrder(
        getRestaurantSlug(),
        orderPayload,
        { idempotencyKey: ensureOrderIdempotencyKey(orderPayload) }
      );
    } catch (error) {
      // Falha REAL da requisição: o carrinho não é tocado e a Idempotency-Key é
      // preservada de propósito — a retentativa precisa ser reconhecida como a
      // mesma tentativa, não como um pedido novo.
      logAppError('Falha ao criar pedido', error);
      setOrderSubmitting(false); // reabilita para retry
      closeOrderConfirm(); // o erro é da sacola, e ela está atrás da folha
      showCartOrderError(orderErrorMessage(error));
      return;
    }

    // Daqui para frente o pedido JÁ EXISTE no servidor. Um erro de renderização
    // não pode virar mensagem de falha: o usuário tentaria de novo e criaria um
    // pedido duplicado. Na dúvida, seguimos para a tela de sucesso.
    try {
      // O await não é decoração: quem chamou (o botão da folha) só devolve a
      // bolinha quando a PRÓXIMA TELA está pronta. Sem ele, submitOrder
      // resolvia assim que disparava o roteamento e o botão voltava ao normal
      // no mesmo quadro, ainda com a cobrança em voo.
      await handleOrderCreated(response);
    } catch (error) {
      logAppError('Pedido criado, mas falhou ao exibir a confirmação', error);
      leaveCartAfterOrder();
      showOrderSuccess(response);
    }
  }

  /**
   * Linhas do carrinho no formato que a tela de pagamento consome. Tirada
   * enquanto o carrinho ainda existe: logo abaixo ele é esvaziado, e nenhuma
   * rota do ciclo devolve os itens de volta.
   */
  function orderItemsSnapshot() {
    return cart.map(item => ({
      name: item.name,
      qty: item.qty,
      total: cartItemUnitPrice(item) * item.qty
    }));
  }

  /**
   * Fecha a sacola e a folha e zera o carrinho — o carrinho só pode ser limpo
   * aqui, depois de sucesso confirmado.
   *
   * Quem chama é sempre quem JÁ TEM a próxima tela pronta para abrir. Enquanto
   * a cobrança está sendo criada a folha continua na frente, com a bolinha
   * girando no botão: fechar a sacola antes deixaria a loja aparecendo por
   * baixo no meio do caminho.
   */
  function leaveCartAfterOrder({ confirmationAlreadyClosed = false } = {}) {
    cart = [];
    selectedCoupon = null;
    selectedCouponPreview = null;
    couponPreviewKey = '';
    paymentMethod = '';
    paymentMethodKey = '';
    resetOrderIdempotencyKey(); // próximo pedido = chave nova
    updateCartUI();
    setOrderSubmitting(false);
    if (!confirmationAlreadyClosed) closeOrderConfirm();
    hideCartOrderError();
    closeModalImmediately('cartModal');
  }

  // Só aqui o carrinho pode ser limpo: depois de sucesso confirmado.
  function handleOrderCreated(response) {
    submittedOrder = response || null;
    const items = orderItemsSnapshot();
    // O tracking_token é gravado ANTES de qualquer renderização: ele é a única
    // porta do visitante para o próprio pedido, e uma exceção mais adiante não
    // pode ser o motivo de ele se perder.
    rememberTrackingToken(response, items);
    // Persistir/disparar evento não pode derrubar a confirmação: o pedido já
    // existe, e uma falha aqui é de cache, não do pedido.
    try { window.PedeAquiOrderState?.saveOrder?.(response); }
    catch (error) { logAppError('Falha ao registrar o pedido localmente', error); }
    return routeCreatedOrder(response, items);
  }

  // O backend decide o caminho, não a UI: `payment_flow` vem na resposta da
  // criação. Pagamento na entrega segue direto para a confirmação, exatamente
  // como sempre; pagamento online precisa da cobrança antes de o pedido valer.
  async function routeCreatedOrder(response, items) {
    if (!isOnlinePaymentFlow(response)) {
      leaveCartAfterOrder();
      showOrderSuccess(response);
      return;
    }
    // A cobrança é criada com a folha ainda na frente; a sacola só sai de cena
    // no quadro em que a tela do Pix entra.
    const session = await preparePixPayment(response, { items, ownsCart: true });
    // A confirmação deixa de ser interativa, mas a sacola permanece visível
    // atrás enquanto a tela Pix desliza por cima dela.
    setOrderSubmitting(false);
    closeOrderConfirm();
    presentPixPayment(session);
  }

  // Totais vêm como number; descontos vêm como string decimal ("0.00").
  // Ver docs/order-contract.md (CreateOrderResponse).
  function orderAmount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function showOrderSuccess(response) {
    const order = response || {};
    const setText = (id, value) => { if ($(id)) $(id).textContent = value; };

    // O pedido acompanhado na tela de sucesso: é dele que sai o tracking_token
    // do botão "Atualizar status".
    trackedOrder = order.tracking_token ? order : (trackedOrder?.id === order.id ? trackedOrder : null);

    setText('ordSuccessMessage', order.message || 'Aguardando confirmação do restaurante.');
    setText('ordSuccessNumber', order.order_number != null ? `#${order.order_number}` : '—');
    setText('ordSuccessStatus', orderStatusLabel(order.status));
    setText('ordSuccessSubtotal', fmt(orderAmount(order.subtotal)));

    const serviceFeeValue = orderAmount(order.service_fee);
    setText('ordSuccessSvc', fmt(serviceFeeValue));
    if ($('ordSuccessSvcRow')) $('ordSuccessSvcRow').style.display = serviceFeeValue > 0 ? '' : 'none';

    const deliveryFeeValue = orderAmount(order.delivery_fee);
    setText('ordSuccessDelivery', fmt(deliveryFeeValue));
    if ($('ordSuccessDeliveryRow')) $('ordSuccessDeliveryRow').style.display = deliveryFeeValue > 0 ? '' : 'none';

    const discount = orderAmount(order.discount_total ?? order.coupon_discount_amount);
    if ($('ordSuccessDiscountRow')) $('ordSuccessDiscountRow').hidden = !(discount > 0);
    setText('ordSuccessDiscount', `- ${fmt(discount)}`);

    setText('ordSuccessTotal', fmt(orderAmount(order.total)));

    // Linha de pagamento: só faz sentido quando houve cobrança online. Num
    // pedido pago na entrega ela continua ausente, e o cartão fica idêntico ao
    // que sempre foi.
    const paymentLabel = onlinePaymentStatusLabel(order);
    if ($('ordSuccessPaymentRow')) $('ordSuccessPaymentRow').hidden = !paymentLabel;
    if (paymentLabel) setText('ordSuccessPayment', paymentLabel);

    // Botão de acompanhamento: aparece só quando temos o token que o autoriza.
    const trackButton = $('ordSuccessTrackBtn');
    if (trackButton) {
      trackButton.hidden = !trackedOrder?.tracking_token;
      trackButton.disabled = false;
      trackButton.textContent = 'Atualizar status do pedido';
    }

    openModal('orderSuccessModal');
  }

  /** Rótulo da linha "Pagamento" — vazio quando o pedido não é de fluxo online. */
  function onlinePaymentStatusLabel(order) {
    if (!isOnlinePaymentFlow(order)) return '';
    return ({
      paid: 'Pago',
      pending: 'Aguardando pagamento',
      failed: 'Não aprovado'
    })[paymentStatusKind(order?.payment_status)] || 'Aguardando pagamento';
  }

  function orderStatusLabel(status) {
    const labels = {
      pending: 'Aguardando confirmação',
      submitted: 'Enviado',
      confirmed: 'Confirmado',
      preparing: 'Em preparo',
      ready: 'Pronto',
      delivering: 'Saiu para entrega',
      delivered: 'Entregue',
      cancelled: 'Cancelado'
    };
    return labels[String(status || '').toLowerCase()] || String(status || '—');
  }

  // ============================================================
  //  Pagamento online (Pix)
  //
  //  O pedido JÁ EXISTE quando esta parte começa: POST /orders respondeu, o
  //  carrinho foi limpo e o tracking_token está guardado. O que falta é a
  //  cobrança — e é ela, não o pedido, que pode falhar daqui para frente. Por
  //  isso nenhum erro deste bloco volta a falar em "não foi possível criar o
  //  pedido": seria mentira, e levaria o cliente a pedir de novo.
  //
  //  Sequência:
  //    POST .../orders/{token}/payment  -> qr_code e/ou checkout_url
  //    GET  .../orders/track/{token}    -> repetido até payment_status virar
  //                                        pago, com prazo (ver PIX_POLL_*)
  //
  //  As duas rotas são autorizadas pelo próprio tracking_token, então o fluxo
  //  inteiro funciona para visitante sem conta.
  // ============================================================

  // Intervalo entre consultas e teto da janela de espera. O teto existe para
  // que a tela não fique consultando para sempre uma cobrança que ninguém vai
  // pagar: ao estourar, o polling PARA e o cliente decide se verifica de novo.
  const PIX_POLL_INTERVAL_MS = 5000;
  const PIX_POLL_WINDOW_MS = 10 * 60 * 1000;
  // O texto de consequência sai da MESMA constante que o contador e o polling:
  // mudar a janela num lugar só não pode deixar a tela prometendo outro prazo.
  const PIX_WINDOW_MINUTES = Math.round(PIX_POLL_WINDOW_MS / 60000);
  // Falhas de rede seguidas na consulta não são falha de pagamento — só
  // desistimos de consultar depois de algumas.
  const PIX_POLL_MAX_FAILURES = 5;

  // Pedido exibido na tela de sucesso, quando ele tem tracking_token.
  let trackedOrder = null;
  // Sessão de pagamento em aberto. Trocar de sessão invalida as respostas em
  // voo da anterior (a comparação `pixSession !== session` aparece em todo
  // ponto que retoma depois de um await).
  let pixSession = null;
  // Tickers da tela de Pix, independentes da sessão: o contador regressivo e o
  // sumiço automático do aviso de "copiado".
  let pixCountdownTimer = null;
  let pixToastTimer = null;
  // Um timer por folha (confirmação de saída, "Como funciona"): o [hidden] só
  // volta quando a animação de descida termina.
  const pixSheetTimers = new Map();
  const PIX_EXIT_SHEET_TRANSITION_MS = 700;

  const isOnlinePaymentFlow = order =>
    String(order?.payment_flow || '').trim().toLowerCase() === 'online';

  /**
   * `payment_status` é `string` livre no OpenAPI — não há enum publicado. Em
   * vez de adivinhar um valor único, classificamos em três desfechos e tratamos
   * o desconhecido como PENDENTE: seguir esperando é o erro barato; dar um
   * pedido como pago sem estar é o caro.
   */
  function paymentStatusKind(status) {
    const value = String(status || '').trim().toLowerCase();
    if (['paid', 'approved', 'succeeded', 'success', 'confirmed', 'captured', 'settled', 'completed'].includes(value)) return 'paid';
    if (['failed', 'failure', 'canceled', 'cancelled', 'expired', 'refused', 'rejected', 'declined', 'error', 'refunded', 'chargeback', 'voided'].includes(value)) return 'failed';
    return 'pending';
  }

  /**
   * @param {Array} [items] foto das linhas do carrinho, tirada ANTES da limpeza
   *   — é a única cópia que sobra delas depois que o pedido é criado.
   */
  function rememberTrackingToken(response, items) {
    try {
      const saved = window.RapidexOrderTracking?.remember?.(getRestaurantSlug(), response, { items });
      if (!saved && isOnlinePaymentFlow(response)) {
        // Sem token não há como iniciar a cobrança nem acompanhar o pedido.
        logAppError('Pedido online criado sem tracking_token', new Error('tracking_token ausente na resposta'));
      }
      return saved;
    } catch (error) {
      logAppError('Falha ao guardar o tracking_token', error);
      return null;
    }
  }

  function updateTrackingEntry(trackingToken, patch) {
    try { window.RapidexOrderTracking?.update?.(getRestaurantSlug(), trackingToken, patch); }
    catch (error) { logAppError('Falha ao atualizar o pedido guardado', error); }
  }

  function setPixState(state) {
    document.querySelectorAll('#pixPaymentModal [data-pix-state]').forEach(section => {
      section.hidden = section.dataset.pixState !== state;
    });
    // O rodapé serve a UMA ação, copiar o código, e só existe onde ela faz
    // sentido: cobrança pronta E com código. Numa cobrança que veio só com
    // checkout_url o botão não teria o que copiar (renderPixCharge esvazia o
    // campo nesse caso), e a saída é o link, não ele.
    const footer = $('pixFooter');
    if (footer) footer.hidden = !(state === 'ready' && !!$('pixCopyCode')?.dataset.code?.trim());
  }

  /**
   * Traduz a falha de CRIAR A COBRANÇA em título, mensagem e desfecho.
   *
   * Duas regras valem em todos os ramos:
   *
   * 1. O pedido JÁ EXISTE quando chegamos aqui. Nenhuma mensagem pode sugerir
   *    refazê-lo — o cliente que refaz acaba com dois pedidos.
   * 2. Retentável e definitivo são telas diferentes. No definitivo o botão
   *    "Tentar novamente" não aparece: ele só levaria o cliente a repetir uma
   *    tentativa que já se sabe que falha. No lugar dele, a orientação de
   *    combinar outra forma de pagamento com o restaurante.
   *
   * ⚠️ Não existe rota para trocar a forma de pagamento de um pedido já criado
   * (o OpenAPI só expõe POST /orders, POST .../payment e GET .../track). Por
   * isso "escolher outra forma" é orientação para resolver com o restaurante
   * pelo número do pedido, e não um botão que prometeria algo que a API não faz.
   *
   * @returns {{message: string, title: string, canRetry: boolean, code: string}}
   */
  function pixChargeErrorOutcome(error) {
    const info = window.PedeAquiApiError?.paymentErrorInfo?.(error)
      || { code: '', retryable: false, text: '', structured: false };
    const code = info.code;

    // Num 5xx o `detail` é mensagem INTERNA do servidor ("gateway indisponível"),
    // escrita para log, não para o cliente. Só aproveitamos o texto quando ele
    // vem estruturado — aí foi feito para ser exibido — ou quando a resposta não
    // é erro de servidor. Fora isso, quem escreve a frase é esta função.
    const serverText = Number(error?.status) >= 500 && !info.structured ? '' : info.text;

    // Transporte: a requisição nem chegou a ter resposta. Sempre retentável, e
    // o `detail` (se houver) não diria nada de útil aqui.
    if (error?.name === 'TimeoutError' || error?.name === 'NetworkError') {
      return {
        title: 'Não foi possível gerar a cobrança',
        message: 'Não conseguimos falar com o provedor de pagamento. Verifique sua conexão e tente de novo — seu pedido já está registrado.',
        canRetry: true,
        code
      };
    }

    if (error?.status === 404) {
      return {
        title: 'Pedido não encontrado para pagamento',
        message: 'Não localizamos este pedido para pagamento. Procure o restaurante informando o número do pedido — ele não foi perdido.',
        canRetry: false,
        code
      };
    }

    // 409 tem leitura própria: o pedido saiu do estado "aguardando pagamento",
    // e um dos motivos possíveis é ele JÁ ESTAR PAGO. Mandar esse cliente
    // "escolher outra forma de pagamento" seria empurrá-lo a pagar duas vezes.
    if (error?.status === 409) {
      return {
        title: 'Este pedido não está mais aguardando pagamento',
        message: serverText
          ? `${serverText} Confira a situação do pedido com o restaurante antes de pagar de novo.`
          : 'Este pedido não está mais aguardando pagamento — ele pode já ter sido pago. Confira a situação com o restaurante informando o número do pedido antes de pagar de novo.',
        canRetry: false,
        code
      };
    }

    // A partir daqui o backend respondeu, e é o `retryable` dele que decide.
    if (info.retryable) {
      return {
        title: 'Não foi possível gerar a cobrança',
        message: serverText
          ? `${serverText} Seu pedido continua registrado — toque em Tentar novamente.`
          : 'O provedor de pagamento não conseguiu criar a cobrança agora. Seu pedido continua registrado — toque em Tentar novamente.',
        canRetry: true,
        code
      };
    }

    return {
      title: 'Pix indisponível para este pedido',
      message: serverText
        ? `${serverText} Não adianta tentar de novo por Pix: combine outra forma de pagamento com o restaurante informando o número do pedido.`
        : 'Não foi possível cobrar por Pix neste pedido, e tentar de novo levaria ao mesmo resultado. Combine outra forma de pagamento com o restaurante informando o número do pedido.',
      canRetry: false,
      code
    };
  }

  /**
   * @param {string} message
   * @param {object} [options]
   * @param {boolean} [options.canRetry] false esconde "Tentar novamente"
   * @param {string}  [options.code]     código do gateway, exibido como referência
   */
  function showPixError(message, { title = 'Não foi possível gerar a cobrança', canRetry = true, code = '' } = {}) {
    stopPixPolling();
    if ($('pixErrorTitle')) $('pixErrorTitle').textContent = title;
    if ($('pixErrorMessage')) $('pixErrorMessage').textContent = message;
    if ($('pixRetryBtn')) $('pixRetryBtn').hidden = !canRetry;

    // O número do pedido é a prova, na tela, de que ele sobreviveu à falha.
    const orderLine = $('pixErrorOrder');
    if (orderLine) {
      const orderNumber = pixSession?.order?.order_number;
      orderLine.hidden = orderNumber == null;
      orderLine.textContent = orderNumber == null ? '' : `Seu pedido #${orderNumber} está registrado.`;
    }

    const codeLine = $('pixErrorCode');
    if (codeLine) {
      // `code` é texto do servidor: vai por textContent, nunca por innerHTML.
      codeLine.hidden = !code;
      codeLine.textContent = code ? `Código do erro: ${code}` : '';
    }

    setPixState('error');
  }

  /**
   * Nome da loja no cartão do pedido: restaurante e, quando ela tem nome
   * próprio, a unidade — é o que diferencia duas lojas da mesma marca. Repetir
   * o nome do restaurante como unidade não informa nada, então esse caso cai
   * para só o nome.
   */
  function pixStoreLabel() {
    const name = String(restaurant.name || fallback().restaurantName || '').trim();
    const branch = currentCartBranchLabel();
    if (!branch || branch === name.toUpperCase()) return name || 'Seu pedido';
    return name ? `${name} - ${branch}` : branch;
  }

  /**
   * Gaveta de conferência. Os itens vêm da foto tirada quando o pedido foi
   * criado (order-tracking.js): nenhuma rota do ciclo os devolve. Sem foto, o
   * botão some — melhor não oferecer do que abrir uma gaveta vazia.
   */
  function renderPixOrderItems(items) {
    const toggle = $('pixItemsToggle');
    const list = $('pixOrderItems');
    if (!toggle || !list) return;

    const rows = (Array.isArray(items) ? items : []).filter(item => item?.name);
    toggle.hidden = !rows.length;
    // Toda abertura de tela começa com a gaveta fechada.
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    list.hidden = true;
    // Quantidade em chip + nome, sem preço por linha: é a linha da referência
    // (assets/testeimagensreferencias/"Captura de tela 2026-08-05 191441.png").
    // O que se paga continua na tela — é o "Total" logo acima, e é ele que tem
    // que bater com a cobrança.
    list.innerHTML = rows.map(item => `
        <li class="pix-order-item">
          <span class="pix-order-item-qty">${esc(String(item.qty || 1))}</span>
          <span class="pix-order-item-name">${esc(item.name)}</span>
        </li>`).join('');
  }

  function togglePixOrderItems() {
    const toggle = $('pixItemsToggle');
    const list = $('pixOrderItems');
    if (!toggle || !list) return;
    const open = list.hidden;
    list.hidden = !open;
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  /**
   * Monta a sessão, cria a cobrança e deixa a tela no estado FINAL — pronta,
   * paga ou em erro. Não abre nada.
   *
   * A tela de "Gerando o código de pagamento..." saiu daqui: era uma tela cheia
   * inteira para anunciar a espera de uma requisição, no meio de um caminho em
   * que o cliente já tinha um botão à sua frente. A espera passou para esse
   * botão — o "Confirmar" da folha, o da barra de pagamento pendente e o
   * "Tentar novamente" do erro —, e a tela do Pix entra pela lateral já com o
   * código na mão.
   *
   * @param {object} order resposta de POST /orders (ou entrada guardada com os mesmos campos)
   * @param {object} [options]
   * @param {Array}  [options.items] foto das linhas; sem ela vale a que ficou
   *   guardada com o token (o caso de quem recarregou a página)
   * @returns {Promise<object>} a sessão preparada, para presentPixPayment()
   *   conferir que ela ainda é a corrente
   */
  async function preparePixPayment(order, { items, ownsCart = false } = {}) {
    const trackingToken = String(order?.tracking_token || '').trim();
    pixSession = {
      order,
      ownsCart,
      trackingToken,
      payment: null,
      pollTimer: null,
      pollUntil: 0,
      pollFailures: 0,
      stopped: false
    };

    if ($('pixOrderStore')) $('pixOrderStore').textContent = pixStoreLabel();
    if ($('pixOrderNumber')) {
      $('pixOrderNumber').textContent = order?.order_number != null ? `Nº do pedido ${order.order_number}` : 'Seu pedido';
    }
    if ($('pixOrderTotal')) $('pixOrderTotal').textContent = fmt(orderAmount(order?.total));
    renderPixOrderItems(items || order?.items);
    // O prazo sai de PIX_POLL_WINDOW_MS para não poder divergir do contador.
    // ⚠️ O cancelamento é afirmação de PRODUTO, não do contrato: nem a cobrança
    // declara validade nem existe rota que confirme o cancelamento do pedido
    // não pago (docs/order-contract.md, item 11).
    if ($('pixConsequence')) {
      $('pixConsequence').textContent =
        `Você tem até ${PIX_WINDOW_MINUTES} minutos para fazer o pagamento. Após esse tempo, o pedido será cancelado.`;
    }
    hidePixToast();
    closePixSheets();
    updatePixCountdown();

    const session = pixSession;
    if (!trackingToken) {
      // Sem token não há rota: nem cobrança, nem acompanhamento. Retentar não
      // resolveria nada, então o botão de retry não aparece.
      showPixError(
        'Seu pedido foi registrado, mas não recebemos o código de acompanhamento necessário para o pagamento online. Procure o restaurante informando o número do pedido.',
        { canRetry: false }
      );
      return session;
    }

    await startPixCharge();
    return session;
  }

  /**
   * Abre a tela, já com o estado decidido por preparePixPayment().
   * @param {object} [session] a sessão de quem preparou; se ela não for mais a
   *   corrente, o cliente saiu no meio da espera e não há tela para abrir.
   */
  function presentPixPayment(session) {
    if (session && pixSession !== session) return;
    openModal('pixPaymentModal');
  }

  function hasCreatedCartPixPayment() {
    const session = pixSession;
    return Boolean(
      session?.ownsCart
      && session.payment
      && paymentStatusKind(session.order?.payment_status) === 'pending'
    );
  }

  function resumeCreatedCartPixPayment() {
    if (!hasCreatedCartPixPayment()) return false;
    const session = pixSession;
    session.stopped = false;
    startPixPolling();
    presentPixPayment(session);
    return true;
  }

  /** Prepara e abre — o caminho de quem não tem outra tela para fechar antes. */
  async function openPixPayment(order, options) {
    presentPixPayment(await preparePixPayment(order, options));
  }

  async function startPixCharge() {
    const session = pixSession;
    if (!session?.trackingToken) return;

    let payment;
    try {
      payment = await window.PedeAquiOrderService.startOrderPayment(getRestaurantSlug(), session.trackingToken);
    } catch (error) {
      if (pixSession !== session) return;
      logAppError('Falha ao criar a cobrança do Pix', error);
      const outcome = pixChargeErrorOutcome(error);
      showPixError(outcome.message, outcome);
      return;
    }
    if (pixSession !== session) return; // a tela mudou enquanto esperávamos

    session.payment = payment;
    const kind = paymentStatusKind(payment?.payment_status);
    if (kind === 'paid') {
      // A cobrança já nasceu paga (retomada de um pagamento feito antes).
      showPixPaid(payment);
      return;
    }
    if (kind === 'failed') {
      showPixError(
        'A cobrança deste pedido não está mais válida. Procure o restaurante informando o número do pedido.',
        { title: 'Cobrança não está mais válida', canRetry: false }
      );
      return;
    }

    if (!renderPixCharge(payment)) return;
    setPixState('ready');
    startPixPolling();
  }

  /**
   * Resumo do payload EMV para a tela: corta logo depois do "BR" do domínio
   * (`...0014BR.GOV.BCB.PIX...`), que é onde a referência corta. O resto são
   * centenas de caracteres que ninguém lê nem digita.
   * @param {string} code payload completo
   * @returns {string} trecho seguido de reticências
   */
  function shortPixCode(code) {
    const full = String(code || '');
    const cut = full.indexOf('BR');
    // Sem "BR" o payload não é um Pix conhecido; ainda assim não deixamos a
    // linha inteira na tela — o CSS trunca o que sobrar.
    return cut < 0 ? full : `${full.slice(0, cut + 2)}...`;
  }

  /**
   * Preenche a tela com o que o gateway devolveu.
   * @returns {boolean} false quando não há como pagar (a tela já foi para erro)
   */
  function renderPixCharge(payment) {
    const code = String(payment?.qr_code || '').trim();
    const checkoutUrl = String(payment?.checkout_url || '').trim();

    // Documentado no próprio OpenAPI: qr_code e checkout_url são alternativos e
    // o sandbox não devolve nenhum dos dois. Sem os dois não há para onde mandar
    // o cliente, e dizer isso é melhor do que mostrar uma tela vazia.
    if (!code && !checkoutUrl) {
      showPixError(
        'A cobrança foi criada, mas o provedor não devolveu o QR Code nem o link de pagamento. Seu pedido está registrado — procure o restaurante informando o número do pedido.',
        { title: 'Cobrança sem forma de pagamento', canRetry: true }
      );
      return false;
    }

    // O payload INTEIRO fica no dataset e é DELE que a cópia sai — o texto
    // visível é só um resumo, e copiar um código cortado cobra errado.
    const codeEl = $('pixCopyCode');
    if (codeEl) {
      codeEl.dataset.code = code || '';
      codeEl.textContent = shortPixCode(code);
    }
    if ($('pixCodeField')) $('pixCodeField').hidden = !code;

    // Sem código, a instrução de copiar não se aplica: a única saída é o link.
    if ($('pixLede')) {
      $('pixLede').textContent = code
        ? 'Copie o código abaixo e utilize o Pix Copia e Cola no aplicativo do seu banco.'
        : 'Abra a página de pagamento para concluir a cobrança no seu banco.';
    }

    const link = $('pixCheckoutLink');
    if (link) {
      // Só http(s): um checkout_url com esquema estranho viraria um vetor de
      // navegação que não controlamos.
      const safeUrl = /^https?:\/\//i.test(checkoutUrl) ? checkoutUrl : '';
      // O link é a SAÍDA DE EMERGÊNCIA, não um segundo caminho: com código na
      // tela ele só competia com o botão de copiar. Some quando há código e
      // aparece quando não há — que é o único caso em que a tela ficaria sem
      // nada para o cliente fazer.
      link.hidden = !safeUrl || !!code;
      if (safeUrl) link.href = safeUrl;
      else link.removeAttribute('href');
    }

    return true;
  }

  /**
   * Aviso curto sobre o cabeçalho. O [hidden] sai antes da classe que anima
   * para o elemento já estar no fluxo quando a transição começa — trocar os
   * dois no mesmo quadro faria o toast surgir sem animação.
   */
  function showPixToast(message) {
    const toast = $('pixToast');
    if (!toast) return;
    clearTimeout(pixToastTimer);
    if ($('pixToastText')) $('pixToastText').textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('is-open'));
    pixToastTimer = setTimeout(hidePixToast, 2400);
  }

  function hidePixToast() {
    const toast = $('pixToast');
    clearTimeout(pixToastTimer);
    pixToastTimer = null;
    if (!toast) return;
    toast.classList.remove('is-open');
    pixToastTimer = setTimeout(() => { toast.hidden = true; }, 200);
  }

  async function copyPixCode() {
    // dataset, não textContent: o texto na tela é o resumo até o "BR".
    const code = $('pixCopyCode')?.dataset.code?.trim();
    if (!code) return;

    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      // Clipboard API exige contexto seguro e nem todo webview a tem. O
      // caminho antigo ainda funciona nesses casos.
      copied = copyTextFallback(code);
    }

    showPixToast(copied ? 'PIX copiado com sucesso!' : 'Não foi possível copiar');
  }

  function copyTextFallback(value) {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.className = 'u-visually-hidden';
    document.body.appendChild(field);
    let copied = false;
    try {
      field.select();
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }

  /* ---------------- Acompanhamento do pagamento ---------------- */

  function startPixPolling() {
    const session = pixSession;
    if (!session) return;
    session.pollUntil = Date.now() + PIX_POLL_WINDOW_MS;
    session.pollFailures = 0;
    startPixCountdown();
    schedulePixPoll(PIX_POLL_INTERVAL_MS);
  }

  function schedulePixPoll(delay) {
    const session = pixSession;
    if (!session || session.stopped) return;
    clearTimeout(session.pollTimer);
    session.pollTimer = setTimeout(() => { pollPixStatus(); }, delay);
  }

  function stopPixPolling() {
    stopPixCountdown();
    if (!pixSession) return;
    pixSession.stopped = true;
    clearTimeout(pixSession.pollTimer);
    pixSession.pollTimer = null;
  }

  /**
   * Contador regressivo e a barra que o acompanha. Contam a MESMA janela em que
   * o polling ainda verifica sozinho — ao zerar, `pollPixStatus` leva a tela
   * para o estado "expired". Um contador com prazo próprio mentiria numa das
   * pontas, e uma barra alimentada por outra conta mentiria na outra: as duas
   * saem daqui, do mesmo `remainingMs`.
   */
  function updatePixCountdown() {
    const node = $('pixCountdown');
    const bar = $('pixCountdownBar');
    if (!node && !bar) return;
    const session = pixSession;
    const remainingMs = session && !session.stopped ? Math.max(0, session.pollUntil - Date.now()) : 0;
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    if (node) node.textContent = `${minutes}:${seconds}`;
    if (bar) {
      const ratio = Math.max(0, Math.min(1, remainingMs / PIX_POLL_WINDOW_MS));
      bar.style.width = `${(ratio * 100).toFixed(2)}%`;
    }
  }

  function startPixCountdown() {
    stopPixCountdown();
    updatePixCountdown();
    pixCountdownTimer = setInterval(updatePixCountdown, 1000);
  }

  function stopPixCountdown() {
    clearInterval(pixCountdownTimer);
    pixCountdownTimer = null;
  }

  async function pollPixStatus() {
    const session = pixSession;
    if (!session || session.stopped) return;

    // Aba em segundo plano não consulta: o pageshow retoma. Consultar em
    // background só gastaria bateria e requisição numa tela que ninguém vê.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      session.pollTimer = null;
      return;
    }

    if (Date.now() >= session.pollUntil) {
      stopPixPolling();
      setPixState('expired');
      return;
    }

    let detail;
    try {
      detail = await window.PedeAquiOrderService.trackOrder(getRestaurantSlug(), session.trackingToken);
    } catch (error) {
      if (pixSession !== session || session.stopped) return;
      session.pollFailures++;
      if (session.pollFailures >= PIX_POLL_MAX_FAILURES) {
        logAppError('Consulta do pagamento falhou repetidamente', error);
        showPixError(
          'Perdemos o contato com o servidor enquanto aguardávamos o pagamento. Se você já pagou, o restaurante confirma assim que a conexão voltar.',
          { title: 'Não conseguimos verificar o pagamento', canRetry: true }
        );
        return;
      }
      // Recuo progressivo: uma instabilidade curta não vira uma rajada.
      schedulePixPoll(PIX_POLL_INTERVAL_MS * (session.pollFailures + 1));
      return;
    }
    if (pixSession !== session || session.stopped) return;

    session.pollFailures = 0;
    updateTrackingEntry(session.trackingToken, {
      status: detail?.status,
      payment_status: detail?.payment_status
    });

    const kind = paymentStatusKind(detail?.payment_status);
    if (kind === 'paid') {
      showPixPaid(detail);
      return;
    }
    if (kind === 'failed') {
      showPixError(
        'O pagamento não foi aprovado. Você pode tentar novamente pelo app do seu banco ou procurar o restaurante.',
        { title: 'Pagamento não aprovado', canRetry: false }
      );
      return;
    }

    schedulePixPoll(PIX_POLL_INTERVAL_MS);
  }

  /** Consulta única, disparada pelo cliente depois que a janela automática fechou. */
  async function checkPixStatusNow() {
    const session = pixSession;
    if (!session?.trackingToken) return;
    session.stopped = false;
    session.pollFailures = 0;
    // A consulta espera no próprio botão, como as outras: trocar a tela por uma
    // de carregamento tiraria da frente o aviso que explica por que ele está ali.
    const button = $('pixCheckNowBtn');
    button?.classList.add('is-loading');

    let detail;
    try {
      detail = await window.PedeAquiOrderService.trackOrder(getRestaurantSlug(), session.trackingToken);
    } catch (error) {
      button?.classList.remove('is-loading');
      if (pixSession !== session) return;
      logAppError('Falha ao verificar o pagamento', error);
      showPixError(
        'Não conseguimos verificar o pagamento agora. Tente novamente em instantes.',
        { title: 'Não conseguimos verificar o pagamento', canRetry: true }
      );
      return;
    }
    button?.classList.remove('is-loading');
    if (pixSession !== session) return;

    updateTrackingEntry(session.trackingToken, {
      status: detail?.status,
      payment_status: detail?.payment_status
    });

    if (paymentStatusKind(detail?.payment_status) === 'paid') {
      showPixPaid(detail);
      return;
    }
    // Continua pendente: reabre a janela de espera do ponto zero.
    if (session.payment && !renderPixCharge(session.payment)) return;
    setPixState('ready');
    startPixPolling();
  }

  /** Pagamento confirmado: para tudo e entrega a tela de sucesso. */
  function showPixPaid(detail) {
    stopPixPolling();
    const base = pixSession?.order || {};
    // A resposta da criação tem `message`, a de acompanhamento não; a de
    // acompanhamento tem o status atual. As duas juntas dão a tela completa.
    const merged = {
      ...base,
      ...(detail && typeof detail === 'object' ? detail : {}),
      tracking_token: base.tracking_token || detail?.tracking_token,
      message: 'Pagamento confirmado! Seu pedido foi enviado ao restaurante.'
    };
    updateTrackingEntry(merged.tracking_token, {
      status: merged.status,
      payment_status: merged.payment_status
    });
    renderPendingPaymentBar();
    hidePixToast();
    closePixSheets();
    if (pixSession?.ownsCart) leaveCartAfterOrder({ confirmationAlreadyClosed: true });
    closeModalImmediately('pixPaymentModal');
    showOrderSuccess(merged);
  }

  async function retryPixPayment() {
    if (!pixSession) return;
    pixSession.stopped = false;
    // A tela de erro continua na frente enquanto a tentativa acontece: a
    // espera cabe no próprio botão, e trocar a tela por uma de carregamento
    // faria o cliente perder de vista o que deu errado.
    const button = $('pixRetryBtn');
    button?.classList.add('is-loading');
    try {
      await startPixCharge();
    } finally {
      button?.classList.remove('is-loading');
    }
  }

  /* ---------------- Folhas da tela ---------------- */

  function openPixSheet(id) {
    const sheet = $(id);
    if (!sheet) return;
    clearTimeout(pixSheetTimers.get(id));
    sheet.hidden = false;
    // Mesmo motivo do toast: o elemento precisa estar no fluxo um quadro antes
    // da classe que anima, senão a folha aparece já no lugar.
    requestAnimationFrame(() => sheet.classList.add('is-open'));
  }

  /** Só desce a folha — nada do que está por baixo é tocado. */
  function closePixSheet(id, { animate = true } = {}) {
    const sheet = $(id);
    if (!sheet) return;
    clearTimeout(pixSheetTimers.get(id));
    sheet.classList.remove('is-open');
    if (!animate) {
      sheet.hidden = true;
      return;
    }
    const hideDelay = id === 'pixExitConfirm' ? PIX_EXIT_SHEET_TRANSITION_MS + 20 : 300;
    pixSheetTimers.set(id, setTimeout(() => { sheet.hidden = true; }, hideDelay));
  }

  // Passo a passo do pagamento. Fica fora da tela principal porque é ajuda, não
  // instrução obrigatória: quem já paga por Pix não precisa lê-la.
  function openPixHowTo() { openPixSheet('pixHowTo'); }
  function closePixHowTo(options) { closePixSheet('pixHowTo', options); }

  // Os dois botões do cabeçalho (voltar e X) caem aqui: uma vez que o pedido
  // existe, sair da cobrança não é um "voltar" qualquer.
  function openPixExitConfirm() { openPixSheet('pixExitConfirm'); }

  /** Só desce a folha — a cobrança continua exatamente como estava. */
  function closePixExitConfirm(options) { closePixSheet('pixExitConfirm', options); }

  /**
   * Baixa TODAS as folhas de uma vez, sem animação. Usada ao entrar e ao sair
   * da tela: uma folha esquecida aberta reapareceria por cima da próxima
   * cobrança.
   */
  function closePixSheets() {
    closePixExitConfirm({ animate: false });
    closePixHowTo({ animate: false });
  }

  /** "Cancelar pedido": volta à sacola quando a cobrança nasceu dela. */
  function confirmPixExit() {
    if (pixSession?.ownsCart && $('cartModal')?.classList.contains('active')) {
      returnPixToCart();
      return;
    }
    closePixSheets();
    closePixPayment();
  }

  function returnPixToCart() {
    stopPixPolling();
    hidePixToast();
    const panel = document.querySelector('#pixPaymentModal .modal');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      panel?.removeEventListener('transitionend', onTransitionEnd);
      closePixSheets();
      $('cartCtaBtn')?.focus({ preventScroll: true });
    };
    const onTransitionEnd = event => {
      if (event.target === panel && event.propertyName === 'transform') finish();
    };
    panel?.addEventListener('transitionend', onTransitionEnd);
    closeModalId('pixPaymentModal');
    setTimeout(finish, 650);
  }

  /** Sai da tela sem cancelar nada: o pedido e o token continuam guardados. */
  function closePixPayment() {
    if (pixSession?.ownsCart && $('cartModal')?.classList.contains('active')) {
      returnPixToCart();
      return;
    }
    stopPixPolling();
    hidePixToast();
    closePixSheets();
    const session = pixSession;
    pixSession = null;
    closeModalId('pixPaymentModal');
    renderPendingPaymentBar();
    if (session?.order) trackedOrder = session.order;
    setTimeout(() => { showHomeTab(); jumpToTop(); }, 160);
  }

  /* ---------------- Retomada e acompanhamento ---------------- */

  // Pagamento pendente guardado para esta loja. Sem pendência a barra nem
  // existe na tela, e a loja fica exatamente como era.
  let pendingPaymentDismissed = false;

  function pendingOnlinePayment() {
    if (pendingPaymentDismissed) return null;
    const entries = window.RapidexOrderTracking?.list?.(getRestaurantSlug()) || [];
    return entries.find(entry =>
      String(entry.payment_flow || '').toLowerCase() === 'online' &&
      paymentStatusKind(entry.payment_status) === 'pending'
    ) || null;
  }

  function renderPendingPaymentBar() {
    const bar = $('pendingPaymentBar');
    if (!bar) return;
    const pending = pendingOnlinePayment();
    bar.hidden = !pending;
    if (!pending) return;
    if ($('pendingPaymentTitle')) {
      $('pendingPaymentTitle').textContent = pending.order_number != null
        ? `Pedido #${pending.order_number} aguardando pagamento`
        : 'Pedido aguardando pagamento';
    }
    if ($('pendingPaymentSubtitle')) {
      $('pendingPaymentSubtitle').textContent = pending.total != null
        ? `Toque para pagar ${fmt(orderAmount(pending.total))} via Pix`
        : 'Toque para concluir o pagamento';
    }
  }

  async function resumePendingPayment() {
    const pending = pendingOnlinePayment();
    if (!pending) {
      renderPendingPaymentBar();
      return;
    }
    // A barra fica no lugar, girando, até a tela estar pronta. Escondê-la no
    // clique — como antes, quando havia uma tela de carregamento para receber
    // o cliente — deixaria a loja sem nenhum sinal de que algo está vindo.
    const bar = $('pendingPaymentBar');
    const button = bar?.querySelector('.pending-payment-main');
    button?.classList.add('is-loading');
    try {
      // Chamar o endpoint de pagamento de novo é seguro: o backend devolve a
      // cobrança corrente do pedido em vez de criar outra.
      await openPixPayment(pending);
    } finally {
      button?.classList.remove('is-loading');
      bar?.setAttribute('hidden', '');
    }
  }

  function dismissPendingPayment() {
    pendingPaymentDismissed = true;
    renderPendingPaymentBar();
  }

  /**
   * Botão "Atualizar status" da tela de sucesso — o caminho de acompanhamento
   * do VISITANTE, autorizado só pelo tracking_token.
   */
  async function refreshTrackedOrder() {
    const trackingToken = trackedOrder?.tracking_token;
    const button = $('ordSuccessTrackBtn');
    if (!trackingToken) return;

    if (button) {
      button.disabled = true;
      button.textContent = 'Consultando...';
    }
    try {
      const detail = await window.PedeAquiOrderService.trackOrder(getRestaurantSlug(), trackingToken);
      updateTrackingEntry(trackingToken, {
        status: detail?.status,
        payment_status: detail?.payment_status
      });
      renderPendingPaymentBar();
      showOrderSuccess({
        ...trackedOrder,
        ...detail,
        tracking_token: trackingToken,
        message: trackedOrder.message
      });
    } catch (error) {
      logAppError('Falha ao acompanhar o pedido', error);
      if (button) {
        button.disabled = false;
        button.textContent = 'Não foi possível atualizar. Tentar de novo';
      }
    }
  }

  // Sem reload: fecha, volta pra home e mantém o app vivo.
  function closeOrderSuccess() {
    closeModalId('orderSuccessModal');
    renderPendingPaymentBar();
    setTimeout(() => { showHomeTab(); jumpToTop(); }, 160);
  }
  // ============================================================
  //  Operation context — single source of truth (per restaurant)
  // ============================================================
  const OP_STORAGE_PREFIX = storageKeys()?.PREFIXES.operationContext || 'rapidex.operationContext.';
  let operationContext = null;
  let opDraft = null; // working copy edited while the operation modal is open
  let operationConfirmed = false;
  let _opOpenedImmediately = false; // true quando aberta sem animação (acesso forçado sem endereço)

  const opStorageKey = () => OP_STORAGE_PREFIX + getRestaurantSlug();

  function loadOperationContext() {
    try { return JSON.parse(readStorageKey(opStorageKey()) || 'null'); }
    catch { return null; }
  }

  function persistOperationContext() {
    if (operationContext) {
      localStorage.setItem(opStorageKey(), JSON.stringify({ ...operationContext, confirmed: operationConfirmed }));
    }
  }

  function addressSummary(a) {
    return a ? `${a.street}, ${a.number} - ${a.neighborhood}` : '';
  }

  function readLocalAddressList() {
    return window.PedeAquiAddressService?.readLocalAddressList?.() || [];
  }

  function writeLocalAddressList(list) {
    return window.PedeAquiAddressService?.writeLocalAddressList?.(list) || [];
  }

  const ADDRESS_IMPORT_SIGNATURE_PREFIX = storageKeys()?.PREFIXES.addressImportSignature || 'rapidex.addressImportSignature.';
  let customerAddressesSyncPromise = null;

  function normalizeAddressValue(address) {
    return window.PedeAquiAddressService?.normalizeAddress?.(address) || address || null;
  }

  function normalizeAddressPart(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function addressFingerprint(address) {
    if (!address) return '';
    const placeId = normalizeAddressPart(address.place_id);
    if (placeId) return `place:${placeId}`;
    const street = normalizeAddressPart(address.street || address.street_name);
    const number = normalizeAddressPart(address.number);
    const neighborhood = normalizeAddressPart(address.neighborhood);
    const city = normalizeAddressPart(address.city);
    if (!street || !number || !neighborhood) return '';
    const postalCode = onlyDigits(address.postal_code || address.zip_code || address.cep || '');
    return [street, number, postalCode, neighborhood, city, normalizeAddressPart(address.state)].join('|');
  }

  function nonEmptyString(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  function uuidOrNull(value) {
    const normalized = nonEmptyString(value);
    return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
      ? normalized
      : null;
  }

  function nullableCoordinate(value) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    const coordinate = Number(value);
    return Number.isFinite(coordinate) ? coordinate : null;
  }

  function remoteAddressId(address) {
    if (!window.PedeAquiCustomerAuth?.isAuthenticatedSession?.() || !address) return null;
    const syncedId = uuidOrNull(address.synced_remote_id);
    if (syncedId) return syncedId;
    return isRemoteAddress(address) ? uuidOrNull(address.id || address.address_id) : null;
  }

  function deliveryAddressPayload(address) {
    const payload = {
      street: nonEmptyString(address?.street || address?.street_name) || '',
      number: nonEmptyString(address?.number) || '',
      neighborhood: nonEmptyString(address?.neighborhood) || '',
      city: nonEmptyString(address?.city) || 'Fortaleza',
      state: (nonEmptyString(address?.state) || 'CE').toUpperCase(),
      latitude: nullableCoordinate(address?.latitude ?? address?.lat),
      longitude: nullableCoordinate(address?.longitude ?? address?.lng)
    };
    const zipcode = nonEmptyString(address?.zipcode || address?.postal_code || address?.zip_code || address?.cep);
    const zipcodeDigits = zipcode ? onlyDigits(zipcode) : '';
    if (zipcodeDigits) payload.zipcode = zipcodeDigits;
    return payload;
  }

  function validAddressForApi(address) {
    const payload = deliveryAddressPayload(address);
    return Boolean(payload.street && payload.number && payload.neighborhood);
  }

  function importAddressFingerprint(address) {
    const payload = deliveryAddressPayload(address);
    return [payload.street, payload.number, payload.neighborhood, payload.city, payload.state]
      .map(normalizeAddressPart)
      .join('|');
  }

  function importAddressPayload(address) {
    const base = deliveryAddressPayload(address);
    return {
      client_reference: nonEmptyString(address?.client_reference || address?.id || address?.address_id),
      label: nonEmptyString(address?.label || address?.alias) || 'Casa',
      street: base.street,
      number: base.number,
      neighborhood: base.neighborhood,
      city: base.city,
      state: base.state,
      ...(base.zipcode ? { zipcode: base.zipcode } : {}),
      complement: nonEmptyString(address?.complement),
      reference: nonEmptyString(address?.reference),
      latitude: base.latitude,
      longitude: base.longitude,
      is_default: address?.is_default === true || address?.default === true || address?.isDefault === true
    };
  }

  function deliveryEstimateKey() {
    const restaurantSlug = getRestaurantSlug();
    const branchId = operationContext?.branch_id;
    const orderType = operationContext?.order_type;
    const fingerprint = addressFingerprint(operationContext?.address);
    const auth = window.PedeAquiCustomerAuth;
    if (auth?.getToken?.() && !auth?.isSessionReady?.()) return null;
    if (!restaurantSlug || !appState.restaurant || !branchId || orderType !== 'delivery' || !fingerprint || !validAddressForApi(operationContext?.address)) return null;
    const addressIdentity = remoteAddressId(operationContext.address) || fingerprint;
    return [restaurantSlug, branchId, orderType, addressIdentity].join('::');
  }

  function pickupWindowText() {
    return settings.pickup_time_text || settings.estimated_pickup_time_text || fallback().pickupTimeText || 'Retirada';
  }

  function deliveryEstimateText() {
    if (operationContext?.order_type === 'pickup') return pickupWindowText();
    if (deliveryEstimate.status === 'loading') return 'Calculando entrega...';
    if (deliveryEstimate.status === 'success' && deliveryEstimate.data?.serviceable === false) {
      return deliveryEstimate.data?.message || 'Fora da área de entrega';
    }
    if (deliveryEstimate.status === 'success') {
      const min = Number(deliveryEstimate.data?.eta_min);
      const max = Number(deliveryEstimate.data?.eta_max);
      if (Number.isFinite(min) && Number.isFinite(max)) return `${min} - ${max} min`;
      if (Number.isFinite(min)) return `${min} min`;
    }
    const configured = deliveryWindowText();
    return deliveryEstimate.status === 'error' ? `${configured} · estimativa indisponível` : configured;
  }

  function renderDeliveryEstimate() {
    const text = deliveryEstimateText();
    const estimateFee = currentDeliveryEstimateFee();
    const feeText = estimateFee == null ? 'Taxa indisponivel' : fmt(estimateFee);
    const isPickup = operationContext?.order_type === 'pickup';
    document.querySelectorAll('.delivery-time-text').forEach(element => { element.textContent = text; });
    document.querySelectorAll('.delivery-fee-text').forEach(element => { element.textContent = isPickup ? 'Gratis' : feeText; });
    if ($('homeAddressSub')) $('homeAddressSub').textContent = operationConfirmed ? text : '';
    if ($('cartDeliveryFeeText')) $('cartDeliveryFeeText').textContent = isPickup ? 'Gratis' : feeText;
    if ($('cartDeliveryTimeText')) $('cartDeliveryTimeText').textContent = isPickup ? pickupWindowText() : `Hoje, ${text}`;
    if ($('cartLocationEta')) $('cartLocationEta').textContent = text;
    if ($('checkoutDeliverySub')) $('checkoutDeliverySub').textContent = `${text} · ${feeText}`;
    if ($('checkoutPickupSub')) $('checkoutPickupSub').textContent = `${pickupWindowText()} · Grátis`;
    if ($('revTypeSub')) $('revTypeSub').textContent = isPickup ? pickupWindowText() : `Hoje, ${text}`;
  }

  function invalidateDeliveryEstimate() {
    const keyToInvalidate = deliveryEstimate.key;
    window.PedeAquiDeliveryService?.invalidate?.(keyToInvalidate);
    deliveryEstimate = { status: 'idle', key: null, data: null, updatedAt: null };
    deliveryEstimatePromise = null;
    renderDeliveryEstimate();
    updateCartUI();
  }

  async function requestDeliveryEstimate() {
    const key = deliveryEstimateKey();
    if (!key) {
      deliveryEstimate = { status: 'idle', key: null, data: null, updatedAt: null };
      renderDeliveryEstimate();
      return null;
    }
    const ttl = window.PedeAquiDeliveryService?.CACHE_TTL_MS || 7 * 60 * 1000;
    if (deliveryEstimate.key === key && deliveryEstimate.status === 'success' && Date.now() - deliveryEstimate.updatedAt < ttl) {
      renderDeliveryEstimate();
      return deliveryEstimate.data;
    }
    if (deliveryEstimate.key === key && deliveryEstimate.status === 'loading' && deliveryEstimatePromise) return deliveryEstimatePromise;
    const address = operationContext.address;
    deliveryEstimate = { status: 'loading', key, data: null, updatedAt: null };
    renderDeliveryEstimate();
    const payload = {};
    const branchId = uuidOrNull(operationContext.branch_id);
    const addressId = remoteAddressId(address);
    if (branchId) payload.branch_id = branchId;
    if (addressId) payload.address_id = addressId;
    else payload.address = deliveryAddressPayload(address);
    console.group('[Rapidex][DeliveryEstimate]');
    console.log('payload enviado:', payload);
    deliveryEstimatePromise = window.PedeAquiDeliveryService.getEstimate(getRestaurantSlug(), payload, { key })
      .then(result => {
        if (deliveryEstimate.key !== key) {
          console.groupEnd();
          return null;
        }
        deliveryEstimate = { status: 'success', key, data: result.data, updatedAt: result.updatedAt };
        renderDeliveryEstimate();
        updateCartUI();
        const valorAplicado = currentDeliveryEstimateFee();
        const total = cartTotals().total;
        console.log('response recebida:', result.data);
        console.log('delivery_fee recebido:', result.data?.delivery_fee);
        console.log('delivery_fee aplicado no estado:', valorAplicado);
        console.log('total recalculado:', total);
        console.groupEnd();
        return result.data;
      })
      .catch(error => {
        if (deliveryEstimate.key !== key) {
          console.groupEnd();
          return null;
        }
        console.error('[PedeAqui] Falha ao calcular estimativa de entrega', error);
        deliveryEstimate = { status: 'error', key, data: null, updatedAt: Date.now() };
        renderDeliveryEstimate();
        updateCartUI();
        console.groupEnd();
        return null;
      })
      .finally(() => {
        if (deliveryEstimate.key === key) deliveryEstimatePromise = null;
      });
    return deliveryEstimatePromise;
  }

  function openCartModal() {
    requestDeliveryEstimate();
    openModal('cartModal');
  }
  function isRemoteAddress(address) {
    const id = String(address?.id || address?.address_id || '');
    return Boolean(id && !id.startsWith('local_') && id !== '__current__');
  }

  function addressApiPayload(address) {
    return {
      street: address?.street || '', number: address?.number || '', neighborhood: address?.neighborhood || '',
      city: address?.city || '', state: address?.state || '', complement: address?.complement || '',
      reference: address?.reference || '', postal_code: onlyDigits(address?.postal_code || address?.zip_code || address?.cep || ''),
      latitude: address?.latitude ?? null, longitude: address?.longitude ?? null, place_id: address?.place_id || '',
      alias: address?.alias || address?.label || ''
    };
  }

  function setSelectedOperationAddress(address, options = {}) {
    const previousEstimateKey = deliveryEstimateKey();
    const normalized = normalizeAddressValue(address);
    if (!operationContext) {
      const branch = defaultBranchFor('delivery');
      operationContext = { order_type: 'delivery', ...branchSnapshot(branch), address: null };
    }
    operationContext.address = normalized;
    if (normalized && options.forceDelivery !== false) operationContext.order_type = 'delivery';
    customerAddress = normalized ? { ...normalized, summary: addressSummary(normalized) } : null;
    customerStore()?.setSelectedAddress?.(customerAddress);
    if (customerAddress) window.PedeAquiAddressService?.saveSelectedAddress?.(customerAddress);
    else localStorage.removeItem(STORAGE_ADDRESS);
    if (options.confirmed === true) operationConfirmed = true;
    persistOperationContext();
    deliveryType = operationContext.order_type;
    renderWidget();
    updateCartUI();
    if (previousEstimateKey !== deliveryEstimateKey()) invalidateDeliveryEstimate();
    requestDeliveryEstimate();
    return customerAddress;
  }

  function defaultBackendAddress(addresses) {
    return addresses.find(address => address?.is_default === true || address?.default === true || address?.isDefault === true) || null;
  }

  function dedupeAddresses(addresses) {
    const byFingerprint = new Map();
    addresses.filter(Boolean).forEach(raw => {
      const address = normalizeAddressValue(raw);
      const fingerprint = addressFingerprint(address) || `id:${addrPickerId(address, '')}`;
      const previous = byFingerprint.get(fingerprint);
      if (!previous || isRemoteAddress(address) || address.is_default) byFingerprint.set(fingerprint, { ...previous, ...address });
    });
    return Array.from(byFingerprint.values());
  }

  function addressImportSignature(localAddresses) {
    return localAddresses.map(address => address.client_reference).filter(Boolean).sort().join('::');
  }

  function newAddressClientReference() {
    const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `local-${uuid}`;
  }

  function ensureLocalClientReferences(addresses) {
    let changed = false;
    const prepared = addresses.map(address => {
      if (remoteAddressId(address) || nonEmptyString(address.client_reference)) return address;
      changed = true;
      return { ...address, client_reference: newAddressClientReference() };
    });
    return changed ? writeLocalAddressList(prepared) : prepared;
  }

  function reconcileLocalAddresses(local, remote) {
    const remoteByFingerprint = new Map(remote.map(address => [importAddressFingerprint(address), address]));
    return local.map(address => {
      const match = remoteByFingerprint.get(importAddressFingerprint(address));
      const remoteId = nonEmptyString(match?.id || match?.address_id);
      return remoteId
        ? { ...address, synced_remote_id: remoteId, synced_at: new Date().toISOString(), sync_error: false }
        : address;
    });
  }

  async function synchronizeCustomerAddresses(options = {}) {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) return [];
    if (customerAddressesSyncPromise) return customerAddressesSyncPromise;
    customerAddressesSyncPromise = (async () => {
      let remote = dedupeAddresses(await window.PedeAquiAddressService.getCustomerAddresses());
      let local = ensureLocalClientReferences(dedupeAddresses(readLocalAddressList()));
      local = reconcileLocalAddresses(local, remote);
      writeLocalAddressList(local);
      const remoteFingerprints = new Set(remote.map(importAddressFingerprint));
      const pending = local.filter(address => (
        validAddressForApi(address)
        && !remoteAddressId(address)
        && !remoteFingerprints.has(importAddressFingerprint(address))
      ));
      const customerKey = currentCustomerSnapshot()?.id || window.PedeAquiCustomerAuth?.getStoredCustomer?.()?.id || 'session';
      const signatureKey = ADDRESS_IMPORT_SIGNATURE_PREFIX + customerKey;
      const signature = addressImportSignature(pending);
      if (options.importLocal !== false && pending.length && readStorageKey(signatureKey) !== signature) {
        try {
          await window.PedeAquiAddressService.importCustomerAddresses(pending.map(importAddressPayload));
          localStorage.setItem(signatureKey, signature);
          remote = dedupeAddresses(await window.PedeAquiAddressService.getCustomerAddresses());
          local = reconcileLocalAddresses(local, remote);
          writeLocalAddressList(local);

        } catch (error) {
          console.error('[PedeAqui] Falha ao importar enderecos locais', error);
          const pendingReferences = new Set(pending.map(address => address.client_reference));
          local = local.map(address => pendingReferences.has(address.client_reference)
            ? { ...address, sync_error: true }
            : address);
          writeLocalAddressList(local);
        }
      }
      appState.customerAddresses = remote;
      customerStore()?.setAddresses?.(remote);
      const backendDefault = defaultBackendAddress(remote);
      const current = operationContext?.address || customerAddress;
      const currentRemoteId = remoteAddressId(current);
      const currentRemote = remote.find(address => (
        (currentRemoteId && nonEmptyString(address.id || address.address_id) === currentRemoteId)
        || importAddressFingerprint(address) === importAddressFingerprint(current)
      ));
      if (currentRemote) setSelectedOperationAddress(currentRemote, { confirmed: operationConfirmed, forceDelivery: false });
      else if (backendDefault) setSelectedOperationAddress(backendDefault, { confirmed: operationConfirmed, forceDelivery: false });
      return remote;
    })().finally(() => { customerAddressesSyncPromise = null; });
    return customerAddressesSyncPromise;
  }
  function compatibleBranches(orderType) {
    return branches.filter(b => orderType === 'pickup' ? b.accepts_pickup : b.accepts_delivery);
  }

  function defaultBranchFor(orderType) {
    const list = compatibleBranches(orderType);
    return list.find(b => b.is_open) || list[0] || branches[0] || null;
  }

  function branchById(id) {
    return branches.find(b => String(b.id) === String(id)) || null;
  }

  function branchSnapshot(branch) {
    return {
      branch_id: branch?.id || null,
      branch_label: branch?.label || '',
      branch_name: branch?.name || '',
      branch_address: branch?.full_address || ''
    };
  }

  function truncateAddress(text, max = 40) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }

  function branchAccepts(branch, orderType) {
    return orderType === 'pickup' ? branch.accepts_pickup : branch.accepts_delivery;
  }

  function initOperationContext() {
    const stored = loadOperationContext();
    operationConfirmed = stored?.confirmed === true;
    const orderType = stored?.order_type === 'pickup' ? 'pickup' : 'delivery';
    let branch = stored?.branch_id ? branchById(stored.branch_id) : null;
    if (!branch || !branchAccepts(branch, orderType)) branch = defaultBranchFor(orderType);
    let address = stored?.address || null;
    if (!address && customerAddress) address = { ...customerAddress };
    operationContext = { order_type: orderType, ...branchSnapshot(branch), address };
    applyOperationToLegacy();
  }

  function applyOperationToLegacy() {
    deliveryType = operationContext.order_type;
    customerAddress = operationContext.address
      ? { ...operationContext.address, summary: addressSummary(operationContext.address) }
      : null;
    if (customerAddress) persistCustomerAddress(customerAddress);
  }

  function operationValid(ctx) {
    if (!ctx || !ctx.branch_id) return false;
    if (ctx.order_type === 'delivery' && !ctx.address) return false;
    return true;
  }

  // ---- Home location widget ----
  function renderWidget() {
    if (!operationContext) return;
    const isPickup = operationContext.order_type === 'pickup';
    const widget = document.querySelector('.delivery-widget');
    widget?.classList.toggle('pending-selection', !operationConfirmed);
    const opTab = $('dwTabDelivery');
    if (opTab) { opTab.textContent = isPickup ? 'RETIRADA' : 'DELIVERY'; opTab.classList.add('active'); }
    const brandTab = $('dwTabBrand');
    if (brandTab) brandTab.textContent = (restaurant.name || fallback().restaurantName || '').toUpperCase();
    const branchTab = $('dwTabBranch');
    if (branchTab) branchTab.textContent = operationContext.branch_label || 'UNIDADE';
    const addrMain = $('homeAddressTitle');
    let text;
    if (!operationConfirmed) text = 'Informe seu endereço e loja';
    else if (operationContext.address) text = addressSummary(operationContext.address);
    else text = 'Use seu endereço para melhores resultados';
    if (addrMain) addrMain.textContent = text;
    const needsAddressHint = !operationContext.address && operationConfirmed && !isPickup;
    widget?.classList.toggle('needs-address-hint', needsAddressHint);
    const addressStrip = document.querySelector('.delivery-widget .address-strip');
    addressStrip?.classList.toggle('needs-address-hint', needsAddressHint);
    addressStrip?.classList.toggle('has-address', operationConfirmed && !isPickup && !!operationContext.address);
  }

  // ---- Operation / location modal ----
  function openOperationScreen(immediate) {
    if (!operationContext) return;
    _opOpenedImmediately = !!immediate;
    opDraft = JSON.parse(JSON.stringify(operationContext));
    if ($('opBranchSearch')) $('opBranchSearch').value = '';
    renderOperationScreen();
    if (immediate) openModalImmediately('operationModal');
    else openModal('operationModal');
  }

  function closeOperationScreen() {
    if (_opOpenedImmediately) closeModalImmediately('operationModal');
    else closeModalId('operationModal');
    _opOpenedImmediately = false;
  }

  function renderOperationScreen() {
    if (!opDraft) return;
    const isPickup = opDraft.order_type === 'pickup';
    $('opSegDelivery')?.classList.toggle('active', !isPickup);
    $('opSegPickup')?.classList.toggle('active', isPickup);
    const title = $('opAddrTitle');
    const sub = $('opAddrSub');
    $('opAddrCard')?.classList.toggle('has-address', !!opDraft.address);
    if (opDraft.address) {
      if (title) title.textContent = addressSummary(opDraft.address);
      if (sub) {
        sub.textContent = '';
        sub.style.display = 'none';
      }
    } else {
      if (title) title.textContent = 'Informe seu endereço';
      if (sub) sub.style.display = 'none';
    }
    renderOperationBranches();
  }

  function setOperationType(type) {
    if (!opDraft) return;
    opDraft.order_type = type;
    const current = branchById(opDraft.branch_id);
    if (!current || !branchAccepts(current, type)) {
      Object.assign(opDraft, branchSnapshot(defaultBranchFor(type)));
    }
    renderOperationScreen();
  }

  function renderOperationBranches() {
    const list = $('opBranchList');
    if (!list || !opDraft) return;
    const query = ($('opBranchSearch')?.value || '').toLowerCase().trim();
    let items = compatibleBranches(opDraft.order_type);
    if (query) {
      items = items.filter(b => `${b.name} ${b.full_address} ${b.neighborhood}`.toLowerCase().includes(query));
    }
    if (!items.length) {
      list.innerHTML = '<div class="op-branch-empty">Nenhuma unidade disponível para esta operação.</div>';
      updateConfirmButton();
      return;
    }
    list.innerHTML = items.map(b => {
      const selected = String(b.id) === String(opDraft.branch_id);
      const badge = b.is_open
        ? '<span class="op-branch-badge open">Aberto</span>'
        : '<span class="op-branch-badge closed">Fechado</span>';
      return `<button type="button" class="op-branch-card${selected ? ' selected' : ''}" ${act('click', 'selectBranch', b.id)}>
        <span class="op-branch-radio"></span>
        <span class="op-branch-body">
          <span class="op-branch-name">${esc(b.name)}</span>
          <span class="op-branch-addr" title="${esc(b.full_address)}">${esc(truncateAddress(b.full_address))}</span>
          ${badge}
        </span>
        <svg class="op-branch-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>
      </button>`;
    }).join('');
    updateConfirmButton();
  }

  function selectBranch(id) {
    if (!opDraft) return;
    const branch = branchById(id);
    if (!branch) return;
    Object.assign(opDraft, branchSnapshot(branch));
    renderOperationBranches();
  }

  function updateConfirmButton() {
    const btn = $('opConfirmBtn');
    if (btn) btn.disabled = !opDraft?.branch_id;
  }

  function confirmOperation() {
    if (!opDraft?.branch_id) return;
    // Delivery sem endereço: confirma assim mesmo e mostra o widget com os 3
    // mini-widgets. O endereço fica como "Use seu endereço para melhores
    // resultados" (renderWidget) e só é exigido no checkout.
    const previousEstimateKey = deliveryEstimateKey();
    const previousInfoKey = restaurantInfoKey();
    operationContext = JSON.parse(JSON.stringify(opDraft));
    operationConfirmed = true;
    persistOperationContext();
    applyOperationToLegacy();
    renderWidget();
    setCartTab(operationContext.order_type);
    updateCartUI();
    if (previousEstimateKey !== deliveryEstimateKey()) invalidateDeliveryEstimate();
    handleRestaurantInfoContextChange(previousInfoKey);
    requestDeliveryEstimate();
    closeOperationScreen();
    if (_pendingMenuNav) {
      _pendingMenuNav = false;
      closeMobViews();
      showMenuTab();
      window.scrollTo(0, 0);
      ensureMenuLoaded();
    }
  }

  // Keep operation context in sync when the cart/checkout tabs change order type
  function syncOrderTypeFromCart(type) {
    if (!operationContext || !operationConfirmed || operationContext.order_type === type) return;
    const previousEstimateKey = deliveryEstimateKey();
    const previousInfoKey = restaurantInfoKey();
    operationContext.order_type = type;
    const current = branchById(operationContext.branch_id);
    if (!current || !branchAccepts(current, type)) {
      Object.assign(operationContext, branchSnapshot(defaultBranchFor(type)));
    }
    persistOperationContext();
    renderWidget();
    if (previousEstimateKey !== deliveryEstimateKey()) invalidateDeliveryEstimate();
    handleRestaurantInfoContextChange(previousInfoKey);
    requestDeliveryEstimate();
  }

  function openAddressScreen() {
    openAddressChoice();
  }

  function openAddressChoice() {
    const hasSavedAddresses = Boolean(
      opDraft?.address
      || operationContext?.address
      || customerAddress
      || readLocalAddressList().length
      || appState.customerAddresses?.length
    );
    if (isLogged() || hasSavedAddresses) {
      openAddrPicker('operation');
      return;
    }
    openAddressChoiceDirect(true);
  }

  let _addAddressOrigin = 'operation';
  let _returnToAddAddressChoice = false;

  function openAddressChoiceDirect(withMotion = true) {
    _editingAddressId = null;
    const btn = $('adcConfirmBtn');
    if (btn) btn.disabled = true;
    _adcSelection = null;
    const fromPicker = $('addrPickerModal')?.classList.contains('active');
    _addAddressOrigin = fromPicker ? 'picker' : 'operation';
    const geo = $('adcBtnGeo');
    const manual = $('adcBtnManual');
    if (geo) geo.classList.remove('selected');
    if (manual) manual.classList.remove('selected');
    if (!fromPicker) closeModalImmediately('addrPickerModal');
    $('addAddressModal')?.classList.toggle('from-picker', fromPicker);
    $('addAddressModal')?.classList.toggle('no-motion', !withMotion);
    openModal('addAddressModal');
  }

  function backFromAddAddress() {
    const fromPicker = _addAddressOrigin === 'picker';
    closeModalId('addAddressModal');
    _returnToAddAddressChoice = false;
    if (fromPicker) {
      setTimeout(() => {
        $('addAddressModal')?.classList.remove('from-picker', 'no-motion');
      }, 560);
    }
  }

  let _adcSelection = null;

  function selectAdcOption(type) {
    _adcSelection = type;
    const geo = $('adcBtnGeo');
    const manual = $('adcBtnManual');
    if (geo) geo.classList.toggle('selected', type === 'geo');
    if (manual) manual.classList.toggle('selected', type === 'manual');
    const btn = $('adcConfirmBtn');
    if (btn) btn.disabled = false;
  }

  function adcConfirm() {
    if (!_adcSelection) return;
    _returnToAddAddressChoice = true;
    if (_adcSelection === 'geo') {
      adcUseGeoSearch(true);
      return;
    }
    openAddrSearch(true);
    closeAddressEntryStackImmediately();
  }

  function closeAddressEntryStackImmediately() {
    closeModalImmediately('addAddressModal');
    if (_addAddressOrigin === 'picker') closeModalImmediately('addrPickerModal');
    $('addAddressModal')?.classList.remove('from-picker');
  }

  function reopenAddressChoiceImmediately() {
    if (_addAddressOrigin === 'picker') {
      $('addrPickerModal')?.classList.add('no-motion');
      openModalImmediately('addrPickerModal');
    }
    $('addAddressModal')?.classList.toggle('from-picker', _addAddressOrigin === 'picker');
    $('addAddressModal')?.classList.add('no-motion');
    openModalImmediately('addAddressModal');
  }

  function backFromAddrSearch() {
    if (!_returnToAddAddressChoice) {
      closeModalId('addrSearchModal');
      return;
    }
    reopenAddressChoiceImmediately();
    closeModalImmediately('addrSearchModal');
  }

  function backFromAddrMap() {
    if (!_returnToAddAddressChoice) {
      closeModalId('addrMapModal');
      return;
    }
    reopenAddressChoiceImmediately();
    closeModalImmediately('addrMapModal');
  }

  function editAddrDetailsLocation() {
    closeModalImmediately('addrDetailsModal');
    openAddrSearch(true);
  }

  let _addrPickerSelected = null;
  let _addrPickerItems = [];
  let _addrPickerOrigin = 'operation';
  let _addrJustSavedAddress = null;
  let _addrPickerDeleteId = null;
  let _addrPickerDeleteMode = 'confirm';
  let _editingAddressId = null;
  const ADDR_PICKER_DOTS_VERTICAL = '<svg width="16" height="23" viewBox="0 0 24 32" fill="none" stroke="#aaa" stroke-width="2"><circle cx="12" cy="5" r="1.45" fill="#aaa"/><circle cx="12" cy="16" r="1.45" fill="#aaa"/><circle cx="12" cy="27" r="1.45" fill="#aaa"/></svg>';
  const ADDR_PICKER_DOTS_HORIZONTAL = '<svg width="21" height="8" viewBox="0 0 30 10" fill="none" stroke="#aaa" stroke-width="2"><circle cx="5" cy="5" r="1.45" fill="#aaa"/><circle cx="15" cy="5" r="1.45" fill="#aaa"/><circle cx="25" cy="5" r="1.45" fill="#aaa"/></svg>';
  const ADDR_PICKER_DELETE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
  function truncateAddrPickerText(text, max = 25) {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;
  }

  function getCurrentPickerAddress() {
    return _addrJustSavedAddress || opDraft?.address || operationContext?.address || customerAddress || null;
  }

  function addrPickerId(addr, fallback = '__current__') {
    return String(addr?.id || addr?.address_id || fallback);
  }

  function sameAddress(a, b) {
    if (!a || !b) return false;
    const aId = a.id || a.address_id;
    const bId = b.id || b.address_id;
    if (aId && bId && String(aId) === String(bId)) return true;
    return String(a.street || '') === String(b.street || '')
      && String(a.number || '') === String(b.number || '')
      && String(a.neighborhood || '') === String(b.neighborhood || '');
  }

  function currentPickerItem(current) {
    if (!current) return null;
    return {
      ...current,
      id: current.id || current.address_id || '__current__',
      label: current.label || current.alias || current.tag || current.name || current.street || 'Endereco'
    };
  }

  function mergeAddressPickerItems(...groups) {
    return dedupeAddresses(groups.flat().filter(Boolean));
  }

  function openAddrPicker(origin) {
    _addrPickerOrigin = origin || ($('mobViewProfile')?.classList.contains('active') && !$('operationModal')?.classList.contains('active') ? 'profile' : 'operation');
    $('addrPickerModal')?.classList.toggle('no-motion', _addrPickerOrigin !== 'profile');
    $('addrPickerModal')?.classList.toggle('from-profile', _addrPickerOrigin === 'profile');
    _addrPickerSelected = null;
    _addrPickerItems = [];
    _addrPickerDeleteId = null;
    setAddrDeleteConfirm(false);
    const confirmBtn = $('addrPickerConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    const current = getCurrentPickerAddress();
    const currentItem = currentPickerItem(current);
    const localItems = readLocalAddressList().map(currentPickerItem).filter(Boolean);
    if (currentItem) {
      _addrPickerItems = mergeAddressPickerItems([currentItem], localItems);
      _addrPickerSelected = addrPickerId(currentItem);
    } else {
      _addrPickerItems = localItems;
    }
    _renderAddrPickerList();
    openModal('addrPickerModal');
    if (window.PedeAquiCustomerService?.isLoggedIn?.()) {
      synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true }).then(list => {
        const current = getCurrentPickerAddress();
        const currentItem = currentPickerItem(current);
        const localItems = readLocalAddressList().map(currentPickerItem).filter(Boolean);
        _addrPickerItems = mergeAddressPickerItems(currentItem ? [currentItem] : [], localItems, list);
        const selectedMatch = _addrPickerItems.find(item => addressFingerprint(item) === addressFingerprint(current));
        if (selectedMatch) _addrPickerSelected = addrPickerId(selectedMatch);
        _renderAddrPickerList();
      }).catch(error => {
        console.error('[PedeAqui] Falha ao carregar endereços', error);
        alert('Não foi possível carregar seus endereços. Os endereços salvos neste aparelho continuam disponíveis.');
      });
    }
  }

  function _renderAddrPickerList() {
    const list = $('addrPickerList');
    if (!list) return;
    const current = getCurrentPickerAddress();
    list.innerHTML = _addrPickerItems.map(addr => {
      const id = addrPickerId(addr);
      const label = addr.label || addr.tag || addr.name || 'Endereço';
      const summary = addr.formatted_address || addressSummary(addr);
      const isSel = _addrPickerSelected
        ? _addrPickerSelected === id
        : current && (sameAddress(addr, current) || id === '__current__');
      if (isSel) {
        _addrPickerSelected = id;
        const btn = $('addrPickerConfirmBtn');
        if (btn) btn.disabled = false;
      }
      return `<button class="addr-picker-item${isSel ? ' selected' : ''}" ${act('click', 'selectAddrPickerItem', id)} data-addr-id="${esc(id)}">
        <span class="addr-picker-pin${isSel ? ' active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </span>
        <span class="addr-picker-copy"><strong>${esc(label)}</strong><small data-full-text="${esc(summary)}" data-short-text="${esc(truncateAddrPickerText(summary, 35))}">${esc(truncateAddrPickerText(summary, 35))}</small></span>
        ${isSel
          ? `<span class="addr-picker-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#15803d"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
             <span class="addr-picker-dots" ${act('click', 'toggleAddrPickerActions', '$event', '$this')}>${ADDR_PICKER_DOTS_VERTICAL}</span>
             <span class="addr-picker-delete" ${act('click', 'removeAddrPickerItem', '$event', '$this')} aria-label="Excluir endereço">${ADDR_PICKER_DELETE_ICON}</span>`
          : `<span class="addr-picker-dots" ${act('click', 'toggleAddrPickerActions', '$event', '$this')}>${ADDR_PICKER_DOTS_VERTICAL}</span>
             <span class="addr-picker-delete" ${act('click', 'removeAddrPickerItem', '$event', '$this')} aria-label="Excluir endereço">${ADDR_PICKER_DELETE_ICON}</span>`}
      </button>`;
    }).join('');
  }

  function setAddrDeleteConfirm(open) {
    const confirm = $('addrDeleteConfirm');
    setAccessibleDialogState(confirm, Boolean(open), '.addr-delete-yes');
  }

  function closeAddrDeleteConfirm() {
    setAddrDeleteConfirm(false);
  }

  function configureAddrDeleteDialog(mode) {
    const confirm = $('addrDeleteConfirm');
    const title = $('addrDeleteTitle');
    const text = confirm?.querySelector('.addr-delete-text');
    const action = confirm?.querySelector('.addr-delete-yes');
    const cancel = confirm?.querySelector('.addr-delete-cancel');
    _addrPickerDeleteMode = mode;
    confirm?.classList.toggle('is-active-warning', mode === 'active-warning');
    if (title) title.textContent = mode === 'active-warning' ? 'Atenção' : 'Excluir endereço';
    if (text) text.textContent = mode === 'active-warning'
      ? 'Não é possível excluir o endereço que está ativo neste momento.'
      : 'Tem certeza que deseja excluir este endereço?';
    if (action) action.textContent = mode === 'active-warning' ? 'Ok' : 'Excluir';
    if (cancel) {
      cancel.textContent = 'Cancelar';
      cancel.hidden = mode === 'active-warning';
    }
  }

  function closeAddrPickerActions(exceptCard) {
    document.querySelectorAll('#addrPickerModal .addr-picker-item.actions-open').forEach(card => {
      if (exceptCard && card === exceptCard) return;
      card.classList.remove('actions-open');
      const copy = card.querySelector('.addr-picker-copy small');
      if (copy?.dataset.shortText) copy.textContent = copy.dataset.shortText;
      const dots = card.querySelector('.addr-picker-dots');
      if (dots) dots.innerHTML = ADDR_PICKER_DOTS_VERTICAL;
    });
  }

  function toggleAddrPickerActions(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    const card = target?.closest?.('.addr-picker-item');
    if (!card) return;
    const willOpen = !card.classList.contains('actions-open');
    closeAddrPickerActions(card);
    card.classList.toggle('actions-open', willOpen);
    const copy = card.querySelector('.addr-picker-copy small');
    if (copy) {
      const full = copy.dataset.fullText || copy.textContent || '';
      copy.dataset.fullText = full;
      const short = copy.dataset.shortText || truncateAddrPickerText(full, 35);
      copy.dataset.shortText = short;
      copy.textContent = willOpen ? truncateAddrPickerText(full, 25) : short;
    }
    const dots = card.querySelector('.addr-picker-dots');
    if (dots) dots.innerHTML = willOpen ? ADDR_PICKER_DOTS_HORIZONTAL : ADDR_PICKER_DOTS_VERTICAL;
  }

  function editAddrPickerItem(event, id) {
    event?.preventDefault();
    event?.stopPropagation();
    const address = _addrPickerItems.find(item => addrPickerId(item) === String(id));
    if (!address) return;
    _editingAddressId = String(id);
    _addrTempLoc = {
      ...address,
      lat: Number(address.latitude ?? address.lat) || null,
      lng: Number(address.longitude ?? address.lng) || null,
      street_name: address.street || address.street_name || ''
    };
    closeModalImmediately('addrPickerModal');
    _openAddrDetailsForm(true);
  }
  function removeAddrPickerItem(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    const card = target?.closest?.('.addr-picker-item');
    const id = card?.dataset.addrId;
    if (!id) return;
    const address = _addrPickerItems.find(item => addrPickerId(item) === String(id));
    const activeAddress = operationContext?.address || customerAddress;
    if (address && (sameAddress(address, activeAddress) || _addrPickerSelected === String(id))) {
      _addrPickerDeleteId = null;
      closeAddrPickerActions();
      configureAddrDeleteDialog('active-warning');
      setAddrDeleteConfirm(true);
      return;
    }
    _addrPickerDeleteId = String(id);
    closeAddrPickerActions();
    configureAddrDeleteDialog('confirm');
    setAddrDeleteConfirm(true);
  }

  function cancelAddrPickerDelete() {
    _addrPickerDeleteId = null;
    closeAddrDeleteConfirm();
  }

  async function confirmAddrPickerDelete() {
    if (_addrPickerDeleteMode === 'active-warning') {
      _addrPickerDeleteId = null;
      closeAddrDeleteConfirm();
      return;
    }
    const id = _addrPickerDeleteId;
    if (!id) return;
    const address = _addrPickerItems.find(item => addrPickerId(item) === String(id));
    _addrPickerDeleteId = null;
    closeAddrDeleteConfirm();
    try {
      const remoteId = remoteAddressId(address);
      if (remoteId) {
        await window.PedeAquiAddressService.deleteCustomerAddress(remoteId);
      }
    } catch (error) {
      console.error('[PedeAqui] Falha ao excluir endereço', error);
      alert('Não foi possível excluir este endereço. Tente novamente.');
      return;
    }
    _addrPickerItems = _addrPickerItems.filter(item => addrPickerId(item) !== String(id));
    writeLocalAddressList(readLocalAddressList().filter(item => addrPickerId(item) !== String(id) && item.synced_remote_id !== String(id)));
    const selectedWasDeleted = addressFingerprint(operationContext?.address) === addressFingerprint(address);
    if (selectedWasDeleted) setSelectedOperationAddress(null, { forceDelivery: false });
    if (_addrPickerSelected === String(id)) _addrPickerSelected = null;
    const btn = $('addrPickerConfirmBtn');
    if (btn) btn.disabled = !_addrPickerSelected;
    if (window.PedeAquiCustomerAuth?.getToken?.()) {
      try {
        const remote = await synchronizeCustomerAddresses({ importLocal: false });
        _addrPickerItems = mergeAddressPickerItems(readLocalAddressList(), remote);
        if (selectedWasDeleted) {
          const replacement = defaultBackendAddress(remote) || remote[0] || null;
          if (replacement) setSelectedOperationAddress(replacement, { confirmed: operationConfirmed });
        }
      } catch (error) {
        console.error('[PedeAqui] Falha ao atualizar endereços após exclusão', error);
      }
    }
    _renderAddrPickerList();
  }

  function selectAddrPickerItem(id) {
    closeAddrPickerActions();
    _addrPickerSelected = id;
    const selectedConfirmBtn = $('addrPickerConfirmBtn');
    if (selectedConfirmBtn) selectedConfirmBtn.disabled = false;
    // _renderAddrPickerList() remonta a lista inteira já com o item selecionado
    // e com os data-act-* corretos. O remendo manual que existia aqui embaixo
    // era inalcançável (ficava depois de um `return`) e reintroduzia um
    // onclick="" em atributo — bloqueado pela CSP de produção.
    _renderAddrPickerList();
  }

  async function confirmAddrPicker() {
    if (!_addrPickerSelected) return;
    let address = _addrPickerItems.find(item => addrPickerId(item) === _addrPickerSelected);
    if (!address) return;
    if (window.PedeAquiCustomerAuth?.getToken?.() && isRemoteAddress(address)) {
      try {
        await window.PedeAquiAddressService.setDefaultCustomerAddress(addrPickerId(address));
        const remote = await synchronizeCustomerAddresses({ importLocal: false });
        address = remote.find(item => addrPickerId(item) === addrPickerId(address)) || address;
      } catch (error) {
        console.error('[PedeAqui] Falha ao definir endereço padrão', error);
        alert('O endereço foi selecionado neste aparelho, mas não foi possível defini-lo como padrão na sua conta.');
      }
    }
    _addrJustSavedAddress = null;
    if (opDraft) opDraft.address = address;
    setSelectedOperationAddress(address, { confirmed: true });
    if (opDraft) renderOperationScreen();
    closeModalImmediately('addrPickerModal');
    if (_addrPickerOrigin === 'profile') {
      $('mobViewProfile')?.classList.add('active');
      setMobNavActive('mobNavProfile');
      renderProfileView();
    }
    _addrPickerOrigin = 'operation';
  }

  // ============================================================
  //  Google Maps address flow (search → map → details)
  // ============================================================

  let _googleMapsLoading = false;
  let _addrTempLoc = null;   // { lat, lng, formatted_address, place_id, street_name, number, street, neighborhood, city, state, postal_code }
  let _addrMap = null;
  let _addrMapMarker = null;
  let _addrSearchDebounce = null;
  let _googleMapsPromise = null;
  let _placesLibraryPromise = null;
  let _mapsLibraryPromise = null;
  let _geocodingLibraryPromise = null;
  let _addrSuggestionCache = [];
  let _addrAutocompleteSessionToken = null;
  let _geocoder = null;
  let _legacyAutocompleteService = null;

  // ----------------------------------------------------------------
  //  Places autocomplete: implementation switch + debug
  // ----------------------------------------------------------------
  // TEMPORARY ISOLATION FLAG.
  //   true  -> legacy google.maps.places.AutocompleteService
  //            (routes through maps.googleapis.com / "Places API")
  //   false -> new AutocompleteSuggestion.fetchAutocompleteSuggestions
  //            (routes through places.googleapis.com / "Places API (New)")
  // The 403 "caller does not have permission" comes from the NEW path
  // (AutocompletePlaces RPC). Keeping this true lets address search work
  // through the legacy/JS endpoint while the Places API (New) key
  // permission is sorted out in Google Cloud. Flip to false to retest New.
  const USE_LEGACY_PLACES_AUTOCOMPLETE = true;

  // Verbose, key-safe diagnostics in the console. Set to false to silence.
  const MAPS_DEBUG = true;
  let _mapsDebugLogged = false;

  function _maskKey(k) {
    if (!k) return '(none)';
    return `${String(k).slice(0, 10)}…(len ${String(k).length})`;
  }

  function _loadedMapsScripts() {
    return Array.from(document.querySelectorAll('script[src*="maps.googleapis.com"]'));
  }

  function _scriptKeyPrefix() {
    const s = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (!s) return null;
    try { return (new URL(s.src).searchParams.get('key') || '').slice(0, 10) || null; }
    catch (_) { return null; }
  }

  function _logMapsDebug(stage, extra) {
    if (!MAPS_DEBUG) return;
    const cfgKey = window.GOOGLE_MAPS_API_KEY || '';
    const scripts = _loadedMapsScripts();
    const scriptKey = _scriptKeyPrefix();
    /* eslint-disable no-console */
    console.groupCollapsed(`[PedeAqui][maps-debug] ${stage}`);
    console.log('location.href      :', window.location.href);
    console.log('location.origin    :', window.location.origin);
    console.log('document.referrer  :', document.referrer || '(empty)');
    console.log('configured key     :', _maskKey(cfgKey));
    console.log('loaded script key  :', scriptKey ? `${scriptKey}…` : '(no maps script yet)');
    console.log('keys match         :', scriptKey ? cfgKey.startsWith(scriptKey) : 'n/a (script not injected yet)');
    console.log('maps scripts count :', scripts.length, scripts.length > 1 ? '⚠ MULTIPLE — duplicate injection' : '(single — ok)');
    scripts.forEach((s, i) => console.log(`  script[${i}]       :`, s.src.replace(/key=[^&]+/, 'key=***')));
    console.log('google.maps        :', !!(window.google && window.google.maps));
    console.log('importLibrary      :', !!(window.google && window.google.maps && window.google.maps.importLibrary));
    console.log('autocomplete mode  :', USE_LEGACY_PLACES_AUTOCOMPLETE
      ? 'LEGACY AutocompleteService → maps.googleapis.com (Places API)'
      : 'NEW AutocompleteSuggestion → places.googleapis.com (Places API New)');
    if (extra) Object.keys(extra).forEach(k => console.log(`${k.padEnd(19)}:`, extra[k]));
    console.groupEnd();
    /* eslint-enable no-console */
  }

  // Map raw Google errors / status codes to friendly Portuguese messages.
  function _mapPlacesError(err) {
    const msg = String((err && err.message) || err || '');
    if (/Chave do Google Maps/i.test(msg) || /API key/i.test(msg))
      return 'Chave do Google Maps nao configurada.';
    if (/caller does not have permission|PERMISSION_DENIED/i.test(msg))
      return 'Nao foi possivel buscar enderecos agora. Verifique a configuracao do Google Places.';
    if (/RefererNotAllowed|referer|referrer/i.test(msg))
      return 'Este dominio local nao esta autorizado na chave do Google Maps.';
    if (/REQUEST_DENIED|not.*enabled|disabled|ApiNotActivated/i.test(msg))
      return 'Google Places API nao esta ativada para este projeto.';
    if (/ZERO_RESULTS|Nenhum/i.test(msg))
      return 'Nenhum endereco encontrado.';
    return 'Nao foi possivel buscar enderecos agora. Use "Nao achei meu endereco".';
  }

  const FORTALEZA_LOCATION_BIAS = {
    north: -2.35,
    south: -5.1,
    east: -37.0,
    west: -40.2
  };

  function _showAddrSearchMessage(message) {
    const sug = $('addrSuggestions');
    if (sug) sug.innerHTML = `<p class="addr-no-results">${_esc(message)}</p>`;
  }

  function _ensureGoogleMapsLoader() {
    if (!_mapsDebugLogged) { _mapsDebugLogged = true; _logMapsDebug('loader-start'); }
    if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
    if (_googleMapsPromise) return _googleMapsPromise;

    const key = window.GOOGLE_MAPS_API_KEY || '';
    if (!key) {
      const err = new Error('Chave do Google Maps nao configurada.');
      console.warn('[Rapidex] Google Maps API key not configured. Copy scripts/config/maps-config.example.js to maps-config.local.js and set the key.');
      _googleMapsPromise = Promise.reject(err);
      return _googleMapsPromise;
    }

    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      _googleMapsPromise = new Promise((resolve, reject) => {
        if (window.google?.maps?.importLibrary) { resolve(window.google.maps); return; }
        existing.addEventListener('load', () => {
          if (window.google?.maps?.importLibrary) resolve(window.google.maps);
          else reject(new Error('Google Maps carregou sem importLibrary.'));
        }, { once: true });
        existing.addEventListener('error', () => reject(new Error('Falha ao carregar o script do Google Maps.')), { once: true });
      });
      return _googleMapsPromise;
    }

    _googleMapsLoading = true;
    _googleMapsPromise = new Promise((resolve, reject) => {
      const bootstrapCallback = '__pedeAquiGoogleMapsReady';
      window.google = window.google || {};
      window.google.maps = window.google.maps || {};
      window.google.maps[bootstrapCallback] = () => {
        _googleMapsLoading = false;
        resolve(window.google.maps);
        try { delete window.google.maps[bootstrapCallback]; } catch (_) { window.google.maps[bootstrapCallback] = undefined; }
      };

      const s = document.createElement('script');
      const params = new URLSearchParams({
        key,
        v: 'weekly',
        loading: 'async',
        callback: `google.maps.${bootstrapCallback}`
      });
      s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      s.async = true;
      s.onerror = () => {
        _googleMapsLoading = false;
        reject(new Error('Falha ao carregar o script do Google Maps.'));
      };
      document.head.appendChild(s);
    });
    return _googleMapsPromise;
  }

  async function _importGoogleMapsLibrary(name) {
    await _ensureGoogleMapsLoader();
    try {
      return await google.maps.importLibrary(name);
    } catch (err) {
      throw new Error(`Falha ao carregar a biblioteca ${name} do Google Maps.`);
    }
  }

  function _loadPlacesLibrary() {
    if (!_placesLibraryPromise) _placesLibraryPromise = _importGoogleMapsLibrary('places');
    return _placesLibraryPromise;
  }

  function _loadMapsLibrary() {
    if (!_mapsLibraryPromise) {
      _mapsLibraryPromise = Promise.all([
        _importGoogleMapsLibrary('maps'),
        _importGoogleMapsLibrary('marker')
      ]);
    }
    return _mapsLibraryPromise;
  }

  async function _loadGeocoder() {
    if (!_geocodingLibraryPromise) _geocodingLibraryPromise = _importGoogleMapsLibrary('geocoding');
    await _geocodingLibraryPromise;
    if (!_geocoder) _geocoder = new google.maps.Geocoder();
    return _geocoder;
  }

  function openAddrSearch(instant = false) {
    const inp = $('addrSearchInput');
    const sug = $('addrSuggestions');
    if (inp) inp.value = '';
    if (sug) sug.innerHTML = '';
    _addrSuggestionCache = [];
    _addrAutocompleteSessionToken = null;
    if (instant) openModalImmediately('addrSearchModal');
    else openModal('addrSearchModal');
    _loadPlacesLibrary()
      .then(() => {
        if (MAPS_DEBUG) _logMapsDebug('places-library-loaded', {
          placesLibrary: 'loaded ok',
          AutocompleteService: !!(window.google?.maps?.places?.AutocompleteService),
          AutocompleteSuggestion: !!(window.google?.maps?.places?.AutocompleteSuggestion)
        });
      })
      .catch(err => {
        console.warn('[PedeAqui] Places library unavailable:', err);
        _showAddrSearchMessage(_mapPlacesError(err));
      })
      .finally(() => setTimeout(() => { if (inp) inp.focus(); }, 200));
  }

  function onAddrSearchInput() {
    clearTimeout(_addrSearchDebounce);
    const val = ($('addrSearchInput') || {}).value?.trim() || '';
    const sug = $('addrSuggestions');
    if (!sug) return;
    if (val.length < 2) { sug.innerHTML = ''; return; }
    _renderAddrSkeleton();
    _addrSearchDebounce = setTimeout(() => _fetchAddrSuggestions(val), 350);
  }

  function _renderAddrSkeleton() {
    const sug = $('addrSuggestions');
    if (!sug) return;
    let h = '';
    for (let i = 0; i < 4; i++) {
      h += `<div class="addr-sug-skeleton">
        <div class="addr-sug-sk-icon"></div>
        <div class="addr-sug-sk-text">
          <div class="addr-sug-sk-line addr-sug-sk-line--main"></div>
          <div class="addr-sug-sk-line addr-sug-sk-line--sub"></div>
        </div>
      </div>`;
    }
    sug.innerHTML = h;
  }

  async function _fetchAddrSuggestions(query) {
    const currentValue = ($('addrSearchInput') || {}).value?.trim() || '';
    if (query !== currentValue) return;
    try {
      const normalized = USE_LEGACY_PLACES_AUTOCOMPLETE
        ? await _fetchLegacySuggestions(query)
        : await _fetchNewSuggestions(query);
      if (query !== (($('addrSearchInput') || {}).value?.trim() || '')) return;
      _renderAddrSuggestions(normalized);
    } catch (err) {
      console.warn('[PedeAqui] Places autocomplete failed:', err);
      if (MAPS_DEBUG) _logMapsDebug('autocomplete-error', {
        rawError: String((err && err.message) || err),
        diagnosis: USE_LEGACY_PLACES_AUTOCOMPLETE
          ? 'Legacy path failed — likely "Places API" (old) not enabled or key referrer/restriction issue.'
          : 'New path failed — likely "Places API (New)" permission/restriction on the key (the AutocompletePlaces 403).'
      });
      _showAddrSearchMessage(_mapPlacesError(err));
    }
  }

  // NEW Places API (places.googleapis.com / AutocompletePlaces RPC).
  // Returns normalized [{ main, sub, placeId, placePrediction }].
  async function _fetchNewSuggestions(query) {
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await _loadPlacesLibrary();
    if (!_addrAutocompleteSessionToken && AutocompleteSessionToken) {
      _addrAutocompleteSessionToken = new AutocompleteSessionToken();
    }
    const req = {
      input: query,
      includedRegionCodes: ['br'],
      language: 'pt-BR',
      region: 'br',
      locationBias: FORTALEZA_LOCATION_BIAS,
      sessionToken: _addrAutocompleteSessionToken
    };
    const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return suggestions
      .filter(s => s.placePrediction)
      .map(s => {
        const p = s.placePrediction;
        return {
          main: _predictionText(p.mainText) || _predictionText(p.text) || '',
          sub: _predictionText(p.secondaryText) || '',
          placeId: p.placeId || '',
          placePrediction: p
        };
      });
  }

  // LEGACY AutocompleteService (maps.googleapis.com / "Places API").
  // Returns normalized [{ main, sub, placeId, placePrediction:null }].
  async function _fetchLegacySuggestions(query) {
    await _loadPlacesLibrary();
    if (!_legacyAutocompleteService) {
      _legacyAutocompleteService = new google.maps.places.AutocompleteService();
    }
    const bounds = new google.maps.LatLngBounds(
      { lat: FORTALEZA_LOCATION_BIAS.south, lng: FORTALEZA_LOCATION_BIAS.west },
      { lat: FORTALEZA_LOCATION_BIAS.north, lng: FORTALEZA_LOCATION_BIAS.east }
    );
    return new Promise((resolve, reject) => {
      _legacyAutocompleteService.getPlacePredictions({
        input: query,
        language: 'pt-BR',
        region: 'br',
        componentRestrictions: { country: 'br' },
        bounds
      }, (predictions, status) => {
        const S = google.maps.places.PlacesServiceStatus;
        if (status === S.ZERO_RESULTS) { resolve([]); return; }
        if (status !== S.OK || !predictions) {
          reject(new Error(`PLACES_STATUS_${status}`));
          return;
        }
        resolve(predictions.map(p => ({
          main: (p.structured_formatting && p.structured_formatting.main_text) || p.description || '',
          sub: (p.structured_formatting && p.structured_formatting.secondary_text) || '',
          placeId: p.place_id || '',
          placePrediction: null
        })));
      });
    });
  }

  // Legacy predictions carry only a placeId — resolve full details via Geocoder
  // (Geocoding API), which is already enabled on the key.
  async function _legacyPlaceIdToLocation(placeId) {
    if (!placeId) throw new Error('Sugestao invalida.');
    const r = await _geocodePlaceId(placeId);
    return {
      lat: r.geometry.location.lat(),
      lng: r.geometry.location.lng(),
      formatted_address: r.formatted_address || '',
      place_id: placeId,
      ..._parseAddrComponents(r.address_components || [])
    };
  }

  // Thin wrapper (kept hoisted) so there is a single escaper behind the
  // address/Places rendering.
  function _esc(s) {
    return esc(s);
  }

  function _predictionText(textValue) {
    if (!textValue) return '';
    return typeof textValue === 'string' ? textValue : (textValue.text || '');
  }

  function _normalizePlaceAddressComponents(comps) {
    return (comps || []).map(c => ({
      long_name: c.long_name || c.longText || '',
      short_name: c.short_name || c.shortText || '',
      types: c.types || []
    }));
  }

  function _placeLocationToLatLng(location) {
    if (!location) return null;
    const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
    const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
  }

  function _geocodePlaceId(placeId) {
    return _loadGeocoder().then(geocoder => new Promise((resolve, reject) => {
      geocoder.geocode({ placeId }, (results, status) => {
        if (status !== 'OK' || !results?.[0]) {
          reject(new Error('Nao foi possivel carregar este endereco.'));
          return;
        }
        resolve(results[0]);
      });
    }));
  }

  async function _placePredictionToLocation(placePrediction) {
    const placeId = placePrediction?.placeId || '';
    if (!placePrediction) throw new Error('Sugestao invalida.');
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ['id', 'formattedAddress', 'location', 'addressComponents'] });
      const loc = _placeLocationToLatLng(place.location);
      if (!loc) throw new Error('Endereco sem coordenadas.');
      return {
        lat: loc.lat,
        lng: loc.lng,
        formatted_address: place.formattedAddress || '',
        place_id: place.id || placeId,
        ..._parseAddrComponents(_normalizePlaceAddressComponents(place.addressComponents || []))
      };
    } catch (err) {
      if (!placeId) throw err;
      const r = await _geocodePlaceId(placeId);
      return {
        lat: r.geometry.location.lat(),
        lng: r.geometry.location.lng(),
        formatted_address: r.formatted_address || '',
        place_id: placeId,
        ..._parseAddrComponents(r.address_components || [])
      };
    }
  }

  function _renderAddrSuggestions(suggestions) {
    const sug = $('addrSuggestions');
    if (!sug) return;
    _addrSuggestionCache = suggestions || [];
    if (!_addrSuggestionCache.length) {
      sug.innerHTML = '<p class="addr-no-results">Nenhum resultado encontrado.</p>';
      return;
    }
    sug.innerHTML = _addrSuggestionCache.map((s, index) => {
      const main = _esc([s.main, s.sub].filter(Boolean).join(s.sub ? ' - ' : ''));
      return `<button class="addr-sug-item" ${act('click', 'selectAddrSuggestion', index)}>
        <svg class="addr-sug-pin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div class="addr-sug-copy">
          <span class="addr-sug-main">${main}</span>
        </div>
      </button>`;
    }).join('');
  }

  async function selectAddrSuggestion(index) {
    const suggestion = _addrSuggestionCache[Number(index)];
    if (!suggestion) {
      _showAddrSearchMessage('Sugestao indisponivel. Tente buscar novamente.');
      return;
    }
    try {
      if (suggestion.placePrediction) {
        // NEW Places API prediction object.
        _addrTempLoc = await _placePredictionToLocation(suggestion.placePrediction);
      } else if (suggestion.placeId) {
        // LEGACY prediction — resolve by placeId through the Geocoder.
        _addrTempLoc = await _legacyPlaceIdToLocation(suggestion.placeId);
      } else {
        throw new Error('Sugestao invalida.');
      }
      _addrAutocompleteSessionToken = null;
      closeModalImmediately('addrSearchModal');
      _openAddrDetailsForm(true);
    } catch (err) {
      console.warn('[PedeAqui] Failed to select address suggestion:', err);
      _showAddrSearchMessage(_mapPlacesError(err));
    }
  }
  function _parseAddrComponents(comps) {
    const get = (...types) => { for (const t of types) { const c = comps.find(x => x.types.includes(t)); if (c) return c.long_name; } return ''; };
    const route = get('route');
    const sNum  = get('street_number');
    return {
      street_name: route,
      number: sNum,
      street: route ? (sNum ? `${route}, ${sNum}` : route) : '',
      neighborhood: get('sublocality_level_1','sublocality','neighborhood','political'),
      city: get('administrative_area_level_2','locality'),
      state: get('administrative_area_level_1'),
      postal_code: get('postal_code')
    };
  }

  function adcUseGeoSearch(instant = false) {
    if (!navigator.geolocation) { alert('Geolocalizacao nao disponivel neste navegador.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        _addrTempLoc = { lat, lng, formatted_address:'', place_id:'', street_name:'', number:'', street:'', neighborhood:'', city:'', state:'', postal_code:'' };
        _loadGeocoder()
          .then(geocoder => {
            geocoder.geocode({ location:{ lat, lng } }, (results, status) => {
              if (status === 'OK' && results?.[0]) {
                _addrTempLoc = { lat, lng, formatted_address: results[0].formatted_address || '', place_id: results[0].place_id||'', ..._parseAddrComponents(results[0].address_components||[]) };
              }
              closeModalImmediately('addrSearchModal');
              if (instant) closeAddressEntryStackImmediately();
              _openAddrMapScreen(lat, lng, instant);
            });
          })
          .catch(err => {
            console.warn('[PedeAqui] Geocoder unavailable for current location:', err);
            closeModalImmediately('addrSearchModal');
            if (instant) closeAddressEntryStackImmediately();
            _openAddrMapScreen(lat, lng, instant);
          });
      },
      err => {
        console.warn('[PedeAqui] User location permission denied or unavailable:', err);
        alert('Nao foi possivel acessar sua localizacao. Digite seu endereco manualmente.');
      }
    );
  }

  function _openAddrMapScreen(lat, lng, instant = false) {
    if (instant) openModalImmediately('addrMapModal');
    else openModal('addrMapModal');
    _loadMapsLibrary()
      .then(() => setTimeout(() => _initAddrMap(lat, lng), 160))
      .catch(err => {
        console.warn('[PedeAqui] Maps library unavailable:', err);
        alert('Nao foi possivel carregar o mapa. Tente novamente.');
      });
  }
  function _initAddrMap(lat, lng) {
    if (!window.google) return;
    const el = $('addrMapContainer');
    if (!el) return;
    _addrMap = new google.maps.Map(el, { center:{lat,lng}, zoom:17, disableDefaultUI:true, zoomControl:true, gestureHandling:'greedy' });
    _addrMapMarker = null;
    const stage = el.closest('.addr-map-stage');
    _addrMap.addListener('dragstart', () => stage?.classList.add('is-moving'));
    _addrMap.addListener('idle', () => {
      stage?.classList.remove('is-moving');
      const center = _addrMap.getCenter();
      if (!center || !_addrTempLoc) return;
      const nextLat = center.lat();
      const nextLng = center.lng();
      const moved = Math.abs(nextLat - _addrTempLoc.lat) > 0.000001
        || Math.abs(nextLng - _addrTempLoc.lng) > 0.000001;
      _addrTempLoc.lat = nextLat;
      _addrTempLoc.lng = nextLng;
      if (moved) {
        _addrTempLoc.formatted_address = '';
        _addrTempLoc.place_id = '';
        _addrTempLoc.street_name = '';
        _addrTempLoc.number = '';
        _addrTempLoc.street = '';
        _addrTempLoc.neighborhood = '';
        _addrTempLoc.city = '';
        _addrTempLoc.state = '';
        _addrTempLoc.postal_code = '';
      }
    });
  }

  function confirmAddrMap() {
    if (!_addrTempLoc?.lat) return;
    if (_addrMap) {
      const p = _addrMap.getCenter();
      _addrTempLoc.lat = p.lat(); _addrTempLoc.lng = p.lng();
    }
    if (!_addrTempLoc.formatted_address) {
      _loadGeocoder()
        .then(geocoder => {
          geocoder.geocode({ location:{ lat:_addrTempLoc.lat, lng:_addrTempLoc.lng } }, (results, status) => {
            if (status === 'OK' && results?.[0]) {
              const parsed = _parseAddrComponents(results[0].address_components||[]);
              _addrTempLoc = { ..._addrTempLoc, formatted_address: results[0].formatted_address||'', ...parsed };
            }
            closeModalImmediately('addrMapModal');
            _openAddrDetailsForm(true);
          });
        })
        .catch(err => {
          console.warn('[PedeAqui] Reverse geocoding unavailable:', err);
          closeModalImmediately('addrMapModal');
          _openAddrDetailsForm(true);
        });
      return;
    }
    closeModalImmediately('addrMapModal');
    _openAddrDetailsForm(true);
  }

  async function finishAddressDetails(address) {
    const editing = _editingAddressId
      ? _addrPickerItems.find(item => addrPickerId(item) === _editingAddressId) || readLocalAddressList().find(item => addrPickerId(item) === _editingAddressId)
      : null;
    let savedAddress = normalizeAddressValue({
      ...editing,
      ...address,
      id: editing?.id || editing?.address_id || address.id || address.address_id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: address.label || address.alias || editing?.label || address.street || 'Endereco'
    });
    const originalId = _editingAddressId;
    const logged = Boolean(window.PedeAquiCustomerAuth?.getToken?.());
    if (logged) {
      try {
        const response = editing && isRemoteAddress(editing)
          ? await window.PedeAquiAddressService.updateCustomerAddress(addrPickerId(editing), addressApiPayload(savedAddress))
          : await window.PedeAquiAddressService.createCustomerAddress(addressApiPayload(savedAddress));
        const remote = normalizeAddressValue(response?.data || response);
        if (remote && typeof remote === 'object') savedAddress = { ...savedAddress, ...remote, id: remote.id || remote.address_id || savedAddress.id };
      } catch (error) {
        console.error('[PedeAqui] Falha ao salvar endereço no backend', error);
        savedAddress.sync_error = true;
        if (editing && isRemoteAddress(editing)) savedAddress.synced_remote_id = addrPickerId(editing);
        alert('Não foi possível salvar o endereço na sua conta. Ele continuará disponível neste aparelho para você tentar novamente.');
      }
    }
    const localList = readLocalAddressList();
    writeLocalAddressList(dedupeAddresses([
      savedAddress,
      ...localList.filter(item => addrPickerId(item) !== String(originalId || '') && addressFingerprint(item) !== addressFingerprint(savedAddress))
    ]));
    _editingAddressId = null;
    _addrJustSavedAddress = savedAddress;
    if (opDraft) opDraft.address = savedAddress;
    setSelectedOperationAddress(savedAddress, { confirmed: operationConfirmed });
    _returnToAddAddressChoice = false;
    closeModalImmediately('addrDetailsModal');
    closeModalImmediately('addrMapModal');
    closeModalImmediately('addrSearchModal');
    $('addrPickerModal')?.classList.add('no-motion');
    openAddrPicker(_addrPickerOrigin);
    _addrPickerItems = mergeAddressPickerItems([currentPickerItem(savedAddress)], _addrPickerItems);
    _addrPickerSelected = addrPickerId(savedAddress);
    _renderAddrPickerList();
    if ($('operationModal')?.classList.contains('active')) renderOperationScreen();
  }

  function _openAddrDetailsForm(instant = false) {
    const loc = _addrTempLoc || {};
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const setDis = (id, v) => { const el = $(id); if (el) { el.value = v; el.disabled = false; } };
    setDis('addrDetStreet', loc.street_name || loc.street || '');
    setDis('addrDetNumber', loc.number || '');
    set('addrDetNeighborhood', loc.neighborhood || '');
    set('addrDetCep', loc.postal_code ? _fmtCep(loc.postal_code) : '');
    set('addrDetComplement', loc.complement || '');
    set('addrDetReference', loc.reference || '');
    set('addrDetAlias', loc.alias || loc.label || '');
    const noNum = $('addrDetNoNumber');
    if (noNum) noNum.checked = false;
    const titleStreet = loc.street_name || String(loc.street || '').replace(/,\s*[^,]+$/, '');
    const titleNumber = String(loc.number || '').trim();
    const titleHasNumber = titleNumber && new RegExp(`(^|\\D)${titleNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(titleStreet);
    const title = titleStreet
      ? `${titleStreet}${titleNumber && !titleHasNumber ? `, ${titleNumber}` : ''}`
      : loc.formatted_address || 'Endereco';
    const sub = [loc.neighborhood, loc.city, loc.state].filter(Boolean).join(', ');
    const titleEl = $('addrDetLocationTitle');
    const subEl = $('addrDetLocationSub');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub || loc.formatted_address || '';
    validateAddrDetails();
    if (instant) openModalImmediately('addrDetailsModal');
    else openModal('addrDetailsModal');
    _loadMapsLibrary()
      .then(() => setTimeout(_initAddrDetailsMiniMap, 160))
      .catch(err => console.warn('[PedeAqui] Mini map unavailable:', err));
  }

  function _initAddrDetailsMiniMap() {
    if (!window.google || !_addrTempLoc?.lat) return;
    const el = $('addrDetailsMiniMap');
    if (!el) return;
    const map = new google.maps.Map(el, { center:{lat:_addrTempLoc.lat,lng:_addrTempLoc.lng}, zoom:16, disableDefaultUI:true, gestureHandling:'none', clickableIcons:false });
    new google.maps.Marker({ position:{lat:_addrTempLoc.lat,lng:_addrTempLoc.lng}, map });
  }

  function _fmtCep(cep) {
    const d = String(cep).replace(/\D/g,'');
    return d.length === 8 ? d.replace(/(\d{5})(\d{3})/,'$1-$2') : cep;
  }

  function maskCep(el) {
    let v = el.value.replace(/\D/g,'').slice(0,8);
    if (v.length > 5) v = v.slice(0,5) + '-' + v.slice(5);
    el.value = v;
  }

  function toggleAddrNoNumber() {
    const noNum = $('addrDetNoNumber');
    const numEl = $('addrDetNumber');
    if (!noNum || !numEl) return;
    if (noNum.checked) { numEl.value = 's/n'; numEl.disabled = true; }
    else { numEl.value = ''; numEl.disabled = false; }
    validateAddrDetails();
  }

  function validateAddrDetails() {
    const v = id => ($( id)||{}).value?.trim()||'';
    const street = v('addrDetStreet');
    const number = v('addrDetNumber');
    const neighborhood = v('addrDetNeighborhood');
    const noNum = $('addrDetNoNumber')?.checked;
    const btn = $('addrDetSaveBtn');
    if (btn) btn.disabled = !(street && (number || noNum) && neighborhood);
  }

  async function saveAddressDetails() {
    const v = id => ($(id)||{}).value?.trim()||'';
    const street       = v('addrDetStreet');
    const rawNum       = v('addrDetNumber');
    const noNum        = $('addrDetNoNumber')?.checked;
    const number       = noNum ? 's/n' : rawNum;
    const neighborhood = v('addrDetNeighborhood');
    const complement   = v('addrDetComplement');
    const reference    = v('addrDetReference');
    const alias        = v('addrDetAlias');
    const postal_code  = v('addrDetCep').replace(/\D/g,'');
    if (!street || (!number && !noNum) || !neighborhood) { alert('Preencha os campos obrigatórios.'); return; }
    const loc = _addrTempLoc || {};
    const address = { street, number, neighborhood, complement, reference, alias, label: alias || street, postal_code,
      formatted_address: loc.formatted_address || `${street}, ${number} - ${neighborhood}`,
      latitude: loc.lat || null, longitude: loc.lng || null, place_id: loc.place_id || '' };
    await finishAddressDetails(address);
  }

  // ── end Google Maps address flow ──

  let _loginOrigin = 'profile';

  function openLoginScreen(origin = 'profile') {
    _loginOrigin = origin;
    loginReturnNavId = document.body.classList.contains('menu-tab') && ['profile', 'club'].includes(origin)
      ? 'mobNavMenu'
      : null;
    document.body.classList.remove('menu-login-open');
    $('loginModal')?.classList.toggle('from-add-address', origin === 'address');
    $('loginModal')?.classList.toggle('from-coupon', origin === 'coupon');
    $('loginModal')?.classList.toggle('from-bottom-nav', ['profile', 'club'].includes(origin));
    openModal('loginModal');
  }

  function mockLogin(mode) {
    persistCustomer({ name: mode === 'signup' ? 'Cliente Rapidex' : 'Cliente identificado', phone: '' });
    appState.profileLoaded = false;
    customerStore()?.set?.({ profileLoaded: false });
    closeModalId('loginModal');
    renderProfileView();
  }

  /* ---------- Register screen ("Cadastre-se") ---------- */

  // Auth screens opened from the guest sheet must inherit Home's soft lock.
  // Promoting it to position:fixed moves the sticky header while returning.
  function lockAuthScreenScroll() {
    const preserveScrolledHome = document.body.classList.contains('home-tab')
      && document.body.classList.contains('soft-scroll-locked');
    lockBodyScroll(currentScrollY(), preserveScrolledHome ? 'soft' : 'fixed');
  }

  function openRegisterScreen() {
    closeModalId('loginModal');
    $('registerScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    $('registerForm')?.scrollTo?.(0, 0);
    clearAllRegErrors();
  }

  function closeRegisterScreen() {
    $('registerScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    // Return to the login sheet the user came from.
    openModalImmediately('loginModal');
  }

  function applyRegMask(el, template, maxDigits) {
    const digits = onlyDigits(el.value).slice(0, maxDigits);
    if (!digits) {
      el.value = '';
      return;
    }

    let index = 0;
    const out = template.replace(/_/g, () => digits[index++] || '_');
    el.value = out;

    const slots = [];
    for (let i = 0; i < template.length; i++) {
      if (template[i] === '_') slots.push(i);
    }
    const cursor = digits.length < slots.length ? slots[digits.length] : out.length;
    requestAnimationFrame(() => {
      try { el.setSelectionRange(cursor, cursor); } catch (_) {}
    });
  }

  function maskRegPhone(el) {
    applyRegMask(el, '(__) _ ____-____', 11);
  }

  function maskRegCpf(el) {
    applyRegMask(el, '___.___.___-__', 11);
  }

  function maskRegBirth(el) {
    applyRegMask(el, '__/__/____', 8);
  }

  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

  function toggleRegPassword(inputId, btn) {
    const input = $(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OPEN_SVG : EYE_OFF_SVG;
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  }

  function isValidCpf(digits) {
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
    let d1 = (sum * 10) % 11;
    if (d1 === 10) d1 = 0;
    if (d1 !== parseInt(digits[9], 10)) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
    let d2 = (sum * 10) % 11;
    if (d2 === 10) d2 = 0;
    return d2 === parseInt(digits[10], 10);
  }

  function isValidBirthDate(value) {
    const d = onlyDigits(value);
    if (d.length !== 8) return false;
    const day = +d.slice(0, 2);
    const month = +d.slice(2, 4);
    const year = +d.slice(4, 8);
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return false;
    return year >= 1900 && dt <= new Date();
  }

  // Field-level validators. Each returns '' when valid or an error message.
  const REG_FIELDS = [
    { id: 'regFullName', err: 'regFullNameErr', validate(v) {
      // No strict validation — any non-empty value is accepted.
      if (!(v || '').trim()) return 'Campo obrigatório';
      return '';
    } },
    { id: 'regEmail', err: 'regEmailErr', validate(v) {
      const s = (v || '').trim();
      if (!s) return 'Campo obrigatório';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'Email inválido';
      return '';
    } },
    { id: 'regPhone', err: 'regPhoneErr', validate(v) {
      const d = onlyDigits(v);
      if (!d) return 'Campo obrigatório';
      if (d.length < 10 || d.length > 11) return 'Informe o telefone completo';
      return '';
    } },
    { id: 'regBirth', err: 'regBirthErr', validate(v) {
      if (!onlyDigits(v)) return 'Campo obrigatório';
      if (!isValidBirthDate(v)) return 'O formato deve ser DD/MM/AAAA';
      return '';
    } },
    { id: 'regCpf', err: 'regCpfErr', validate(v) {
      const d = onlyDigits(v);
      if (!d) return 'Campo obrigatório';
      if (!isValidCpf(d)) return 'CPF inválido';
      return '';
    } },
    { id: 'regPassword', err: 'regPasswordErr', validate(v) {
      if (!v) return 'Campo obrigatório';
      if (v.length < 8) return 'Informe ao menos 8 caracteres';
      return '';
    } },
    { id: 'regPasswordConfirm', err: 'regPasswordConfirmErr', validate(v) {
      if (!v) return 'Campo obrigatório';
      if (v !== ($('regPassword')?.value || '')) return 'As senhas não coincidem';
      return '';
    } }
  ];

  function showRegError(errId, msg) {
    const e = $(errId);
    if (e) { e.textContent = msg; e.classList.add('show'); }
  }
  function hideRegError(errId) {
    const e = $(errId);
    if (e) { e.textContent = ''; e.classList.remove('show'); }
  }
  function setRegFieldError(def, msg) {
    $(def.id)?.closest('.reg-field')?.classList.add('reg-field--error');
    showRegError(def.err, msg);
  }
  function clearRegFieldError(def) {
    $(def.id)?.closest('.reg-field')?.classList.remove('reg-field--error');
    hideRegError(def.err);
  }

  // Tracks which fields the user has interacted with, so errors only show
  // after a field has been touched/edited (or after submit).
  const regTouched = new Set();

  let _regSummaryTimer = null;
  function showRegSummary(message) {
    const el = $('regSummary');
    if (!el) return;
    // The summary holds an icon span + a message span; update the message text.
    const msgSpan = el.querySelector('span:last-child');
    if (msgSpan) msgSpan.textContent = message || 'Preencha todos os campos';
    if (_regSummaryTimer) { clearTimeout(_regSummaryTimer); _regSummaryTimer = null; }
    el.classList.remove('hiding');
    el.classList.add('show');
    _regSummaryTimer = setTimeout(() => hideRegSummary(), 5000);
  }
  function hideRegSummary(immediate) {
    const el = $('regSummary');
    if (!el) return;
    if (_regSummaryTimer) { clearTimeout(_regSummaryTimer); _regSummaryTimer = null; }
    if (immediate || !el.classList.contains('show')) {
      el.classList.remove('show', 'hiding'); return;
    }
    el.classList.add('hiding');
    setTimeout(() => el.classList.remove('show', 'hiding'), 320);
  }

  function clearAllRegErrors() {
    document.querySelectorAll('#registerScreen .reg-field--error').forEach(el => el.classList.remove('reg-field--error'));
    document.querySelectorAll('#registerScreen .reg-error').forEach(el => { el.textContent = ''; el.classList.remove('show'); });
    hideRegSummary(true);
    regTouched.clear();
  }

  // Hide the generic summary once no field/checkbox is flagged anymore.
  function maybeHideRegSummary() {
    const anyError = document.querySelector('#registerScreen .reg-field--error');
    if (!anyError) hideRegSummary();
  }

  // Validate a single touched field and show/clear only its own error.
  function validateRegField(id) {
    const def = REG_FIELDS.find(f => f.id === id);
    if (!def || !regTouched.has(id)) return;
    const msg = def.validate($(id)?.value);
    if (msg) setRegFieldError(def, msg);
    else clearRegFieldError(def);
  }

  // Real-time validation: mark the field touched, validate it live, and keep
  // the confirm-password field in sync when the password changes.
  function handleRegFieldInput(id) {
    regTouched.add(id);
    validateRegField(id);
    if (id === 'regPassword' && regTouched.has('regPasswordConfirm')) {
      validateRegField('regPasswordConfirm');
    }
    maybeHideRegSummary();
  }

  // Validate on blur (the field counts as touched once it loses focus).
  function handleRegFieldBlur(id) {
    regTouched.add(id);
    validateRegField(id);
    maybeHideRegSummary();
  }

  function handleRegPrivacyInput() {
    regTouched.add('regPrivacy');
    const privacy = $('regPrivacy');
    hideRegError('regPrivacyErr');
    maybeHideRegSummary();
  }

  // Validate every field, render errors, and return the first invalid element.
  function runRegisterValidation() {
    let firstInvalid = null;
    REG_FIELDS.forEach(def => {
      const input = $(def.id);
      if (!input) return;
      regTouched.add(def.id);
      const msg = def.validate(input.value);
      if (msg) {
        setRegFieldError(def, msg);
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearRegFieldError(def);
      }
    });
    const privacy = $('regPrivacy');
    regTouched.add('regPrivacy');
    hideRegError('regPrivacyErr');
    if (privacy && !privacy.checked) {
      if (!firstInvalid) firstInvalid = privacy;
    }
    if (firstInvalid) showRegSummary(); else hideRegSummary();
    return firstInvalid;
  }

  // Build the API payload: digits-only phone/CPF and DD/MM/YYYY -> YYYY-MM-DD.
  function buildRegisterPayload() {
    const birth = onlyDigits($('regBirth').value); // DDMMYYYY
    const birth_date = `${birth.slice(4, 8)}-${birth.slice(2, 4)}-${birth.slice(0, 2)}`;
    return {
      name: ($('regFullName').value || '').trim(),
      email: ($('regEmail').value || '').trim(),
      phone: onlyDigits($('regPhone').value),
      birth_date,
      cpf: onlyDigits($('regCpf').value),
      password: $('regPassword').value || '',
      marketing_opt_in: Boolean($('regPromo')?.checked),
      privacy_accepted: Boolean($('regPrivacy')?.checked)
    };
  }

  function regFieldDef(id) {
    return REG_FIELDS.find(f => f.id === id);
  }
  function showRegFieldApiError(fieldId, msg) {
    const def = regFieldDef(fieldId);
    if (def) { setRegFieldError(def, msg); return true; }
    return false;
  }

  // Map backend register errors onto the right fields (or the form summary).
  function applyRegisterApiError(error) {
    const data = error?.data;
    let handled = false;

    // FastAPI-style validation array: [{ loc: ['body','email'], msg }]
    if (Array.isArray(data?.detail)) {
      const map = { name: 'regFullName', email: 'regEmail', phone: 'regPhone', birth_date: 'regBirth', cpf: 'regCpf', password: 'regPassword' };
      data.detail.forEach(item => {
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : '';
        if (map[field] && showRegFieldApiError(map[field], item.msg || 'Valor inválido')) handled = true;
      });
      if (handled) { showRegSummary('Revise os campos destacados'); return; }
    }

    const raw = apiErrorMessage(error, '');
    const msg = raw.toLowerCase();
    const dup = /(already|já|ja |cadastrad|registr|exist|in use|em uso|duplicad)/.test(msg);

    if ((msg.includes('email') || msg.includes('e-mail')) && dup) {
      showRegFieldApiError('regEmail', 'Este e-mail já está cadastrado'); handled = true;
    } else if ((msg.includes('phone') || msg.includes('telefone') || msg.includes('celular')) && dup) {
      showRegFieldApiError('regPhone', 'Este telefone já está cadastrado'); handled = true;
    } else if (msg.includes('cpf') && dup) {
      showRegFieldApiError('regCpf', 'Este CPF já está cadastrado'); handled = true;
    } else if (msg.includes('cpf')) {
      showRegFieldApiError('regCpf', 'CPF inválido'); handled = true;
    } else if (msg.includes('password') || msg.includes('senha')) {
      showRegFieldApiError('regPassword', raw || 'Senha inválida'); handled = true;
    } else if (msg.includes('privacy') || msg.includes('privacidade')) {
      showRegError('regPrivacyErr', 'É necessário aceitar a política de privacidade');
      handled = true;
    }

    showRegSummary(handled ? 'Revise os campos destacados' : (raw || 'Não foi possível concluir o cadastro.'));
  }

  let _registerSubmitting = false;
  async function submitRegister(event) {
    if (event) event.preventDefault();
    const firstInvalid = runRegisterValidation();
    if (firstInvalid) {
      const target = firstInvalid.closest('.reg-field') || firstInvalid.closest('.reg-check') || firstInvalid;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus({ preventScroll: true });
      return;
    }
    if (_registerSubmitting) return;
    _registerSubmitting = true;
    const btn = $('regSubmitBtn');
    const restore = () => { _registerSubmitting = false; if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); } };
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    try {
      const reg = buildRegisterPayload();
      const res = await window.PedeAquiCustomerService.registerCustomer(reg);
      // Do not auto-login. Move the user to e-mail verification.
      const email = res?.email || reg.email;
      restore();
      openVerifyScreen({ email, source: 'register', customer: { name: reg.name, email: reg.email, phone: reg.phone } });
    } catch (error) {
      applyRegisterApiError(error);
      restore();
    }
  }

  /* ---------- Code verification screen (e-mail verify + password reset) ---------- */

  let verifyCtx = { email: '', source: 'register', customer: null };
  let _vfyTimer = null;
  let _vfyRemaining = 0;
  let _vfySubmitting = false;
  const VFY_RESEND_SECONDS = 60;

  // 'cliente@email.com' -> 'c***@email.com'
  function maskEmail(email) {
    const s = String(email || '');
    const at = s.indexOf('@');
    if (at <= 0) return s;
    return `${s.slice(0, 1)}***${s.slice(at)}`;
  }

  const vfyDigits = () => Array.from(document.querySelectorAll('#vfyCode .vfy-digit'));
  const getVfyCode = () => vfyDigits().map(i => i.value).join('');

  function updateVfySubmitState() {
    const btn = $('vfySubmitBtn');
    if (btn) btn.disabled = getVfyCode().length !== 6;
  }
  function clearVfyInputs() {
    vfyDigits().forEach(i => { i.value = ''; i.classList.remove('filled'); });
    $('verifyScreen')?.classList.remove('vfy-error');
    updateVfySubmitState();
  }
  function showVfyMsg(msg, type) {
    const el = $('vfyMsg');
    if (!el) return;
    const textEl = el.querySelector('.vfy-msg-text') || el;
    textEl.textContent = msg || '';
    el.classList.remove('is-error', 'is-success', 'show');
    if (msg) el.classList.add('show', type === 'success' ? 'is-success' : 'is-error');
  }

  function openVerifyScreen(ctx) {
    verifyCtx = {
      email: ctx?.email || '',
      source: ctx?.source || 'register',
      customer: ctx?.customer || null
    };
    const isReset = verifyCtx.source === 'reset';
    const titleText = isReset ? 'Recuperar senha' : 'Validação de e-mail';
    if ($('vfyHeaderTitle')) $('vfyHeaderTitle').textContent = titleText;
    if ($('vfyText')) {
      $('vfyText').innerHTML = `Nós enviamos um código de 6 dígitos para <strong>${esc(maskEmail(verifyCtx.email))}</strong>. O código expira em alguns minutos, insira o código abaixo:`;
    }
    showVfyMsg('');
    clearVfyInputs();
    $('registerScreen')?.classList.remove('active');
    $('loginScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('verifyScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    startVfyTimer();
    setTimeout(() => vfyDigits()[0]?.focus(), 60);
  }

  function closeVerifyScreen() {
    stopVfyTimer();
    $('verifyScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    // Return to a sensible previous screen.
    if (verifyCtx.source === 'register') $('registerScreen')?.classList.add('active');
    else openModal('loginModal');
  }

  function handleVfyInput(el, index) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    el.classList.toggle('filled', Boolean(el.value));
    $('verifyScreen')?.classList.remove('vfy-error');
    showVfyMsg('');
    if (el.value && index < 5) vfyDigits()[index + 1]?.focus();
    updateVfySubmitState();
  }

  function handleVfyKeydown(event, index) {
    const inputs = vfyDigits();
    if (event.key === 'Backspace') {
      if (!inputs[index].value && index > 0) {
        const prev = inputs[index - 1];
        prev.focus();
        prev.value = '';
        prev.classList.remove('filled');
        event.preventDefault();
        updateVfySubmitState();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      inputs[index - 1].focus(); event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < 5) {
      inputs[index + 1].focus(); event.preventDefault();
    }
  }

  function handleVfyPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const digits = text.replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const inputs = vfyDigits();
    inputs.forEach((inp, i) => {
      inp.value = digits[i] || '';
      inp.classList.toggle('filled', Boolean(digits[i]));
    });
    inputs[Math.min(digits.length, 5)]?.focus();
    updateVfySubmitState();
  }

  function renderVfyTimer() {
    const btn = $('vfyResend');
    const hint = $('vfyResendHint');
    if (!btn) return;
    if (_vfyRemaining > 0) {
      const mm = String(Math.floor(_vfyRemaining / 60)).padStart(2, '0');
      const ss = String(_vfyRemaining % 60).padStart(2, '0');
      btn.textContent = `Reenviar código em ${mm}:${ss}`;
      if (hint) hint.style.display = 'none';
    } else {
      btn.textContent = 'Reenviar código';
      if (hint) hint.style.display = '';
    }
  }
  function stopVfyTimer() {
    if (_vfyTimer) { clearInterval(_vfyTimer); _vfyTimer = null; }
  }
  // A contagem já para ao fechar a tela de verificação; isto cobre o caso em
  // que a página some com ela ainda aberta.
  onTeardown(stopVfyTimer);
  function startVfyTimer() {
    stopVfyTimer();
    _vfyRemaining = VFY_RESEND_SECONDS;
    const btn = $('vfyResend');
    if (btn) btn.disabled = true;
    renderVfyTimer();
    _vfyTimer = setInterval(() => {
      _vfyRemaining -= 1;
      if (_vfyRemaining <= 0) {
        stopVfyTimer();
        if (btn) btn.disabled = false;
      }
      renderVfyTimer();
    }, 1000);
  }

  async function resendVfyCode() {
    const btn = $('vfyResend');
    if (btn?.disabled) return; // respect the running timer (no endpoint spam)
    try {
      if (verifyCtx.source === 'reset') {
        await window.PedeAquiCustomerAuth.forgotPassword({ email: verifyCtx.email });
      } else {
        await window.PedeAquiCustomerAuth.resendEmailCode({ email: verifyCtx.email });
      }
      // Sem mensagem de confirmação — apenas reinicia o timer.
      showVfyMsg('');
    } catch (error) {
      showVfyMsg(error?.message || 'Não foi possível reenviar o código.', 'error');
    }
    startVfyTimer();
  }

  async function submitVerify(event) {
    if (event) event.preventDefault();
    const code = getVfyCode();
    if (code.length !== 6) { updateVfySubmitState(); return; }
    if (_vfySubmitting) return;
    _vfySubmitting = true;
    const btn = $('vfySubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Validando...'; }
    try {
      if (verifyCtx.source === 'reset') {
        const res = await window.PedeAquiCustomerAuth.verifyResetCode({ email: verifyCtx.email, code });
        stopVfyTimer();
        $('verifyScreen')?.classList.remove('active');
        openResetPasswordScreen(res?.reset_token, verifyCtx.email);
      } else {
        const res = await window.PedeAquiCustomerAuth.verifyEmailCode({ email: verifyCtx.email, code });
        stopVfyTimer();
        const fallbackCustomer = verifyCtx.customer || { email: verifyCtx.email };
        const verifiedCustomer = customerFromAuthResponse(res, fallbackCustomer);
        const accessToken = tokenFromAuthResponse(res);
        if (accessToken) {
          applyLoggedSession(accessToken, verifiedCustomer);
          await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true });
        }
        else if (verifiedCustomer?.name || verifyCtx.source === 'register') applyLocalCustomer(verifiedCustomer);
        $('verifyScreen')?.classList.remove('active');
        goToInitialScreenAfterAuth();
      }
    } catch (error) {
      $('verifyScreen')?.classList.add('vfy-error');
      showVfyMsg('O código de verificação é inválido ou expirou!', 'error');
    } finally {
      _vfySubmitting = false;
      if (btn) btn.textContent = 'Validar código';
      updateVfySubmitState();
    }
  }

  /* ---------- New password screen (password reset step 3) ---------- */

  let resetPwCtx = { reset_token: '', email: '' };
  let _resetSubmitting = false;

  function openResetPasswordScreen(resetToken, email) {
    resetPwCtx = { reset_token: resetToken || '', email: email || '' };
    if ($('resetNewPw')) $('resetNewPw').value = '';
    if ($('resetConfirmPw')) $('resetConfirmPw').value = '';
    hideResetPwErr();
    $('resetPasswordScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    setTimeout(() => $('resetNewPw')?.focus(), 60);
  }
  function closeResetPasswordScreen() {
    $('resetPasswordScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    openModal('loginModal');
  }
  // Per-field error below each password input (same style as the register form).
  function showResetFieldErr(fieldId, errId, msg) {
    const e = $(errId);
    if (e) { e.textContent = msg; e.classList.add('show'); }
    $(fieldId)?.closest('.vfy-field')?.classList.add('vfy-field--error');
  }
  function hideResetPwErr() {
    [['resetNewPw', 'resetNewPwErr'], ['resetConfirmPw', 'resetConfirmPwErr']].forEach(([fieldId, errId]) => {
      const e = $(errId);
      if (e) { e.textContent = ''; e.classList.remove('show'); }
      $(fieldId)?.closest('.vfy-field')?.classList.remove('vfy-field--error');
    });
  }
  function handleResetPwInput() { hideResetPwErr(); }

  async function submitResetPassword(event) {
    if (event) event.preventDefault();
    const np = $('resetNewPw')?.value || '';
    const cp = $('resetConfirmPw')?.value || '';
    hideResetPwErr();
    if (np.length < 8) { showResetFieldErr('resetNewPw', 'resetNewPwErr', 'Informe ao menos 8 caracteres'); return; }
    if (np !== cp) { showResetFieldErr('resetConfirmPw', 'resetConfirmPwErr', 'As senhas não coincidem'); return; }
    if (_resetSubmitting) return;
    _resetSubmitting = true;
    const btn = $('resetPwSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      await window.PedeAquiCustomerAuth.resetPassword({ reset_token: resetPwCtx.reset_token, new_password: np, confirm_password: cp });
      const email = resetPwCtx.email;
      showVfyMsg('');
      openVfyAlert('Senha alterada com sucesso!', () => {
        $('resetPasswordScreen')?.classList.remove('active');
        openSigninScreen();
        if ($('loginEmail')) $('loginEmail').value = email;
        $('loginEmail')?.focus();
      }, 'Ok');
    } catch (error) {
      showResetFieldErr('resetConfirmPw', 'resetConfirmPwErr', error?.message || 'Não foi possível redefinir a senha.');
    } finally {
      _resetSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
    }
  }

  /* ---------- Login screen ("Entrar") ---------- */

  // Field-level validators for the sign-in form (same pattern as register).
  const LOGIN_FIELDS = [
    { id: 'loginEmail', err: 'loginEmailErr', validate(v) {
      const s = (v || '').trim();
      if (!s) return 'Campo obrigatório';
      // Accept either a valid e-mail or a phone number (the field allows both).
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
      const isPhone = /^\d{10,11}$/.test(onlyDigits(s));
      if (!isEmail && !isPhone) return 'Informe um e-mail ou telefone válido';
      return '';
    } },
    { id: 'loginPassword', err: 'loginPasswordErr', validate(v) {
      if (!v) return 'Campo obrigatório';
      if (v.length < 8) return 'Informe ao menos 8 caracteres';
      return '';
    } }
  ];

  const loginTouched = new Set();

  function setLgnFieldError(def, msg) {
    $(def.id)?.closest('.lgn-field')?.classList.add('lgn-field--error');
    const e = $(def.err);
    if (e) { e.textContent = msg; e.classList.add('show'); }
  }
  function clearLgnFieldError(def) {
    $(def.id)?.closest('.lgn-field')?.classList.remove('lgn-field--error');
    const e = $(def.err);
    if (e) { e.textContent = ''; e.classList.remove('show'); }
  }
  function clearAllLoginErrors() {
    LOGIN_FIELDS.forEach(clearLgnFieldError);
    hideLgnSummary(true);
    loginTouched.clear();
  }

  let _lgnSummaryTimer = null;
  function showLgnSummary(message) {
    const el = $('lgnSummary');
    if (!el) return;
    const msgSpan = el.querySelector('span:last-child');
    if (msgSpan) msgSpan.textContent = message || 'Dados de login incorretos. Verifique suas informações.';
    if (_lgnSummaryTimer) { clearTimeout(_lgnSummaryTimer); _lgnSummaryTimer = null; }
    el.classList.remove('hiding');
    el.classList.add('show');
    _lgnSummaryTimer = setTimeout(() => hideLgnSummary(), 5000);
  }
  function hideLgnSummary(immediate) {
    const el = $('lgnSummary');
    if (!el) return;
    if (_lgnSummaryTimer) { clearTimeout(_lgnSummaryTimer); _lgnSummaryTimer = null; }
    if (immediate || !el.classList.contains('show')) {
      el.classList.remove('show', 'hiding'); return;
    }
    el.classList.add('hiding');
    setTimeout(() => el.classList.remove('show', 'hiding'), 320);
  }
  function validateLoginField(id) {
    const def = LOGIN_FIELDS.find(f => f.id === id);
    if (!def || !loginTouched.has(id)) return;
    const msg = def.validate($(id)?.value);
    if (msg) setLgnFieldError(def, msg);
    else clearLgnFieldError(def);
  }
  function handleLoginFieldInput(id) {
    loginTouched.add(id);
    validateLoginField(id);
  }
  function handleLoginFieldBlur(id) {
    loginTouched.add(id);
    validateLoginField(id);
  }

  function openSigninScreen() {
    $('loginModal')?.classList.add('signin-open');
    $('loginScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    $('loginForm')?.scrollTo?.(0, 0);
    clearAllLoginErrors();
  }

  function closeSigninScreen() {
    $('loginScreen')?.classList.remove('active');
    $('loginModal')?.classList.remove('signin-open');
    syncAuthScreenOpenClass();
    unlockBodyScrollIfClear();
  }

  const isEmailValue = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

  /* ---------- Forgot password — step 1: dedicated "Redefina sua senha" screen ---------- */

  let _forgotSubmitting = false;

  // Open the recovery screen. Never auto-fill from the login form — the screen
  // always asks for the e-mail on its own page (an empty login field is fine).
  function loginForgotPassword() {
    openForgotPasswordScreen();
  }

  function openForgotPasswordScreen() {
    if ($('forgotEmail')) $('forgotEmail').value = '';
    hideForgotEmailErr();
    $('loginScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('forgotPasswordScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    setTimeout(() => $('forgotEmail')?.focus(), 60);
  }

  function closeForgotPasswordScreen() {
    $('forgotPasswordScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    openModal('loginModal');
  }

  function showForgotEmailErr(msg) {
    const el = $('forgotEmailErr');
    if (el) { el.textContent = msg; el.classList.add('show'); }
    $('forgotEmail')?.closest('.vfy-field')?.classList.add('vfy-field--error');
  }
  function hideForgotEmailErr() {
    const el = $('forgotEmailErr');
    if (el) { el.textContent = ''; el.classList.remove('show'); }
    $('forgotEmail')?.closest('.vfy-field')?.classList.remove('vfy-field--error');
  }
  function handleForgotEmailInput() { hideForgotEmailErr(); }

  let _vfyAlertAfterClose = null;

  // Card alert reused by password-recovery screens.
  function openVfyAlert(message, afterClose, buttonLabel = 'Tentar novamente') {
    const modal = $('forgotNotFoundModal');
    if (!modal) return;
    const title = $('forgotNotFoundTitle');
    if (title) title.textContent = message || 'Não foi possível continuar';
    const button = modal.querySelector('.vfy-alert-btn');
    if (button) button.textContent = buttonLabel;
    _vfyAlertAfterClose = typeof afterClose === 'function' ? afterClose : null;
    modal.classList.remove('closing');
    modal.classList.add('active');
    lockAuthScreenScroll();
  }

  // Card shown when the backend says the e-mail isn't registered.
  function openForgotNotFound() {
    openVfyAlert('E-mail não encontrado', () => $('forgotEmail')?.focus());
  }
  let _forgotNotFoundClosing = false;
  function closeForgotNotFound(event) {
    // When triggered from the overlay backdrop, ignore clicks on the card.
    if (event && event.target !== event.currentTarget) return;
    const modal = $('forgotNotFoundModal');
    if (!modal || !modal.classList.contains('active') || _forgotNotFoundClosing) return;
    // Play the slide-up/fade-out animation, then hide and return focus.
    _forgotNotFoundClosing = true;
    modal.classList.add('closing');
    setTimeout(() => {
      modal.classList.remove('active', 'closing');
      _forgotNotFoundClosing = false;
      const afterClose = _vfyAlertAfterClose;
      _vfyAlertAfterClose = null;
      if (afterClose) afterClose();
      unlockBodyScrollIfClear();
    }, 220);
  }

  async function submitForgotPassword(event) {
    if (event) event.preventDefault();
    const email = ($('forgotEmail')?.value || '').trim();
    // Client-side format check → inline error (does not call the backend).
    if (!email) { showForgotEmailErr('E-mail inválido'); return; }
    if (!isEmailValue(email)) { showForgotEmailErr('E-mail inválido'); return; }
    if (_forgotSubmitting) return;
    _forgotSubmitting = true;
    const btn = $('forgotSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
    try {
      // Backend verifies the e-mail exists. Success → advance to the code screen.
      await window.PedeAquiCustomerAuth.forgotPassword({ email });
      $('forgotPasswordScreen')?.classList.remove('active');
      openRecoverCodeScreen(email);
    } catch (error) {
      const detail = apiErrorMessage(error, '').toLowerCase();
      const notFound = error?.status === 404 || /não encontrad|nao encontrad|not found/.test(detail);
      if (notFound) {
        // E-mail not registered → show the "not found" card.
        openForgotNotFound();
      } else {
        // Other failures (network/server) → inline message, keep the user here.
        showForgotEmailErr('Não foi possível enviar o código. Tente novamente.');
      }
    } finally {
      _forgotSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
    }
  }

  /* ---------- Recover password — code step (own screen) ---------- */

  let recoverCtx = { email: '' };
  let _recSubmitting = false;
  let _recResendCooldown = false;

  const recDigits = () => Array.from(document.querySelectorAll('#recCode .vfy-digit'));
  const getRecCode = () => recDigits().map(i => i.value).join('');

  function updateRecSubmitState() {
    const btn = $('recSubmitBtn');
    if (btn) btn.disabled = getRecCode().length !== 6;
  }
  function clearRecInputs() {
    recDigits().forEach(i => { i.value = ''; i.classList.remove('filled'); });
    showRecMsg('');
    updateRecSubmitState();
  }
  function showRecMsg(msg, type) {
    const el = $('recMsg');
    if (!el) return;
    const textEl = el.querySelector('.vfy-msg-text') || el;
    textEl.textContent = msg || '';
    el.classList.remove('is-error', 'is-success', 'show');
    if (msg) el.classList.add('show', type === 'success' ? 'is-success' : 'is-error');
  }

  function openRecoverCodeScreen(email) {
    recoverCtx = { email: email || '' };
    if ($('recEmailText')) {
      $('recEmailText').innerHTML = `Um código foi enviado para o email <strong>${esc(recoverCtx.email)}</strong>.`;
    }
    clearRecInputs();
    $('forgotPasswordScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('recoverCodeScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    setTimeout(() => recDigits()[0]?.focus(), 60);
  }

  function closeRecoverCodeScreen() {
    $('recoverCodeScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    openForgotPasswordScreen();
  }

  function handleRecInput(el, index) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    el.classList.toggle('filled', Boolean(el.value));
    showRecMsg('');
    if (el.value && index < 5) recDigits()[index + 1]?.focus();
    updateRecSubmitState();
  }

  function handleRecKeydown(event, index) {
    const inputs = recDigits();
    if (event.key === 'Backspace') {
      if (!inputs[index].value && index > 0) {
        const prev = inputs[index - 1];
        prev.focus();
        prev.value = '';
        prev.classList.remove('filled');
        event.preventDefault();
        updateRecSubmitState();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      inputs[index - 1].focus(); event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < 5) {
      inputs[index + 1].focus(); event.preventDefault();
    }
  }

  function handleRecPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const digits = text.replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const inputs = recDigits();
    inputs.forEach((inp, i) => {
      inp.value = digits[i] || '';
      inp.classList.toggle('filled', Boolean(digits[i]));
    });
    inputs[Math.min(digits.length, 5)]?.focus();
    updateRecSubmitState();
  }

  async function resendRecoverCode() {
    if (_recResendCooldown) return;
    _recResendCooldown = true;
    setTimeout(() => { _recResendCooldown = false; }, 30000);
    try {
      await window.PedeAquiCustomerAuth.forgotPassword({ email: recoverCtx.email });
      showRecMsg('');
    } catch (error) {
      showRecMsg('Não foi possível reenviar o código.', 'error');
      _recResendCooldown = false;
    }
  }

  async function submitRecoverCode(event) {
    if (event) event.preventDefault();
    const code = getRecCode();
    if (code.length !== 6) { updateRecSubmitState(); return; }
    if (_recSubmitting) return;
    _recSubmitting = true;
    const btn = $('recSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Validando...'; }
    try {
      const res = await window.PedeAquiCustomerAuth.verifyResetCode({ email: recoverCtx.email, code });
      $('recoverCodeScreen')?.classList.remove('active');
      openResetPasswordScreen(res?.reset_token, recoverCtx.email);
    } catch (error) {
      openVfyAlert('O código de verificação expirou!', () => {
        clearRecInputs();
        recDigits()[0]?.focus();
      });
    } finally {
      _recSubmitting = false;
      if (btn) btn.textContent = 'Continuar';
      updateRecSubmitState();
    }
  }

  // Persist a successful login into both the shared auth store and the
  // existing in-page `customer` shape so the current UI keeps working.
  function applyLoggedSession(accessToken, apiCustomer) {
    window.PedeAquiCustomerAuth.saveSession({ access_token: accessToken, customer: apiCustomer });
    persistCustomer({
      id: apiCustomer?.id || null,
      name: apiCustomer?.name || '',
      phone: apiCustomer?.phone || '',
      email: apiCustomer?.email || ''
    });
    syncCartLocationState();
    loadCashbackForHome();
  }

  function applyLocalCustomer(apiCustomer) {
    persistCustomer({
      id: apiCustomer?.id || null,
      name: apiCustomer?.name || '',
      phone: apiCustomer?.phone || '',
      email: apiCustomer?.email || ''
    });
    window.PedeAquiCustomerAuth?.setStoredCustomer?.(apiCustomer);
    appState.profileLoaded = false;
    customerStore()?.set?.({ profileLoaded: false });
  }

  function tokenFromAuthResponse(res) {
    return res?.access_token || res?.token || res?.accessToken || res?.auth?.access_token || '';
  }

  function customerFromAuthResponse(res, fallback = {}) {
    return res?.customer || res?.user || res?.data?.customer || res?.data?.user || fallback;
  }

  function goToInitialScreenAfterAuth() {
    document.querySelectorAll('.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.vfy-screen.active').forEach(el => {
      el.classList.remove('active');
    });
    $('loginModal')?.classList.remove('signin-open');
    closeProfSub();
    renderHomeLoginPrompt();
    renderProfileView();
    showHomeTab();
    window.scrollTo(0, 0);
    setBottomNavSuppressedForAuth(false);
    unlockBodyScrollIfClear();
  }

  function finishLoginNavigation() {
    $('loginScreen')?.classList.remove('active');
    $('loginModal')?.classList.remove('signin-open');
    setBottomNavSuppressedForAuth(false);
    renderHomeLoginPrompt();
    updateCartUI();
    if (_loginOrigin === 'coupon') {
      closeModalId('loginModal');
      closeCouponDetail();
      selectedCoupon = null;
      selectedCouponPreview = null;
      couponPreviewKey = '';
      updateCartUI();
      clubController.invalidateCoupons();
      if ($('mobViewClub')?.classList.contains('active')) clubController.renderClubView({ force: true });
      return;
    }
    if (_loginOrigin === 'club') {
      closeModalId('loginModal');
      clubController.invalidateCoupons();
      mobNavClub();
      return;
    }
    closeModalId('loginModal');
    renderProfileView();
  }

  let _loginSubmitting = false;
  async function submitLogin(event) {
    if (event) event.preventDefault();
    let firstInvalid = null;
    LOGIN_FIELDS.forEach(def => {
      const input = $(def.id);
      if (!input) return;
      loginTouched.add(def.id);
      const msg = def.validate(input.value);
      if (msg) {
        setLgnFieldError(def, msg);
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearLgnFieldError(def);
      }
    });
    if (firstInvalid) {
      (firstInvalid.closest('.lgn-field') || firstInvalid).scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus({ preventScroll: true });
      return;
    }
    if (_loginSubmitting) return;
    _loginSubmitting = true;
    const btn = $('loginSubmitBtn');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    const rawLogin = ($('loginEmail').value || '').trim();
    const login = isEmailValue(rawLogin) ? rawLogin : onlyDigits(rawLogin);
    try {
      const res = await window.PedeAquiCustomerService.loginCustomer({ login, password: $('loginPassword').value || '' });
      // Unverified customer → route them to e-mail verification (not re-register).
      if (res?.requires_email_verification) {
        openVerifyScreen({ email: res.email || (isEmailValue(rawLogin) ? rawLogin : ''), source: 'login' });
        return;
      }
      if (res?.access_token) {
        applyLoggedSession(res.access_token, res.customer);
        await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true });
        finishLoginNavigation();
      } else {
        showLgnSummary('Dados de login incorretos. Verifique suas informações.');
      }
    } catch (error) {
      showLgnSummary('Dados de login incorretos. Verifique suas informações.');
    } finally {
      _loginSubmitting = false;
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    }
  }

  // Sync the logged customer against /customers/me; clear session on 401.
  async function syncCustomerSession() {
    const auth = window.PedeAquiCustomerAuth;
    if (!auth?.isLoggedIn()) return;
    const stored = auth.getStoredCustomer();
    if (stored && !customer) {
      persistCustomer({ id: stored.id || null, name: stored.name || '', phone: stored.phone || '', email: stored.email || '', birth_date: stored.birth_date || '' });
    }
    try {
      const me = await window.PedeAquiCustomerService.getCurrentCustomer();
      if (me) {
        persistCustomer({ id: me.id || null, name: me.name || '', phone: me.phone || '', email: me.email || '', birth_date: me.birth_date || '' });
        auth.setStoredCustomer(me);
        renderHomeLoginPrompt();
        renderProfileView();
        loadCashbackForHome();
        await synchronizeCustomerAddresses({ importLocal: true });
        requestDeliveryEstimate();
      }
    } catch (error) {
      if (error?.status === 401) {
        auth.logout();
        persistCustomer(null);
        appState.customerOrders = null;
        appState.customerAddresses = null;
        appState.profileLoaded = false;
        customerStore()?.clear?.();
        // persistCustomer(null) e auth.logout() já limparam a sessão: uma chave só.
        renderHomeLoginPrompt();
        renderProfileView();
        requestDeliveryEstimate();
        renderSharedCashbackState();
      } else {
        console.error('[PedeAqui] Falha ao sincronizar sessão ou endereços', error);
      }
    }
  }

  let _policyReturn = 'login';
  let _policyTouchStartY = 0;
  let _authSuppressedNav = null;
  let _authSuppressedNavParent = null;
  let _authSuppressedNavNext = null;

  const AUTH_SCREEN_SELECTOR = '.lgn-screen.active,.reg-screen.active,.vfy-screen.active,#forgotPasswordScreen.active,#recoverCodeScreen.active,#resetPasswordScreen.active';
  // As MESMAS telas, sem o `.active`. Uma é o ESTADO que interessa (tela de auth
  // aberta), a outra é o CONJUNTO a vigiar — os elementos existem o tempo todo,
  // só a classe entra e sai.
  const AUTH_SCREEN_ELEMENTS = '.lgn-screen,.reg-screen,.vfy-screen,#forgotPasswordScreen,#recoverCodeScreen,#resetPasswordScreen';
  function setBottomNavSuppressedForAuth(active) {
    const nav = _authSuppressedNav || $('mobBottomNav');
    document.body.classList.toggle('auth-screen-open', active);
    if (!nav) return;
    if (active) {
      if (nav.isConnected) {
        _authSuppressedNav = nav;
        _authSuppressedNavParent = nav.parentNode;
        _authSuppressedNavNext = nav.nextSibling;
        _authSuppressedNavParent?.removeChild(nav);
      }
      nav.style.setProperty('display', 'none', 'important');
      nav.style.setProperty('visibility', 'hidden', 'important');
      nav.style.setProperty('opacity', '0', 'important');
      nav.style.setProperty('pointer-events', 'none', 'important');
      nav.style.setProperty('transform', 'translateY(140%)', 'important');
      nav.style.setProperty('z-index', '-1', 'important');
      return;
    }
    if (_authSuppressedNav && !_authSuppressedNav.isConnected && _authSuppressedNavParent) {
      _authSuppressedNavParent.insertBefore(
        _authSuppressedNav,
        _authSuppressedNavNext?.parentNode === _authSuppressedNavParent ? _authSuppressedNavNext : null
      );
    }
    nav.style.removeProperty('display');
    nav.style.removeProperty('visibility');
    nav.style.removeProperty('opacity');
    nav.style.removeProperty('pointer-events');
    nav.style.removeProperty('transform');
    nav.style.removeProperty('z-index');
    _authSuppressedNav = null;
    _authSuppressedNavParent = null;
    _authSuppressedNavNext = null;
  }
  function syncAuthScreenOpenClass() {
    setBottomNavSuppressedForAuth(Boolean(document.querySelector(AUTH_SCREEN_SELECTOR)));
  }
  // C2 — o escopo do observer.
  //
  // Antes: `observe(document.body, { subtree: true })`. Isso pede ao browser um
  // MutationRecord para CADA mudança de class em QUALQUER um dos ~1,4 mil
  // elementos da página — aba trocada, chip de categoria, card em :active,
  // sticky do scroll — para checar seis seletores que só podem mudar em seis
  // elementos. O trabalho era proporcional ao tamanho da página; o interesse,
  // não.
  //
  // Agora: os seis elementos, sem subtree. Eles são markup ESTÁTICO do
  // restaurant.html (nenhum é criado em runtime — se um dia for, precisa entrar
  // em observeAuthScreens), e o script roda como módulo, ou seja, depois do
  // parse: todos já existem quando isto executa.
  const authScreenObserver = new MutationObserver(syncAuthScreenOpenClass);
  function observeAuthScreens() {
    const screens = document.querySelectorAll(AUTH_SCREEN_ELEMENTS);
    if (!screens.length) {
      // O markup mudou de nome debaixo do JS. Volta ao escopo largo: a barra
      // aparecendo por cima da tela de login é bug visível; o custo, não.
      authScreenObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
      return;
    }
    for (const screen of screens) {
      authScreenObserver.observe(screen, { attributes: true, attributeFilter: ['class'] });
    }
  }
  observeAuthScreens();
  onTeardown(() => authScreenObserver.disconnect());
  syncAuthScreenOpenClass();

  function policyScrollBody() {
    return $('privacyPolicyBody');
  }

  function handlePolicyTouchStart(event) {
    _policyTouchStartY = event.touches?.[0]?.clientY || 0;
  }

  function handlePolicyTouchMove(event) {
    const body = policyScrollBody();
    if (!body || !event.touches?.length) return;
    const currentY = event.touches[0].clientY;
    const deltaY = currentY - _policyTouchStartY;
    const atTop = body.scrollTop <= 0;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
    if (body.scrollHeight <= body.clientHeight || (atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
      event.preventDefault();
    }
  }

  function attachPolicyScrollGuard() {
    const screen = $('privacyPolicyScreen');
    if (!screen || screen.dataset.scrollGuardAttached === '1') return;
    screen.addEventListener('touchstart', handlePolicyTouchStart, { passive: true });
    screen.addEventListener('touchmove', handlePolicyTouchMove, { passive: false });
    screen.dataset.scrollGuardAttached = '1';
  }

  function detachPolicyScrollGuard() {
    const screen = $('privacyPolicyScreen');
    if (!screen || screen.dataset.scrollGuardAttached !== '1') return;
    screen.removeEventListener('touchstart', handlePolicyTouchStart);
    screen.removeEventListener('touchmove', handlePolicyTouchMove);
    delete screen.dataset.scrollGuardAttached;
  }

  function openPolicyScreen(type) {
    const screen = $('privacyPolicyScreen');
    const body = $('privacyPolicyBody');
    const loyaltyIntro = window.PEDEAQUI_LOYALTY_POLICY_HTML
      ? '<div class="policy-section-label">Programa de fidelidade, cashback e benefícios</div>'
      : '';
    const html = `${window.PEDEAQUI_PRIVACY_POLICY_HTML || ''}${loyaltyIntro}${window.PEDEAQUI_LOYALTY_POLICY_HTML || ''}`;
    if (!screen || !body) return;
    if (!body.innerHTML.trim()) body.innerHTML = html;
    // Remember which screen to return to when the policy screen closes.
    const fromRegister = $('registerScreen')?.classList.contains('active');
    const fromProfile = $('mobViewProfile')?.classList.contains('active');
    const fromLogin = $('loginModal')?.classList.contains('active') || $('loginScreen')?.classList.contains('active');
    _policyReturn = fromRegister ? 'register' : (fromProfile ? 'profile' : (fromLogin ? 'login' : 'app'));
    if (_policyReturn === 'login') {
      $('loginModal')?.classList.add('active');
      document.querySelector('#loginModal .modal--login')?.classList.add('policy-hidden');
    }
    document.querySelectorAll('.policy-screen').forEach(el => el.classList.remove('active'));
    document.body.classList.add('policy-open');
    document.body.classList.toggle('policy-from-profile', _policyReturn === 'profile');
    screen.classList.add('active');
    attachPolicyScrollGuard();
    lockAuthScreenScroll();
    body.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function closePolicyScreen(type) {
    $('privacyPolicyScreen')?.classList.remove('active');
    detachPolicyScrollGuard();
    document.body.classList.remove('policy-open');
    document.body.classList.remove('policy-from-profile');
    document.querySelector('#loginModal .modal--login')?.classList.remove('policy-hidden');
    // The register screen stays active underneath, so only restore the login modal.
    if (_policyReturn === 'login') $('loginModal')?.classList.add('active');
    if (_policyReturn === 'profile') {
      $('mobViewProfile')?.classList.add('active');
      setMobNavActive('mobNavProfile');
      setBottomNavSuppressedForAuth(false);
    }
    unlockBodyScrollIfClear();
  }

  function closeProfilePolicyBeforeNavigation() {
    if (_policyReturn !== 'profile' || !$('privacyPolicyScreen')?.classList.contains('active')) return;
    closePolicyScreen('privacy');
  }

  function showCouponNotice(message) {
    let notice = $('couponNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'couponNotice';
      notice.className = 'coupon-notice';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('is-visible');
    clearTimeout(showCouponNotice.timer);
    showCouponNotice.timer = setTimeout(() => notice.classList.remove('is-visible'), 3600);
  }

  function couponIdentity(coupon) {
    return String(coupon?.id ?? coupon?.coupon_id ?? coupon?.code ?? coupon?.coupon_code ?? '');
  }

  async function previewSelectedCoupon({ silent = false } = {}) {
    if (!selectedCoupon || !cart.length) return null;
    const totals = cartTotals();
    const key = [couponIdentity(selectedCoupon), totals.subtotal, totals.delivery, deliveryType].join(':');
    if (selectedCouponPreview && couponPreviewKey === key) return selectedCouponPreview;
    if (couponPreviewPromise && couponPreviewKey === key) return couponPreviewPromise;
    couponPreviewKey = key;
    const requestKey = key;
    couponPreviewPromise = window.PedeAquiClubService.previewCoupon({
      restaurantSlug: getRestaurantSlug(),
      couponId: selectedCoupon.id ?? selectedCoupon.coupon_id,
      couponCode: selectedCoupon.code || selectedCoupon.coupon_code,
      subtotal: totals.subtotal,
      deliveryFee: totals.delivery,
      orderType: deliveryType
    }).then(response => {
      if (couponPreviewKey !== requestKey) return response;
      selectedCouponPreview = response;
      updateCartUI();
      return response;
    }).catch(async error => {
      if (couponPreviewKey === requestKey) selectedCouponPreview = null;
      if (error?.status === 401) {
        await syncCustomerSession();
        if (!silent) openLoginScreen('coupon');
      } else if (!silent) {
        showCouponNotice('Não foi possível aplicar este cupom. Tente novamente.');
      }
      return null;
    }).finally(() => {
      if (couponPreviewKey === requestKey) couponPreviewPromise = null;
    });
    return couponPreviewPromise;
  }

  function couponLabel(coupon) {
    const type = String(coupon.discount_type || coupon.type || '').toLowerCase();
    const value = Number(coupon.discount_value ?? coupon.value ?? coupon.amount ?? 0);
    if (['percent', 'percentage'].includes(type)) return `${value.toLocaleString('pt-BR')}% OFF`;
    if (type === 'free_delivery' || type === 'free_shipping') return 'Frete grátis';
    if (value > 0) return `${fmt(value)} OFF`;
    return coupon.name || coupon.title || coupon.code || 'Cupom';
  }

  function couponRules(coupon) {
    const rules = [];
    const minimum = Number(coupon.min_order_value ?? coupon.minimum_order_value ?? coupon.min_subtotal ?? 0);
    const maximum = Number(coupon.max_discount ?? coupon.maximum_discount ?? coupon.max_discount_value ?? 0);
    if (minimum > 0) rules.push(`Em pedidos a partir de ${fmt(minimum)}`);
    if (coupon.expires_at || coupon.valid_until) rules.push(`Válido até ${coupon.expires_at || coupon.valid_until}`);
    if (maximum > 0) rules.push(`Desconto máximo de ${fmt(maximum)}`);
    if (coupon.description) rules.push(coupon.description);
    return rules;
  }

  function openCouponDetail(code, source) {
    const coupon = clubController.getCoupon(code)
      || coupons.find(c => [c.id, c.coupon_id, c.code, c.coupon_code].some(value => String(value) === String(code)));
    if (!coupon) return;
    selectedCoupon = coupon;
    document.body.classList.add('coupon-nav-keep');
    couponDetailScrollY = currentScrollY();
    lockBodyScroll(couponDetailScrollY, 'soft');
    const image = couponImageUrl(coupon);
    const label = couponLabel(coupon);
    const minText = Number(coupon.min_order_value) > 0 ? `Pedido mínimo ${fmt(coupon.min_order_value)}` : 'Sem mínimo informado';
    const art = $('couponDetailArt');
    if (art) {
      const fallbackMarkup = `<div class="coupon-detail-art-fallback"><span>Cupom</span><strong>${esc(label)}</strong></div>`;
      const preview = readyCardImage(source, '.coupon-card', '.coupon-art img')
        || readyCardImage(source, '.club-available-coupon-card', '.club-available-coupon-image');
      if (image) {
        renderDetailImage(art, {
          url: image,
          alt: coupon.name || coupon.title || label,
          className: 'coupon-detail-photo',
          fluid: COUPON_DETAIL_FLUID,
          preview,
          fallbackMarkup
        });
      } else {
        art.innerHTML = fallbackMarkup;
      }
    }
    if ($('couponDetailTitle')) $('couponDetailTitle').textContent = coupon.name || coupon.title || label;
    if ($('couponDetailCode')) $('couponDetailCode').textContent = coupon.code || 'CUPOM';
    if ($('couponDetailMin')) $('couponDetailMin').textContent = minText;
    const rules = $('couponDetailRules');
    if (rules) rules.innerHTML = couponRules(coupon).map(rule => `<li>${esc(rule)}</li>`).join('');
    $('couponDetailOverlay')?.classList.add('active');
  }

  function closeCouponDetail(event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    const restoreY = couponDetailScrollY;
    const overlay = $('couponDetailOverlay');
    overlay?.classList.remove('active');
    document.body.classList.remove('coupon-nav-keep');
    setTimeout(() => {
      if (!hasBlockingUiOpen()) unlockBodyScroll(restoreY);
    }, 560);
  }

  async function confirmCouponDetail() {
    if (!selectedCoupon) return;
    if (selectedCoupon.requires_login === true && !isLogged()) {
      openLoginScreen('coupon');
      return;
    }
    selectedCouponPreview = null;
    couponPreviewKey = '';
    if (!cart.length) {
      cartStore()?.set?.({ coupon: selectedCoupon, couponPreview: null });
      closeCouponDetail();
      await mobNavMenu();
      showCouponNotice('Cupom selecionado. Adicione produtos à sacola para usar.');
      return;
    }
    const button = document.querySelector('.coupon-detail-use');
    if (button) {
      button.disabled = true;
      button.textContent = 'Validando...';
    }
    const preview = await previewSelectedCoupon();
    if (button) {
      button.disabled = false;
      button.textContent = 'Usar cupom';
    }
    if (!preview) return;
    closeCouponDetail();
    showCouponNotice(`Cupom aplicado. Desconto de ${fmt(couponDiscountAmount())}.`);
  }

  function useCoupon(code) {
    openCouponDetail(code);
  }

  function handleBannerAction(type, value) {
    if (type === 'category' && value) {
      scrollToMenu();
      setTimeout(() => scrollToCategory(value, findCategoryButton(value)), 250);
      return;
    }
    scrollToMenu();
  }

  const MOB_VIEWS = ['mobViewClub', 'mobViewAssistant', 'mobViewProfile'];
  let secondaryCartBottomOffset = null;

  function preserveSecondaryNavGeometry() {
    const nav = $('mobBottomNav');
    if (!nav) return;
    const style = getComputedStyle(nav);
    const height = nav.getBoundingClientRect().height;
    if (!height) return;
    nav.style.setProperty('box-sizing', 'border-box', 'important');
    nav.style.setProperty('height', `${height}px`, 'important');
    nav.style.setProperty('min-height', `${height}px`, 'important');
    nav.style.setProperty('max-height', `${height}px`, 'important');
    nav.style.setProperty('padding', style.padding, 'important');
    const sticky = $('cartSticky');
    if (sticky?.classList.contains('show')) {
      const bottom = sticky.getBoundingClientRect().bottom;
      secondaryCartBottomOffset = Math.max(0, window.innerHeight - bottom);
    }
  }

  function releaseSecondaryNavGeometry() {
    const nav = $('mobBottomNav');
    if (!nav) return;
    ['box-sizing', 'height', 'min-height', 'max-height', 'padding'].forEach(property => nav.style.removeProperty(property));
    secondaryCartBottomOffset = null;
  }

  function syncSecondaryViewCartSticky(forceActive) {
    const sticky = $('cartSticky');
    if (!sticky) return;
    const secondaryViewActive = forceActive ?? Boolean(
      $('mobViewClub')?.classList.contains('active') || $('mobViewProfile')?.classList.contains('active')
    );
    const cartCount = cart.reduce((total, item) => total + Number(item.qty || 0), 0);
    const renderedCartCount = Number($('cartCountSticky')?.dataset.count || $('cartCountSticky')?.textContent || 0);
    const hasCartItems = cartCount > 0 || renderedCartCount > 0;
    const shouldFloat = secondaryViewActive && hasCartItems;
    document.body.classList.toggle('secondary-view-cart-visible', shouldFloat);
    const properties = ['display', 'visibility', 'opacity', 'z-index', 'bottom'];
    if (!shouldFloat) {
      properties.forEach(property => sticky.style.removeProperty(property));
      return;
    }
    sticky.classList.add('show');
    sticky.style.setProperty('display', 'flex', 'important');
    sticky.style.setProperty('visibility', 'visible', 'important');
    sticky.style.setProperty('opacity', '1', 'important');
    sticky.style.removeProperty('z-index');
    const navHeight = $('mobBottomNav')?.getBoundingClientRect().height;
    const bottomOffset = secondaryCartBottomOffset ?? navHeight;
    if (bottomOffset) sticky.style.setProperty('bottom', `${bottomOffset}px`, 'important');
  }

  function closeMobViews() {
    MOB_VIEWS.forEach(id => $(id)?.classList.remove('active'));
    document.body.classList.remove('assistant-nav-keep');
    syncSecondaryViewCartSticky(false);
    releaseSecondaryNavGeometry();
    unlockBodyScrollIfClear();
  }

  // O botão do assistente NÃO é .mob-nav-item: ele é o círculo central, que tem
  // geometria própria. Sem incluí-lo aqui, ele ficava com .active para sempre —
  // limpar só os irmãos deixava o destaque aceso em todas as outras abas.
  function setMobNavActive(id) {
    document.querySelectorAll('.mob-nav-item, .mob-nav-assistant-btn')
      .forEach(b => b.classList.remove('active'));
    $(id)?.classList.add('active');
  }

  let _pendingMenuNav = false;
  let _assistantReturnNav = 'home';

  function getCurrentBottomNav() {
    if ($('mobNavAssistantTab')?.classList.contains('active')) return 'assistant';
    if ($('mobNavMenu')?.classList.contains('active')) return 'menu';
    if ($('mobNavOrders')?.classList.contains('active')) return 'club';
    if ($('mobNavProfile')?.classList.contains('active')) return 'profile';
    return 'home';
  }

  async function mobNavMenu() {
    closeProfilePolicyBeforeNavigation();
    if (!operationConfirmed) {
      _pendingMenuNav = true;
      openOperationScreen(true); // immediate = sem animacao de entrada
      return;
    }
    const returningToVisibleMenu = document.body.classList.contains('menu-tab')
      && Boolean(document.querySelector('.mob-view.active'));
    const menuScrollY = returningToVisibleMenu ? currentScrollY() : 0;
    closeMobViews();
    showMenuTab();
    if (returningToVisibleMenu) holdMenuScrollPosition(menuScrollY, 360);
    else jumpToTop();
    await ensureMenuLoaded();
  }

  function mobNavHome() {
    closeProfilePolicyBeforeNavigation();
    scrollToHome();
  }

  async function mobNavAssistant() {
    closeProfilePolicyBeforeNavigation();
    const currentNav = getCurrentBottomNav();
    const shouldFocusAssistantInput = currentNav !== 'assistant';
    if (currentNav !== 'assistant') _assistantReturnNav = currentNav;
    closeMobViews();
    uiStore()?.set?.({ activeView: 'assistant', bottomNav: 'assistant' });
    setMobNavActive('mobNavAssistantTab');
    $('mobViewAssistant')?.classList.add('active');
    document.body.classList.add('assistant-nav-keep');
    lockBodyScroll();
    if (!products.length || !categories.length) {
      const view = $('mobViewAssistant');
      if (view) view.innerHTML = '<div class="assistant-preparing-loader">Preparando sugestões...</div>';
      await ensureMenuLoaded();
    }
    if (window.renderAssistantView) window.renderAssistantView({ deferIntro: shouldFocusAssistantInput });
    if (shouldFocusAssistantInput) {
      requestAnimationFrame(() => {
        const input = $('assistantInput');
        if ($('mobViewAssistant')?.classList.contains('active')) {
          input?.focus?.({ preventScroll: true });
        }
      });
    }
  }

  function assistantGoBack() {
    mobNavHome();
  }

  async function mobNavClub() {
    closeProfilePolicyBeforeNavigation();
    if (!isLogged()) {
      openLoginScreen('club');
      return;
    }
    setMobNavActive('mobNavOrders');
    closeMobViews();
    preserveSecondaryNavGeometry();
    uiStore()?.set?.({ activeView: 'club', bottomNav: 'club' });
    $('mobViewClub')?.classList.add('active');
    syncSecondaryViewCartSticky(true);
    await clubController.renderClubView();
  }

  function renderProfileLoading() {
    const box = $('profileIdentity');
    if (box) {
      box.innerHTML = '<div class="profile-skeleton">Carregando conta...</div>';
    }
  }

  async function loadProfileData() {
    if (!isLogged()) return null;
    if (appState.profileLoaded) return {
      customer: appState.customer,
      addresses: appState.customerAddresses,
      orders: appState.customerOrders
    };
    if (profileLoadPromise) return profileLoadPromise;
    setLoading('profile', true);
    profileLoadPromise = (async () => {
      const auth = window.PedeAquiCustomerAuth;
      if (!window.PedeAquiCustomerService?.isLoggedIn?.()) return null;
      try {
        const [profileResults] = await Promise.all([
          Promise.allSettled([
            window.PedeAquiCustomerService.getCurrentCustomer(),
            window.PedeAquiAddressService.getCustomerAddresses(),
            window.PedeAquiOrderService.getCustomerOrders()
          ]),
          wait(TAB_LOADER_MIN_MS)
        ]);
        const [meResult, addressesResult, ordersResult] = profileResults;
        const rejected = [meResult, addressesResult, ordersResult].find(result => result.status === 'rejected');
        if (rejected?.reason?.status === 401) {
          await syncCustomerSession();
          return null;
        }
        if (rejected) logAppError('Falha parcial ao carregar perfil', rejected.reason);
        if (meResult.status === 'fulfilled' && meResult.value) {
          const me = meResult.value;
          persistCustomer({ id: me.id || null, name: me.name || '', phone: me.phone || '', email: me.email || '', birth_date: me.birth_date || '' });
          auth?.setStoredCustomer?.(me);
        }
        if (addressesResult.status === 'fulfilled') {
          const value = addressesResult.value;
          appState.customerAddresses = Array.isArray(value) ? value : (value?.addresses || value?.items || value?.data || []);
          customerStore()?.setAddresses?.(appState.customerAddresses);
        }
        if (ordersResult.status === 'fulfilled') {
          const value = ordersResult.value;
          appState.customerOrders = Array.isArray(value) ? value : (value?.orders || value?.items || value?.data || []);
          customerStore()?.setOrders?.(appState.customerOrders);
        }
        appState.profileLoaded = true;
        customerStore()?.set?.({ profileLoaded: true });
        return {
          customer: appState.customer,
          addresses: appState.customerAddresses,
          orders: appState.customerOrders
        };
      } catch (error) {
        appState.profileLoaded = false;
        if (error?.status === 401) await syncCustomerSession();
        else logAppError('Falha ao carregar perfil', error);
        return null;
      } finally {
        setLoading('profile', false);
        profileLoadPromise = null;
      }
    })();
    return profileLoadPromise;
  }

  async function mobNavProfile() {
    closeProfilePolicyBeforeNavigation();
    if (!isLogged()) {
      openLoginScreen('profile');
      return;
    }
    setMobNavActive('mobNavProfile');
    closeMobViews();
    preserveSecondaryNavGeometry();
    uiStore()?.set?.({ activeView: 'profile', bottomNav: 'profile' });
    $('mobViewProfile')?.classList.add('active');
    syncSecondaryViewCartSticky(true);
    if (!appState.profileLoaded) renderProfileLoading();
    await loadProfileData();
    renderProfileView();
  }

  function renderProfileView() {
    const hub = $('profHubWrap');
    const profileCustomer = currentCustomerSnapshot();
    if (hub && isLogged()) {
      hub.innerHTML = renderLoggedProfileHub(profileCustomer);
    } else if (hub) {
      hub.innerHTML = renderGuestProfileHub();
    }
    const identityBox = $('profileIdentity');
    if (identityBox) {
      identityBox.innerHTML = isLogged()
        ? `<div class="prof-hero-label">${esc(profileCustomer?.name || '')}</div><div class="prof-hero-sub">Cliente identificado</div>`
        : `<div class="prof-hero-label">${esc(restaurant.name || fallback().restaurantName || '')}</div><div class="prof-hero-sub">Entre para acessar promo&ccedil;&otilde;es e pedidos</div><button class="profile-login-btn" ${act('click', 'openLoginScreen')}>Entrar ou cadastrar</button>`;
    }
    const logoutGroup = $('profLogoutGroup');
    showEl(logoutGroup, isLogged());
  }

  function renderGuestProfileHub() {
    return `
      <div class="prof-hero">
        <div class="prof-hero-avatar">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M5 21c.7-4.4 3.2-6.6 7-6.6s6.3 2.2 7 6.6"/></svg>
        </div>
        <div id="profileIdentity"></div>
      </div>
      <div class="prof-options-group">
        <button class="prof-option-row" ${act('click', 'openProfSub', 'info')}><div class="prof-option-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></div><div><div class="prof-option-title">Informa&ccedil;&otilde;es do restaurante</div><div class="prof-option-desc">Endere&ccedil;os, hor&aacute;rios e contato</div></div></button>
        <button class="prof-option-row" ${act('click', 'openLoginScreen')}><div class="prof-option-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg></div><div><div class="prof-option-title">Entrar ou cadastrar</div><div class="prof-option-desc">Acesse promo&ccedil;&otilde;es e pedidos</div></div></button>
      </div>
    `;
  }
  function profileMenuIcon(name) {
    const icons = {
      user: '<circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 20c.8-4.2 3-6.3 6.5-6.3s5.7 2.1 6.5 6.3"/>',
      receipt: '<path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2Z"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/><path d="M9.5 16h3"/>',
      pin: '<path d="M18 10c0 4.5-6 10-6 10s-6-5.5-6-10a6 6 0 1 1 12 0Z"/><circle cx="12" cy="10" r="2"/>',
      doc: '<path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v5h5"/><path d="M9.5 12h5"/><path d="M9.5 16h5"/>',
      help: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m6.4 6.4 3.5 3.5M14.1 14.1l3.5 3.5M17.6 6.4l-3.5 3.5M9.9 14.1l-3.5 3.5"/>',
      exit: '<path d="M9 5H5v14h4"/><path d="M13 16l4-4-4-4"/><path d="M17 12H8"/>'
    };
    return `<svg class="prof-account-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.doc}</svg>`;
  }

  function renderLoggedProfileHub(profileCustomer) {
    const displayName = firstName(profileCustomer?.name || customer?.name || '').toUpperCase() || 'CLIENTE';
    // `action` deixou de ser um trecho de JS costurado no onclick e passou a ser
    // [nome, ...argumentos] — o que o despachante sabe resolver sem eval.
    const row = (icon, label, action, extra = '') => `
      <button class="prof-account-row ${extra}" type="button" ${act('click', ...action)}>
        <span class="prof-account-row-icon">${profileMenuIcon(icon)}</span>
        <span class="prof-account-row-label">${label}</span>
      </button>
    `;
    return `
      <section class="prof-account-page" aria-label="Perfil">
        <div class="prof-account-header">
          <span class="prof-account-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="3.2"/><path d="M5.8 20c.8-4.2 3-6.2 6.2-6.2s5.4 2 6.2 6.2"/>
            </svg>
          </span>
          <h1>Ol&aacute;, ${esc(displayName)}!</h1>
        </div>
        <nav class="prof-account-list" aria-label="Op&ccedil;&otilde;es da conta">
          ${row('user', 'Gerenciar perfil', ['openProfSub', 'meusdados'])}
          ${row('receipt', 'Meus pedidos', ['openProfSub', 'pedidos'])}
          ${row('pin', 'Meus endere&ccedil;os', ['openAddrPicker', 'profile'])}
          ${row('doc', 'Pol&iacute;tica de privacidade', ['openPolicyScreen', 'privacy'])}
          ${row('help', 'Ajuda', ['openProfSub', 'ajuda'])}
          ${row('exit', 'Sair', ['logout'], 'prof-account-row--logout')}
        </nav>
      </section>
    `;
  }
  let _logoutConfirmCloseTimer = null;
  function setLogoutConfirm(open) {
    const confirm = $('logoutConfirm');
    if (!confirm) return;
    if (_logoutConfirmCloseTimer) {
      clearTimeout(_logoutConfirmCloseTimer);
      _logoutConfirmCloseTimer = null;
    }
    if (open) {
      document.body.classList.add('logout-confirm-open');
      setAccessibleDialogState(confirm, true, '.addr-delete-cancel');
      return;
    }
    setAccessibleDialogState(confirm, false);
    _logoutConfirmCloseTimer = setTimeout(() => {
      document.body.classList.remove('logout-confirm-open');
      _logoutConfirmCloseTimer = null;
    }, 920);
  }

  function closeLogoutConfirm() {
    setLogoutConfirm(false);
  }

  function cancelLogout() {
    closeLogoutConfirm();
  }

  function logout() {
    if (!isLogged()) return;
    setLogoutConfirm(true);
  }

  function confirmLogout() {
    closeLogoutConfirm();
    if ($('appLoaderTitle')) $('appLoaderTitle').textContent = 'Carregando restaurante';
    if ($('appLoaderMessage')) $('appLoaderMessage').textContent = 'Preparando sua experiência.';
    setAppBooting(true);
    persistCustomer(null);
    appState.customerOrders = null;
    appState.customerAddresses = null;
    appState.profileLoaded = false;
    customerStore()?.clear?.();
    window.PedeAquiCustomerAuth?.logout();
    renderSharedCashbackState();
    setTimeout(() => {
      closeProfSub();
      closeMobViews();
      document.querySelectorAll('.overlay.active,.lgn-screen.active,.reg-screen.active,.vfy-screen.active').forEach(el => {
        el.classList.remove('active');
      });
      $('loginModal')?.classList.remove('signin-open');
      renderHomeLoginPrompt();
      renderProfileView();
      updateCartUI();
      showHomeTab();
      setMobNavActive('mobNavHome');
      window.scrollTo(0, 0);
      setBottomNavSuppressedForAuth(false);
      unlockBodyScrollIfClear();
      setAppBooting(false);
    }, 550);
  }

  let customerDataSubmitting = false;
  let customerDataLoading = false;
  const CUSTOMER_DATA_FIELDS = {
    name: ['profDataNameField', 'profDataNameError'],
    email: ['profDataEmailField', 'profDataEmailError'],
    birth: ['profDataBirthField', 'profDataBirthError'],
    phone: ['profDataPhoneField', 'profDataPhoneError']
  };

  function setCustomerDataFieldError(field, message = '') {
    const [fieldId, errorId] = CUSTOMER_DATA_FIELDS[field] || [];
    $(fieldId)?.classList.toggle('has-error', Boolean(message));
    if ($(errorId)) $(errorId).textContent = message;
  }
  function setCustomerDataStatus(message = '', tone = '') {
    const status = $('profDataStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('success', tone === 'success');
    status.classList.toggle('error', tone === 'error');
  }
  function formatCustomerBirthDate(value) {
    const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }
  function customerBirthDateToIso(value) {
    const digits = onlyDigits(value);
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  function fillCustomerDataForm(data) {
    if ($('profDataName')) $('profDataName').value = data?.name || '';
    if ($('profDataEmail')) $('profDataEmail').value = data?.email || '';
    if ($('profDataBirth')) { $('profDataBirth').value = formatCustomerBirthDate(data?.birth_date); if ($('profDataBirth').value) maskRegBirth($('profDataBirth')); }
    if ($('profDataPhone')) { $('profDataPhone').value = data?.phone || ''; if ($('profDataPhone').value) maskRegPhone($('profDataPhone')); }
  }
  function resetCustomerDataFeedback() {
    Object.keys(CUSTOMER_DATA_FIELDS).forEach(field => setCustomerDataFieldError(field));
    setCustomerDataStatus();
  }
  function redirectCustomerDataToLogin() {
    window.PedeAquiCustomerAuth?.logout?.();
    persistCustomer(null);
    customerStore()?.clear?.();
    releaseFocusFrom($('profDataScreen'));
    $('profDataScreen')?.classList.remove('active');
    $('profDataScreen')?.setAttribute('aria-hidden', 'true');
    $('profDataBackdrop')?.classList.remove('active');
    $('profDataBackdrop')?.setAttribute('aria-hidden', 'true');
    closeProfSub();
    renderHomeLoginPrompt();
    renderProfileView();
    openLoginScreen();
  }
  async function openCustomerDataScreen() {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) { openLoginScreen(); return; }
    const screen = $('profDataScreen');
    const backdrop = $('profDataBackdrop');
    resetCustomerDataFeedback();
    fillCustomerDataForm(currentCustomerSnapshot());
    backdrop?.classList.add('active');
    backdrop?.setAttribute('aria-hidden', 'false');
    if (screen) {
      void screen.offsetWidth;
      screen.classList.add('active');
      screen.setAttribute('aria-hidden', 'false');
    }
    if (customerDataLoading) return;
    customerDataLoading = true;
    try {
      const me = await window.PedeAquiCustomerService.getCurrentCustomer();
      if (!me) throw new Error('Não foi possível carregar seus dados');
      persistCustomer(me);
      window.PedeAquiCustomerAuth?.setStoredCustomer?.(me);
      fillCustomerDataForm(me);
    } catch (error) {
      if (error?.status === 401) { redirectCustomerDataToLogin(); return; }
      setCustomerDataStatus('Não foi possível carregar seus dados. Tente novamente.', 'error');
    } finally {
      customerDataLoading = false;
    }
  }
  function closeCustomerDataScreen() {
    if (customerDataSubmitting) return;
    releaseFocusFrom($('profDataScreen'));
    $('profDataScreen')?.classList.remove('active');
    $('profDataScreen')?.setAttribute('aria-hidden', 'true');
    $('profDataBackdrop')?.classList.remove('active');
    $('profDataBackdrop')?.setAttribute('aria-hidden', 'true');
    resetCustomerDataFeedback();
  }
  function handleCustomerDataInput(field) { setCustomerDataFieldError(field); setCustomerDataStatus(); }
  function validateCustomerDataForm() {
    const name = ($('profDataName')?.value || '').trim();
    const email = ($('profDataEmail')?.value || '').trim();
    const phone = onlyDigits($('profDataPhone')?.value || '');
    const birth = $('profDataBirth')?.value || '';
    resetCustomerDataFeedback();
    let valid = true;
    if (!name) { setCustomerDataFieldError('name', 'Campo obrigatório'); valid = false; }
    if (!email) { setCustomerDataFieldError('email', 'Campo obrigatório'); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setCustomerDataFieldError('email', 'E-mail inválido'); valid = false; }
    if (!phone) { setCustomerDataFieldError('phone', 'Campo obrigatório'); valid = false; }
    else if (phone.length < 10 || phone.length > 11) { setCustomerDataFieldError('phone', 'Informe o telefone completo'); valid = false; }
    if (!onlyDigits(birth)) { setCustomerDataFieldError('birth', 'Campo obrigatório'); valid = false; }
    else if (!isValidBirthDate(birth)) { setCustomerDataFieldError('birth', 'O formato deve ser DD/MM/AAAA'); valid = false; }
    return valid ? { name, email, phone, birth_date: customerBirthDateToIso(birth) } : null;
  }
  function customerDataApiMessage(error) {
    return apiErrorMessage(error, 'Não foi possível atualizar seus dados');
  }
  async function submitCustomerData(event) {
    event?.preventDefault();
    if (customerDataSubmitting || customerDataLoading) return;
    if (!window.PedeAquiCustomerAuth?.getToken?.()) { redirectCustomerDataToLogin(); return; }
    const payload = validateCustomerDataForm();
    if (!payload) return;
    const submit = $('profDataSubmit');
    customerDataSubmitting = true;
    let updatedSuccessfully = false;
    if (submit) { submit.disabled = true; submit.classList.add('is-loading'); }
    try {
      const response = await window.PedeAquiCustomerService.updateCurrentCustomer(payload);
      const updated = { ...currentCustomerSnapshot(), ...payload, ...(response || {}) };
      persistCustomer(updated);
      window.PedeAquiCustomerAuth?.setStoredCustomer?.(updated);
      fillCustomerDataForm(updated);
      renderHomeLoginPrompt();
      renderProfileView();
      updatedSuccessfully = true;
    } catch (error) {
      if (error?.status === 401) { redirectCustomerDataToLogin(); return; }
      const message = customerDataApiMessage(error);
      const normalized = message.toLocaleLowerCase('pt-BR');
      const duplicate = error?.status === 409 || /já|ja |already|exist|em uso|in use|duplicad/.test(normalized);
      const emailInUse = duplicate && /email|e-mail/.test(normalized);
      const phoneInUse = duplicate && /phone|telefone|celular/.test(normalized);
      if (emailInUse) { setCustomerDataFieldError('email', 'Este e-mail já está em uso'); setCustomerDataStatus('Este e-mail já está em uso', 'error'); }
      else if (phoneInUse) { setCustomerDataFieldError('phone', 'Este telefone já está em uso'); setCustomerDataStatus('Este telefone já está em uso', 'error'); }
      else if (error?.status === 409) setCustomerDataStatus('Este e-mail ou telefone já está em uso', 'error');
      else setCustomerDataStatus(message, 'error');
    } finally {
      customerDataSubmitting = false;
      if (submit) { submit.disabled = false; submit.classList.remove('is-loading'); }
      if (updatedSuccessfully) closeCustomerDataScreen();
    }
  }
  let customerPasswordSubmitting = false;

  const CUSTOMER_PASSWORD_FIELDS = {
    current: ['profCurrentPasswordField', 'profCurrentPasswordError'],
    new: ['profNewPasswordField', 'profNewPasswordError'],
    confirm: ['profConfirmPasswordField', 'profConfirmPasswordError']
  };

  function setCustomerPasswordFieldError(field, message = '') {
    const [fieldId, errorId] = CUSTOMER_PASSWORD_FIELDS[field] || [];
    const wrapper = $(fieldId);
    const error = $(errorId);
    wrapper?.classList.toggle('has-error', Boolean(message));
    if (error) error.textContent = message;
  }

  function hideCustomerPasswordSummary() {
    const summary = $('profPasswordSummary');
    if (!summary) return;
    summary.classList.remove('show', 'success');
    const text = summary.querySelector('.prof-password-summary-text');
    if (text) text.textContent = '';
  }

  function showCustomerPasswordSummary(message, success = false) {
    const summary = $('profPasswordSummary');
    if (!summary) return;
    const text = summary.querySelector('.prof-password-summary-text');
    if (text) text.textContent = message;
    summary.classList.toggle('success', success);
    summary.classList.add('show');
  }

  function resetCustomerPasswordForm() {
    $('profPasswordForm')?.reset();
    Object.keys(CUSTOMER_PASSWORD_FIELDS).forEach(field => setCustomerPasswordFieldError(field));
    hideCustomerPasswordSummary();
    document.querySelectorAll('#profPasswordScreen .prof-password-input-wrap button').forEach(button => {
      button.innerHTML = EYE_OFF_SVG;
      button.setAttribute('aria-label', 'Mostrar senha');
    });
    ['profCurrentPassword', 'profNewPassword', 'profConfirmPassword'].forEach(id => {
      const input = $(id);
      if (input) input.type = 'password';
    });
  }

  function openCustomerPasswordScreen() {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) {
      openLoginScreen();
      return;
    }
    resetCustomerPasswordForm();
    const screen = $('profPasswordScreen');
    screen?.classList.add('active');
    screen?.setAttribute('aria-hidden', 'false');
  }

  function closeCustomerPasswordScreen() {
    if (customerPasswordSubmitting) return;
    const screen = $('profPasswordScreen');
    releaseFocusFrom(screen);
    screen?.classList.remove('active');
    screen?.setAttribute('aria-hidden', 'true');
    resetCustomerPasswordForm();
  }

  function handleCustomerPasswordInput(field) {
    setCustomerPasswordFieldError(field);
    hideCustomerPasswordSummary();
  }

  function customerPasswordApiMessage(error) {
    const message = apiErrorMessage(error, 'Não foi possível alterar a senha');
    const normalized = String(message).toLocaleLowerCase('pt-BR');
    if (normalized.includes('senha atual') && (normalized.includes('incorret') || normalized.includes('invalid'))) {
      return 'Senha atual incorreta';
    }
    if (normalized.includes('não confer') || normalized.includes('nao confer') || normalized.includes('não coinc') || normalized.includes('nao coinc')) {
      return 'As senhas não conferem';
    }
    return String(message);
  }

  async function submitCustomerPassword(event) {
    event?.preventDefault();
    if (customerPasswordSubmitting) return;
    const currentPassword = $('profCurrentPassword')?.value || '';
    const newPassword = $('profNewPassword')?.value || '';
    const confirmPassword = $('profConfirmPassword')?.value || '';
    Object.keys(CUSTOMER_PASSWORD_FIELDS).forEach(field => setCustomerPasswordFieldError(field));
    hideCustomerPasswordSummary();
    let valid = true;
    if (!currentPassword) {
      setCustomerPasswordFieldError('current', 'Campo obrigatório');
      valid = false;
    }
    if (!newPassword) {
      setCustomerPasswordFieldError('new', 'Campo obrigatório');
      valid = false;
    } else if (newPassword.length < 8) {
      setCustomerPasswordFieldError('new', 'Informe ao menos 8 caracteres');
      valid = false;
    }
    if (!confirmPassword) {
      setCustomerPasswordFieldError('confirm', 'Campo obrigatório');
      valid = false;
    } else if (newPassword !== confirmPassword) {
      setCustomerPasswordFieldError('confirm', 'As senhas não conferem');
      valid = false;
    }
    if (!valid) return;
    const submit = $('profPasswordSubmit');
    customerPasswordSubmitting = true;
    if (submit) {
      submit.disabled = true;
      submit.classList.add('is-loading');
    }
    try {
      await window.PedeAquiCustomerAuth.changeCustomerPassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      });
      const success = $('profPasswordSuccess');
      success?.classList.add('active');
      success?.setAttribute('aria-hidden', 'false');
    } catch (error) {
      if (error?.status === 401 && !String(error?.message || '').toLocaleLowerCase('pt-BR').includes('senha')) {
        await syncCustomerSession();
        return;
      }
      showCustomerPasswordSummary(customerPasswordApiMessage(error));
    } finally {
      customerPasswordSubmitting = false;
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
      }
    }
  }
  function confirmCustomerPasswordSuccess() {
    const success = $('profPasswordSuccess');
    releaseFocusFrom(success);
    success?.classList.remove('active');
    success?.setAttribute('aria-hidden', 'true');
    resetCustomerPasswordForm();
    closeCustomerPasswordScreen();
  }
  const PROF_ORDER_ACTIVE_STATUSES = new Set([
    'pending', 'created', 'confirmed', 'accepted', 'preparing', 'ready', 'out_for_delivery'
  ]);
  const PROF_ORDER_STATUS_LABELS = {
    pending: 'Aguardando pagamento',
    created: 'Criado',
    confirmed: 'Confirmado',
    accepted: 'Aceito',
    preparing: 'Preparando',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    completed: 'Finalizado',
    delivered: 'Entregue',
    finished: 'Finalizado',
    cancelled: 'Recusado',
    canceled: 'Recusado',
    refused: 'Recusado',
    rejected: 'Recusado'
  };
  const PROF_ORDER_SUCCESS_STATUSES = new Set(['completed', 'delivered', 'finished']);
  const PROF_ORDER_DANGER_STATUSES = new Set(['cancelled', 'canceled', 'refused', 'rejected']);
  let profOrdersView = [];
  let profOrderDetailRequest = 0;

  function profOrderStatus(order) {
    return String(order?.status || '').trim().toLowerCase();
  }

  function profOrderStatusInfo(order) {
    const status = profOrderStatus(order);
    const tone = PROF_ORDER_DANGER_STATUSES.has(status)
      ? 'danger'
      : (PROF_ORDER_SUCCESS_STATUSES.has(status) ? 'success' : 'active');
    return {
      status,
      tone,
      label: PROF_ORDER_STATUS_LABELS[status] || (status ? status.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase()) : 'Status não informado')
    };
  }

  function profOrderDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return 'Data não informada';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit'
    }).format(date);
  }

  function renderProfOrderCard(order, index) {
    const status = profOrderStatusInfo(order);
    const isActive = PROF_ORDER_ACTIVE_STATUSES.has(status.status);
    const icon = status.tone === 'danger'
      ? '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5.5"/><path d="m4.2 4.2 3.6 3.6m0-3.6-3.6 3.6"/></svg>'
      : '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5.5"/><path d="m3.5 6.2 1.7 1.7 3.4-3.8"/></svg>';
    const statusClass = status.status.replace(/[^a-z0-9_-]/g, '');
    return `
      <article class="prof-order-card prof-order-card--${statusClass} prof-order-card--${status.tone}-tone">
        <div class="prof-order-card-main">
          <strong class="prof-order-number">Pedido #${esc(order.order_number ?? '')}</strong>
          <div class="prof-order-status prof-order-status--${status.tone}">
            ${status.tone === 'active' ? '' : `<span class="prof-order-status-icon" aria-hidden="true">${icon}</span>`}
            <span>${status.tone === 'active'
              ? 'Aguardando pagamento'
              : `${esc(status.label)} ${esc(profOrderDate(order.created_at))}`}</span>
          </div>
        </div>
        <button class="prof-order-details-button" type="button" ${act('click', 'openProfOrderDetails', index)}>${isActive ? 'Acompanhar pedido' : 'Ver detalhes'}</button>
      </article>
    `;
  }

  function renderProfPedidos(orders = appState.customerOrders || []) {
    const body = $('profSubPedidosBody');
    if (!body) return;
    profOrdersView = Array.isArray(orders) ? orders : [];
    const activeOrders = [];
    const orderHistory = [];
    profOrdersView.forEach((order, index) => {
      const entry = { order, index };
      if (PROF_ORDER_ACTIVE_STATUSES.has(profOrderStatus(order))) activeOrders.push(entry);
      else orderHistory.push(entry);
    });
    const renderEntries = entries => entries.map(({ order, index }) => renderProfOrderCard(order, index)).join('');
    body.innerHTML = `
      <section class="prof-orders-current">
        <h2>Pedidos em andamento (${activeOrders.length})</h2>
        ${activeOrders.length
          ? `<div class="prof-orders-list">${renderEntries(activeOrders)}</div>`
          : '<p>Você não possui pedidos em andamento</p>'}
      </section>
      <section class="prof-orders-history">
        <h2>Histórico de pedidos (${orderHistory.length})</h2>
        ${orderHistory.length
          ? `<div class="prof-orders-list">${renderEntries(orderHistory)}</div>`
          : '<p class="prof-orders-history-empty">Nenhum pedido encontrado</p>'}
      </section>
    `;
  }

  function renderProfPedidosLoading() {
    const body = $('profSubPedidosBody');
    if (body) body.innerHTML = '<div class="prof-orders-feedback">Carregando pedidos...</div>';
  }

  function renderProfPedidosError() {
    const body = $('profSubPedidosBody');
    if (!body) return;
    body.innerHTML = `
      <div class="prof-orders-feedback prof-orders-feedback--error">
        <p>Não foi possível carregar seus pedidos.</p>
        <button type="button" ${act('click', 'loadProfPedidos')}>Tentar novamente</button>
      </div>
    `;
  }

  async function loadProfPedidos() {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) {
      openLoginScreen();
      return;
    }
    renderProfPedidosLoading();
    try {
      const orders = await window.PedeAquiOrderService.getCustomerOrders();
      appState.customerOrders = Array.isArray(orders) ? orders : [];
      customerStore()?.setOrders?.(appState.customerOrders);
      renderProfPedidos(appState.customerOrders);
    } catch (error) {
      if (error?.status === 401) {
        await syncCustomerSession();
        return;
      }
      logAppError('Falha ao carregar pedidos do cliente', error);
      renderProfPedidosError();
    }
  }

  function profOrderRelativeDate(value) {
    const created = new Date(value);
    if (!value || Number.isNaN(created.getTime())) return 'Pedido realizado';
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - created.getTime()) / 60000));
    if (elapsedMinutes < 1) return 'Realizado agora';
    if (elapsedMinutes < 60) return `Realizado há ${elapsedMinutes} minuto${elapsedMinutes === 1 ? '' : 's'}`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `Realizado há ${elapsedHours} hora${elapsedHours === 1 ? '' : 's'}`;
    return `Realizado em ${profOrderDate(value)}`;
  }

  function profOrderAddress(order) {
    const addressId = order.customer_address_id || order.delivery_address_id || order.address_id || '';
    const savedAddress = (appState.customerAddresses || []).find(address =>
      String(address.id || address.address_id || '') === String(addressId)
    );
    const candidates = [
      order.delivery_address_snapshot,
      order.customer_address_snapshot,
      order.address_snapshot,
      order.delivery_address,
      order.customer_address,
      order.shipping_address,
      order.address,
      order.delivery?.address,
      savedAddress
    ];
    const hasAddressContent = candidate => {
      if (typeof candidate === 'string') return Boolean(candidate.trim());
      if (!candidate || typeof candidate !== 'object') return false;
      const nested = candidate.address && typeof candidate.address === 'object' ? candidate.address : candidate;
      return ['street', 'street_name', 'logradouro', 'address_line', 'line1', 'formatted_address', 'full_address']
        .some(key => Boolean(nested[key]));
    };
    let source = candidates.find(hasAddressContent) || {};
    if (typeof source === 'string') {
      try {
        source = JSON.parse(source);
      } catch {
        return { firstLine: source.trim(), secondLine: '' };
      }
    }
    source = source.address && typeof source.address === 'object' ? source.address : source;
    const street = source.street || source.street_name || source.logradouro || source.address_line || source.line1 || order.delivery_street || '';
    const number = source.number || source.street_number || source.numero || order.delivery_number || '';
    const neighborhood = source.neighborhood || source.district || source.bairro || order.delivery_neighborhood || '';
    const city = source.city || source.cidade || order.delivery_city || '';
    const state = source.state || source.uf || order.delivery_state || '';
    const formatted = source.formatted_address || source.full_address || '';
    const firstLine = [street, number].filter(Boolean).join(', ');
    const cityState = [city, state].filter(Boolean).join(' / ');
    const secondLine = [neighborhood, cityState].filter(Boolean).join(' - ');
    return { firstLine: firstLine || formatted, secondLine };
  }

  function profOrderSelectedOptions(item) {
    const options = Array.isArray(item.selected_options_snapshot)
      ? item.selected_options_snapshot
      : (Array.isArray(item.selected_options) ? item.selected_options : []);
    return options.map(option => {
      const group = option.group_name || option.option_group_name || option.group?.name || option.option_group?.name || '';
      const name = option.option_name || option.name || option.label || option.option?.name || '';
      const quantity = Number(option.quantity ?? option.qty ?? 1) || 1;
      return { group, name, quantity };
    }).filter(option => option.group || option.name);
  }

  function profOrderItemTotal(item, quantity) {
    const direct = item.total ?? item.line_total ?? item.subtotal ?? item.total_price;
    if (direct != null && direct !== '' && Number.isFinite(Number(direct))) return Number(direct);
    const unit = item.unit_price ?? item.price ?? item.product_price;
    return Number.isFinite(Number(unit)) ? Number(unit) * quantity : null;
  }

  function profOrderItemMarkup(item) {
    const quantity = Number(item.quantity ?? item.qty ?? 1) || 1;
    const menuProduct = products.find(product => String(product.id) === String(item.product_id || item.product?.id || ''));
    const name = item.name || item.product_name || item.product?.name || menuProduct?.name || 'Item';
    const imageUrl = item.image_url || item.image_path || item.product_image_url || item.product?.image_url || item.product?.image_path || menuProduct?.image_url || menuProduct?.image_path || '';
    const total = profOrderItemTotal(item, quantity);
    const options = profOrderSelectedOptions(item);
    return `
      <div class="order-details__item">
        ${imageUrl
          ? `<img class="order-details__item-image" src="${esc(imageUrl)}" alt="${esc(name)}">`
          : `<div class="order-details__item-image order-details__item-image--fallback"><span>${esc(initials(name))}</span></div>`}
        <div class="order-details__item-copy">
          <div class="order-details__item-title"><strong>${quantity}x</strong><span>${esc(name)}</span></div>
          ${options.map(option => `
            <div class="order-details__item-option">
              ${option.group ? `<strong>${esc(option.group)}</strong>` : ''}
              ${option.name ? `<span>${option.quantity}x ${esc(option.name)}</span>` : ''}
            </div>
          `).join('')}
          ${total == null ? '' : `<strong class="order-details__item-price">${fmt(total)}</strong>`}
        </div>
      </div>
    `;
  }

  function profOrderWaitingMarkup(status) {
    if (!PROF_ORDER_ACTIVE_STATUSES.has(status.status)) return '';
    return `
      <section class="order-details__waitingPayment" aria-live="polite">
        <span class="order-details__waiting-spinner" aria-hidden="true"></span>
        <div class="order-details__waiting-copy">
          <strong>Aguardando confirmação</strong>
          <p>Aguarde alguns segundos enquanto revisamos o pagamento. <strong>Não saia desta tela</strong> até a confirmação.</p>
        </div>
      </section>
    `;
  }

  function renderProfOrderDetails(order) {
    const body = $('profOrderDetailBody');
    if (!body) return;
    const status = profOrderStatusInfo(order);
    const items = Array.isArray(order.items) ? order.items : [];
    const address = profOrderAddress(order);
    const orderNumber = order.order_number ?? '';
    const restaurantName = order.restaurant_name || restaurant.name || fallback().restaurantName || 'Restaurante';
    const restaurantLogo = order.restaurant_logo_url || order.restaurant_logo || restaurant.logo_url || restaurant.logo_path || '';
    const subtotal = Number(order.subtotal) || 0;
    const deliveryFee = Number(order.delivery_fee) || 0;
    const total = Number(order.total) || 0;
    const isPickup = String(order.order_type || '').toLowerCase() === 'pickup';
    const addressTitle = isPickup ? 'Local de retirada' : 'Endereço de entrega';
    const firstAddressLine = address.firstLine || (isPickup ? order.branch_name : '') || 'Endereço não informado';
    const secondAddressLine = address.secondLine || '';
    const title = $('profOrderDetailTitle');
    if (title) title.textContent = `Pedido #${orderNumber}`;
    body.innerHTML = `
      ${profOrderWaitingMarkup(status)}
      <section class="order-details__card order-details__address">
        <h2>${addressTitle}</h2>
        <div class="order-details__divider"></div>
        <div class="order-details__address-row">
          <img class="order-details__address-map" src="/assets/icons/cart/cart-location-guest@2x.webp" alt="">
          <div class="order-details__address-copy">
            <span>${isPickup ? 'Retirar em' : 'Receber em'}</span>
            <strong>${esc(firstAddressLine)}</strong>
            ${secondAddressLine ? `<strong>${esc(secondAddressLine)}</strong>` : ''}
          </div>
        </div>
      </section>
      <section class="order-details__card order-details__order-card">
        <h2>Seu pedido</h2>
        <div class="order-details__divider"></div>
        <div class="order-details__restaurant">
          ${restaurantLogo
            ? `<img class="order-details__restaurant-logo" src="${esc(restaurantLogo)}" alt="">`
            : `<div class="order-details__restaurant-logo order-details__restaurant-logo--fallback">${esc(initials(restaurantName))}</div>`}
          <div><strong>${esc(restaurantName)}</strong><span>${esc(profOrderRelativeDate(order.created_at))}</span></div>
        </div>
        <div class="order-details__divider"></div>
        <div class="order-details__items">
          ${items.length ? items.map(profOrderItemMarkup).join('') : '<p class="order-details__items-empty">Nenhum item informado.</p>'}
        </div>
      </section>
      <section class="order-details__card order-details__totalContainer">
        <h2>Valores</h2>
        <div class="order-details__divider"></div>
        <dl>
          <div><dt>Subtotal</dt><dd>${fmt(subtotal)}</dd></div>
          <div><dt>Taxa de entrega</dt><dd>${fmt(deliveryFee)}</dd></div>
          <div class="order-details__total"><dt>Total</dt><dd>${fmt(total)}</dd></div>
        </dl>
      </section>
      <button class="order-details__help" type="button" ${act('click', 'openProfOrderHelp')}>Ajuda</button>
    `;
  }

  async function openProfOrderDetails(index) {
    const order = profOrdersView[index];
    const detail = $('profOrderDetail');
    if (!order || !detail) return;
    const requestId = ++profOrderDetailRequest;
    detail.dataset.orderId = String(order.id || index);
    renderProfOrderDetails(order);
    detail.scrollTop = 0;
    detail.classList.add('active');
    detail.setAttribute('aria-hidden', 'false');
    if (!order.id || !window.PedeAquiOrderService?.getCustomerOrder) return;
    try {
      const fullOrder = await window.PedeAquiOrderService.getCustomerOrder(order.id);
      if (requestId !== profOrderDetailRequest || !detail.classList.contains('active') || !fullOrder) return;
      renderProfOrderDetails({ ...order, ...fullOrder });
    } catch (error) {
      if (error?.status === 401) await syncCustomerSession();
      else logAppError('Falha ao atualizar detalhes do pedido', error);
    }
  }

  function closeProfOrderDetails() {
    const detail = $('profOrderDetail');
    profOrderDetailRequest += 1;
    releaseFocusFrom(detail);
    detail?.classList.remove('active');
    detail?.setAttribute('aria-hidden', 'true');
  }

  function openProfOrderHelp() {
    closeProfOrderDetails();
    $('profOrdersBackdrop')?.classList.remove('active');
    openProfSub('ajuda');
  }

  async function openProfSub(subId) {
    if (!isLogged() && ['cupons', 'meusdados', 'seguranca', 'pedidos'].includes(subId)) {
      openLoginScreen();
      return;
    }
    document.querySelectorAll('#mobViewProfile .prof-sub').forEach(el => el.classList.remove('active'));
    const sub = $('profSub' + subId);
    if (!sub) return;
    if (subId === 'pedidos') $('profOrdersBackdrop')?.classList.add('active');
    sub.classList.add('active');
    if (subId === 'pedidos') await loadProfPedidos();
    if (subId === 'ajuda') {
      renderProfileHelpContacts(restaurantInfoState.status === 'success' ? restaurantInfoState.data : null);
      const info = await ensureRestaurantInfo();
      if (info) renderProfileHelpContacts(info);
    }
    if (subId === 'pagamento') {
      const body = document.querySelector('#profSubpagamento .prof-sub-body');
      if (body && restaurantInfoState.status !== 'success') body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Carregando formas de pagamento...</div></div>';
      await ensureRestaurantInfo();
    }
    if (subId === 'info') {
      const body = document.querySelector('#profSubinfo .prof-sub-body');
      if (body && restaurantInfoState.status !== 'success') body.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Carregando informações...</div></div>';
      await ensureRestaurantInfo();
    }
  }
  function closeProfSub() {
    closeProfOrderDetails();
    $('profOrdersBackdrop')?.classList.remove('active');
    document.querySelectorAll('#mobViewProfile .prof-sub, #profSubpedidos').forEach(el => el.classList.remove('active'));
  }

  function mobFocusSearch() {
    closeMobViews();
    showMenuTab();
    ensureMenuLoaded();
    $('searchCat')?.classList.add('search-open');
    $('searchInput')?.focus();
    const el = $('menu-area');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 96, behavior: 'smooth' });
  }

  function closeSearch() {
    $('searchCat')?.classList.remove('search-open');
    if ($('searchInput')) {
      $('searchInput').value = '';
      $('searchInput').dispatchEvent(new Event('input'));
    }
  }

  function openServiceFeeInfo() {
    openModal('serviceFeeModal');
  }

  async function initRestaurantApp() {
    if (bootPromise) return bootPromise;
    resetRuntimeStateForPageLoad();
    setAppBooting(true);
    renderSectionLoader('menuContainer', 'Carregando cardápio...', 'menu-skeleton');
    const loadInitialData = async () => {
    const restaurantSlug = getRestaurantSlug();
    // URL que não identifica um restaurante: nem chega a bater na API.
    if (!restaurantSlug) throw restaurantNotFoundError('');
    try {
      payload = await window.PedeAquiRestaurantService.getRestaurantMenu(restaurantSlug);
    } catch (error) {
      // 404 = slug inexistente; 410 = desativado. Ambos são "não encontrado";
      // qualquer outro status continua sendo falha de carregamento (com retry).
      if (error?.status === 404 || error?.status === 410) throw restaurantNotFoundError(restaurantSlug);
      throw error;
    }
    restaurant = payload.restaurant || {};
    // Backend que responde 200 com corpo vazio, ou com o restaurante inativo,
    // também não pode virar tela em branco nem cair em outro tenant.
    if (!restaurant.id && !restaurant.slug && !restaurant.name) throw restaurantNotFoundError(restaurantSlug);
    if (restaurant.is_active === false) throw restaurantNotFoundError(restaurantSlug);
    appState.restaurant = restaurant;
    settings = payload.settings || {};
    branches = Array.isArray(payload.branches) ? payload.branches : [];
    categories = Array.isArray(payload.categories) ? payload.categories : [];
    products = Array.isArray(payload.products) ? payload.products : [];
    banners = Array.isArray(payload.banners) ? payload.banners : [];
    highlightBanners = Array.isArray(payload.highlight_banners) ? payload.highlight_banners : [];
    // Home coupons come from the public /menu payload. They are intentionally
    // independent from the customer-specific /coupons/available Club feed.
    coupons = Array.isArray(payload.coupons) ? payload.coupons : [];
    restaurantStore()?.set?.({
      restaurant,
      settings,
      branches,
      categories,
      products,
      banners,
      highlightBanners,
      coupons
    });
    };
    bootPromise = (async () => {
    await loadInitialData();
    submittedOrder = window.PedeAquiOrderState?.listOrders()?.[0] || null;
    restoreCart(); // depois do menu carregar: precisa de `products` para validar
    initOperationContext();
    applyTheme();
    initStoreInfoModal();
    initCashbackState();
    renderRestaurantShell();
    renderBanners();
    renderCoupons();
    renderHighlights();
    renderProfileView();
    initSearch();
    setCartTab(operationContext?.order_type || 'delivery');
    updateCartUI();
    showHomeTab();
    requestDeliveryEstimate();
    loadCashbackForHome();
    appState.homeLoaded = true;
    appState.menuLoaded = false;
    restaurantStore()?.set?.({ homeLoaded: true, menuLoaded: false });
    initPageRubberBand();
    initMenuHeaderHide();
    await waitForHomeCriticalMedia();
    setAppBooting(false);
    // Best-effort: refresh the logged customer against the backend (clears
    // the session on 401). Runs after first paint so it never blocks the page.
    syncCustomerSession();
    })();
    return bootPromise;
  }

  function retryRestaurantBoot() {
    bootPromise = null;
    document.body.classList.remove('app-error');
    return initRestaurantApp().catch(showAppError);
  }

  function retryMenuLoad() {
    appState.menuLoaded = false;
    menuLoadPromise = null;
    return ensureMenuLoaded();
  }

  function retryClubLoad() {
    return clubController.retryClubLoad();
  }

  function refreshAvailableCoupons() {
    clubController.invalidateCoupons();
    if ($('mobViewClub')?.classList.contains('active')) return clubController.renderClubView({ force: true });
    return Promise.resolve();
  }


  function mountProfOrdersOverlay() {
    const panel = $('profSubpedidos');
    if (!panel) return;
    let backdrop = $('profOrdersBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'profOrdersBackdrop';
      backdrop.className = 'prof-orders-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.appendChild(backdrop);
    }
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
  }
  // Handlers de tela. O markup referencia estes nomes por data-act-*, e o
  // despachante (scripts/utils/actions.js) resolve pelo registro — não por
  // window. Ver a lista curta logo abaixo para o que continua global e por quê.
  // A arte do cupom não carregou: volta para o fundo de fallback. Era um
  // onerror inline mexendo em classList.
  function couponArtImageFailed(image) {
    image?.closest('.coupon-art')?.classList.remove('coupon-art--has-img');
    image?.remove();
  }

  const ACTIONS = {
    couponArtImageFailed,
    openModal, closeModalId, closeModal, openProduct, changeQty, addToCart, toggleProductOption, handleHomeLoginPromptClick, handleHomeCartValueClick, openCartBenefits, scrollToCategory, findCategoryButton, scrollToMenu,
    removeCartItem, openCartItemDeleteConfirm, closeCartItemDeleteConfirm, cancelCartItemDelete, confirmCartItemDelete, editCartItem, setCartTab, handleCartCta, openCheckout, backToCart, setDeliveryType, openPaymentMethodScreen, closePaymentMethodScreen, setPaymentScreenTab,
    submitOrder, closeOrderSuccess, refreshTrackedOrder,
    openOrderConfirm, closeOrderConfirm, confirmOrderFromSheet, openConfirmBenefits,
    closePixPayment, copyPixCode, retryPixPayment, checkPixStatusNow, togglePixOrderItems,
    openPixExitConfirm, closePixExitConfirm, confirmPixExit, openPixHowTo, closePixHowTo,
    resumePendingPayment, dismissPendingPayment,
    setPayment, confirmPaymentMethodSelection, openAddressScreen, openAddressChoice, openAddressChoiceDirect, backFromAddAddress, backFromAddrSearch, backFromAddrMap, selectAdcOption, adcConfirm,
    openAddrSearch, onAddrSearchInput, selectAddrSuggestion, adcUseGeoSearch, confirmAddrMap, editAddrDetailsLocation, toggleAddrNoNumber, maskCep, validateAddrDetails, saveAddressDetails,
    openLoginScreen, mockLogin,
    openRegisterScreen, closeRegisterScreen, maskRegPhone, maskRegCpf, maskRegBirth,
    toggleRegPassword, handleRegFieldInput, handleRegFieldBlur, handleRegPrivacyInput, submitRegister, logout, confirmLogout, cancelLogout, closeLogoutConfirm,
    openSigninScreen, closeSigninScreen, submitLogin, loginForgotPassword,
    handleLoginFieldInput, handleLoginFieldBlur,
    closeVerifyScreen, handleVfyInput, handleVfyKeydown, handleVfyPaste, submitVerify, resendVfyCode,
    openResetPasswordScreen, closeResetPasswordScreen, submitResetPassword, handleResetPwInput,
    openForgotPasswordScreen, closeForgotPasswordScreen, submitForgotPassword, handleForgotEmailInput,
    openForgotNotFound, closeForgotNotFound,
    openRecoverCodeScreen, closeRecoverCodeScreen, handleRecInput, handleRecKeydown, handleRecPaste,
    resendRecoverCode, submitRecoverCode,
    openOperationScreen, closeOperationScreen, setOperationType, renderOperationBranches, selectBranch, confirmOperation,
    openAddrPicker, selectAddrPickerItem, editAddrPickerItem, confirmAddrPicker, toggleAddrPickerActions, removeAddrPickerItem, confirmAddrPickerDelete, cancelAddrPickerDelete, closeAddrDeleteConfirm,
    openPolicyScreen, closePolicyScreen,
    useCoupon, openCouponDetail, closeCouponDetail, confirmCouponDetail, handleBannerAction,
    setStoreInfoTab, openRestaurantInfo, setProfilePaymentTab, showCardComingSoon,
    mobNavHome, mobNavMenu, mobNavClub, mobNavAssistant, mobNavProfile, assistantGoBack, goToMenuTab: scrollToMenu,
    openProfSub, closeProfSub, openCustomerDataScreen, closeCustomerDataScreen, handleCustomerDataInput, submitCustomerData, openCustomerPasswordScreen, closeCustomerPasswordScreen, handleCustomerPasswordInput, submitCustomerPassword, confirmCustomerPasswordSuccess, loadProfPedidos, openProfOrderDetails, closeProfOrderDetails, openProfOrderHelp, mobFocusSearch, closeSearch, openServiceFeeInfo, setHeroBanner,
    retryRestaurantBoot, retryMenuLoad, retryClubLoad, refreshAvailableCoupons, syncCustomerSession, openCashbackStatement, retryCashbackStatement, closeCashbackStatement
  };

  window.RapidexActions.register(ACTIONS);

  // 152 nomes iam para window; 141 deles existiam SÓ para alimentar handlers
  // on*= inline e agora vivem apenas no registro de ações. Os 11 abaixo ficam
  // porque outro módulo ou a suíte E2E os chama pelo nome global — cada um foi
  // conferido por grep (window.X e chamada bare), não por suposição.
  Object.assign(window, {
    // scripts/pages/restaurant-assistant.js
    openProduct, scrollToCategory, findCategoryButton, mobNavMenu,
    // scripts/pages/restaurant-club.js
    openCouponDetail, openCashbackStatement,
    // scripts/pages/cashback-statement.js
    openLoginScreen, syncCustomerSession,
    // tests/e2e/helpers.js e order-flow.spec.js
    openModal, changeQty, addToCart
  });

  // A consulta do pagamento não roda com a aba escondida (ver pollPixStatus).
  // Quando ela volta, retomamos na hora em vez de esperar o próximo intervalo:
  // é justamente o momento em que o cliente voltou do app do banco.
  window.RapidexLifecycle?.onVisibility?.({
    onVisible: () => {
      if (pixSession && !pixSession.stopped && !pixSession.pollTimer) pollPixStatus();
    },
    onHidden: () => {
      if (pixSession?.pollTimer) {
        clearTimeout(pixSession.pollTimer);
        pixSession.pollTimer = null;
      }
    }
  });
  // Sair da página não pode deixar um timer segurando a sessão por closure.
  window.RapidexLifecycle?.onTeardown?.(() => stopPixPolling());
  // Pagamento pendente de uma visita anterior: só desenha se existir um.
  renderPendingPaymentBar();

  initializeDismissedDialogs();
  // Antes da Fase 1 este evento nunca chegava a disparar: nenhum pedido era
  // criado. Agora ele dispara de verdade e precisa invalidar o que o pedido
  // acabou de tornar obsoleto — cupons (podem ter sido consumidos) e cashback
  // (o pedido pode ter gerado crédito).
  window.addEventListener('rapidex:order-confirmed', () => {
    refreshAvailableCoupons();
    clubController?.invalidateCoupons?.();
    loadCashbackForHome({ force: true });
  }, { signal: LIFECYCLE_SIGNAL });
  mountProfOrdersOverlay();
  initRestaurantApp().catch(showAppError);
})();
