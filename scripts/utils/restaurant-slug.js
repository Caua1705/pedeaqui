// Resolução do tenant (slug do restaurante) — FONTE ÚNICA.
//
// Ordem de precedência:
//   1. subdomínio do hostname   — <slug>.rapidex.com   (topologia wildcard)
//   2. ?slug= na query          — o que o rewrite do Vercel entrega
//   3. segmento do path         — rapidex.com/<slug>, /r/<slug>, /restaurantes/<slug>
//
// NÃO existe fallback para um restaurante padrão. Um slug ausente, malformado ou
// desconhecido tem que virar erro na tela — servir outro tenant no lugar é falha
// de isolamento (o cliente veria cardápio, marca e preços de outra loja).
(function () {
  // O subdomínio só é lido quando o host pertence a um domínio-raiz conhecido.
  // Sem isso, `preview-abc123.vercel.app` viraria o "slug" preview-abc123, e
  // qualquer host de 3 rótulos passaria a ser interpretado como tenant.
  const DEFAULT_ROOT_DOMAINS = ['rapidex.com', 'pederapidex.com'];

  // Subdomínios da plataforma: existem no domínio-raiz mas não são restaurantes.
  const RESERVED_SUBDOMAINS = new Set([
    'www', 'app', 'api', 'admin', 'painel', 'dashboard', 'cdn', 'assets',
    'mail', 'staging', 'stage', 'dev', 'preview', 'homolog'
  ]);

  // Prefixos de rota: o slug vem no segmento SEGUINTE (/r/<slug>).
  const ROUTE_PREFIXES = new Set(['r', 'restaurante', 'restaurantes']);

  // Diretórios estáticos servidos na raiz: nunca contêm um slug.
  const STATIC_ROOTS = new Set(['assets', 'scripts', 'styles', 'data', 'api']);

  // Formato canônico de slug (o mesmo que scripts/utils/slugify.js produz).
  const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function rootDomains() {
    const configured = window.APP_CONFIG?.TENANT_ROOT_DOMAINS;
    const list = Array.isArray(configured) ? configured : DEFAULT_ROOT_DOMAINS;
    return list.map(domain => String(domain || '').trim().toLowerCase()).filter(Boolean);
  }

  // Devolve o slug só se ele for canônico. Qualquer outra coisa vira '' e o
  // chamador trata como "restaurante não encontrado".
  function normalizeSlug(value) {
    const slug = String(value ?? '').trim().toLowerCase();
    return SLUG_PATTERN.test(slug) ? slug : '';
  }

  function slugFromHostname(hostname, domains) {
    const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host) return '';
    for (const domain of domains) {
      // Apex (rapidex.com) não tem subdomínio; só `<algo>.rapidex.com` tem.
      if (!host.endsWith('.' + domain)) continue;
      const subdomain = host.slice(0, -(domain.length + 1));
      // Só o rótulo mais à esquerda importa, e apenas se for o único:
      // `a.b.rapidex.com` não é um tenant válido.
      if (subdomain.includes('.')) return '';
      if (RESERVED_SUBDOMAINS.has(subdomain)) return '';
      return normalizeSlug(subdomain);
    }
    return '';
  }

  function slugFromSearch(search) {
    try {
      return normalizeSlug(new URLSearchParams(String(search || '')).get('slug'));
    } catch {
      return '';
    }
  }

  function decodeSegment(segment) {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      return String(segment).toLowerCase();
    }
  }

  // Só o começo do path decide. `/fuji/qualquer/coisa` é o tenant fuji; um
  // diretório estático ou um arquivo (restaurant.html) não é tenant nenhum.
  function slugFromPathname(pathname) {
    const segments = String(pathname || '').split('/').filter(Boolean).map(decodeSegment);
    const [first, second] = segments;
    if (!first) return '';
    if (ROUTE_PREFIXES.has(first)) return normalizeSlug(second);
    if (STATIC_ROOTS.has(first)) return '';
    // Arquivo servido diretamente (restaurant.html, favicon.ico): nunca é slug.
    if (first.includes('.')) return '';
    return normalizeSlug(first);
  }

  // Puro e injetável — os testes passam location sintético, sem tocar no browser.
  function resolveSlugFrom({ hostname = '', search = '', pathname = '', rootDomains: domains } = {}) {
    const domainList = Array.isArray(domains) ? domains : rootDomains();
    return slugFromHostname(hostname, domainList)
      || slugFromSearch(search)
      || slugFromPathname(pathname);
  }

  function resolveSlug() {
    const location = window.location || {};
    return resolveSlugFrom({
      hostname: location.hostname,
      search: location.search,
      pathname: location.pathname
    });
  }

  window.RapidexTenant = {
    resolveSlug,
    resolveSlugFrom,
    normalizeSlug,
    slugFromHostname,
    slugFromSearch,
    slugFromPathname,
    DEFAULT_ROOT_DOMAINS,
    RESERVED_SUBDOMAINS,
    ROUTE_PREFIXES,
    STATIC_ROOTS
  };

  // Nomes antigos mantidos como alias fino: o resto do app já os chamava.
  window.getRestaurantSlugFromUrl = resolveSlug;
  window.PedeAquiRestaurantSlug = { getRestaurantSlugFromUrl: resolveSlug, resolveSlug };
})();
