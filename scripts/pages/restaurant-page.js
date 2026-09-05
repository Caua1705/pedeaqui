(function () {
  // C3 — todo listener de vida longa em document/window carrega este signal, e
  // um único abort() no teardown remove os que estiverem pendurados nele. É o
  // que evita ter de guardar referência de cada handler só para poder removê-lo
  // (metade deles é função anônima). Ver scripts/utils/lifecycle.js.
  const LIFECYCLE_SIGNAL = window.RapidexLifecycle?.signal;
  const onTeardown = (dispose) => window.RapidexLifecycle?.onTeardown(dispose);

  // Apelido local das 45 chamadas. O formatador mora em scripts/utils/currency.js
  // — o modulo que esta linha ja procurava e que nao existia: o `||` que estava
  // aqui fazia o fallback rodar em 100% das chamadas, calado.
  const fmt = (value) => window.PedeAquiCurrency.formatCurrency(value);
  const storageKeys = () => window.RapidexStorage;
  const STORAGE_ADDRESS = storageKeys()?.KEYS.customerAddress || 'rapidex.customerAddress';
  const readStorageKey = (key) => storageKeys()?.readWithMigration
    ? storageKeys().readWithMigration(key)
    : localStorage.getItem(key);
  // Sessão do cliente: global, chave única. Esta página gravava o mesmo cliente
  // numa segunda chave (rapidex.customer.local) que podia divergir da do auth.
  const readSessionCustomer = () => storageKeys()?.readSessionCustomer?.() || null;

  let payload = {};
  let restaurant = {};
  let settings = {};
  // De qual filial é o cardápio que está carregado AGORA — o `branch_id` que a
  // resposta declarou, não o que foi pedido. É a régua que diz se a tela está
  // mostrando a loja escolhida: `products`, `categories` e `settings` são todos
  // dela, e os ids de produto NÃO se repetem entre filiais.
  let menuBranchId = null;
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
  let deliveryType = 'delivery';
  // paymentMethod = rótulo exibido ("Pix"); paymentMethodKey = chave da UI ("pix");
  // paymentApiTypeByKey mapeia a chave da UI para o method_type do backend
  // ("credit" -> "credit_card"), que é o valor enviado em POST /orders.
  let paymentMethod = '';
  let paymentMethodKey = '';
  let selectedSavedCard = null;
  let savedCardPaymentToken = '';
  const paymentApiTypeByKey = new Map();
  const paymentScopeByKey = new Map();
  // ------------------------------------------------------------
  //  DOIS cupons, e a diferença entre eles vale dinheiro.
  //
  //  `couponDetailCoupon` é o que está ABERTO NA TELA para leitura. Some quando
  //  a folha fecha e não entra em pedido nenhum.
  //
  //  `selectedCoupon` é o que está APLICADO À SACOLA. É ele que vai no
  //  payload de POST /orders (currentOrderState) e que o backend consome.
  //
  //  Eram a MESMA variável, e openCouponDetail() a escrevia só de abrir. Quem
  //  tocasse num card de cupom para ler as regras e fechasse saía com o cupom
  //  armado: o updateCartUI() seguinte disparava o preview em silêncio, o
  //  desconto aparecia sem ninguém ter confirmado, e o coupon_id ia no pedido.
  //  Num cupom de uso único isso o QUEIMA — gasto sem nunca ter sido escolhido.
  //
  //  Só confirmCouponDetail() promove um ao outro. Ler nunca aplica.
  // ------------------------------------------------------------
  let selectedCoupon = null;
  let selectedCouponPreview = null;
  let couponPreviewPromise = null;
  let couponPreviewKey = '';
  let pendingCartItemDeleteUid = null;
  let customer = window.PedeAquiCustomerService?.getStoredCustomer?.() || readSessionCustomer();
  let customerAddress = window.PedeAquiAddressService?.readSelectedAddress?.() || JSON.parse(readStorageKey(STORAGE_ADDRESS) || 'null');
  // O total que estava NA TELA no instante em que o cliente confirmou.
  //
  // Existe porque a API não tem rota que orce um pedido: não há como pedir ao
  // backend o total antes de criar o pedido (/coupons/preview só responde com
  // cupom, /delivery/estimate só a taxa). Então o número que o cliente aprova é
  // calculado aqui (cartTotals) e o número que ele paga vem de lá (order.total),
  // e nada garantia que fossem o mesmo. Guardamos o primeiro para poder
  // COMPARAR com o segundo em vez de trocar de número na virada da tela.
  let confirmedTotalAtSubmit = null;
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
  // NÃO existe piso de tempo para o loader do boot. Havia um (APP_LOADER_MIN_MS
  // = 900ms), para a volta dos três pontinhos não parecer um flash — ou seja,
  // toda primeira abertura pagava 0,9s de espera inventada. Loader que some
  // rápido é exatamente o objetivo; a tela aparece assim que os dados chegam.
  const TAB_LOADER_MIN_MS = 500;
  // A troca para o cardápio continua instantânea quando as miniaturas vieram
  // do cache. Se alguma ainda estiver pendente, o loader entra no MESMO quadro
  // do clique: deixar a tela aparecer antes dele produz o flash
  // "cardápio -> loader -> cardápio".
  const MENU_MEDIA_LOADER_MIN_VISIBLE_MS = 360;
  const MENU_MEDIA_TIMEOUT_MS = 6500;
  let menuMediaLoadSequence = 0;

  const $ = window.PedeAquiDom?.byId || ((id) => document.getElementById(id));

  // Mostrar/esconder passa por classe, não por style.display.
  //
  // O estado inicial escondido vinha de style="display:none" no HTML, e era o
  // que obrigava a CSP a liberar style-src 'unsafe-inline'. Sem o atributo, um
  // `style.display = ''` não desfaz mais nada — quem esconde agora é .u-hidden,
  // então quem mostra tem que tirar a classe.
  const showEl = (element, shown) => element?.classList.toggle('u-hidden', !shown);

  const dialogFocusOrigins = new WeakMap();

  // releaseFocusFrom saiu daqui: os dois últimos usuários (Perfil/pedidos e
  // dados do cliente) migraram para screens/ e usam a cópia do screen-kit,
  // que é idêntica. Quem precisar aqui de novo: window.PedeAquiScreenKit.

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
  // Iniciais de um nome. O fallback era a string 'Rapidex' — ou seja, todo
  // placeholder de logo, avatar de sacola e foto de produto sem nome nascia
  // escrito "RA", a marca da PLATAFORMA, dentro do app de um restaurante.
  // Sem nome não há iniciais: um quadrado liso na cor da loja diz menos, e
  // dizer menos é melhor do que dizer o nome errado. Mesma função que a marca
  // gerada do favicon usa (scripts/utils/tenant-identity.js), para que a aba e
  // a tela concordem letra por letra.
  const initials = (name) => window.RapidexTenantIdentity.initialsFor(name);
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
  const cartStore = () => window.PedeAquiCartStore;
  // productOptionGroups/optionGroupSelections/optionAdditionalPrice moram no
  // product-screen — a escolha de opções é toda de lá.
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
    if (customer) storageKeys()?.writeSessionCustomer?.(customer);
    else storageKeys()?.clearSessionCustomer?.();
    return customer;
  }

  function persistCustomerAddress(address) {
    if (!address) return null;
    customerAddress = window.PedeAquiAddressService?.saveSelectedAddress?.(address) || address;
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
   * Rastro do checkout, do toque em "Confirmar" até a resposta da cobrança.
   *
   * Mesmo princípio (e mesmo formato) do `cvvTrace` da tela de cartão: cada
   * etapa se ANUNCIA com o estado que a governa, de modo que o console diga em
   * qual delas o fluxo parou — sem isso, um checkout que morre no meio deixa
   * apenas ausência no console, e ausência não se investiga.
   *
   * Continua a numeração daquele rastro: a tela do CVV vai de A/E a 5/5, e o
   * checkout segue de 6 em diante, para os dois lerem como UMA sequência.
   */
  function checkoutTrace(step, detail = {}) {
    console.log(`[PedeAqui][Checkout] ${step}`, detail);
  }

  /** Só o que identifica o erro — nunca o objeto inteiro, que polui o console. */
  function errorTrace(error) {
    return {
      tipo: error?.name || 'Error',
      status: error?.status ?? null,
      mensagem: error?.message || String(error),
      detail: error?.data?.detail ?? error?.detail ?? null
    };
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
    menuBranchId = null;
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
    selectedSavedCard = null;
    savedCardPaymentToken = '';
    paymentApiTypeByKey.clear();
    paymentScopeByKey.clear();
    selectedCoupon = null;
    selectedCouponPreview = null;
    couponPreviewPromise = null;
    couponPreviewKey = '';
    menuLoadPromise = null;
    profileLoadPromise = null;
    menuRenderSignature = '';
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

  const clubController = window.PedeAquiRestaurantClub.createRestaurantClubController({
    appState,
    getRestaurantSlug,
    getCouponContext: () => {
      const totals = cartTotals();
      return { subtotal: totals.subtotal, deliveryFee: totals.delivery, orderType: deliveryType };
    },
    // ACESSOR, nao valor. `cart` e reatribuido (restoreCart, troca de filial,
    // limpar sacola); uma copia aqui viraria a fotografia do boot e o botao do
    // cupom decidiria para sempre com a sacola de quando o app subiu — a
    // armadilha mais cara da §2.1 da skill.
    getCart: () => cart,
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
    // O saldo DESTA loja, não o da conta: CashbackBalanceResponse.balance soma
    // todos os restaurantes do Rapidex, e o schema avisa que a soma não é
    // gastável. Num app white-label, mostrar saldo de outra loja como se
    // valesse aqui é prometer desconto que o pedido não vai ter.
    const balance = Number(window.PedeAquiClubService?.restaurantCashbackBalance?.(getRestaurantSlug(), cashbackState?.data));
    return Number.isFinite(balance) ? fmt(balance) : fmt(0);
  }

  function renderSharedCashbackState(state = window.PedeAquiClubService?.getState?.()) {
    const text = cashbackValueText(state?.cashback);
    if ($('homeCartTotal')) $('homeCartTotal').textContent = text;
    if ($('clubCashbackBalance')) $('clubCashbackBalance').textContent = text;
    // O saldo do EXTRATO não entra aqui: aquele modal é da conta inteira
    // (linhas de todos os restaurantes) e o dono dele é cashback-statement.js,
    // que escreve o balance da própria resposta de transações.
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

  // O extrato de cashback (modal, linhas, rótulos) mora INTEIRO em
  // scripts/pages/cashback-statement.js, que carrega depois deste arquivo e
  // sempre venceu em window e no registro de ações. A versão que vivia aqui
  // (renderCashbackStatement e companhia) era código morto com um defeito
  // dentro — lia `transactions.data` como array, quando o contrato responde
  // {balance, currency, transactions} — e saiu em 30/08/2026. Se o extrato
  // precisar de algo desta página, vai por window.* como já fazem
  // openLoginScreen e syncCustomerSession.

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

  function imageAttrs({ lazy = true, priority = 'auto' } = {}) {
    const loading = lazy ? 'lazy' : 'eager';
    const fetchPriority = priority && priority !== 'auto' ? ` fetchpriority="${priority}"` : '';
    return `loading="${loading}" decoding="async"${fetchPriority}`;
  }

  // ==========================================================================
  //  A AÇÃO ÚNICA DE RECUO, para o markup montado por template.
  //
  //  Handler inline `on*=` é proibido aqui (inline-handlers.test.js barra), e a
  //  ponte é o registro de ações:
  //
  //      ${act('error', 'retreatImage', '$this')}
  //
  //  O `'$this'` NÃO É OPCIONAL, e foi ele que custou esta rodada. A FORMA
  //  CURTA (`data-act-error="nome"`) chama `fn.apply(elemento)` **sem
  //  argumento nenhum**: o elemento chega em `this`, não no primeiro parâmetro.
  //  Uma função escrita como `fn(img)` recebe `undefined`, sai pelo `?.` ou
  //  pelo early-return, e NÃO FAZ NADA — sem erro, sem log, sem sintoma.
  //
  //  Dois handlers deste app estavam assim desde que foram escritos:
  //  `couponArtImageFailed` (a arte quebrada do cupom nunca foi removida) e
  //  `assistantImagePlaceholder` (o placeholder do assistente nunca entrou).
  //  Os dois foram corrigidos junto — o defeito foi encontrado por acidente,
  //  porque o recuo novo nasceu com o mesmo erro e um teste o cobrou.
  //
  //  Ela não tem fallback próprio de propósito. Quem quer um — as iniciais do
  //  logo, o placeholder do cupom — chama `RapidexImageCdn.retreat()` no
  //  PRÓPRIO ouvinte e decide o que fazer quando ele devolve `false`. Esta aqui
  //  serve os sítios cujo desfecho, se o original também falhar, é o de hoje:
  //  a imagem não pinta e o desenho de baixo aparece.
  // ==========================================================================
  function retreatImage(img) {
    window.RapidexImageCdn?.retreat?.(img);
  }

  function replaceFailedProductImage(img) {
    if (!img?.isConnected) return;
    const placeholder = document.createElement('div');
    placeholder.className = `${img.className} product-image--placeholder`;
    const label = document.createElement('span');
    label.textContent = initials(img.alt || 'Produto');
    placeholder.appendChild(label);
    img.replaceWith(placeholder);
  }

  // O srcset usa a variante redimensionada do Storage. Se essa variante falhar,
  // tentamos a URL original antes de assumir que a foto está indisponível.
  // Assim uma falha pontual do transformador não deixa o quadrado cinza.
  function waitForProductImageReady(img) {
    if (!img?.src) return Promise.resolve();
    img.loading = 'eager';

    return new Promise(resolve => {
      const originalSrc = img.getAttribute('src') || img.src;
      let retriedOriginal = false;
      let settled = false;

      const cleanup = () => {
        img.removeEventListener('load', handleLoad);
        img.removeEventListener('error', handleError);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const handleLoad = () => {
        const decoded = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
        decoded.finally(finish);
      };
      const handleError = () => {
        if (!retriedOriginal && img.hasAttribute('srcset')) {
          retriedOriginal = true;
          img.removeAttribute('srcset');
          img.removeAttribute('sizes');
          img.src = originalSrc;
          return;
        }
        replaceFailedProductImage(img);
        finish();
      };

      img.addEventListener('load', handleLoad);
      img.addEventListener('error', handleError);
      if (img.complete) {
        if (img.naturalWidth > 0) handleLoad();
        else handleError();
      }
    });
  }

  function menuImagesNearViewport() {
    const images = Array.from(document.querySelectorAll('#menuContainer img.product-image'));
    if (!images.length) return [];
    const viewportLimit = window.innerHeight + 220;
    const visibleSoon = images.filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < viewportLimit;
    });
    // O fallback cobre ambientes sem layout real (e também os testes DOM).
    return (visibleSoon.length ? visibleSoon : images.slice(0, 6)).slice(0, 8);
  }

  function setMenuMediaLoading(active) {
    if (active) {
      if (document.body.classList.contains('app-booting') || document.body.classList.contains('app-error')) return;
      if ($('appLoaderTitle')) $('appLoaderTitle').textContent = 'Carregando cardápio';
      if ($('appLoaderMessage')) $('appLoaderMessage').textContent = 'Preparando as imagens dos produtos.';
      document.body.classList.add('menu-media-loading');
      return;
    }
    document.body.classList.remove('menu-media-loading');
    if ($('appLoaderTitle')) $('appLoaderTitle').textContent = 'Carregando restaurante';
    if ($('appLoaderMessage')) $('appLoaderMessage').textContent = 'Preparando sua experiência.';
  }

  async function waitForMenuCriticalMedia() {
    if (!document.body.classList.contains('menu-tab')) return;
    const images = menuImagesNearViewport();
    if (!images.length) return;

    const sequence = ++menuMediaLoadSequence;
    images.slice(0, 3).forEach(img => { img.fetchPriority = 'high'; });
    const ready = Promise.allSettled(images.map(waitForProductImageReady));
    // complete + naturalWidth significa que o browser já tem pixels para
    // pintar. Nesse caso esperamos apenas o decode, sem piscar um loader.
    const hasPendingImage = images.some(img => !img.complete || img.naturalWidth <= 0);
    if (!hasPendingImage) {
      await ready;
      return;
    }
    if (sequence !== menuMediaLoadSequence || !document.body.classList.contains('menu-tab')) return;

    const shownAt = performance.now();
    setMenuMediaLoading(true);
    await Promise.race([ready, wait(MENU_MEDIA_TIMEOUT_MS)]);
    const remaining = MENU_MEDIA_LOADER_MIN_VISIBLE_MS - (performance.now() - shownAt);
    if (remaining > 0) await wait(remaining);
    if (sequence === menuMediaLoadSequence) setMenuMediaLoading(false);
  }

  // waitForHomeCriticalMedia() foi REMOVIDA. Ela segurava o loader do boot por
  // até 1,4s esperando logo, hero, cupons e destaques terminarem de baixar —
  // imagens que já têm caixa reservada (width/height + aspect-ratio), então
  // aparecer depois não move nada de lugar. Era espera por rede que não
  // precisa terminar antes de a tela existir.

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
  // ==========================================================================
  //  AS CAIXAS DO LOGO DA LOJA — MEDIDAS, não lidas da folha.
  //
  //  O MESMO arquivo é desenhado em seis lugares, e o lado de cada um é
  //  diferente. Medido no app a 390x844 com `getBoundingClientRect()`, e não
  //  lido no CSS de propósito: `.mob-logo` não declara lado nenhum na regra
  //  dela (styles/restaurant.css:1008) — o tamanho vem de outra folha, e
  //  qualquer número tirado dali seria chute.
  //
  //      .mob-logo             45x45     cabeçalho da Home
  //      #loginLogo           150x150    folha de login
  //      #infoStoreLogo        95x95     Informações da loja
  //      .help-store-logo      95x95     Perfil > Ajuda
  //      #pixOrderLogo         32x32     cartão de conferência do Pix
  //      order-details logo    40x40     detalhe do pedido (screens/profile)
  //
  //  Até 05/09/2026 os seis pediam o ORIGINAL — o arquivo no tamanho em que o
  //  lojista subiu, em toda visita, para desenhar um círculo de 45px.
  //
  //  QUANDO ALGUÉM MUDAR O CSS: o número aqui não acompanha sozinho. Ele erra
  //  para o lado seguro (uma derivada um pouco maior ou menor que a caixa
  //  continua desenhando), mas quem mexer no lado do logo mede de novo — a
  //  sonda é `getBoundingClientRect()` na tela, e leva dois minutos.
  // ==========================================================================
  const LOGO_BOX = {
    cabecalho: { w: 45, h: 45 },
    login: { w: 150, h: 150 },
    info: { w: 95, h: 95 },
    ajuda: { w: 95, h: 95 },
    pix: { w: 32, h: 32 },
    pedido: { w: 40, h: 40 }
  };

  // DELEGAÇÃO, não implementação: o montador mora em `utils/image-cdn.js`
  // desde 05/09/2026, para alcançar os arquivos que não recebem `shell` (o
  // Clube, o assistente, o Perfil). Estes dois nomes ficam porque a Home e a
  // tela do cupom os recebem por `shell`/`kit` — o que sumiu foi a segunda
  // cópia da regra de tamanho.
  function responsiveImageAttrs(url, options = {}) {
    return window.RapidexImageCdn?.attrs?.(url, options) || '';
  }

  // O herói é full-bleed (aspect-ratio 1080/500 — styles/utilities.css:652) e a
  // arte é autorada a 1080 de largura, então a grade para aí.
  // .coupon-card tem 168px de largura (styles/utilities.css:1205) e a arte
  // dentro dela tem 90px de altura (.coupon-art — styles/utilities.css:768).
  // .highlight-banner troca de regime por breakpoint: 290px fixos no desktop,
  // 65%/78% da viewport no mobile (styles/utilities.css:857/1260/1414). Como
  // não é largura fixa em todo lugar, vai de `w` + sizes.
  // COUPON_DETAIL_FLUID mora na tela do cupom (coupon-detail-screen.js).

  // Versão para <img> que JÁ existe no DOM (o herói é atualizado por
  // propriedade, não recriado por template).
  function applyResponsiveImage(img, url, options = {}) {
    window.RapidexImageCdn?.apply?.(img, url, options);
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

  // O modal de informações (abas, chrome e conteúdo) mora em
  // screens/store-info-screen.js (setStoreInfoTab, initStoreInfoModal,
  // openRestaurantInfo são ações registradas pela tela).

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
    // /info existe em duas versoes no ambiente real: algumas filiais ainda
    // devolvem os metodos agrupados em { online, delivery }, enquanto outras
    // seguem o contrato em lista plana e informam o grupo em payment_flow.
    // Aceitar somente a primeira forma fazia o PIX desaparecer ao trocar de
    // unidade, apesar de ele continuar habilitado no payload daquela filial.
    let groups;
    if (Array.isArray(methods)) {
      const online = [];
      const delivery = [];
      methods.forEach(method => {
        const rawFlow = method?.payment_flow || method?.flow || method?.scope || '';
        const flow = normalizeAddressPart(rawFlow).replace(/[^a-z0-9]+/g, '_');
        const isBoth = flow === 'both' || flow === 'all' || flow === 'todos';
        const isOnline = isBoth || flow.includes('online') || flow.includes('gateway')
          || (!flow && method?.requires_gateway === true);
        const isDelivery = isBoth || flow.includes('delivery') || flow.includes('entrega')
          || flow.includes('offline') || flow.includes('presencial')
          || (!flow && method?.requires_gateway === false);
        if (isOnline) online.push(method);
        if (isDelivery) delivery.push(method);
      });
      groups = {
        online: normalizeInfoPaymentMethods(online),
        delivery: normalizeInfoPaymentMethods(delivery)
      };
    } else {
      groups = {
        online: normalizeInfoPaymentMethods(methods.online),
        delivery: normalizeInfoPaymentMethods(methods.delivery)
      };
    }

    // AQUI HAVIA UM FALLBACK DE PIX, e ele foi removido em 20/08/2026 junto
    // com o campo que o alimentava. Nao restaure sem ler isto.
    //
    // Quando /info devolvia os dois grupos vazios, a tela recuperava o PIX de
    // `GET /menu -> settings.payment_methods`, tratando a ausencia como
    // payload incompleto da filial em vez de desativacao explicita.
    //
    // O raciocinio estava errado por um motivo que so se ve do lado do
    // servidor: os dois grupos vazios significam que aquela filial nao tem
    // NENHUMA linha habilitada em `branch_payment_methods` — e e essa tabela,
    // e so ela, que `POST /orders` consulta. O PIX que este bloco devolvia
    // aparecia na tela e morria no checkout com 400 "Esta filial nao aceita
    // esta forma de pagamento". Ou seja: o fallback nao salvava a venda, ele
    // adiava a recusa para depois de o cliente ter escolhido.
    //
    // `settings.payment_methods` era o jsonb do RESTAURANTE, sem relacao com
    // o que cada loja habilitou. Ele saiu da resposta e da tabela na revisao
    // 20260820_0027 do backend; ler daqui hoje devolve `undefined`.
    //
    // O conserto de verdade e de cadastro: a filial sem forma de pagamento
    // precisa ganhar as linhas dela no painel. Ver
    // `docs/cardapio-por-filial.md` no backend.
    return groups;
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

  // A grade de pagamento do MODAL mora em screens/store-info-screen.js.

  // O contrato manda o rótulo PRONTO: BusinessHourDayResponse.day_label
  // ("Segunda-feira"). Este helper lia display_name/day_name/label — nomes que
  // nunca existiram — e caía num mapa 1..7 que NÃO é o do contrato (weekday é
  // 0=SEGUNDA, o datetime.weekday() do Python). Resultado em produção: a
  // primeira linha do horário dizia "0", e todos os outros dias saíam
  // deslocados em um (o weekday 1, que é terça, virava "Segunda-feira").
  // O mapa local fica só para day_label ausente, com a numeração DO CONTRATO.
  // Os formatadores de /info (dia da semana, períodos, endereço) moram em
  // scripts/services/store-info-format.js — o rodapé e a tela de informações
  // leem DALI, para as duas superfícies nunca divergirem de novo.

  // ── /info chegou: reparte entre as superfícies ──
  //
  // O modal de informações e a subtela de info do Perfil moram em
  // screens/store-info-screen.js; a tela registra 'renderStoreInfoState' no
  // registro de ações (que aqui serve de barramento: o page anuncia o estado,
  // a tela desenha o que é dela). O que continua daqui — rodapé, pagamento do
  // perfil, contatos da Ajuda, formas de pagamento do checkout — é chamado
  // pelo nome, como sempre foi.
  function renderRestaurantInfo(data) {
    window.RapidexActions.resolve('renderStoreInfoState')?.({ status: 'success', data });
    renderFooterInfo(data);
    renderProfilePaymentScreen(data);
    renderProfileHelpContacts(data);
    renderCheckoutPaymentMethods(data);
  }

  function renderRestaurantInfoLoading() {
    window.RapidexActions.resolve('renderStoreInfoState')?.({ status: 'loading' });
  }

  function renderRestaurantInfoError() {
    window.RapidexActions.resolve('renderStoreInfoState')?.({ status: 'error' });
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
    // hasBlockingUiOpen e unlockBodyScroll saíram: o último usuário daqui era
    // a folha do cupom, que agora os lê direto de PedeAquiRestaurantUi.
    lockBodyScroll,
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

  /**
   * A PORTA UNICA de fechar modal. Nao e uma segunda implementacao do
   * closeModalId de restaurant-ui.js: e um decorador em volta dele.
   *
   *   restaurant-ui.closeModalId  -> a mecanica (classe, scroll do body, nav)
   *   esta funcao                 -> as regras DESTA tela por cima
   *
   * As regras de cima existem porque o motivo delas nao cabe no arquivo de
   * baixo: manter as categorias do cardapio paradas quando o login fecha, e
   * devolver a sacola grudada quando o seletor de endereco veio do perfil.
   *
   * payment-card-flow.js chamava `PedeAquiRestaurantUi.closeModalId` DIRETO,
   * isto e, entrava por baixo do decorador. Hoje nao muda nada — as regras
   * acima olham `loginModal` e `addrPickerModal`, e o cartao fecha outros tres.
   * Mas era uma segunda porta para a mesma coisa: no dia em que uma regra nova
   * entrasse aqui, ela valeria para o app inteiro MENOS para a tela de cartao,
   * e a falha apareceria longe da linha que a causou. Agora ha uma porta so,
   * publicada em window.closeModalId.
   */
  function closeModalId(id) {
    const keepMenuCatsStable = id === 'loginModal' && document.body.classList.contains('menu-tab');
    const returnsToProfile = id === 'addrPickerModal' && $('addrPickerModal')?.classList.contains('from-profile');
    const menuScrollY = keepMenuCatsStable ? currentScrollY() : 0;
    if (keepMenuCatsStable) document.body.classList.add('menu-login-closing');
    closeUiModalId(id);
    if (id === 'loginModal') {
      resetMenuLoginState();
      if (keepMenuCatsStable) holdMenuScrollPosition(menuScrollY);
      setTimeout(() => document.body.classList.remove('menu-login-closing'), 760);
    }
    if (returnsToProfile) syncCartStickyForActiveView();
  }

  // O tema inteiro sai de UMA cor cadastrada pelo lojista. A derivação (hover,
  // ativo, tons claros, borda) e a guarda de contraste do texto sobre a marca
  // vivem em scripts/utils/brand-theme.js, que é puro e tem teste unitário.
  //
  // Um hex ausente ou inválido cai na cor da PLATAFORMA — que significa "a API
  // não mandou cor", nunca "use a marca do tenant X".
  //
  // QUANDO ELA RODA IMPORTA. Até 03/09/2026 esta chamada era a penúltima do
  // boot, depois de um segundo ida-e-volta de rede, embora a cor chegue no
  // primeiro. E como as superfícies de marca transicionam (0,15 a 0,25 s), a
  // troca da paleta padrão — que é a cor da PLATAFORMA — pela do lojista era uma
  // animação, e o loader saía no meio dela: num tenant azul, 15 elementos ainda
  // laranja no instante da revelação. Hoje ela roda assim que o /menu responde,
  // e `body.app-booting *{transition:none}` (styles/restaurant.css) faz a troca
  // ser um repaint em vez de uma animação. Guardado por tenant-theme.spec.js,
  // no teste que NÃO congela transições.
  function applyTheme() {
    const config = window.APP_CONFIG || {};
    const palette = window.RapidexTheme.applyBrandTheme(
      restaurant.primary_color || config.PLATFORM_BRAND_PRIMARY,
      restaurant.secondary_color || config.PLATFORM_BRAND_SECONDARY
    );
    // O loader ainda está na tela neste ponto. A primeira visita não tem cache,
    // então esta é a escrita que torna os pontos visíveis — já na cor real.
    window.RapidexBootTint?.paintTint?.(palette['--brand-primary']);
    // A COR DE HOJE PAGA O LOADER DE AMANHÃ. Os três pontinhos do boot pintam
    // com --app-loader-dot, que nasce transparente; sem isto aqui ele nunca
    // apareceria na primeira visita. Guardado por slug, como o
    // carrinho. Ver scripts/utils/boot-tint.js.
    //
    // Grava o que a PALETA recebeu, não `restaurant.primary_color` cru: um hex
    // inválido do backend vira a cor da plataforma dentro do brand-theme, e
    // gravar o cru ressuscitaria o laranja na visita seguinte.
    //
    // E SÓ GRAVA SE O LOJISTA CADASTROU COR. Sem `primary_color` a paleta é a
    // da PLATAFORMA — guardá-la seria escrever o laranja do Rapidex no cache
    // do tenant e reintroduzir, da segunda visita em diante, exatamente o
    // defeito que este bloco existe para fechar. Loja sem cor fica no cinza
    // neutro, que é a resposta certa para "não sei qual é a marca desta loja".
    if (restaurant.primary_color) {
      window.RapidexBootTint?.rememberTint?.(getRestaurantSlug(), palette['--brand-primary']);
    }
    // Sem o sufixo da plataforma: a aba é da loja, e o cliente que abriu isto
    // não sabe o que é Rapidex.
    document.title = `${restaurant.name || fallback().restaurantName || ''} — Pedido Online`;
    // Mesma cor e mesmo nome que acabaram de entrar na tela vão para o manifest,
    // para o favicon, para o ícone da tela inicial e para as meta de
    // compartilhamento: a aba, o app instalado e o link compartilhado precisam
    // ser do restaurante, não da plataforma.
    //
    // logo_path é caminho relativo do bucket, não URL — ele só é aceito aqui
    // porque remoteLogo() descarta o que não for http(s) absoluto e cai na
    // marca gerada, que é a resposta certa para "não tem logo utilizável".
    window.RapidexPWA?.applyTenantManifest({
      name: restaurant.name || fallback().restaurantName || '',
      themeColor: restaurant.primary_color || config.PLATFORM_BRAND_PRIMARY,
      logoUrl: restaurant.logo_url || restaurant.logo_path,
      description: restaurant.description || ''
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
    // A CAIXA VEM POR PARÂMETRO porque os três destinos têm tamanhos
    // DIFERENTES — medidos no app a 390x844, não lidos da folha: 45 no
    // cabeçalho, 150 na folha de login, 95 nas Informações. Uma caixa fixa aqui
    // pediria a largura errada para dois deles, e pedir 150 para um círculo de
    // 45 é o mesmo desperdício de antes com outro número.
    const renderLogo = (container, box) => {
      if (!container) return;
      container.replaceChildren();
      if (!logoUrl) {
        container.appendChild(fallbackLogo());
        return;
      }
      const image = document.createElement('img');
      image.src = logoUrl;
      // O `src` continua sendo o ORIGINAL de propósito (ver o cabeçalho de
      // image-cdn.js): se a transformação falhar, o browser ainda tem uma URL
      // boa. Quem escolhe a derivada é o `srcset` abaixo.
      applyResponsiveImage(image, logoUrl, { box });
      image.alt = restName;
      image.loading = 'eager';
      image.decoding = 'async';
      image.fetchPriority = 'high';
      // SEM `{ once: true }`: o primeiro erro recua para o original e o
      // fallback só vale no SEGUNDO, quando nem o original veio.
      image.addEventListener('error', () => {
        if (window.RapidexImageCdn?.retreat?.(image)) return;
        container.replaceChildren(fallbackLogo());
      });
      container.appendChild(image);
    };
    renderLogo(document.querySelector('.mob-logo'), LOGO_BOX.cabecalho);
    renderLogo($('loginLogo'), LOGO_BOX.login);
    renderLogo($('infoStoreLogo'), LOGO_BOX.info);

    // O cartão de conferência do Pix mostra a MARCA da loja, não as iniciais:
    // ali o cliente confere para quem está prestes a pagar, e uma sigla não
    // confirma nada. Não usa renderLogo() porque o fallback de lá é a caixa
    // .mob-logo-fallback, grande demais para um avatar de 32px — aqui o que
    // sobra são as iniciais que o loop acima já escreveu.
    const pixAvatar = $('pixOrderLogo');
    if (pixAvatar && logoUrl) {
      const avatarImage = document.createElement('img');
      avatarImage.src = logoUrl;
      applyResponsiveImage(avatarImage, logoUrl, { box: LOGO_BOX.pix });
      avatarImage.alt = '';
      avatarImage.decoding = 'async';
      avatarImage.addEventListener('error', () => {
        if (window.RapidexImageCdn?.retreat?.(avatarImage)) return;
        pixAvatar.textContent = initials(restName);
      });
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
    // A PINTURA DE ANTES DO /info SEGUE A MESMA REGRA das linhas de contato:
    // contato que nao existe nao ganha linha (ver o bloco em
    // screens/store-info-screen.js, que reescreve isto quando o /info chega).
    //
    // Este ramo escrevia "Telefone nao informado" / "E-mail nao informado" /
    // "WhatsApp nao informado" e era ele quem ficava na tela enquanto o /info
    // estava em voo — ou para sempre, se ele falhasse. O e-mail nunca vem no
    // /menu (restaurant.email/settings.email jamais existiram no contrato),
    // entao a linha dele nasce escondida aqui e so aparece se o /info trouxer.
    const esconderLinhaDeContato = (el, valor) => {
      el.textContent = valor || '';
      const row = el.closest('.store-contact-row');
      if (row) row.hidden = !valor;
    };
    document.querySelectorAll('.store-info-phone').forEach(el => esconderLinhaDeContato(el, branch.phone));
    document.querySelectorAll('.store-info-email').forEach(el => esconderLinhaDeContato(el, ''));
    // O ROTULO E O NUMERO QUE O LINK ABRE. Esta linha e um <a>: mostrar o campo
    // inteiro ("(85) 3025-3303 / (85) 3025-7808") num link que abre so o primeiro
    // e prometer dois e cumprir um. Quando nao ha numero com DDD o rotulo vem
    // vazio e a linha se esconde — que e o mesmo desfecho do href logo abaixo.
    document.querySelectorAll('.store-info-whatsapp').forEach(el => esconderLinhaDeContato(el, window.PedeAquiContactLink.whatsAppLabel(branch.whatsapp || '')));
    document.querySelectorAll('.store-contact-row--wa').forEach(el => {
      // O 55 NÃO se prega sempre: aqui ele era, e quem digitou o país no
      // cadastro virava `wa.me/555541...`. Quem decide é utils/contact-link.js,
      // por comprimento — a mesma regra que a tela do entregador e o Perfil já
      // usavam, e que este sítio contrariava.
      const href = window.PedeAquiContactLink.whatsAppHref(branch.whatsapp || branch.phone || '');
      if (href) el.href = href;
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
    // O chip "fecha às HH:MM" (#mobCloseTime) NÃO EXISTE no markup — o id não
    // aparece em restaurant.html (só uma regra órfã de .mob-close-time no
    // utilities.css). O código que o alimentava lia closing_time/close_time do
    // /menu, campos que também nunca existiram: fantasma escrevendo em
    // fantasma. Saiu. Se o produto quiser o chip de volta, a hora certa mora
    // em /info (business_hours[current_weekday].periods[].closes_at) — ver
    // infoTodayHours().
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
    const email = branch.email || '';
    // Os três hrefs saem do MESMO dono (utils/contact-link.js). O `tel:` era
    // `onlyDigits()` no campo inteiro, e o telefone do piloto tem DOIS números
    // ("(85) 3025-3303 / (85) 3025-7808"): o link discava os vinte dígitos
    // grudados, sem sintoma na tela, porque o rótulo mostra o texto original.
    const contato = window.PedeAquiContactLink;
    const whatsappHref = contato.whatsAppHref(whatsapp);
    const telefoneHref = contato.telHref(phone);
    const emailHref = contato.mailHref(email);

    // CONTATO QUE NAO EXISTE NAO GANHA LINHA — a mesma regra que o e-mail do
    // #infoModal ja seguia desde 03/09/2026, agora nas tres linhas e nas tres
    // superficies. "Telefone nao informado" nao e informacao: e uma linha do
    // cartao gasta para dizer que nao ha nada ali, e numa loja que nao
    // preencheu nenhum dos tres a tela inteira virava tres frases anunciando
    // ausencia, com icone e tudo, embaixo de "entre em contato conosco pelos
    // seguintes meios".
    //
    // O `href` de placeholder ('#') sai junto: um <a> que leva a lugar nenhum
    // e um alvo de toque que promete e nao cumpre.
    const linhasDeContato = [
      telefoneHref && `
        <a class="help-store-contact" href="${esc(telefoneHref)}">
          <span class="help-store-contact-icon">${HELP_PHONE_ICON}</span>
          <span>${esc(contato.telLabel(phone))}</span>
        </a>`,
      emailHref && `
        <a class="help-store-contact" href="${esc(emailHref)}">
          <span class="help-store-contact-icon help-store-contact-at" aria-hidden="true">@</span>
          <span>${esc(String(email).toUpperCase())}</span>
        </a>`,
      whatsappHref && `
        <a class="help-store-contact help-store-contact--whatsapp" href="${esc(whatsappHref)}" target="_blank" rel="noopener">
          <span class="help-store-contact-icon">${HELP_WHATSAPP_ICON}</span>
          <span>${esc(contato.whatsAppLabel(whatsapp))}</span>
        </a>`
    ].filter(Boolean);

    // Sem contato NENHUM, o convite e a divisoria tambem saem: "entre em
    // contato conosco pelos seguintes meios" seguido de nada e pior que o
    // silencio, e uma divisoria separa o cartao do vazio.
    card.innerHTML = `
      <div class="help-store-logo" aria-hidden="true">
        ${logoUrl ? `<img src="${esc(logoUrl)}"${responsiveImageAttrs(logoUrl, { box: LOGO_BOX.ajuda })} alt="">` : `<span>${esc(initials(name))}</span>`}
      </div>
      <div class="help-store-name">${esc(name)}</div>
      <div class="help-store-branch">${esc(branchName)}</div>
      ${linhasDeContato.length ? `
      <p class="help-store-intro">Se precisar de ajuda, entre em contato conosco pelos<br> seguintes meios:</p>
      <div class="help-store-divider"></div>
      <div class="help-store-contacts">${linhasDeContato.join('')}</div>` : ''}`;

    const logo = card.querySelector('.help-store-logo');
    const logoImg = logo?.querySelector('img');
    logoImg?.addEventListener('error', () => {
      if (window.RapidexImageCdn?.retreat?.(logoImg)) return;
      const fallbackElement = document.createElement('span');
      fallbackElement.textContent = initials(name);
      logo.replaceChildren(fallbackElement);
    });
  }

  // Coluna "Informações" do rodapé. Era markup fixo com o horário e o couvert de
  // um restaurante só; agora sai da API, e o que a API não informa não aparece.
  function renderFooterInfo(infoData = null) {
    const hoursEl = $('footerHours');
    if (hoursEl) {
      // opening_hours_text/business_hours_text nunca existiram em resposta
      // nenhuma — a linha de horário do rodapé ficou escondida desde que o
      // markup fixo saiu. O que a API tem é business_hours no /info; o rodapé
      // responde a pergunta de hoje.
      const info = infoData || (restaurantInfoState.status === 'success' ? restaurantInfoState.data : null);
      const F = window.PedeAquiStoreInfoFormat;
      const today = F.todayHours(info);
      const text = today ? `Hoje: ${F.formatHoursLine(today)}` : '';
      hoursEl.textContent = text;
      hoursEl.hidden = !text;
    }
    const feeEl = $('footerServiceFee');
    if (feeEl) {
      const feeAmount = asFiniteNumber(settings.service_fee_amount);
      // service_fee_description/service_fee_note não existem no contrato.
      const parts = [];
      if (feeAmount != null && feeAmount > 0) parts.push(`Taxa de serviço: ${fmt(feeAmount)}`);
      feeEl.textContent = parts.join(' · ');
      feeEl.hidden = !parts.length;
    }
  }

  // O carrossel do hero (banners, autoplay, swipe) mora em
  // screens/home-screen.js.

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

  // Vitrine de cupons, destaques e visibilidade das seções da home moram em
  // screens/home-screen.js (ação-barramento renderHomeContent).

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

  /**
   * Busca o cardápio DAQUELA filial. `branchId` nulo é a vitrine: vale a filial
   * padrão do backend, e é o que o primeiro acesso vê enquanto o cliente não
   * escolheu a loja.
   */
  function fetchMenuPayload(branchId) {
    // Direto no MenuService — que e quem normaliza o payload. Antes esta linha
    // chamava PedeAquiRestaurantService.getRestaurantMenu(), cujo corpo inteiro
    // era `return window.PedeAquiMenuService.getRestaurantMenu(...)`.
    return window.PedeAquiMenuService.getRestaurantMenu(getRestaurantSlug(), branchId || null);
  }

  /**
   * Assume a carga como a verdade da tela — inclusive DE QUAL FILIAL ela é.
   *
   * `menuBranchId` sai da resposta, nunca do que foi pedido: é a resposta que
   * sabe em qual loja o backend acabou caindo, e é esse valor que as telas
   * comparam para descobrir que estão mostrando o cardápio de outra.
   *
   * Listas ausentes viram VAZIAS, e não "o que já estava aí": manter os
   * produtos da filial anterior é exatamente o defeito que esta carga existe
   * para desfazer.
   */
  function applyMenuPayload(fresh) {
    payload = fresh || {};
    restaurant = payload.restaurant || restaurant || {};
    settings = payload.settings || {};
    menuBranchId = payload.branch_id || null;
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
    return payload;
  }

  /** O cardápio carregado é de outra loja que não a escolhida. */
  function menuBranchIsStale() {
    // Antes de o contexto de operação existir não há escolha contra a qual
    // comparar — e a carga do boot é, por construção, a que acabou de chegar.
    if (!operationContext) return false;
    return String(menuBranchId || '') !== String(operationContext.branch_id || '');
  }

  async function ensureMenuLoaded() {
    // Cardápio de outra filial não é "já carregado": os ids são de outra loja,
    // e servir isto é mostrar preço da Matriz na tela de quem escolheu a
    // Varjota. Cai no caminho de busca, com a filial certa.
    if (menuBranchIsStale()) {
      appState.menuLoaded = false;
      menuRenderSignature = null;
      categories = [];
      products = [];
    }
    if (appState.menuLoaded && $('menuContainer')?.querySelector('.menu-section')) {
      await waitForMenuCriticalMedia();
      return;
    }
    if (appState.menuLoaded) {
      renderMenu();
      await waitForMenuCriticalMedia();
      return;
    }
    if (products.length && categories.length) {
      renderMenu();
      initScrollSpy();
      initProductPressFeedback();
      setFirstCategoryActive();
      await waitForMenuCriticalMedia();
      return;
    }
    if (menuLoadPromise) return menuLoadPromise;
    setLoading('menu', true);
    if ($('catNav')) $('catNav').innerHTML = '';
    renderSectionLoader('menuContainer', 'Carregando cardápio...', 'menu-skeleton');
    menuLoadPromise = (async () => {
      try {
        if (!products.length || !categories.length) {
          applyMenuPayload(await fetchMenuPayload(operationContext?.branch_id));
        }
        await wait(TAB_LOADER_MIN_MS);
        renderMenu();
        initScrollSpy();
        initProductPressFeedback();
        setFirstCategoryActive();
        await waitForMenuCriticalMedia();
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
    setMobNavActive('mobNavHome');
    syncCartStickyForActiveView();
  }

  function showMenuTab() {
    document.body.classList.remove('home-tab');
    document.body.classList.add('menu-tab');
    setMobNavActive('mobNavMenu');
    syncCartStickyForActiveView();
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

  function jumpToTop() {
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
    const normalizeSearch = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    $('searchInput')?.addEventListener('input', (e) => {
      const input = e.target;
      const q = normalizeSearch(input.value);
      const isSearching = Boolean(q);
      input.closest('.search-bar')?.classList.toggle('has-value', isSearching);
      document.body.classList.toggle('menu-search-active', isSearching);
      if (searchFrame) cancelAnimationFrame(searchFrame);
      searchFrame = requestAnimationFrame(() => {
        let foundAny = false;
        const sections = menuSectionsCache.length ? menuSectionsCache : Array.from(document.querySelectorAll('.menu-section'));
        sections.forEach(sec => {
          let secFound = false;
          sec.querySelectorAll('.product-card').forEach(card => {
            const productName = card.querySelector('.product-name')?.textContent || '';
            const match = !isSearching || normalizeSearch(productName).includes(q);
            card.classList.toggle('is-search-hidden', !match);
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

  // O modal de produto (abrir, opções, quantidade, observação) mora em
  // screens/product-screen.js.

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


  // ── addDraftToCart: a ÚNICA porta pela qual o modal de produto escreve na
  // sacola. O rascunho traz tudo decidido (produto, qty, obs, preço visual,
  // opções em payload e em snapshot); aqui só se grava, no shape LOCAL da
  // sacola (unit_price/selected_options_snapshot são deste lado — não são os
  // nomes da API, ver a nota metodológica da auditoria no scratchpad).
  function addDraftToCart({ product, qty, obs, unitPrice, selected_options, selected_options_snapshot, editingUid }) {
    const cartItem = window.PedeAquiCartService?.normalizeCartItem?.(product, qty, obs)
      || { ...product, qty, obs, uid: newCartItemUid() };
    if (editingUid) cart = cart.filter(item => item.uid !== editingUid);
    cart.push({
      ...cartItem,
      price: Number(product.price),
      base_price: Number(product.price),
      unit_price: unitPrice,
      visual_unit_price: unitPrice,
      selected_options,
      selected_options_snapshot
    });
    closeModalId('productModal');
    updateCartUI();
  }

  // Trampolins: o assistente chama window.openProduct e a suíte E2E dirige a
  // sacola por window.changeQty/window.addToCart. DECLARAÇÃO de função (TDZ).
  function openProduct(...args) {
    return window.RapidexActions.resolve('openProduct')?.(...args);
  }
  function changeQty(...args) {
    return window.RapidexActions.resolve('changeQty')?.(...args);
  }
  function addToCart(...args) {
    return window.RapidexActions.resolve('addToCart')?.(...args);
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

  /**
   * O total que o backend calculou para esta sacola COM o cupom.
   *
   * `total_after_coupon` é o nome no contrato (CouponPreviewResponse), e ele
   * não estava na lista: os quatro nomes procurados aqui não existem em lugar
   * nenhum da API. A função devolvia `null` em 100% das chamadas e cartTotals()
   * caía no `beforeDiscount - discount`, refazendo no browser uma conta que já
   * tinha vindo pronta. Enquanto os dois resultados coincidiram ninguém viu;
   * bastava um arredondamento ou um teto de desconto para o número da tela
   * divergir do que o pedido ia cobrar.
   *
   * Os outros nomes ficam como tolerância a versões antigas da resposta, atrás
   * do nome certo.
   */
  function couponPreviewTotal() {
    const preview = couponPreviewData();
    const value = Number(preview.total_after_coupon ?? preview.final_total ?? preview.total_after_discount ?? preview.discounted_total ?? preview.payable_amount);
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

  let benefitCountSyncPromise = null;

  function benefitAvailabilityLabel() {
    const count = clubController.availableBenefitCount();
    if (!Number.isInteger(count)) return 'Benefícios para você';
    return `${count} ${count === 1 ? 'benefício' : 'benefícios'} para você`;
  }

  function appliedBenefitTitle() {
    return selectedCoupon?.title
      || window.PedeAquiCouponFormat?.couponLabel?.(selectedCoupon)
      || 'Benefício aplicado';
  }

  function renderBenefitAction(button) {
    if (!button) return;
    const copy = button.querySelector('.cart-benefit-copy');
    const action = button.querySelector('.cart-benefit-add');
    if (!copy || !action) return;
    const applied = Boolean(selectedCoupon && couponDiscountAmount() > 0);
    button.classList.toggle('has-applied-benefit', applied);
    copy.replaceChildren();
    if (!applied) {
      copy.textContent = benefitAvailabilityLabel();
      action.textContent = 'Adicionar';
      return;
    }

    const title = document.createElement('strong');
    title.textContent = appliedBenefitTitle();
    copy.append(title);
    const code = String(selectedCoupon.code || selectedCoupon.coupon_code || '').trim();
    if (code) {
      const badge = document.createElement('small');
      badge.className = 'cart-benefit-code';
      badge.textContent = code;
      copy.append(badge);
    }
    action.textContent = 'Trocar';
  }

  function syncBenefitActions({ loadCount = true } = {}) {
    document.querySelectorAll('#cartModal .cart-benefit-action').forEach(renderBenefitAction);
    const applied = Boolean(selectedCoupon && couponDiscountAmount() > 0);
    const needsCount = clubController.availableBenefitCount() == null;
    if (!loadCount || applied || !cart.length || !needsCount || !window.PedeAquiCustomerAuth?.getToken?.() || benefitCountSyncPromise) return;
    benefitCountSyncPromise = clubController.ensureClubLoaded().finally(() => {
      benefitCountSyncPromise = null;
      syncBenefitActions({ loadCount: false });
    });
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
    const mapStem = '/assets/icons/cart/cart-location-guest';
    const mapSource = `${mapStem}@1x.webp`;
    if (map && map.getAttribute('src') !== mapSource) {
      // srcset junto com src: com os dois presentes quem decide é o srcset, e
      // um src novo sozinho seria ignorado.
      map.srcset = `${mapStem}@1x.webp 1x, ${mapStem}@2x.webp 2x`;
      map.src = mapSource;
    }
    syncBenefitActions({ loadCount: false });

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
      checkoutTrace('6/11 Confirmar pressionado', {
        formaDePagamento: paymentMethodKey || paymentMethod || null,
        cartaoSalvoSelecionado: selectedSavedCard?.id || null,
        jaTemTokenDoCartao: Boolean(savedCardPaymentToken),
        itensNaSacola: cart.length
      });
      if (selectedSavedCard?.id && !savedCardPaymentToken) {
        // Abre a tela de CVV; o rastro dela é o `[CartaoSalvo]` (A/E a 5/5).
        savedCardPaymentToken = await window.PedeAquiCardFlow?.requestSavedCardToken?.(selectedSavedCard) || '';
        if (!savedCardPaymentToken) {
          checkoutTrace('6/11 PAROU: a tela de CVV não devolveu token');
          return;
        }
      }
      await submitOrder();
    } catch (error) {
      checkoutTrace('6/11 PAROU: erro antes de criar o pedido', errorTrace(error));
      if (error?.message !== 'Pagamento cancelado.') logAppError('Falha ao confirmar o cartão salvo', error);
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
        ? '/assets/icons/cart/cart-location-customer'
        : '/assets/icons/cart/cart-location-guest';
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
    syncCartStickyForActiveView();
    renderSharedCashbackState();

    if ($('cartContent')) $('cartContent').style.display = 'block';
    if ($('cartFooter')) $('cartFooter').style.display = 'block';
    if ($('cartOrderCard')) $('cartOrderCard').style.display = qty ? '' : 'none';
    syncCartLocationState();
    syncBenefitActions();

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
    // A linha da taxa aparece quando há taxa; some quando não há — nunca um
    // "R$ 0,00" solto. setProperty com important porque a folha declara
    // display:flex!important na .cps-row e um style inline comum perderia.
    $('csSvcFeeRow')?.style.setProperty('display', totals.svc > 0 ? 'flex' : 'none', 'important');
    // TAXA DESCONHECIDA NÃO É TAXA ZERO, e esta linha dizia que era.
    //
    // `deliveryFee()` devolve `currentDeliveryEstimateFee() ?? 0` — quando a
    // estimativa falha (422 da rota) ou nem é pedida (endereço incompleto: o
    // `deliveryEstimateKey()` devolve null), o total sai SEM o frete. Isso é
    // por construção, e quem impede o estrago é `hasValidDeliveryEstimateFee()`
    // barrando a criação do pedido.
    //
    // O que estava errado era a LINHA: ela escrevia `R$ 0,00`, afirmando que a
    // entrega é de graça. O cliente lia 68,60 + 0,99 + 0,00 = 69,59 e a conta
    // FECHAVA — uma tela internamente coerente e mentirosa, que é pior do que
    // uma que não fecha. O CLAUDE.md já dizia a regra pela outra ponta:
    // "parcela zerada é linha FORA, nunca um R$ 0,00 solto".
    //
    // "A definir" é o mesmo texto que o markup traz por padrão
    // (restaurant.html:956) e o mesmo que o resto da tela usa enquanto a taxa
    // não chegou. O total continua sem o frete — mudá-lo é outra conversa, e o
    // pedido está barrado de qualquer forma.
    $('csDelivery').textContent = deliveryType === 'delivery'
      ? (hasValidDeliveryEstimateFee() ? fmt(totals.delivery) : 'A definir')
      : 'Grátis';
    // O desconto do cupom, com o sinal que ele tem na conta. Sem esta linha as
    // parcelas de cima somavam mais do que o Total de baixo e o cliente via
    // dinheiro sumir sem explicação — mesma classe do R$ 0,99 da taxa de
    // serviço, que já tinha custado um defeito. O valor é `discount_amount`,
    // do contrato (CouponPreviewResponse), e NÃO uma subtração feita aqui.
    $('csDiscount').textContent = `- ${fmt(totals.discount)}`;
    $('csDiscountRow')?.style.setProperty('display', totals.discount > 0 ? 'flex' : 'none', 'important');
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

  // editCartItem é ação registrada por screens/product-screen.js.

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
    await Promise.all([
      ensureRestaurantInfo(),
      window.PedeAquiPaymentConfigService?.getPaymentConfig?.(getRestaurantSlug()).catch(() => null)
    ]);
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
        <button class='prof-card-coming-soon' type='button' ${act('click', 'openAddCardTypeScreen')} hidden>Cadastrar novo cartão</button>
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
    if (overlay && paymentMethod) {
      overlay.dataset.paymentValue = paymentMethod;
      overlay.dataset.paymentKey = confirmedKey;
    } else {
      overlay?.removeAttribute('data-payment-value');
      overlay?.removeAttribute('data-payment-key');
    }
    syncPaymentMethodFooter();
    overlay?.classList.remove('is-entered', 'is-closing');
    openModal('paymentMethodModal');
    window.PedeAquiCardFlow?.refreshPaymentMethods?.({
      branchAcceptsOnlineCard: branchAcceptsOnlineCard()
    });
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

  /**
   * Esta entrada de /info é cartão de crédito NO GATEWAY?
   *
   * `api_method_type` é a grafia do BACKEND (`credit_card`) e é ela que o
   * pedido manda em `payment_method`; `method_type` é a chave normalizada da
   * UI (`credit`). Conferimos as duas porque `/info` existe em duas formas no
   * ambiente real (ver infoPaymentData) e nem sempre traz a original.
   */
  const isOnlineCardEntry = entry =>
    String(entry?.api_method_type || '').trim().toLowerCase() === 'credit_card'
    || entry?.method_type === 'credit';

  /**
   * Esta filial aceita cartão ONLINE?
   *
   * ⚠️ São DUAS perguntas diferentes, e o front só fazia uma:
   *
   *   1. "o restaurante tem credencial de gateway?" — `/payment-config`
   *      (`card_enabled`). É do RESTAURANTE.
   *   2. "esta filial habilitou credit_card no grupo `online`?" — `/info`.
   *      É da FILIAL, e é ela que decide o `payment_flow` do pedido.
   *
   * O backend resolve o fluxo por (2): `_resolve_payment_flow` procura as
   * linhas de `branch_payment_methods` com aquele `method_type` e devolve
   * "online" só se alguma delas for online. Com `credit_card` habilitado
   * apenas como `delivery` — a maquininha na porta —, o pedido nascia
   * `payment_flow: "delivery"` mesmo com o cartão salvo escolhido e o token
   * já gerado: cartão tokenizado, nenhuma cobrança, e o pedido indo para a
   * cozinha como "paga na entrega".
   */
  function branchAcceptsOnlineCard(data = restaurantInfoState.data) {
    return (infoPaymentData(data)?.online || []).some(isOnlineCardEntry);
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
    // O cartão salvo só é uma forma DISPONÍVEL onde a filial aceita cartão
    // online. Antes esta chave entrava incondicionalmente, e era ela que
    // deixava escolher um cartão que a filial não cobra pelo gateway — o
    // pedido nascia `payment_flow: "delivery"` e ninguém cobrava nada.
    //
    // Não estando na lista, `paymentMethod` selecionado se limpa sozinho logo
    // abaixo: é o que faz trocar de filial derrubar o cartão escolhido na
    // anterior, em vez de levá-lo para uma loja que não o aceita.
    if (selectedSavedCard?.id && groups.online.some(isOnlineCardEntry)) {
      const savedKey = `credit:${selectedSavedCard.id}`;
      availableCheckoutPaymentKeys.add(savedKey);
      paymentApiTypeByKey.set(savedKey, 'credit_card');
      paymentScopeByKey.set(savedKey, 'online');
    }
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
      // O cartão cai JUNTO quando era ele o método derrubado. Deixá-lo
      // pendurado é estado morto: a filial nova não o aceita, e um
      // `selectedSavedCard` sem método escolhido só serve para confundir as
      // guardas do checkout mais adiante.
      if (String(selectedKey || '').startsWith('credit:')) {
        selectedSavedCard = null;
        savedCardPaymentToken = '';
      }
    }
    buttons.forEach(button => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    if ($('checkoutPaymentLabel')) $('checkoutPaymentLabel').textContent = paymentMethod || 'Selecione a forma de pagamento';
  }

  function commitPaymentMethod(value, key) {
    if (!String(key || '').startsWith('credit:')) {
      selectedSavedCard = null;
      savedCardPaymentToken = '';
    }
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

  // Uma implementacao so, em services/card-format.js: esta tabela existia aqui
  // e, identica, em payment-card-flow.js.
  const savedCardBrandLabel = (value) => window.PedeAquiCardFormat.cardBrandLabel(value);

  function selectSavedCardPayment(card) {
    if (!card?.id) return;
    selectedSavedCard = card;
    savedCardPaymentToken = '';
    const key = `credit:${card.id}`;
    const label = `Crédito - ${savedCardBrandLabel(card.brand)} •••• ${card.last_four_digits || ''}`.trim();
    paymentApiTypeByKey.set(key, 'credit_card');
    paymentScopeByKey.set(key, 'online');
    availableCheckoutPaymentKeys.add(key);
    commitPaymentMethod(label, key);
    const overlay = $('paymentMethodModal');
    if (overlay) {
      overlay.dataset.paymentValue = label;
      overlay.dataset.paymentKey = key;
    }
    closeProfSub();
    returnToCartFromPayment();
  }

  function clearSavedCardPayment(cardId) {
    if (paymentMethodKey !== `credit:${cardId}`) return;
    selectedSavedCard = null;
    savedCardPaymentToken = '';
    paymentMethod = '';
    paymentMethodKey = '';
    updateCartUI();
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

  function currentCardPaymentPayload() {
    if (!selectedSavedCard?.id || !savedCardPaymentToken) return null;
    return {
      saved_card_id: selectedSavedCard.id,
      token: savedCardPaymentToken
    };
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

  /**
   * A sacola é DA LOJA, não do restaurante.
   *
   * Os ids de produto não se repetem entre filiais desde 20/08/2026: um item da
   * Matriz enviado no pedido da Varjota volta 400 "Produto inválido ou
   * indisponível", sem dizer qual. Com a filial na chave, trocar de loja não
   * perde nada — a sacola de cada uma fica onde estava, e voltar a encontra.
   *
   * Sem filial (restaurante sem nenhuma ativa) a chave é a antiga, que é também
   * o que a migração em readStoredCart() procura.
   */
  const cartStorageKey = (branchId = operationContext?.branch_id) =>
    (storageKeys()?.PREFIXES.cart || 'rapidex.cart.') + getRestaurantSlug()
    + (branchId ? `::${branchId}` : '');

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

  /**
   * A sacola desta filial, adotando a que ficou na chave antiga.
   *
   * Até 20/08/2026 a chave era só o slug. Aquela sacola foi montada no cardápio
   * da filial padrão, que é a mesma que o cliente vê no primeiro acesso — então
   * ela é adotada pela loja atual UMA vez, e o filtro de restoreCart() descarta
   * o que não existir nela. Sem isto, quem tinha sacola aberta a veria sumir no
   * primeiro carregamento depois do deploy.
   */
  function readStoredCart() {
    try {
      const key = cartStorageKey();
      const legacyKey = cartStorageKey(null);
      let raw = localStorage.getItem(key);
      if (raw === null && key !== legacyKey) {
        raw = localStorage.getItem(legacyKey);
        if (raw !== null) {
          localStorage.setItem(key, raw);
          localStorage.removeItem(legacyKey);
        }
      }
      return JSON.parse(raw || 'null');
    } catch {
      return null;
    }
  }

  function restoreCart() {
    const stored = readStoredCart();
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

  // ---- A CHAVE QUE O SERVIDOR RECUSA: 422 de corpo diferente ----
  //
  // `POST /orders` responde 422 quando a chave já foi usada com OUTRO corpo
  // (`IdempotencyService.begin`). Isso NÃO é dado inválido, e tratá-lo como
  // dado inválido — que era o que acontecia até aqui — produz os dois piores
  // desfechos possíveis:
  //
  //   1. a chave era preservada no `catch`, então tocar de novo mandava a MESMA
  //      chave e recebia o MESMO 422: laço fechado, o cliente nunca pede;
  //   2. quem recarregasse a página escaparia do laço com uma chave nova — e
  //      criaria um SEGUNDO pedido, que é exatamente o que a chave existe para
  //      impedir.
  //
  // QUANDO ISSO ACONTECE. O fingerprint do servidor sai de `model_dump()` do
  // corpo inteiro, então **qualquer campo novo no `CreateOrderRequest` muda o
  // hash de todo corpo**. `use_cashback` é o campo que entra agora (ele muda o
  // total, então conflito é a resposta certa), e o preço é 24h de 422 para
  // chave reservada ANTES do deploy e retentada DEPOIS. É a armadilha 37 do
  // backend, e é isto que este bloco existe para tolerar.
  //
  // O QUE ELE DIZ SOBRE O PEDIDO, e é a parte que decide a frase na tela: a
  // reserva da chave vive na MESMA transação do INSERT do pedido
  // (`OrderService.create`, comentário do `idempotency_service.begin`), então
  // um erro adiante a solta junto com o rollback. Linha que sobreviveu =
  // pedido que COMMITOU. Ou seja: quem recebe este 422 quase certamente JÁ TEM
  // o pedido gravado, e só não viu a resposta (timeout, queda de rede).
  // Reenviar sozinho seria duplicar o pedido de alguém — por isso aqui a chave
  // é rotacionada mas NÃO há retentativa automática: quem decide é o cliente,
  // com a informação na mão.
  //
  // COMO SE RECONHECE, e por que não pelo texto. O backend avisa que só a
  // frase separa este 422 dos outros, mas há um sinal ESTRUTURAL melhor: o 422
  // de validação do FastAPI traz `detail` como ARRAY de `{loc,msg,type}`; este
  // traz uma STRING. Conferido no spec: em `POST /restaurants/{slug}/orders`
  // esta é a única fonte de 422 com `detail` string. Casar a prosa quebraria
  // no dia em que alguém corrigir um acento nela.
  function isRecycledIdempotencyKey(error) {
    if (Number(error?.status) !== 422) return false;
    return typeof error?.data?.detail === 'string';
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
    if (isRecycledIdempotencyKey(error)) {
      // A frase NÃO pode ser "revise e tente novamente": os dados estão certos,
      // e o pedido provavelmente já existe (ver `isRecycledIdempotencyKey`).
      // Mandar conferir antes de reenviar é a única instrução que não arrisca
      // um pedido duplicado — e ela muda conforme haja onde conferir: sem
      // conta, a lista de pedidos não existe nesta tela.
      return isLogged()
        ? 'Sua tentativa anterior pode ter sido concluída. Confira em Meus pedidos antes de enviar de novo — se o pedido não estiver lá, toque em Efetuar pagamento novamente.'
        : 'Sua tentativa anterior pode ter sido concluída. Confira com o restaurante antes de enviar de novo — se o pedido não tiver chegado, toque em Efetuar pagamento novamente.';
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
    checkoutTrace('7/11 payload do pedido montado', {
      payment_method: orderPayload?.payment_method ?? null,
      order_type: orderPayload?.order_type ?? null,
      itens: orderPayload?.items?.length ?? 0,
      problemas: problems
    });
    if (problems.length) {
      // O aviso mora na sacola, atrás da folha: mostrá-lo com a folha em cima
      // seria escrever para uma tela que o cliente não está vendo.
      closeOrderConfirm();
      showCartOrderProblems(problems);
      return;
    }

    // Cartão selecionado e token ausente = não há como cobrar este pedido.
    // Criá-lo assim produziria um pedido de cartão que a rota de cobrança
    // receberia SEM cartão — ou seja, exatamente o pedido sem pagamento que
    // este fluxo existe para impedir. O caminho normal (confirmOrderFromSheet)
    // já pede o CVV antes; esta é a rede embaixo dele.
    if (selectedSavedCard?.id && !savedCardPaymentToken) {
      checkoutTrace('7/11 PAROU: cartão sem token — pedido NÃO criado', {
        cartaoSalvoSelecionado: selectedSavedCard.id
      });
      closeOrderConfirm();
      showCartOrderError('Não foi possível confirmar o cartão. Informe o CVV novamente para continuar.');
      return;
    }

    hideCartOrderError();
    // Congela o número que o cliente está aprovando NESTE toque. Depois daqui a
    // sacola é esvaziada e cartTotals() passa a devolver zero — comparar mais
    // tarde compararia contra nada.
    confirmedTotalAtSubmit = cartTotals().total;
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
      //
      // A ÚNICA EXCEÇÃO é a chave que o servidor já recusou por corpo
      // diferente: ela está morta, e repeti-la só pode produzir o mesmo 422.
      // Preservá-la aqui é o laço fechado descrito em
      // `isRecycledIdempotencyKey`. Rotacionar é o "gere uma nova chave" que a
      // própria resposta pede — e note que rotacionar NÃO reenvia nada: o
      // próximo toque é do cliente, depois de ler que o pedido pode já existir.
      if (isRecycledIdempotencyKey(error)) resetOrderIdempotencyKey();
      checkoutTrace('7/11 PAROU: POST /orders falhou — nenhum pedido criado', errorTrace(error));
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
    selectedSavedCard = null;
    savedCardPaymentToken = '';
    resetOrderIdempotencyKey(); // próximo pedido = chave nova
    updateCartUI();
    setOrderSubmitting(false);
    if (!confirmationAlreadyClosed) closeOrderConfirm();
    hideCartOrderError();
    closeModalImmediately('cartModal');
  }

  // Só aqui o carrinho pode ser limpo: depois de sucesso confirmado.
  function handleOrderCreated(response) {
    // Antes de qualquer tela: as duas que mostram total leem o resultado daqui.
    evaluateTotalMismatch(response);
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
    const cardPayment = currentCardPaymentPayload();
    checkoutTrace('8/11 pedido criado, decidindo o caminho', {
      order_number: response?.order_number ?? null,
      payment_flow: response?.payment_flow ?? null,
      payment_status: response?.payment_status ?? null,
      temTrackingToken: Boolean(response?.tracking_token),
      pagaComCartao: Boolean(cardPayment)
    });
    if (!isOnlinePaymentFlow(response)) {
      // A CONTRADIÇÃO: o cliente escolheu cartão, tokenizou o CVV, e o pedido
      // voltou "paga na entrega". Não há cobrança e não vai haver — mas o
      // cartão foi digitado, então "pedido feito" sem mais nada leria como
      // "cartão cobrado", que é a leitura mais cara possível.
      //
      // Com a filial gateada (branchAcceptsOnlineCard) isto não deve mais
      // acontecer; se acontecer, é divergência entre /info e o que
      // `branch_payment_methods` responde na criação, e o certo é dizer em voz
      // alta em vez de deixar o cliente descobrir na porta.
      if (cardPayment) {
        checkoutTrace('11/11 FIM: CONTRADIÇÃO — cartão escolhido, pedido nasceu na entrega', {
          payment_flow: response?.payment_flow ?? null,
          payment_status: response?.payment_status ?? null
        });
        logAppError(
          'Pedido de cartão criado com payment_flow=delivery: a filial não aceita cartão online',
          new Error(`payment_flow=${response?.payment_flow}`)
        );
        leaveCartAfterOrder();
        showOrderSuccess({
          ...response,
          message: 'Seu pedido foi registrado para PAGAMENTO NA ENTREGA — o cartão não foi cobrado. Tenha a forma de pagamento em mãos na entrega.'
        });
        return;
      }
      checkoutTrace('11/11 FIM: pagamento na entrega — sem cobrança online', {
        payment_flow: response?.payment_flow ?? null
      });
      leaveCartAfterOrder();
      showOrderSuccess(response);
      return;
    }
    // A cobrança é criada com a folha ainda na frente; a sacola só sai de cena
    // no quadro em que a tela do Pix entra.
    const session = await preparePixPayment(response, {
      items,
      ownsCart: true,
      cardPayment
    });
    // A confirmação deixa de ser interativa, mas a sacola permanece visível
    // atrás enquanto a tela Pix desliza por cima dela.
    setOrderSubmitting(false);
    // Cartão não aprovado: o cliente NÃO pode ver "pedido feito" nem cair na
    // tela do Pix, que é de outra forma de pagamento. Ele fica onde estava —
    // na sacola —, com o motivo e os itens intactos.
    if (session.cardDeclined) {
      failCardCheckout(session.cardDeclined.message);
      return;
    }
    closeOrderConfirm();
    if (!session.cardCompleted) presentPixPayment(session);
  }

  /**
   * Volta ao checkout depois de um cartão não aprovado.
   *
   * Três coisas, e cada uma tem um motivo:
   *
   * 1. `P.pixSession = null` — não há cobrança aberta para retomar. Sem isto o
   *    próximo toque em "Efetuar pagamento" cairia em
   *    resumeCreatedCartPixPayment() e reabriria a tela do Pix do pedido que
   *    acabou de ser recusado, em vez de deixar o cliente tentar de novo.
   * 2. o token do cartão é ZERADO — ele é de uso único no Mercado Pago, e um
   *    token já gasto só produziria a mesma recusa. A retentativa pede o CVV
   *    de novo, que é o gesto certo depois de uma recusa por CVV.
   * 3. a sacola NÃO é tocada. É a regra que vale em todo erro deste arquivo:
   *    falha não pode custar o pedido do cliente.
   *
   * ⚠️ PENDÊNCIA DE BACKEND: o pedido JÁ FOI CRIADO no servidor antes da
   * cobrança — é assim que a API funciona (POST /orders e depois
   * POST /orders/{token}/payment; não há como cobrar um pedido que não existe).
   * O front não tem rota para cancelá-lo (o OpenAPI só expõe o PATCH de status
   * em /admin). Enquanto o backend não cancelar sozinho o pedido online cuja
   * cobrança foi recusada, ele fica registrado sem pagamento.
   */
  function failCardCheckout(message) {
    P.pixSession = null;
    savedCardPaymentToken = '';
    closeOrderConfirm();
    showCartOrderError(message);
  }

  // Totais vêm como number; descontos vêm como string decimal ("0.00").
  // Ver docs/order-contract.md (CreateOrderResponse).
  function orderAmount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * O TÍTULO DA ÚLTIMA TELA, escolhido pelo estado real do pagamento.
   *
   * Ele era fixo no HTML — "Pedido enviado!" — para as QUATRO notícias que
   * esta tela dá, e a notícia de verdade ficava em 13px cinza embaixo. É a
   * §17.4 exata: a frase escolhida por uma categoria larga ("deu certo") em
   * vez do estado, com o agravante de que aqui uma das quatro é RUIM.
   *
   * `failed` chega, sim, e por um caminho concreto: `refreshTrackedOrder()`
   * redesenha esta tela com o que o `track` responder, e um Pix recusado
   * depois do fato vira `payment_status: failed`. Um check verde por cima
   * disso é a §4 desenhada — 200 não é sucesso.
   */
  function orderSuccessHeadline(order) {
    if (!isOnlinePaymentFlow(order)) return { texto: 'Pedido enviado!', alerta: false };
    return ({
      paid: { texto: 'Pagamento aprovado!', alerta: false },
      pending: { texto: 'Pedido enviado!', alerta: false },
      failed: { texto: 'Pagamento não aprovado', alerta: true }
    })[paymentStatusKind(order?.payment_status)] || { texto: 'Pedido enviado!', alerta: false };
  }

  /**
   * "Chega em 30 a 45 minutos" — a pergunta seguinte de quem acabou de pagar.
   *
   * Os dois campos são `integer | null` em `OrderDetailResponse` e NÃO existem
   * em `CreateOrderResponse`: o pedido pago na entrega não passa pelo `track`
   * e chega aqui sem eles. Por isso a linha SOME quando não há prazo, em vez
   * de mostrar um travessão — a mesma regra da §3.1 para dinheiro: parcela
   * zerada é linha fora, nunca um "—" solto.
   *
   * `?? null` e não `||`: zero minuto não existe como prazo, mas a regra da
   * família do `sort_order` vale igual, e escrevê-la certa custa dois
   * caracteres.
   */
  function orderEtaText(order) {
    const min = Number(order?.delivery_eta_min ?? null);
    const max = Number(order?.delivery_eta_max ?? null);
    const temMin = Number.isFinite(min) && min > 0;
    const temMax = Number.isFinite(max) && max > 0;
    if (!temMin && !temMax) return '';
    const retirada = String(order?.order_type || '') === 'pickup';
    const verbo = retirada ? 'Pronto para retirada em' : 'Chega em';
    if (temMin && temMax && max > min) return `${verbo} ${min} a ${max} minutos`;
    return `${verbo} cerca de ${temMax ? max : min} minutos`;
  }

  function showOrderSuccess(response) {
    const order = response || {};
    const setText = (id, value) => { if ($(id)) $(id).textContent = value; };

    // O pedido acompanhado na tela de sucesso: é dele que sai o tracking_token
    // do botão "Atualizar status".
    P.trackedOrder = order.tracking_token ? order : (P.trackedOrder?.id === order.id ? P.trackedOrder : null);

    const headline = orderSuccessHeadline(order);
    setText('ordSuccessTitle', headline.texto);
    $('ordSuccessIcon')?.classList.toggle('is-warning', headline.alerta);

    setText('ordSuccessMessage', order.message || 'Aguardando confirmação do restaurante.');
    setText('ordSuccessNumber', order.order_number != null ? `#${order.order_number}` : '—');

    // O nome da loja NÃO vem no pedido: `CreateOrderResponse` e
    // `OrderDetailResponse` trazem `restaurant_id`, não o nome. Quem sabe o
    // nome é o app, que já o carregou no boot — e é por isso que a linha some
    // quando ele não está lá, em vez de escrever o slug ou um travessão.
    const nomeDaLoja = String(restaurant?.name || '').trim();
    if ($('ordSuccessStoreRow')) $('ordSuccessStoreRow').hidden = !nomeDaLoja;
    if (nomeDaLoja) setText('ordSuccessStore', nomeDaLoja);

    const eta = orderEtaText(order);
    if ($('ordSuccessEtaRow')) $('ordSuccessEtaRow').hidden = !eta;
    if (eta) setText('ordSuccessEta', eta);

    setText('ordSuccessStatus', orderStatusLabel(order.status));
    setText('ordSuccessSubtotal', fmt(orderAmount(order.subtotal)));

    const serviceFeeValue = orderAmount(order.service_fee);
    setText('ordSuccessSvc', fmt(serviceFeeValue));
    if ($('ordSuccessSvcRow')) $('ordSuccessSvcRow').style.display = serviceFeeValue > 0 ? '' : 'none';

    const deliveryFeeValue = orderAmount(order.delivery_fee);
    setText('ordSuccessDelivery', fmt(deliveryFeeValue));
    if ($('ordSuccessDeliveryRow')) $('ordSuccessDeliveryRow').style.display = deliveryFeeValue > 0 ? '' : 'none';

    // DESCONTO E CASHBACK SÃO DUAS LINHAS, e a conta do backend é a razão:
    // `discount_total = coupon_discount + cashback_redeemed`. Lendo só o total
    // — que era o que esta linha fazia — o saldo que o CLIENTE gastou entrava
    // escondido dentro de "Desconto", como se fosse desconto da loja. As duas
    // linhas somam exatamente o `discount_total`; nenhuma conta é feita aqui,
    // os dois números vêm do contrato.
    const cashbackUsado = orderAmount(order.cashback_redeemed_amount);
    const desconto = orderAmount(order.coupon_discount_amount);
    // Fallback para o pedido que só traz o agregado: sem `coupon_discount_amount`
    // e sem cashback, `discount_total` É o desconto do cupom.
    const descontoDoCupom = desconto > 0 || cashbackUsado > 0
      ? desconto
      : orderAmount(order.discount_total);
    if ($('ordSuccessDiscountRow')) $('ordSuccessDiscountRow').hidden = !(descontoDoCupom > 0);
    setText('ordSuccessDiscount', `- ${fmt(descontoDoCupom)}`);
    if ($('ordSuccessCashbackRow')) $('ordSuccessCashbackRow').hidden = !(cashbackUsado > 0);
    setText('ordSuccessCashback', `- ${fmt(cashbackUsado)}`);

    setText('ordSuccessTotal', fmt(orderAmount(order.total)));
    renderTotalMismatch(order, 'ordSuccessMismatchRow', 'ordSuccessMismatch');

    // Linha de pagamento: só faz sentido quando houve cobrança online. Num
    // pedido pago na entrega ela continua ausente, e o cartão fica idêntico ao
    // que sempre foi.
    const paymentLabel = onlinePaymentStatusLabel(order);
    if ($('ordSuccessPaymentRow')) $('ordSuccessPaymentRow').hidden = !paymentLabel;
    if (paymentLabel) setText('ordSuccessPayment', paymentLabel);

    // Botão de acompanhamento: aparece só quando temos o token que o autoriza.
    const trackButton = $('ordSuccessTrackBtn');
    if (trackButton) {
      trackButton.hidden = !P.trackedOrder?.tracking_token;
      trackButton.disabled = false;
      trackButton.textContent = 'Atualizar status do pedido';
    }

    openModal('orderSuccessModal');
  }

  // Um centavo. Abaixo disso é ruído de ponto flutuante (0.1 + 0.2), não
  // divergência: somar reais em Number produz erro na 15ª casa, e acusar isso
  // seria alarme falso em todo pedido.
  const TOTAL_MISMATCH_TOLERANCE = 0.005;

  /**
   * Aviso de divergência do pedido recém-criado: `{ orderId, message }`.
   *
   * Fica preso ao ID do pedido de propósito. As duas telas que mostram total
   * (sucesso e Pix) leem daqui, e reabrir a tela de um pedido ANTIGO não pode
   * herdar a comparação de outro.
   */
  let pendingTotalMismatch = null;

  /**
   * Compara o total que o cliente APROVOU com o total que o pedido TEM.
   *
   * A API não orça pedido: não existe rota que devolva o total antes da
   * criação (/coupons/preview só responde com cupom, /delivery/estimate só a
   * taxa). Então o número da confirmação sai de uma conta feita AQUI
   * (cartTotals: itens + taxa de serviço + frete − desconto) e o número do
   * pedido vem de `order.total`, calculado LÁ. Duas autoridades para o mesmo
   * valor, uma tela de distância.
   *
   * Enquanto as duas contas coincidiram ninguém percebeu — e o fixture do e2e
   * fazia as duas darem 22,14, então nem o teste percebia. Basta uma regra que
   * só o backend conhece (teto de desconto, arredondamento, taxa por
   * modalidade) para o cliente confirmar um número e pagar outro, sem uma
   * palavra.
   *
   * Não dá para IMPEDIR a divergência daqui: quando ela aparece o pedido já
   * existe, com o total do servidor, que é o que vale. O que dá para fazer é
   * parar de trocar de número em silêncio — dizer o que foi confirmado, dizer o
   * que ficou, e registrar os dois no console para a causa ser investigável.
   *
   * Roda UMA vez por pedido, em handleOrderCreated.
   */
  function evaluateTotalMismatch(order) {
    const confirmed = confirmedTotalAtSubmit;
    confirmedTotalAtSubmit = null;
    pendingTotalMismatch = null;
    if (!Number.isFinite(confirmed)) return;

    const finalTotal = orderAmount(order?.total);
    if (Math.abs(finalTotal - confirmed) <= TOTAL_MISMATCH_TOLERANCE) return;

    logAppError(
      'Total divergente entre a confirmação e o pedido criado',
      new Error(`confirmado=${confirmed.toFixed(2)} pedido=${finalTotal.toFixed(2)}`)
    );
    checkoutTrace('ATENÇÃO: total confirmado ≠ total do pedido', {
      confirmado: confirmed,
      pedido: finalTotal,
      diferenca: Number((finalTotal - confirmed).toFixed(2))
    });

    pendingTotalMismatch = {
      orderId: String(order?.id ?? order?.order_number ?? ''),
      // Cobrar MAIS do que foi aprovado é o caso que precisa de ação; cobrar
      // menos é só uma diferença que o cliente tem o direito de ver.
      message: finalTotal > confirmed
        ? `O total ficou ${fmt(finalTotal)}, acima dos ${fmt(confirmed)} que você confirmou. Confira com o restaurante antes de pagar.`
        : `O total ficou ${fmt(finalTotal)}, abaixo dos ${fmt(confirmed)} que você confirmou.`
    };
  }

  /** Desenha o aviso na tela pedida, se ele for DESTE pedido. */
  function renderTotalMismatch(order, rowId, textId) {
    const row = $(rowId);
    const mine = pendingTotalMismatch
      && pendingTotalMismatch.orderId === String(order?.id ?? order?.order_number ?? '');
    if (row) row.hidden = !mine;
    if (mine && $(textId)) $(textId).textContent = pendingTotalMismatch.message;
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

  /**
   * O status do pedido, em português — na tela de pedido criado.
   *
   * ESTA TABELA ESTAVA ERRADA DOS DOIS LADOS, e o fallback era o código CRU.
   * O vocabulário do backend é `ORDER_STATUSES` (core/constants.py):
   * pending, accepted, rejected, preparing, ready, out_for_delivery,
   * completed, cancelled.
   *
   * Faltavam QUATRO dos oito — `accepted`, `rejected`, `out_for_delivery` e
   * `completed` —, e cada um deles caía no `String(status)`: o cliente lia
   * `out_for_delivery` na tela do pedido que acabou de fazer. E sobravam
   * quatro nomes fantasma que a API nunca mandou (`submitted`, `confirmed`,
   * `delivering`, `delivered`), que é a classe de erro da §12.1 da skill —
   * código que mente para quem lê.
   *
   * Os fantasmas ficam como ALIAS, e a distinção importa: eles não são
   * contrato, são tolerância a um backend antigo. Se um deles chegar, a tela
   * diz a frase certa em vez do código.
   */
  const ORDER_STATUS_LABELS = {
    pending: 'Aguardando confirmação',
    accepted: 'Confirmado',
    rejected: 'Recusado',
    preparing: 'Em preparo',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    completed: 'Finalizado',
    cancelled: 'Cancelado',
    // Alias de nomes que não estão em ORDER_STATUSES.
    submitted: 'Enviado',
    confirmed: 'Confirmado',
    delivering: 'Saiu para entrega',
    delivered: 'Entregue',
    canceled: 'Cancelado',
    refused: 'Recusado',
    finished: 'Finalizado'
  };

  function orderStatusLabel(status) {
    const chave = String(status || '').trim().toLowerCase();
    // Sem tabela, um status novo do backend viraria `out_for_delivery` na tela.
    // A frase genérica não informa menos que o código, e não expõe o interno.
    return ORDER_STATUS_LABELS[chave] || (chave ? 'Em andamento' : '—');
  }

  // showAppToast() morava LA DENTRO do bloco do Pix, por acidente de historia —
  // e e um toast do app inteiro: a troca de filial e a falha de cardapio tambem
  // o usam. Subiu para ca, fora do bloco, antes de o bloco virar modulo. Move,
  // nao muda: mesmo corpo, mesma posicao de leitura.
  /**
   * Aviso curto no rodapé, que não interrompe nada.
   *
   * É para o que o cliente precisa VER mas não precisa responder. O caso que o
   * trouxe: ao trocar de loja, dizer que a sacola da anterior ficou guardada —
   * senão a sacola parece ter sumido, que é a leitura errada.
   *
   * Mesma dança do toast do Pix: o [hidden] sai um quadro antes da classe que
   * anima, senão a transição não acontece.
   */
  let appToastTimer = null;
  function showAppToast(message) {
    const toast = $('appToast');
    if (!toast || !message) return;
    clearTimeout(appToastTimer);
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('is-open'));
    appToastTimer = setTimeout(() => {
      toast.classList.remove('is-open');
      appToastTimer = setTimeout(() => { toast.hidden = true; }, 220);
    }, 3600);
  }

  // ============================================================
  //  Pagamento online (Pix)
  //
  //  As 1.064 linhas que estavam AQUI foram para
  //  scripts/pages/restaurant-pix-flow.js. Corpos verbatim; só a costura é
  //  nova. O cabeçalho de lá explica por que este é o único módulo até agora
  //  cujo estado aponta para os dois lados.
  //
  //  As 13 ações do markup do Pix não passam mais por este arquivo: o módulo
  //  as registra em RapidexActions, que MESCLA.
  // ============================================================
  const pixFlow = window.PedeAquiPixFlow;

  pixFlow.init({
    // `$` vem de `const $ = window.PedeAquiDom?.byId || ...` mais acima. Ele
    // escapou da varredura que montou esta lista nos DOIS modulos, sempre pelo
    // mesmo motivo: a busca usava ``, e `` nao casa antes de `$`, que nao e
    // caractere de palavra. E o lint NAO cobra a falta dele aqui — cobra so do
    // lado de la, onde o nome fica sem declaracao. Faltando nesta linha, a tela
    // do Pix quebraria no primeiro clique com o lint verde.
    $, checkoutTrace, closeModalId, closeModalImmediately, currentCartBranchLabel, detailText,
    errorTrace, esc, failCardCheckout, fallback, fmt, getRestaurantSlug, jumpToTop,
    leaveCartAfterOrder, logAppError, openModal, orderAmount, renderTotalMismatch,
    showHomeTab, showOrderSuccess,
    // Lidos a cada acesso, nunca copiados: estes DOIS sao reatribuidos neste
    // arquivo depois do init() — `restaurant` 3 vezes (boot, cardapio, troca de
    // filial) e `selectedSavedCard` 7. Por valor eles chegavam como a
    // fotografia do boot (`{}` e `null`) e nunca mais mudavam: a tela de
    // pagamento anunciava o nome da PLATAFORMA no lugar do da loja, e a
    // retentativa de cartao nunca pedia um token novo.
    restaurant: () => restaurant,
    selectedSavedCard: () => selectedSavedCard
  });

  // As portas que o resto deste arquivo ainda chama pelo nome.
  const {
    hasCreatedCartPixPayment,
    isOnlinePaymentFlow,
    paymentStatusKind,
    pollPixStatus,
    preparePixPayment,
    presentPixPayment,
    rememberTrackingToken,
    renderPendingPaymentBar,
    resumeCreatedCartPixPayment,
    stopPixPolling
  } = pixFlow;

  // `P.pixSession` e `P.trackedOrder` agora são do módulo, mas ESTE arquivo também
  // os lê e escreve (a tela de sucesso zera a cobrança e guarda o pedido; o
  // gancho de visibilidade retoma a consulta). `P` é o objeto com getter e
  // setter de verdade — `P.pixSession = null` muda a variável de lá, e
  // `P.pixSession.pollTimer` escreve no mesmo objeto que lá está usando.
  const P = pixFlow.compartilhado;

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
  let branchAvailability = { status: 'idle', key: null, data: null, error: null };
  let branchAvailabilityRequestSequence = 0;
  let operationScreenOpenPromise = null;
  let operationScreenOpenSequence = 0;

  const opStorageKey = () => OP_STORAGE_PREFIX + getRestaurantSlug();

  function loadOperationContext() {
    try { return JSON.parse(readStorageKey(opStorageKey()) || 'null'); }
    catch { return null; }
  }

  /**
   * O endereço da visita anterior, lido ANTES de existir cardápio — as mesmas
   * duas fontes, na mesma ordem, que o initOperationContext() usa depois. É o
   * que permite pedir a disponibilidade das unidades junto com o /menu.
   */
  function bootAvailabilityAddress() {
    return loadOperationContext()?.address || customerAddress || null;
  }

  /**
   * A filial guardada, lida ANTES de existir cardápio.
   *
   * É ela que decide com qual loja o primeiro `GET /menu` vai falar — e por
   * isso a leitura não pode depender do `operationContext`, que só é montado
   * depois de a lista de filiais chegar. A chave precisa só do slug, e o slug
   * está na URL.
   */
  function storedOperationBranchId() {
    return loadOperationContext()?.branch_id || null;
  }

  /**
   * Esquece a filial guardada que o backend não reconhece mais (desativada, ou
   * de outro restaurante). O endereço fica — continua válido —, mas o
   * "confirmado" cai, e o seletor volta a ser obrigatório antes do cardápio.
   */
  function forgetStoredBranch() {
    const stored = loadOperationContext();
    if (!stored) return;
    delete stored.branch_id;
    delete stored.branch_label;
    delete stored.branch_name;
    delete stored.branch_address;
    stored.confirmed = false;
    try { localStorage.setItem(opStorageKey(), JSON.stringify(stored)); }
    catch { /* modo privativo: o boot seguinte tenta de novo */ }
  }

  function persistOperationContext() {
    if (operationContext) {
      localStorage.setItem(opStorageKey(), JSON.stringify({ ...operationContext, confirmed: operationConfirmed }));
    }
  }

  /* ── A filial escolhida, para quem está fora deste arquivo ──
     Desde 20/08/2026 o cardápio é da FILIAL, e `/chat`, `/voice/session` e
     `/voice/search` exigem `branch_id` (backend `docs/cardapio-por-filial.md`,
     §3.5). O assistente mora em outro arquivo e precisa mandar a MESMA filial
     que monta o cardápio, o carrinho e o pedido — não uma cópia dela.

     Só leitura, e SEM queda para `branches[0]`: um default aqui devolveria o
     cardápio da loja errada com preço e sem erro, que é justamente o que o
     backend fechou ao tornar o campo obrigatório. Sem filial escolhida isto
     devolve null, e quem chama tem de parar. */
  window.RapidexOperationContext = {
    branchId: () => operationContext?.branch_id || null
  };

  // A LINHA DE ENDEREÇO TEM UM DONO SÓ, e não é aqui.
  //
  // Esta função interpolava cru — `${a.street}, ${a.number} - ${a.neighborhood}`
  // — e interpolação crua não devolve string vazia quando falta o campo:
  // devolve a PALAVRA `undefined`. A tela de Unidades e Operação escrevia
  // `undefined, 450 - Aldeota` para todo endereço gravado sem `street`, e
  // `street` falta de verdade (o normalizador aceita `street_name` como
  // sinônimo justamente porque os dois nomes circulam).
  //
  // A lista de endereços do Perfil nunca mostrou isso porque ela passa pelo
  // serviço, que soma com `filter(Boolean)`. Eram dois montadores para a mesma
  // linha, e o errado era o que ganhava nos sítios que não normalizavam.
  //
  // O fallback vazio não é decoração: se o serviço não tiver carregado, uma
  // linha em branco é o desfecho certo — nunca `undefined` na tela.
  function addressSummary(a) {
    return window.PedeAquiAddressService?.formatAddressSummary?.(a) || '';
  }

  // Apelidos locais das 16 chamadas. A lista de enderecos guardada tem UM dono,
  // scripts/services/address-service.js — e so ele normaliza, le e grava.
  //
  // O que saiu daqui foi o `?.` com `|| []`: parecia defesa e nao era. Na
  // leitura o servico ja devolve [] em qualquer falha, e na escrita ele sempre
  // devolve array (e `[] || []` da `[]`, porque array vazio e truthy) — entao o
  // fallback so podia disparar num caso: o modulo nao ter carregado. Nesse caso
  // ele fazia a tela mostrar "nenhum endereco salvo" para quem tem enderecos
  // salvos, calada. address-service.js esta na lista fixa do
  // entry-restaurant.js; se sair de la, isto tem de quebrar, nao mentir.
  const readLocalAddressList = () => window.PedeAquiAddressService.readLocalAddressList();
  const writeLocalAddressList = (list) => window.PedeAquiAddressService.writeLocalAddressList(list);

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
    // `zipcode` PRIMEIRO: e o nome do contrato (CustomerAddressResponse), e um
    // endereco que venha CRU do `GET /customers/me/addresses` — sem passar por
    // normalizeAddress — nao tem `postal_code` nenhum. Sem isto, o mesmo
    // endereco gera impressoes digitais diferentes conforme o caminho por onde
    // chegou, e o app o trata como dois.
    const postalCode = onlyDigits(address.zipcode || address.postal_code || address.zip_code || address.cep || '');
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

  /**
   * O CORPO DE `POST/PUT /customers/me/addresses` — e ele e FECHADO.
   *
   * `CreateCustomerAddressRequest` e `UpdateCustomerAddressRequest` tem
   * `additionalProperties: false`, entao um nome que a API nao declara nao e
   * ignorado: ele derruba a requisicao inteira com 422.
   *
   * Ate 02/09/2026 esta funcao mandava TRES nomes que nao existem la —
   * `postal_code`, `place_id` e `alias` — e o resultado era que NENHUM cliente
   * logado conseguia salvar endereco na conta. O que ele via era o
   * `alert("Nao foi possivel salvar o endereco na sua conta. Ele continuara
   * disponivel neste aparelho...")` de finishAddressDetails, toda vez, e o
   * endereco ficava so naquele aparelho.
   *
   * Ninguem pegou porque NENHUM teste salvava endereco: o `mockApi()` so
   * atende o GET, o POST caia no catch-all, e o boot-smoke — que e quem le
   * `rotasDesconhecidas` — nao passa pelo formulario de endereco.
   *
   * Os tres nomes certos, e por que os errados existiam:
   *
   * - `zipcode`: `postal_code` e o nome INTERNO do front (quem o produz e
   *   `address-service.normalizeAddress`, de proposito, para ter uma forma so
   *   entre a API e o que ele mesmo grava no localStorage). Mapear de volta na
   *   borda ja era o que `order-payload.js:70` fazia ao criar o pedido; era
   *   esta borda que nao fazia.
   * - `label`: `alias` e o nome do campo no formulario, nao o do contrato.
   * - `place_id` SAI. Ele e do Google, nao da nossa API, e nao esta em esquema
   *   de endereco nenhum. O front continua guardando-o localmente (o
   *   `addressFingerprint` o usa); o que ele nao faz mais e manda-lo.
   *
   * Guardado por `tests/e2e/customer-address-contract.spec.js`, cujo mock
   * recusa como o backend recusa — lendo o `openapi.json`, e nao uma lista de
   * campos copiada a mao, que seria a segunda copia do contrato.
   */
  function addressApiPayload(address) {
    return {
      street: address?.street || '', number: address?.number || '', neighborhood: address?.neighborhood || '',
      city: address?.city || '', state: address?.state || '', complement: address?.complement || '',
      reference: address?.reference || '',
      zipcode: onlyDigits(address?.zipcode || address?.postal_code || address?.zip_code || address?.cep || ''),
      latitude: address?.latitude ?? null, longitude: address?.longitude ?? null,
      label: address?.label || address?.alias || ''
    };
  }

  function operationScreenIsForeground() {
    if (!$('operationModal')?.classList.contains('active')) return false;
    return !['addAddressModal', 'addrPickerModal', 'addrSearchModal', 'addrMapModal', 'addrDetailsModal']
      .some(id => $(id)?.classList.contains('active'));
  }

  function setSelectedOperationAddress(address, options = {}) {
    const previousEstimateKey = deliveryEstimateKey();
    const normalized = normalizeAddressValue(address);
    if (!operationContext) {
      const branch = defaultBranchFor('delivery');
      operationContext = { order_type: 'delivery', ...branchSnapshot(branch), address: null };
    }
    operationContext.address = normalized;
    if (opDraft) opDraft.address = normalized;
    if (normalized && options.forceDelivery !== false) operationContext.order_type = 'delivery';
    customerAddress = normalized ? { ...normalized, summary: addressSummary(normalized) } : null;
    if (customerAddress) window.PedeAquiAddressService?.saveSelectedAddress?.(customerAddress);
    else localStorage.removeItem(STORAGE_ADDRESS);
    if (options.confirmed === true) operationConfirmed = true;
    persistOperationContext();
    deliveryType = operationContext.order_type;
    renderWidget();
    updateCartUI();
    if (previousEstimateKey !== deliveryEstimateKey()) invalidateDeliveryEstimate();
    requestDeliveryEstimate();
    if (operationScreenIsForeground()) {
      renderOperationScreen();
      requestBranchAvailability(normalized);
    }
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

  function availabilityKey(address) {
    if (!validAddressForApi(address)) return 'no-address';
    return addressFingerprint(address) || remoteAddressId(address) || 'address';
  }

  function currentAvailabilityAddress() {
    return opDraft ? opDraft.address : operationContext?.address;
  }

  function availabilityPayload(address) {
    if (!validAddressForApi(address)) return {};
    const addressId = remoteAddressId(address);
    if (addressId) return { address_id: addressId };
    const normalized = deliveryAddressPayload(address);
    if (normalized.latitude === null || normalized.longitude === null) {
      delete normalized.latitude;
      delete normalized.longitude;
    }
    return { address: normalized };
  }

  function mergeAvailabilityBranch(availableBranch) {
    const menuBranch = branchById(availableBranch?.id) || {};
    return {
      ...menuBranch,
      ...availableBranch,
      label: availableBranch?.label || menuBranch.label || availableBranch?.name || menuBranch.name || '',
      full_address: availableBranch?.full_address || menuBranch.full_address || '',
      accepts_delivery: menuBranch.accepts_delivery !== false,
      accepts_pickup: menuBranch.accepts_pickup !== false
    };
  }

  function operationBranches(orderType) {
    if (branchAvailability.status !== 'success') {
      return compatibleBranches(orderType);
    }
    const available = (branchAvailability.data?.branches || []).map(mergeAvailabilityBranch);
    if (orderType === 'pickup') return available.filter(branch => branch.accepts_pickup !== false);
    if (branchAvailability.data?.address_provided !== true) {
      return available.filter(branch => branch.accepts_delivery !== false);
    }
    return available;
  }

  function operationBranchById(id, orderType = opDraft?.order_type) {
    const available = operationBranches(orderType).find(branch => String(branch.id) === String(id));
    return available || (branchAvailability.status === 'success' ? null : branchById(id));
  }

  function branchDeliveryBlocked(branch, orderType = opDraft?.order_type) {
    return orderType === 'delivery'
      && branchAvailability.status === 'success'
      && branchAvailability.data?.address_provided === true
      && branch?.delivery !== null
      && branch?.delivery?.delivers_to_address === false;
  }

  function branchSelectable(branch, orderType = opDraft?.order_type) {
    if (!branch) return false;
    if (orderType === 'pickup') return branch.accepts_pickup !== false;
    if (branchAvailability.data?.address_provided === true) return !branchDeliveryBlocked(branch, orderType);
    return branch.accepts_delivery !== false;
  }

  function sortedOperationBranches(items, orderType) {
    if (orderType !== 'delivery' || branchAvailability.data?.address_provided !== true) return items;
    const group = branch => branchDeliveryBlocked(branch, orderType) ? 2 : (branch.is_open ? 0 : 1);
    const distance = branch => asFiniteNumber(branch.delivery?.distance_km) ?? Number.POSITIVE_INFINITY;
    return items.map((branch, index) => ({ branch, index })).sort((left, right) => (
      group(left.branch) - group(right.branch)
      || distance(left.branch) - distance(right.branch)
      || left.index - right.index
    )).map(item => item.branch);
  }

  function unavailableBranchReason(delivery = {}) {
    const message = nonEmptyString(delivery.message);
    if (message) return message;
    return ({
      outside_delivery_area: 'Fora da área de entrega para o endereço selecionado.',
      branch_closed: 'Esta unidade está fechada no momento.',
      delivery_disabled: 'Esta unidade não faz entregas.',
      prep_time_unavailable: 'Entrega indisponível nesta unidade no momento.',
      delivery_fee_config_unavailable: 'Não foi possível calcular a taxa desta unidade.',
      route_not_found: 'Não encontramos uma rota até o endereço selecionado.',
      route_unavailable: 'Não foi possível calcular a rota agora.',
      address_not_found: 'Revise o endereço selecionado para continuar.'
    })[delivery.reason] || 'Esta unidade não entrega no endereço selecionado.';
  }

  function formatBranchDistance(value) {
    const distance = asFiniteNumber(value);
    if (distance === null) return '';
    return `${distance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
  }

  function branchAvailabilityFeedback() {
    if (branchAvailability.status === 'loading' && validAddressForApi(opDraft?.address)) {
      return '<div class="op-branch-feedback" role="status">Calculando distância e taxa...</div>';
    }
    if (branchAvailability.status === 'error' && validAddressForApi(opDraft?.address)) {
      return '<div class="op-branch-feedback error" role="status">Não foi possível verificar a entrega. Tente novamente.</div>';
    }
    return '';
  }

  /**
   * `inflight` é a MESMA busca, já disparada antes (só o boot usa). Reaproveitá-la
   * evita uma segunda ida à rede idêntica: o endereço do boot é lido das mesmas
   * duas fontes de storage que o initOperationContext() vai ler.
   */
  async function requestBranchAvailability(address = opDraft?.address, inflight = null) {
    const key = availabilityKey(address);
    const sequence = ++branchAvailabilityRequestSequence;
    branchAvailability = { status: 'loading', key, data: null, error: null };
    renderOperationBranches();
    try {
      const data = await (inflight || window.PedeAquiBranchAvailabilityService.getAvailability(
        getRestaurantSlug(),
        availabilityPayload(address)
      ));
      if (sequence !== branchAvailabilityRequestSequence || availabilityKey(currentAvailabilityAddress()) !== key) return null;
      branchAvailability = { status: 'success', key, data, error: null };
      const selectedBranch = operationBranchById(opDraft?.branch_id, opDraft?.order_type);
      if (opDraft?.branch_id && !branchSelectable(selectedBranch, opDraft?.order_type)) {
        Object.assign(opDraft, { branch_id: null, branch_label: '', branch_name: '', branch_address: '' });
      }
      renderOperationBranches();
      return data;
    } catch (error) {
      if (sequence !== branchAvailabilityRequestSequence) return null;
      console.error('[PedeAqui] Falha ao carregar disponibilidade das unidades', error);
      branchAvailability = { status: 'error', key, data: null, error };
      renderOperationBranches();
      return null;
    }
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
    // Sem escolha guardada, a filial é a que o /menu ACABOU de responder: é o
    // cardápio que está na tela. Adivinhar outra aqui faria o seletor nomear
    // uma loja enquanto a lista de produtos é de outra — e ainda custaria uma
    // segunda busca no boot para desfazer o próprio palpite.
    if (!branch) branch = branchById(menuBranchId);
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

  /**
   * O cardápio carregado tem de ser o da filial escolhida.
   *
   * No boot isto quase sempre não faz nada: a busca já saiu com a filial
   * guardada. O caso que sobra é a filial guardada não servir para o tipo de
   * pedido (uma loja que deixou de aceitar retirada, por exemplo), quando
   * initOperationContext() escolhe outra — e aí a carga que veio é da loja
   * errada.
   */
  /**
   * @returns {Promise<boolean>} true se o cardápio em memória é o da filial
   *          escolhida — ou seja, se dá para conferir a sacola contra ele.
   */
  async function ensureMenuMatchesSelectedBranch() {
    if (!menuBranchIsStale() || !operationContext?.branch_id) return true;
    try {
      applyMenuPayload(await fetchMenuPayload(operationContext.branch_id));
      return true;
    } catch (error) {
      // Fica com o que veio e segue: a aba Cardápio detecta o desencontro e
      // tenta de novo, com tela de erro própria.
      //
      // Mas quem chama PRECISA saber que o cardápio em memória é de outra
      // filial. No boot é o que decide se a sacola pode ser restaurada: contra
      // o cardápio errado ela seria esvaziada e o vazio gravado por cima.
      logAppError('Falha ao carregar o cardápio da unidade', error);
      return false;
    }
  }

  /**
   * A troca de loja: cardápio, sacola e tela passam a ser da filial nova.
   *
   * A sacola da loja anterior JÁ está gravada na chave dela — persistCart() roda
   * a cada mudança —, então aqui ela só sai da memória. `cartRestored` volta a
   * false pelo mesmo motivo do boot: um updateCartUI() no meio do caminho
   * gravaria uma sacola vazia por cima da que a filial nova tem guardada.
   */
  /**
   * O que foi escolhido PARA UMA LOJA e não sobrevive à troca dela.
   *
   * Pagamento e cupom são da filial: cada uma declara os próprios meios em
   * /info (`branchAcceptsOnlineCard`) e o desconto do cupom é calculado contra
   * a sacola daquela loja. Antes eles atravessavam a troca intactos — escolher
   * cartão numa filial que aceita e mudar para uma que não aceita levava direto
   * na contradição tratada em routeCreatedOrder: pedido de cartão nascendo
   * "paga na entrega", com o CVV já tokenizado e nenhuma cobrança.
   *
   * O token do cartão é de uso único no gateway; deixá-lo vivo só produziria
   * uma recusa mais adiante.
   */
  function clearBranchScopedSelection() {
    paymentMethod = '';
    paymentMethodKey = '';
    selectedSavedCard = null;
    savedCardPaymentToken = '';
    // A folha de leitura fecha junto: cupom de uma filial não fica aberto na
    // tela enquanto a outra carrega (e o estado dela mora na própria tela).
    window.RapidexActions.resolve('closeCouponDetail')?.();
    selectedCoupon = null;
    selectedCouponPreview = null;
    couponPreviewKey = '';
  }

  /**
   * A troca de loja é TRANSACIONAL: ou o cardápio da filial nova chega, ou nada
   * muda.
   *
   * O que acontecia quando o /menu falhava: o `catch` só escrevia no console e
   * a função seguia. `restoreCart()` então conferia a sacola guardada da loja
   * NOVA contra `products`, que ainda era o cardápio da ANTIGA. Como os ids de
   * produto não se repetem entre filiais (ver cartStorageKey), nada casava, o
   * carrinho virava vazio — e a última linha de restoreCart() gravava esse
   * vazio por cima da sacola guardada. O cliente perdia o pedido montado, sem
   * uma palavra na tela, por causa de uma falha de rede.
   *
   * Agora: se o cardápio novo não chega, o contexto volta para a filial
   * anterior, a sacola dela é restaurada contra o cardápio dela (que continua
   * em memória, intacto) e a tela diz o que houve.
   *
   * @param {object|null} previousContext cópia do operationContext ANTES da troca
   */
  async function handleMenuBranchChange(previousContext) {
    const previousBranchId = previousContext?.branch_id || null;
    const nextBranchId = operationContext?.branch_id || null;
    if (String(previousBranchId || '') === String(nextBranchId || '')) return;

    const previousLabel = branchById(previousBranchId)?.name || '';
    const hadItems = cart.length > 0;
    cart = [];
    cartRestored = false;
    appState.menuLoaded = false;
    menuRenderSignature = null;

    let fresh;
    try {
      fresh = await fetchMenuPayload(nextBranchId);
    } catch (error) {
      logAppError('Falha ao carregar o cardápio da unidade', error);
      rollbackBranchChange(previousContext, previousLabel);
      return;
    }

    // Só a partir daqui a troca é fato consumado.
    applyMenuPayload(fresh);
    clearBranchScopedSelection();
    // Depois do cardápio novo: é contra ELE que os itens são conferidos, e é
    // dele que sai o preço — a mesma picanha custa o que a loja nova cobra.
    restoreCart();
    window.RapidexActions.resolve('renderHomeContent')?.();
    updateCartUI();
    if (document.body.classList.contains('menu-tab')) ensureMenuLoaded();
    if (hadItems) {
      showAppToast(previousLabel
        ? `Sua sacola da ${previousLabel} ficou guardada.`
        : 'Sua sacola da unidade anterior ficou guardada.');
    }
  }

  /**
   * Desfaz a troca de loja que não completou.
   *
   * `products` em memória ainda é o cardápio da filial anterior — foi
   * justamente ele que não chegou a ser substituído. Voltando o contexto para
   * ela, tudo volta a combinar: a chave da sacola, os ids dos produtos e os
   * preços. É por isso que o rollback restaura a sacola DEPOIS de devolver o
   * contexto, e não antes.
   */
  function rollbackBranchChange(previousContext, previousLabel) {
    if (previousContext) {
      operationContext = JSON.parse(JSON.stringify(previousContext));
      persistOperationContext();
      applyOperationToLegacy();
      renderWidget();
      setCartTab(operationContext.order_type || 'delivery');
    }
    // O cardápio em memória volta a ser o da filial do contexto.
    appState.menuLoaded = true;
    restoreCart();
    window.RapidexActions.resolve('renderHomeContent')?.();
    updateCartUI();
    // A estimativa era da filial que não vingou.
    invalidateDeliveryEstimate();
    requestDeliveryEstimate();
    showAppToast(previousLabel
      ? `Não foi possível carregar o cardápio. Você continua na ${previousLabel}.`
      : 'Não foi possível carregar o cardápio da unidade. Nada foi alterado.');
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
  function setOperationEntryLoading(control, loading) {
    if (!control) return;
    control.classList.toggle('is-loading', loading);
    if (loading) control.setAttribute('aria-busy', 'true');
    else control.removeAttribute('aria-busy');
  }

  function clearOperationEntryLoading() {
    setOperationEntryLoading($('mobNavMenu'), false);
  }

  function openOperationScreen(immediate, trigger) {
    if (!operationContext) return Promise.resolve(null);
    if (operationScreenOpenPromise) return operationScreenOpenPromise;
    const openSequence = ++operationScreenOpenSequence;
    _opOpenedImmediately = !!immediate;
    opDraft = JSON.parse(JSON.stringify(operationContext));
    if ($('opBranchSearch')) $('opBranchSearch').value = '';
    const availabilityAlreadyResolved = branchAvailability.key === availabilityKey(opDraft.address)
      && (branchAvailability.status === 'success' || branchAvailability.status === 'error');
    const revealOperationScreen = () => {
      if (openSequence !== operationScreenOpenSequence) return null;
      renderOperationScreen();
      if (immediate) openModalImmediately('operationModal');
      else openModal('operationModal');
      return branchAvailability.data;
    };
    if (availabilityAlreadyResolved) return Promise.resolve(revealOperationScreen());

    // O widget nunca vira um loader: a disponibilidade normal já foi aquecida
    // no boot. Só o Cardápio sinaliza espera se uma atualização excepcional
    // ainda estiver em trânsito.
    const loadingTarget = trigger?.id === 'mobNavMenu' ? trigger : null;
    setOperationEntryLoading(loadingTarget, true);
    const promise = requestBranchAvailability(opDraft.address).then(() => {
      // Uma confirmação programática pode cancelar a abertura enquanto a rota
      // ainda está em trânsito. Nesse caso a resposta atualiza o estado, mas o
      // modal não reaparece por cima da tela para a qual o cliente já avançou.
      return revealOperationScreen();
    }).finally(() => {
      if (operationScreenOpenPromise === promise) operationScreenOpenPromise = null;
      if (openSequence === operationScreenOpenSequence) setOperationEntryLoading(loadingTarget, false);
    });
    operationScreenOpenPromise = promise;
    return promise;
  }

  function closeOperationScreen() {
    operationScreenOpenSequence += 1;
    operationScreenOpenPromise = null;
    clearOperationEntryLoading();
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
    let items = operationBranches(opDraft.order_type);
    if (query) {
      items = items.filter(b => `${b.name} ${b.full_address} ${b.neighborhood}`.toLowerCase().includes(query));
    }
    items = sortedOperationBranches(items, opDraft.order_type);
    const feedback = branchAvailabilityFeedback();
    if (!items.length) {
      list.innerHTML = `${feedback}<div class="op-branch-empty">Nenhuma unidade disponível para esta operação.</div>`;
      updateConfirmButton();
      return;
    }
    list.innerHTML = feedback + items.map(b => {
      const selected = String(b.id) === String(opDraft.branch_id);
      const blocked = branchDeliveryBlocked(b, opDraft.order_type);
      const statusBadge = b.is_open
        ? '<span class="op-branch-badge open">Aberto</span>'
        : '<span class="op-branch-badge closed">Fechado</span>';
      const showDeliveryContext = opDraft.order_type === 'delivery'
        && branchAvailability.status === 'success'
        && branchAvailability.data?.address_provided === true;
      const distanceText = showDeliveryContext ? formatBranchDistance(b.delivery?.distance_km) : '';
      const fee = showDeliveryContext ? asFiniteNumber(b.delivery?.delivery_fee) : null;
      const badges = [
        distanceText ? `<span class="op-branch-badge metric">${esc(distanceText)}</span>` : '',
        fee !== null ? `<span class="op-branch-badge metric">${esc(fmt(fee))}</span>` : '',
        statusBadge
      ].filter(Boolean).join('');
      const reason = blocked
        ? `<span class="op-branch-reason">${esc(unavailableBranchReason(b.delivery))}</span>`
        : '';
      return `<button type="button" role="radio" class="op-branch-card${selected && !blocked ? ' selected' : ''}${blocked ? ' unavailable' : ''}" ${blocked ? 'disabled aria-disabled="true"' : act('click', 'selectBranch', b.id)} aria-checked="${selected && !blocked}">
        <span class="op-branch-radio" aria-hidden="true"></span>
        <span class="op-branch-body">
          <span class="op-branch-name">${esc(b.name)}</span>
          <span class="op-branch-addr" title="${esc(b.full_address)}">${esc(truncateAddress(b.full_address))}</span>
          <span class="op-branch-badges">${badges}</span>
          ${reason}
        </span>
        <svg class="op-branch-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>
      </button>`;
    }).join('');
    updateConfirmButton();
  }

  function selectBranch(id) {
    if (!opDraft) return;
    const branch = operationBranchById(id, opDraft.order_type);
    if (!branchSelectable(branch, opDraft.order_type)) return;
    Object.assign(opDraft, branchSnapshot(branch));
    renderOperationBranches();
  }

  function updateConfirmButton() {
    const btn = $('opConfirmBtn');
    if (!btn) return;
    const selectedBranch = operationBranchById(opDraft?.branch_id, opDraft?.order_type);
    const waitingForAddress = opDraft?.order_type === 'delivery'
      && validAddressForApi(opDraft?.address)
      && branchAvailability.status === 'loading';
    btn.disabled = !opDraft?.branch_id || waitingForAddress || !branchSelectable(selectedBranch, opDraft?.order_type);
  }

  function confirmOperation() {
    const selectedBranch = operationBranchById(opDraft?.branch_id, opDraft?.order_type);
    if (!opDraft?.branch_id || !branchSelectable(selectedBranch, opDraft?.order_type)) return;
    // Delivery sem endereço: confirma assim mesmo e mostra o widget com os 3
    // mini-widgets. O endereço fica como "Use seu endereço para melhores
    // resultados" (renderWidget) e só é exigido no checkout.
    const previousEstimateKey = deliveryEstimateKey();
    const previousInfoKey = restaurantInfoKey();
    // Cópia do contexto INTEIRO, não só do id: se o cardápio da filial nova não
    // chegar, é para este estado que a tela volta (ver rollbackBranchChange).
    const previousContext = operationContext ? JSON.parse(JSON.stringify(operationContext)) : null;
    operationContext = JSON.parse(JSON.stringify(opDraft));
    operationConfirmed = true;
    // ANTES de qualquer updateCartUI(): a sacola em memória ainda é da loja
    // anterior, e um persistCart() a partir daqui a gravaria na chave da loja
    // NOVA — os itens da Matriz reapareceriam como se fossem da Varjota. A
    // troca solta a memória de forma SÍNCRONA (só o cardápio é assíncrono), e
    // enquanto ela não é restaurada persistCart() não grava.
    // Não é aguardada: a tela fecha na hora e a carga se resolve por trás.
    handleMenuBranchChange(previousContext);
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
    const previousContext = JSON.parse(JSON.stringify(operationContext));
    operationContext.order_type = type;
    const current = branchById(operationContext.branch_id);
    if (!current || !branchAccepts(current, type)) {
      Object.assign(operationContext, branchSnapshot(defaultBranchFor(type)));
    }
    // Trocar entrega/retirada pode trocar a FILIAL junto (quando a atual não
    // serve para o novo tipo), e aí o cardápio na tela vira o de outra loja.
    // Vem antes de tudo pelo mesmo motivo de confirmOperation().
    handleMenuBranchChange(previousContext);
    persistOperationContext();
    renderWidget();
    if (previousEstimateKey !== deliveryEstimateKey()) invalidateDeliveryEstimate();
    handleRestaurantInfoContextChange(previousInfoKey);
    requestDeliveryEstimate();
  }

  // ============================================================
  //  Endereço: escolha, lista salva, busca no Google, mapa e formulário.
  //
  //  As 1.124 linhas que estavam AQUI foram para
  //  scripts/pages/restaurant-address-flow.js. Os corpos foram verbatim; só a
  //  costura abaixo é nova. O cabeçalho de lá explica por que o estado vai
  //  como getter e o resto por valor.
  //
  //  As 27 ações do markup daquele fluxo não passam mais por este arquivo: o
  //  módulo as registra em RapidexActions, que MESCLA. O `data-act-*` do HTML
  //  não mudou.
  // ============================================================
  const addressFlow = window.PedeAquiAddressFlow;

  addressFlow.init({
    // Lidos a cada acesso, nunca copiados: estes quatro são reatribuídos
    // NESTE arquivo depois do init(), e uma cópia congelaria o módulo no
    // endereço e na filial que valiam no boot.
    operationContext: () => operationContext,
    opDraft: () => opDraft,
    operationConfirmed: () => operationConfirmed,
    customerAddress: () => customerAddress,
    // Estáveis: declarações de função e consts que ninguém reatribui.
    // `$`, openModal, openModalImmediately e closeModalImmediately chegam por
    // desestruturação de window.PedeAquiRestaurantUi mais acima neste arquivo —
    // e foi justamente por isso que a varredura que montou esta lista não os
    // viu, e o lint os cobrou. Estão aqui pelo mesmo motivo dos outros.
    $, act, addressApiPayload, addressFingerprint, addressSummary, appState,
    closeModalId, closeModalImmediately, dedupeAddresses, defaultBackendAddress, esc,
    isLogged, isRemoteAddress, normalizeAddressValue, openModal, openModalImmediately,
    readLocalAddressList, remoteAddressId, renderOperationScreen, renderProfileView,
    requestBranchAvailability, setAccessibleDialogState, setMobNavActive,
    setOperationEntryLoading, setSelectedOperationAddress, syncCartStickyForActiveView,
    synchronizeCustomerAddresses, writeLocalAddressList
  });

  // As três portas que o resto deste arquivo ainda chama pelo nome. (openAddrPicker
  // era a quarta; a única referência a ela aqui fora estava no objeto ACTIONS, que
  // foi para o módulo junto com as outras 26.)
  const { addrPickerId, openAddressChoiceDirect, openAddressScreen } = addressFlow;

  // ============================================================
  //  Entrar, cadastrar, verificar código e recuperar senha.
  //
  //  As 1.132 linhas que estavam AQUI foram para
  //  scripts/pages/restaurant-auth-flow.js. Corpos verbatim; a costura tocou
  //  cinco linhas de código, todas listadas no commit.
  //
  //  As 42 ações destas telas não passam mais por este arquivo: o módulo as
  //  registra em RapidexActions, que MESCLA.
  // ============================================================
  const authFlow = window.PedeAquiAuthFlow;

  authFlow.init({
    // Estado que continua sendo daqui. Os quatro de baixo o módulo ESCREVE:
    // ao entrar na conta a partir de um cupom, é ele que limpa o cupom em
    // leitura e a pré-visualização pendente. Sem o setter, este arquivo
    // continuaria achando que há cupom aplicado e mandaria o coupon_id.
    estado: {
      customer: { get: () => customer },
      selectedCoupon: { get: () => selectedCoupon, set: (v) => { selectedCoupon = v; } },
      selectedCouponPreview: { get: () => selectedCouponPreview, set: (v) => { selectedCouponPreview = v; } },
      couponPreviewKey: { get: () => couponPreviewKey, set: (v) => { couponPreviewKey = v; } },
      loginReturnNavId: { get: () => loginReturnNavId, set: (v) => { loginReturnNavId = v; } }
    },
    // Estáveis.
    $, apiErrorMessage, appState, closeCouponDetail, closeModalId, closeProfSub,
    clubController, currentScrollY, esc, fallback, loadCashbackForHome, lockBodyScroll,
    mobNavAssistant, mobNavClub, onTeardown, onlyDigits, openModal,
    openModalImmediately, persistCustomer, renderHomeLoginPrompt, renderProfileView, renderSharedCashbackState, requestDeliveryEstimate,
    setBottomNavSuppressedForAuth, showHomeTab, syncAuthScreenOpenClass, syncCartLocationState, synchronizeCustomerAddresses, unlockBodyScrollIfClear,
    updateCartUI
  });

  // As portas que o resto deste arquivo ainda chama pelo nome.
  const {
    EYE_OFF_SVG,
    isValidBirthDate,
    lockAuthScreenScroll,
    maskRegBirth,
    maskRegPhone,
    openLoginScreen,
    syncCustomerSession
  } = authFlow;

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
    if (_policyReturn === 'profile') syncCartStickyForActiveView();
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
      syncCartStickyForActiveView();
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

  // AQUI MORAVA `ultimoMotivoDeCupom`, e a nota fica porque a tela que vai
  // receber o campo de código vai precisar dele de volta.
  //
  // Ele guardava o motivo da ÚLTIMA recusa nas palavras do backend, porque
  // `previewSelectedCoupon({ silent: true })` não pinta nada e quem pediu em
  // silêncio precisava da mesma frase para responder no próprio lugar. Saiu
  // junto com o campo da sacola, seu único leitor: guardar uma frase que
  // ninguém lê é estado que envelhece sozinho.
  //
  // E ele carregava uma lição cara, que vale para quem o trouxer de volta: o
  // motivo tinha de ser zerado no início da AÇÃO (armSelectedCoupon), nunca no
  // início da LEITURA — o ramo `valid: false` chama updateCartUI(), que chama
  // previewSelectedCoupon() de novo, e a reentrada apagava a frase antes de
  // quem pediu em silêncio conseguir lê-la.
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
      // 200 NÃO quer dizer aplicado. O contrato responde `valid: false` com
      // `ineligibility_reason` para o cupom que existe mas não vale nesta
      // sacola — e ninguém lia esse campo. O resultado era a mensagem "Cupom
      // aplicado. Desconto de R$ 0,00" e o coupon_id indo no pedido de um
      // cupom que o backend já tinha recusado.
      const preview = response?.data ?? response ?? {};
      const payload = preview.preview ?? preview;
      if (payload.valid === false) {
        selectedCouponPreview = null;
        // `ineligibility_reason` NÃO é uma frase: é um código interno do
        // backend (`minimum_order_not_reached`, `first_order_only`, ...), e ele
        // chegava CRU ao toast do cliente. O comentário que autorizava isso
        // dizia "a razão vem do backend em português"; a metade certa é que ela
        // é específica, e a metade errada é a que ficou na tela.
        //
        // A tradução mora em coupon-reason.js e é NOMINAL: código desconhecido
        // devolve '' e cai na frase genérica daqui, em vez de virar um palpite.
        const motivos = window.PedeAquiCouponReason;
        const motivo = motivos.couponReasonMessage(payload.ineligibility_reason, {
          // O quanto falta sai do mínimo do cupom e do MESMO subtotal que
          // acabou de ser enviado no preview — as duas entradas da conta que o
          // backend fez. O número não entra na sacola nem no pedido: ele existe
          // dentro da frase.
          faltam: motivos.couponMissingAmount(selectedCoupon, totals.subtotal),
          fmt
        }) || 'Este cupom não vale para esta sacola.';
        if (!silent) showCouponNotice(motivo);
        updateCartUI();
        return null;
      }
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

  // ── A folha de detalhe do cupom mora em screens/coupon-detail-screen.js ──
  //
  // O que fica AQUI é o dinheiro: selectedCoupon/preview e as três portas que
  // a folha usa para tocá-lo (armSelectedCoupon, restoreSelectedCoupon,
  // restoreSelectedCoupon). A folha lê e escreve o estado da SACOLA só por
  // essas portas — a separação leitura/aplicação (couponDetailCoupon vs
  // selectedCoupon) continua valendo, agora com o lado da leitura DENTRO da
  // tela e o da aplicação aqui.
  function getCouponForDetail(code) {
    return clubController.getCoupon(code)
      || coupons.find(c => [c.id, c.coupon_id, c.code, c.coupon_code].some(value => String(value) === String(code)));
  }

  /**
   * O MESMO CUPOM, JULGADO PELO BACKEND CONTRA ESTA SACOLA.
   *
   * O problema que isto fecha: a folha de detalhe aberta pela vitrine da Home
   * recebe um `PublicCouponResponse`, que NÃO TEM `state` — a vitrine é o feed
   * do `/menu`, e o backend nunca julgou aquele cupom contra esta pessoa. Sem
   * `state` o botão caía em "aplicar", e quem não tinha o mínimo só descobria
   * depois do toque, por um toast que contradizia o botão ao lado.
   *
   * O FRONT NÃO PASSA A CALCULAR NADA. Quem julga continua sendo o servidor, e
   * a rota que julga JÁ EXISTE e já é chamada por este app:
   * `GET /restaurants/{slug}/coupons` aceita `subtotal`, `delivery_fee` e
   * `order_type` OPCIONAIS, e o `@description` dela diz textualmente que sem
   * eles responde a tela do Clube e COM eles responde a do checkout. Ela
   * também funciona sem token (`get_optional_current_customer` no backend),
   * então o visitante recebe `login_required` em vez de nada.
   *
   * Ou seja: o backend não precisa publicar `state` em `PublicCouponResponse`.
   * O que faltava era o front PERGUNTAR — e a pergunta é a mesma que o card do
   * Clube já faz, com a mesma sacola, pelo mesmo controlador (o que também
   * aproveita o cache por contexto: abrir a folha duas vezes não pede duas).
   */
  // ANOTADO, NÃO CONSERTADO NESTA RODADA — e este bloco aumenta o preço do que
  // já estava anotado, então fica escrito aqui e não só na skill.
  //
  // `CustomerCouponState` tem CINCO valores no contrato — `applicable`,
  // `missing_amount`, `login_required`, `payment_method_not_allowed` e
  // `outside_hours` — e `club-service.COUPON_STATES` conhece TRÊS. Os dois
  // últimos são DESCARTADOS por `normalizeCustomerCoupons`.
  //
  // Até agora isso custava um cupom sumido da lista do Clube. Com este bloco
  // custa mais: um cupom nesses dois estados volta `null` daqui, a folha fica
  // com o da vitrine (sem `state`) e o botão diz "Usar cupom" para um cupom que
  // o backend acabou de recusar por forma de pagamento ou por horário — que é
  // exatamente a contradição que este bloco existe para fechar, por outra porta.
  // Não foi consertado aqui porque cada um dos dois precisa de rótulo e destino
  // próprios (o de forma de pagamento leva à escolha de pagamento, o de horário
  // não leva a lugar nenhum), e isso é decisão de produto, não de código.
  async function judgedCouponForDetail(code) {
    const jaCarregado = clubController.getCoupon(code);
    if (jaCarregado) return jaCarregado;
    try {
      await clubController.ensureClubLoaded();
    } catch {
      // Sem veredito, a folha segue com o cupom da vitrine e o backend julga
      // uma porta adiante, no preview. Falhar aqui não pode fechar a tela.
      return null;
    }
    return clubController.getCoupon(code);
  }

  // O CAMPO DE CÓDIGO DE CUPOM SAIU DA SACOLA em 03/09/2026, por decisão de
  // produto: digitar um código que veio de fora vai ser outra tela. O que
  // ficou aqui são as três portas do DINHEIRO, que a folha de detalhe do
  // Clube usa hoje e a tela nova vai usar amanhã — armSelectedCoupon,
  // restoreSelectedCoupon e previewSelectedCoupon. A view saiu inteira (as
  // funções, as duas ações e o markup): ação registrada sem markup é caminho
  // armado esperando quem o religue, que é a lição do persistCouponChoice.
  // Guarda: tests/unit/cart-coupon-field.test.js.

  /** Arma o cupom na sacola e devolve o anterior (para rollback). */
  function armSelectedCoupon(coupon) {
    // Aqui era zerado o motivo da última recusa — ver a nota que ficou no
    // lugar de `ultimoMotivoDeCupom`, logo acima de previewSelectedCoupon.
    // Quem trouxer o campo de código de volta zera a frase NESTA linha, que é
    // o começo da AÇÃO, e nunca no começo da leitura.
    const previous = selectedCoupon;
    selectedCoupon = coupon;
    selectedCouponPreview = null;
    couponPreviewKey = '';
    return previous;
  }

  /** Rollback exato: recusado/inelegível/rede — a sacola volta ao que era. */
  function restoreSelectedCoupon(previous) {
    selectedCoupon = previous;
    selectedCouponPreview = null;
    couponPreviewKey = '';
    updateCartUI();
  }

  // `persistCouponChoice()` MORREU em 02/09/2026, e o buraco onde ela estava
  // e proposital. Ela gravava `{ coupon: selectedCoupon }` na sacola guardada
  // quando alguem confirmava um cupom com a sacola VAZIA — um cupom aplicado
  // sem preview nenhum, que voltava armado no proximo boot e seguia no
  // `coupon_id` do pedido. Num cupom de uso unico, o backend o queima ali.
  // Hoje a sacola vazia leva ao cardapio e nao arma nada (coupon-cta.js), e a
  // gravacao legitima do cupom aplicado continua sendo a de `updateCartUI`
  // (:2262), que roda em toda mutacao do carrinho. Nao recoloque esta funcao
  // sem ler o cabecalho de services/coupon-cta.js.

  // Trampolins: o clube e o auth-flow chamam estes dois POR NOME (window e
  // deps de init). DECLARAÇÃO de função — const aqui é TDZ, a lição do
  // closeProfSub (o authFlow.init lá em cima os passa por valor).
  function openCouponDetail(...args) {
    return window.RapidexActions.resolve('openCouponDetail')?.(...args);
  }
  function closeCouponDetail(...args) {
    return window.RapidexActions.resolve('closeCouponDetail')?.(...args);
  }

  // handleBannerAction mora em screens/home-screen.js.

  const MOB_VIEWS = ['mobViewClub', 'mobViewAssistant', 'mobViewProfile'];

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
  }

  function releaseSecondaryNavGeometry() {
    const nav = $('mobBottomNav');
    if (!nav) return;
    ['box-sizing', 'height', 'min-height', 'max-height', 'padding'].forEach(property => nav.style.removeProperty(property));
  }

  function syncCartStickyForActiveView() {
    const sticky = $('cartSticky');
    if (!sticky) return;
    const cartCount = cart.reduce((total, item) => total + Number(item.qty || 0), 0);
    const renderedCartCount = Number($('cartCountSticky')?.dataset.count || $('cartCountSticky')?.textContent || 0);
    const hasCartItems = cartCount > 0 || renderedCartCount > 0;
    const otherAppViewActive = MOB_VIEWS.some(id => $(id)?.classList.contains('active'));
    const shouldShow = document.body.classList.contains('menu-tab') && !otherAppViewActive && hasCartItems;
    document.body.classList.remove('secondary-view-cart-visible');
    const properties = ['display', 'visibility', 'opacity', 'z-index', 'bottom'];
    properties.forEach(property => sticky.style.removeProperty(property));
    sticky.classList.toggle('show', shouldShow);
  }

  function closeMobViews() {
    MOB_VIEWS.forEach(id => $(id)?.classList.remove('active'));
    document.body.classList.remove('assistant-nav-keep');
    syncCartStickyForActiveView();
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
      await openOperationScreen(true, $('mobNavMenu')); // sem lista parcial durante a consulta
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
    closeMobViews();
    setMobNavActive('mobNavAssistantTab');
    $('mobViewAssistant')?.classList.add('active');
    syncCartStickyForActiveView();
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
    $('mobViewClub')?.classList.add('active');
    syncCartStickyForActiveView();
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
        }
        if (ordersResult.status === 'fulfilled') {
          const value = ordersResult.value;
          appState.customerOrders = Array.isArray(value) ? value : (value?.orders || value?.items || value?.data || []);
        }
        appState.profileLoaded = true;
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
    $('mobViewProfile')?.classList.add('active');
    syncCartStickyForActiveView();
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
      exit: '<path d="M9 5H5v14h4"/><path d="M13 16l4-4-4-4"/><path d="M17 12H8"/>',
      shield: '<path d="M12 21s7-3.5 7-9V6l-7-3-7 3v6c0 5.5 7 9 7 9Z"/><path d="m9.2 12 2 2 3.6-4"/>'
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
          <!-- CONTAS CONECTADAS NÃO ESTÁ AQUI, e a ausência é decisão. Com um
               provedor só, uma linha de primeiro nível para dizer "Google:
               conectado" pesa mais do que informa; ela mora dentro de
               "Gerenciar perfil", ao lado de "Alterar senha", que é a mesma
               família — configuração de acesso à conta. VOLTA para cá no dia em
               que houver mais de um provedor: scratchpad/contas-conectadas-no-menu.md -->
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
      // O foco vai para o botão CHEIO, como nos outros dois diálogos. Ele era
      // `.addr-delete-cancel` porque ali morava o preenchido; com os papéis
      // desinvertidos (§4.1), o preenchido é o `.addr-delete-yes`.
      setAccessibleDialogState(confirm, true, '.addr-delete-yes');
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

  // ── Perfil: dados do cliente e senha ──
  // Mora em scripts/pages/screens/customer-data-screen.js (mount(ctx), skill
  // §9). As nove ações são registradas pela tela; o markup não mudou.
  // ── Perfil: histórico de pedidos e roteador de subtelas ──
  //
  // Mora em scripts/pages/screens/profile-screen.js (contrato mount(ctx),
  // skill §9). As seis ações (openProfSub, closeProfSub, loadProfPedidos,
  // openProfOrderDetails, closeProfOrderDetails, openProfOrderHelp) são
  // registradas pela tela; o markup não mudou um byte.
  //
  // closeProfSub continua sendo chamado POR NOME aqui e nos flows (auth), e a
  // função vive na tela — este trampolim resolve pelo registro NA CHAMADA,
  // nunca no boot, para não congelar referência de quem carrega depois.
  // DECLARAÇÃO de função, não const: o authFlow.init() lá em cima passa
  // `closeProfSub` por valor ANTES desta linha rodar, e um const aqui era TDZ
  // — o app inteiro morreu no boot com "Cannot access 'Vc' before
  // initialization", com lint e unitários verdes (§5 da skill: nenhum dos
  // três executa o app; quem pegou foi o boot-smoke, em segundos e com frase).
  function closeProfSub(...args) {
    return window.RapidexActions.resolve('closeProfSub')?.(...args);
  }

  // mobFocusSearch/closeSearch moram em screens/home-screen.js.

  function openServiceFeeInfo() {
    openModal('serviceFeeModal');
  }

  async function initRestaurantApp() {
    if (bootPromise) return bootPromise;
    resetRuntimeStateForPageLoad();
    setAppBooting(true);
    renderSectionLoader('menuContainer', 'Carregando cardápio...', 'menu-skeleton');
    const restaurantSlugAtBoot = getRestaurantSlug();
    // A disponibilidade das unidades precisa só do slug (que está na URL) e do
    // endereço (que está no storage). Nada disso depende do cardápio — mas ela
    // era disparada DEPOIS do /menu responder, custando uma ida à rede inteira
    // encadeada no caminho do primeiro render. Aqui ela sai junto com o /menu;
    // o resultado continua sendo aplicado depois, quando o contexto de
    // operação já existe para recebê-lo.
    const availabilityAtBoot = restaurantSlugAtBoot
      ? window.PedeAquiBranchAvailabilityService
        .getAvailability(restaurantSlugAtBoot, availabilityPayload(bootAvailabilityAddress()))
      : null;
    // Se o /menu falhar, ninguém chega a esperar por esta busca. O ramo mudo
    // existe só para a rejeição dela não virar "unhandled rejection" no console.
    availabilityAtBoot?.catch(() => {});
    const loadInitialData = async () => {
    const restaurantSlug = restaurantSlugAtBoot;
    // URL que não identifica um restaurante: nem chega a bater na API.
    if (!restaurantSlug) throw restaurantNotFoundError('');
    // A filial da visita anterior, lida do storage antes de existir cardápio:
    // é ela que faz a PRIMEIRA carga já ser a da loja certa, em vez de mostrar
    // a filial padrão do backend e trocar depois.
    const storedBranchId = uuidOrNull(storedOperationBranchId());
    let fresh;
    try {
      fresh = await fetchMenuPayload(storedBranchId);
    } catch (error) {
      // 404 COM filial pedida não é slug inexistente: é a filial guardada que
      // saiu do ar (desativada, ou de outro restaurante). Sem este ramo um
      // branch_id velho no localStorage prende o cliente numa tela de
      // "restaurante indisponível" que recarregar não conserta.
      if (error?.status === 404 && storedBranchId) {
        console.warn('[PedeAqui] A filial guardada não existe mais; recarregando sem filial.', storedBranchId);
        forgetStoredBranch();
        fresh = await fetchMenuPayload(null).catch(retryError => {
          if (retryError?.status === 404 || retryError?.status === 410) throw restaurantNotFoundError(restaurantSlug);
          throw retryError;
        });
      } else if (error?.status === 404 || error?.status === 410) {
        // 404 = slug inexistente; 410 = desativado. Ambos são "não encontrado";
        // qualquer outro status continua sendo falha de carregamento (com retry).
        throw restaurantNotFoundError(restaurantSlug);
      } else {
        throw error;
      }
    }
    restaurant = fresh?.restaurant || {};
    // Backend que responde 200 com corpo vazio, ou com o restaurante inativo,
    // também não pode virar tela em branco nem cair em outro tenant.
    if (!restaurant.id && !restaurant.slug && !restaurant.name) throw restaurantNotFoundError(restaurantSlug);
    if (restaurant.is_active === false) throw restaurantNotFoundError(restaurantSlug);
    applyMenuPayload(fresh);
    appState.restaurant = restaurant;
    };
    bootPromise = (async () => {
    await loadInitialData();
    // O TEMA VEM AQUI, e não no fim do boot.
    //
    // A cor do lojista chega no PRIMEIRO await desta função, junto com o
    // /menu. Enquanto applyTheme() ficava lá embaixo, a paleta da PLATAFORMA
    // seguia pintada por todo o initOperationContext(), por um SEGUNDO
    // ida-e-volta de rede (a disponibilidade da filial) e pelo restoreCart().
    // O comentário de applyTheme() conta o que isso custava na tela.
    applyTheme();
    // A ORDEM IMPORTA: a chave da sacola tem a filial, então o contexto de
    // operação precisa estar montado antes de restaurá-la — e o cardápio
    // precisa ser o daquela filial, porque é contra ele que os itens são
    // conferidos e é dele que sai o preço.
    initOperationContext();
    // A disponibilidade faz parte do boot: quando a Home aparece, o widget já
    // abre Unidades diretamente com KM, taxa e status, sem carregar na seta.
    const [menuMatchesBranch] = await Promise.all([
      ensureMenuMatchesSelectedBranch(),
      requestBranchAvailability(operationContext.address, availabilityAtBoot)
    ]);
    // A sacola só é conferida contra o cardápio DA FILIAL DELA. Se o cardápio
    // da filial guardada não chegou, o que está em memória é o da filial padrão
    // — e conferir contra ele apagaria a sacola (os ids não se repetem entre
    // filiais) e ainda gravaria o vazio por cima. Nesse caso não se restaura
    // nada: `cartRestored` continua false, então persistCart() também não
    // grava, e a sacola guardada sobrevive intacta para a próxima visita.
    if (menuMatchesBranch) restoreCart();
    else showAppToast('Não foi possível carregar o cardápio da sua unidade. Recarregue a página.');
    window.RapidexActions.resolve('initStoreInfoModal')?.();
    initCashbackState();
    renderRestaurantShell();
    window.RapidexActions.resolve('renderHomeContent')?.();
    renderProfileView();
    initSearch();
    setCartTab(operationContext?.order_type || 'delivery');
    updateCartUI();
    showHomeTab();
    requestDeliveryEstimate();
    loadCashbackForHome();
    // O LINK DE PRODUTO, aberto no fim do boot e não antes.
    //
    // `/{slug}/produto/{id}` é rewrite na Vercel para `?produto=<id>`. Ele só
    // pode ser honrado AQUI: `openProduct()` procura o id em `products`, que
    // só existe depois do `/menu` — e depois de `ensureMenuMatchesSelectedBranch()`,
    // porque ids não se repetem entre filiais e um link aberto contra o
    // cardápio errado cairia no aviso de "fora do cardápio desta unidade".
    //
    // Falha em silêncio de propósito quando o id não existe: quem chegou por
    // um link velho vê a loja, que é o destino certo — e `openProduct()` já
    // avisa por toast quando o item não está nesta unidade.
    abrirProdutoDoLink();
    appState.homeLoaded = true;
    appState.menuLoaded = false;
    restaurantStore()?.set?.({ homeLoaded: true, menuLoaded: false });
    initPageRubberBand();
    initMenuHeaderHide();
    setAppBooting(false);
    // Best-effort: refresh the logged customer against the backend (clears
    // the session on 401). Runs after first paint so it never blocks the page.
    syncCustomerSession();
    })();
    return bootPromise;
  }

  /**
   * Lê `?produto=<id>` e abre aquele produto. Devolve o id lido, ou ''.
   *
   * O parâmetro é APAGADO da barra antes de abrir, e não é enfeite: quem abre
   * o produto reescreve a url para `/{slug}/produto/{id}` de qualquer jeito
   * (marcarProdutoNaUrl), e deixar o `?produto=` para trás deixaria a loja com
   * duas grafias do mesmo endereço — a bonita e a de rewrite — competindo em
   * histórico, compartilhamento e cache.
   */
  function abrirProdutoDoLink() {
    const id = (() => {
      try { return String(new URLSearchParams(window.location.search).get('produto') || '').trim(); } catch { return ''; }
    })();
    if (!id) return '';
    const slug = getRestaurantSlug();
    if (slug) {
      try { window.history.replaceState(window.history.state, '', `${window.location.origin}/${encodeURIComponent(slug)}`); } catch { /* idem */ }
    }
    window.RapidexActions.resolve('openProduct')?.(id);
    return id;
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
  // couponArtImageFailed mora em screens/home-screen.js.

  const ACTIONS = {
    // openProduct/toggleProductOption/changeQty/addToCart/editCartItem são
    // registradas por screens/product-screen.js — registrar o trampolim aqui
    // seria recursão se a tela faltasse.
    openModal, closeModalId, closeModal, handleHomeLoginPromptClick, handleHomeCartValueClick, openCartBenefits, scrollToCategory, findCategoryButton, scrollToMenu,
    removeCartItem, openCartItemDeleteConfirm, closeCartItemDeleteConfirm, cancelCartItemDelete, confirmCartItemDelete, setCartTab, handleCartCta, openCheckout, backToCart, setDeliveryType, openPaymentMethodScreen, closePaymentMethodScreen, setPaymentScreenTab,
    submitOrder, closeOrderSuccess,
    openOrderConfirm, closeOrderConfirm, confirmOrderFromSheet, openConfirmBenefits,
    // As 13 acoes do fluxo de Pix sairam daqui: registram-se sozinhas em
    // scripts/pages/restaurant-pix-flow.js.
    setPayment, confirmPaymentMethodSelection,
    // As 27 acoes do fluxo de endereco sairam daqui: elas se registram sozinhas
    // em scripts/pages/restaurant-address-flow.js. RapidexActions.register()
    // mescla, entao o markup nao mudou.
    // As 42 acoes de entrar/cadastrar/verificar/recuperar sairam daqui: elas se
    // registram sozinhas em scripts/pages/restaurant-auth-flow.js. As quatro
    // abaixo NAO foram: sair da conta e a confirmacao dela moram no perfil, nao
    // nas telas de autenticacao.
    logout, confirmLogout, cancelLogout, closeLogoutConfirm,
    openOperationScreen, closeOperationScreen, setOperationType, renderOperationBranches, selectBranch, confirmOperation,
    openPolicyScreen, closePolicyScreen,
    // useCoupon/openCouponDetail/closeCouponDetail/confirmCouponDetail são da
    // coupon-detail-screen; handleBannerAction, setHeroBanner, mobFocusSearch,
    // closeSearch e couponArtImageFailed são da home-screen.
    // setStoreInfoTab e openRestaurantInfo são registradas por
    // screens/store-info-screen.js.
    setProfilePaymentTab, selectSavedCardPayment, clearSavedCardPayment,
    mobNavHome, mobNavMenu, mobNavClub, mobNavAssistant, mobNavProfile, assistantGoBack, goToMenuTab: scrollToMenu,
    // As seis ações do Perfil/pedidos (openProfSub, closeProfSub,
    // loadProfPedidos, openProfOrderDetails, closeProfOrderDetails,
    // openProfOrderHelp) são registradas por screens/profile-screen.js.
    // As nove ações de dados/senha do cliente são registradas por
    // screens/customer-data-screen.js.
    openServiceFeeInfo,
    // As três ações do extrato (openCashbackStatement, retryCashbackStatement,
    // closeCashbackStatement) são registradas por cashback-statement.js.
    retryRestaurantBoot, retryMenuLoad, retryClubLoad, refreshAvailableCoupons
  };

  window.RapidexActions.register(ACTIONS);

  // ── appPort: os 13 estados do app, por GETTER, para as telas (skill §9) ──
  //
  // Getter, nunca valor: `app.cart` chama o getter A CADA acesso e devolve a
  // variável VIVA deste fechamento. Uma cópia no boot viraria fotografia — o
  // módulo passaria a decidir com dado velho sem acusar nada, que é a
  // armadilha mais cara da extração de módulos (skill §2.1). As quatro
  // últimas já são funções: a REFERÊNCIA delas é estável, o que muda é o que
  // elas leem — por isso vão como valor.
  //
  // boot-smoke.spec.js exige as 13 chaves e que as de estado sejam ACESSOR
  // (getter de verdade), não propriedade de dado.
  window.PedeAquiAppPort = {
    get restaurant() { return restaurant; },
    get cart() { return cart; },
    get customer() { return customer; },
    get products() { return products; },
    get branches() { return branches; },
    get settings() { return settings; },
    get appState() { return appState; },
    get operationContext() { return operationContext; },
    get restaurantInfoState() { return restaurantInfoState; },
    isLogged,
    deliveryFee,
    currentCustomerSnapshot,
    persistCustomer
  };

  // ── mount das telas (skill §9) ──
  //
  // Depois de ACTIONS e do appPort: a tela registra as ações dela no registro
  // (que MESCLA) e lê estado pelas portas. O shell leva só o que ESTA tela
  // precisa do fechamento — cada função a mais aqui é um fio a mais na conta
  // do fios-do-corte --tela.
  window.PedeAquiProfileScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      openLoginScreen,
      syncCustomerSession,
      syncCartStickyForActiveView,
      renderProfileHelpContacts,
      ensureRestaurantInfo
    }
  });

  window.PedeAquiCustomerDataScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      openLoginScreen,
      syncCustomerSession,
      closeProfSub,
      renderHomeLoginPrompt,
      renderProfileView,
      apiErrorMessage,
      // Máscaras e validação de nascimento são portas do auth-flow — a mesma
      // grafia do cadastro, para os dois formulários nunca divergirem.
      maskRegBirth,
      maskRegPhone,
      isValidBirthDate,
      EYE_OFF_SVG
    }
  });

  window.PedeAquiAccountDeleteScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      openLoginScreen,
      // A saída depois do 204 é local: a conta não existe mais e o token
      // morreu junto, então nenhuma destas quatro fala com a rede.
      closeProfSub,
      renderHomeLoginPrompt,
      renderProfileView,
      apiErrorMessage,
      showAppToast
    }
  });

  window.PedeAquiStoreInfoScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      // Os normalizadores de pagamento ficam AQUI porque o checkout e a
      // subtela de pagamento do Perfil também os leem — mover viraria
      // dependência de tela para tela.
      infoPaymentData,
      infoPaymentLabel,
      infoBrandClass,
      profilePaymentChips,
      ensureRestaurantInfo,
      openModal
    }
  });

  window.PedeAquiCouponDetailScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      getCouponForDetail,
      judgedCouponForDetail,
      // As três portas do dinheiro: a folha nunca escreve selectedCoupon
      // diretamente — arma, desfaz e persiste por aqui.
      armSelectedCoupon,
      restoreSelectedCoupon,
      previewSelectedCoupon,
      couponImageUrl,
      readyCardImage,
      renderDetailImage,
      openLoginScreen,
      // NAO E `app.isLogged()`, e a diferenca decide se uma requisicao sai.
      //
      // `isLogged()` e `Boolean(customer || ...)`: ele responde TRUE para quem
      // so digitou nome e telefone no checkout, porque isso grava um perfil em
      // localStorage sem token nenhum. Quem faz `POST /coupons/preview`
      // responder 401 e a ausencia do Bearer, e so ela — a rota declara
      // `HTTPBearer` no contrato.
      //
      // Perguntar `isLogged()` antes de aplicar um cupom deixaria passar
      // exatamente o caso mais comum do defeito: a pessoa que se identificou
      // para pedir, nunca criou conta, e via "Validando..." antes do login.
      hasAuthSession: () => Boolean(window.PedeAquiCustomerService?.isLoggedIn?.()),
      mobNavMenu,
      // O destino do cupom `payment_method_not_allowed`. As DUAS, e nesta
      // ordem: a tela de pagamento volta para a sacola ao confirmar, e é na
      // sacola que o cupom se aplica — abrir só o pagamento deixaria a pessoa
      // num beco com o cupom fora de alcance.
      openCartModal,
      openPaymentMethodScreen
    }
  });

  window.PedeAquiProductScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      addDraftToCart,
      closeModalId,
      productImage,
      readyCardImage,
      renderDetailImage,
      openModal,
      menuBranchId: () => menuBranchId
    }
  });

  window.PedeAquiHomeScreen.mount({
    kit: window.PedeAquiScreenKit,
    app: window.PedeAquiAppPort,
    shell: {
      // Acessores, nunca cópia: os três arrays são REATRIBUÍDOS a cada carga
      // de cardápio — uma referência congelada mostraria a filial anterior.
      getBanners: () => banners,
      getHighlightBanners: () => highlightBanners,
      getCoupons: () => coupons,
      couponImageUrl,
      responsiveImageAttrs,
      applyResponsiveImage,
      imageAttrs,
      actAll,
      closeMobViews,
      showMenuTab,
      ensureMenuLoaded,
      scrollToMenu,
      scrollToCategory,
      findCategoryButton
    }
  });

  // 152 nomes iam para window; 141 deles existiam SÓ para alimentar handlers
  // on*= inline e agora vivem apenas no registro de ações. Os 11 abaixo ficam
  // porque outro módulo ou a suíte E2E os chama pelo nome global — cada um foi
  // conferido por grep (window.X e chamada bare), não por suposição.
  Object.assign(window, {
    // scripts/pages/restaurant-assistant.js
    openProduct, scrollToCategory, findCategoryButton, mobNavMenu,
    // scripts/pages/restaurant-club.js (openCashbackStatement, que o clube
    // também chama, é publicado em window por cashback-statement.js)
    openCouponDetail,
    // scripts/pages/cashback-statement.js
    openLoginScreen, syncCustomerSession,
    // tests/e2e/helpers.js e order-flow.spec.js
    openModal, changeQty, addToCart
  });
  // O recuo é do APP inteiro, não de uma tela: o registro MESCLA, então o
  // markup do Clube, do Perfil e da Home alcança a mesma ação.
  window.RapidexActions.register({ retreatImage });

  // A consulta do pagamento não roda com a aba escondida (ver pollPixStatus).
  // Quando ela volta, retomamos na hora em vez de esperar o próximo intervalo:
  // é justamente o momento em que o cliente voltou do app do banco.
  window.RapidexLifecycle?.onVisibility?.({
    onVisible: () => {
      if (P.pixSession && !P.pixSession.stopped && !P.pixSession.pollTimer) pollPixStatus();
    },
    onHidden: () => {
      if (P.pixSession?.pollTimer) {
        clearTimeout(P.pixSession.pollTimer);
        P.pixSession.pollTimer = null;
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
