// ============================================================================
//  screen-kit — as ferramentas que TODA tela usa, num lugar só.
//
//  Isto existe para a fase de telas (screens/*.js): cada tela recebe
//  ctx = { kit, app, shell }, e `kit` é este objeto. Onze das catorze
//  ferramentas são INVÓLUCRO de um global que já existe (PedeAquiDom,
//  PedeAquiCurrency, RapidexTenantIdentity...) — e ficam invólucro de
//  propósito: reimplementar aqui viraria uma segunda verdade, e o dia em que
//  o dono mudasse (o esc() ganhando um caso novo, por exemplo) as telas
//  divergiriam do resto do app sem nenhum aviso.
//
//  Todos os invólucros leem o global NA CHAMADA, não no import: este arquivo
//  carrega cedo em entry-restaurant.js e não pode congelar referências de
//  quem carrega depois. (A mesma lição do init(deps): valor congela a
//  fotografia do boot.)
//
//  NENHUMA instrução executável no corpo além das definições — o
//  page-modules.test.js barra módulo de tela que executa no import, e este
//  arquivo segue a mesma regra.
// ============================================================================
(function () {
  const TAB_LOADER_MIN_MS = 500;

  const esc = (text) => (window.PedeAquiDom?.escapeHtml
    ? window.PedeAquiDom.escapeHtml(text)
    : String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])));

  const fmt = (value) => window.PedeAquiCurrency.formatCurrency(value);

  const fallback = () => window.PedeAquiFallbackConfig || {};

  const $ = (id) => (window.PedeAquiDom?.byId ? window.PedeAquiDom.byId(id) : document.getElementById(id));

  // Mostrar/esconder passa por classe, não por style.display (CSP: o estado
  // inicial escondido é .u-hidden no markup, sem style= inline).
  const showEl = (element, shown) => element?.classList.toggle('u-hidden', !shown);

  const initials = (name) => window.RapidexTenantIdentity.initialsFor(name);

  const onlyDigits = (value) => (window.PedeAquiValidators?.onlyDigits
    ? window.PedeAquiValidators.onlyDigits(value)
    : String(value ?? '').replace(/\D/g, ''));

  // Atributo de ação para markup gerado em template (scripts/utils/actions.js).
  // O valor vai CRU: a spec vira JSON e só então é escapada.
  const act = (event, name, ...args) =>
    `data-act-${event}="${esc(args.length ? JSON.stringify([name, ...args]) : name)}"`;

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Mesmo efeito do setLoading do restaurant-page.js: deduplica no appState
  // (via appPort — o objeto é o MESMO, getter não copia) e avisa o store.
  function setLoading(scope, active) {
    const appState = window.PedeAquiAppPort?.appState;
    if (appState?.loading) {
      if (appState.loading[scope] === active) return;
      appState.loading[scope] = active;
    }
    window.PedeAquiRestaurantStore?.setLoading?.(scope, active);
  }

  function logAppError(message, error) {
    console.error(`[PedeAqui] ${message}`, error);
  }

  function releaseFocusFrom(container, focusFallback) {
    const active = document.activeElement;
    if (!container || !active || !container.contains(active)) return;
    active.blur();
    if (focusFallback?.isConnected && typeof focusFallback.focus === 'function') focusFallback.focus({ preventScroll: true });
    else document.body?.focus?.({ preventScroll: true });
  }

  function getRestaurantSlug() {
    return window.RapidexTenant?.resolveSlug?.() || '';
  }

  window.PedeAquiScreenKit = {
    TAB_LOADER_MIN_MS,
    esc,
    fmt,
    fallback,
    $,
    showEl,
    initials,
    onlyDigits,
    act,
    wait,
    setLoading,
    logAppError,
    releaseFocusFrom,
    getRestaurantSlug
  };
})();
