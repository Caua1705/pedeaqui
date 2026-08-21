// PWA por tenant — manifest e registro do service worker.
//
// O PROBLEMA. O manifest é um ARQUIVO que o browser busca por URL, e a Vercel é
// um host estático: ela só sabe mapear uma URL para bytes que já existiam no
// build. Os tenants vêm da API e são ilimitados, então não existe (e nunca vai
// existir) um manifest.webmanifest por restaurante no disco.
//
// A saída tem duas camadas, e cada uma cobre o buraco da outra:
//
// 1. IDENTIDADE (camada estática, sem JS).
//    O public/manifest.webmanifest (servido em /manifest.webmanifest) declara
//    `start_url` e `scope` como "./" —
//    RELATIVOS. A spec resolve os dois contra a URL DO MANIFEST, então o MESMO
//    arquivo, servido em /junior-da-picanha/manifest.webmanifest, produz
//    escopo /junior-da-picanha/. Um rewrite na vercel.json aponta
//    /:slug/manifest.webmanifest para o arquivo único. Um arquivo, N escopos.
//
//    `id` é omitido de propósito: ele NÃO é resolvido contra a URL do manifest,
//    e sim contra a ORIGEM (spec: "let baseURL be the origin of start URL"), de
//    modo que um "./" ali colapsaria todos os tenants no mesmo id. Omitido, o id
//    cai no default — o próprio start_url, que já é por tenant.
//
//    Esta camada NÃO declara ícone. Ela serve todos os tenants ao mesmo tempo,
//    então qualquer ícone nela seria, por definição, o de nenhum restaurante —
//    e na prática o nosso. O preço é que o browser só oferece a instalação
//    depois que a camada 2 entra, o que é o comportamento desejado: instalar
//    antes de a marca chegar é exatamente o vazamento que se quer evitar.
//
// 2. MARCA (camada de runtime).
//    Nome, cor e logo do restaurante só existem depois que a API responde.
//    Quando respondem, o manifest é remontado em memória e servido por um
//    blob: URL — e junto com ele vão o favicon, o apple-touch-icon e as meta de
//    compartilhamento (scripts/utils/tenant-identity.js). Exige
//    `manifest-src 'self' blob:` na CSP — sem isso o browser recusa o blob e o
//    `<link>` fica quebrado. Se o blob falhar por qualquer motivo, o href volta
//    para a camada 1, que continua correta; o favicon e o ícone da tela inicial
//    não dependem dele e já estão aplicados.
//
// POR QUE O ESCOPO PRECISA DA BARRA FINAL. O escopo é comparado como PREFIXO DE
// STRING no path. Com scope "/junior-da-picanha" (sem barra), a URL
// /junior-da-picanha-2 também casa o prefixo — o app instalado de um tenant
// capturaria a URL do vizinho, que é exatamente a falha de isolamento que este
// projeto não aceita. Com "/junior-da-picanha/" não casa. Só que a barra final
// precisa EXISTIR como rota, e o rewrite antigo (/:slug) casava um único
// segmento sem barra: /junior-da-picanha/ dava 404. Daí a rota nova na
// vercel.json. Ver tests/unit/pwa-manifest.test.js.
//
// Em subdomínio (<slug>.rapidex.com) nada disso é preciso: a origem já é do
// tenant, então o escopo é a raiz.
(function () {
  // Nome do app quando o tenant ainda não resolveu. Era "Rapidex": o nome da
  // plataforma no ícone de um app que é do restaurante. Neutro é a única saída
  // honesta aqui, porque este fallback serve TODOS os tenants ao mesmo tempo —
  // ele não tem como saber de qual loja é. Assim que o slug resolve,
  // applyTenantManifest() troca por nome, cor e logo da loja.
  const FALLBACK_NAME = 'Pedido Online';
  const MANIFEST_FILE = 'manifest.webmanifest';

  // NÃO EXISTE MAIS uma lista de ícones da plataforma aqui.
  //
  // Existia: os PNGs de /assets/icons/pwa/ entravam no manifest de TODO tenant,
  // com a justificativa de garantirem os 192/512 px exigidos para a instalação e
  // de servirem de reserva quando a logo remota não carregasse. As duas coisas
  // eram verdade — e o efeito era o pin do Rapidex na tela inicial de quem
  // instalasse o app de uma loja sem logo, ou com logo fora do ar.
  //
  // Quem cumpre os dois papéis agora é a marca gerada com as INICIAIS do
  // restaurante sobre a COR dele (scripts/utils/tenant-identity.js): tem os
  // tamanhos explícitos que o browser pede e é a reserva da logo. A cadeia
  // inteira passa a ser do lojista, do primeiro ao último degrau.
  const PLATFORM_THEME = '#F36F21';
  const BACKGROUND = '#FFFFFF';

  // O escopo do tenant. 'subdomain' => a origem já é dele.
  // Ver o bloco sobre a barra final no topo do arquivo.
  function tenantScope(slug, topology) {
    return topology === 'subdomain' || !slug ? '/' : `/${slug}/`;
  }

  // De onde o slug veio decide a topologia. É a MESMA fonte que o resto do app
  // usa (scripts/utils/restaurant-slug.js), não uma segunda heurística.
  function detectTopology(location) {
    const tenant = window.RapidexTenant;
    if (!tenant) return 'path';
    const host = (location || window.location || {}).hostname || '';
    const domains = window.APP_CONFIG?.TENANT_ROOT_DOMAINS || tenant.DEFAULT_ROOT_DOMAINS;
    return tenant.slugFromHostname(host, domains) ? 'subdomain' : 'path';
  }

  // A resolução do ícone do lojista (o que é URL utilizável, que `type`
  // declarar, o que fazer sem logo) NÃO mora mais aqui: mora em
  // scripts/utils/tenant-identity.js, que é o mesmo lugar de onde saem o favicon
  // e o apple-touch-icon. Manifest e aba precisam concordar sobre qual é o ícone
  // do restaurante, e a única forma de garantir isso é ter uma fonte só.

  function absolute(origin, path) {
    return new URL(path, origin).href;
  }

  /**
   * Monta o manifest do tenant. PURO: recebe origem, slug e marca, devolve o
   * objeto — sem tocar em location, DOM ou rede (tests/unit/pwa-manifest.test.js).
   *
   * TODAS as URLs saem absolutas de propósito. Este objeto vira um blob:, e
   * blob: tem path opaco: resolver "/x" contra "blob:https://origem/uuid" NÃO
   * devolve "https://origem/x". Absoluto, não há base para resolver.
   */
  function buildTenantManifest({ origin, slug, topology, name, themeColor, logoUrl } = {}) {
    const scope = tenantScope(slug, topology);
    const scopeUrl = absolute(origin, scope);
    const restaurantName = String(name || '').trim();
    const theme = window.RapidexTheme?.normalizeHex(themeColor, PLATFORM_THEME) || PLATFORM_THEME;

    return {
      // Explícito e absoluto aqui (ao contrário do arquivo estático): resolvido
      // contra a origem, dá exatamente o mesmo id que o start_url do estático,
      // então trocar de uma camada para a outra não vira "outro app" no Chrome.
      id: scopeUrl,
      name: restaurantName ? `${restaurantName} — Pedido Online` : FALLBACK_NAME,
      short_name: restaurantName || FALLBACK_NAME,
      description: restaurantName
        ? `Peça online no ${restaurantName}.`
        : 'Peça online no seu restaurante favorito.',
      lang: 'pt-BR',
      dir: 'ltr',
      start_url: scopeUrl,
      scope: scopeUrl,
      display: 'standalone',
      orientation: 'portrait',
      background_color: BACKGROUND,
      theme_color: theme,
      categories: ['food', 'shopping'],
      // A logo do lojista primeiro; a marca gerada com as iniciais dele logo
      // atrás, cobrindo os tamanhos exigidos e o caso da logo fora do ar. Todas
      // as entradas são data: ou https: absolutos, então nenhuma depende da base
      // opaca do blob. Ver tenantIcons() em scripts/utils/tenant-identity.js.
      icons: window.RapidexTenantIdentity.tenantIcons({
        name: restaurantName,
        logoUrl,
        primaryColor: theme
      })
    };
  }

  // A URL da camada estática: o arquivo único servido sob o diretório do tenant.
  function staticManifestUrl(slug, topology) {
    return tenantScope(slug, topology) + MANIFEST_FILE;
  }

  function manifestLink() {
    return document.querySelector('link[rel="manifest"]');
  }

  let _blobUrl = null;

  function setManifestHref(href) {
    const link = manifestLink();
    if (!link || link.getAttribute('href') === href) return false;
    link.setAttribute('href', href);
    return true;
  }

  // A cor da barra do browser acompanha a marca do tenant. Só o chrome do
  // browser muda; nenhum pixel da página depende desta meta.
  function setThemeColorMeta(themeColor) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeColor) meta.setAttribute('content', themeColor);
  }

  /**
   * Camada 1. Roda no boot, com o slug que a URL já entrega — não espera a API.
   */
  function applyStaticTenantManifest() {
    const slug = window.RapidexTenant?.resolveSlug?.() || '';
    if (!slug) return '';
    const href = staticManifestUrl(slug, detectTopology());
    setManifestHref(href);
    return href;
  }

  /**
   * Camada 2. Roda quando a marca do restaurante chega da API.
   * Devolve o manifest aplicado, ou null se não deu para aplicar.
   *
   * Favicon, apple-touch-icon e as meta de compartilhamento são aplicados ANTES
   * do manifest e FORA do try: eles não dependem de blob nem de CSP, e não podem
   * ficar reféns de um passo que pode falhar. Se o blob for barrado, a aba e a
   * tela inicial já estão com a cara da loja.
   */
  function applyTenantManifest({ name, themeColor, logoUrl, description } = {}) {
    const slug = window.RapidexTenant?.resolveSlug?.() || '';
    if (!slug) return null;
    window.RapidexTenantIdentity.applyTenantIcons({ name, logoUrl, primaryColor: themeColor });
    window.RapidexTenantIdentity.applyTenantMeta({ name, description, logoUrl, primaryColor: themeColor });
    if (!manifestLink()) return null;
    const manifest = buildTenantManifest({
      origin: window.location.origin,
      slug,
      topology: detectTopology(),
      name,
      themeColor,
      logoUrl
    });
    setThemeColorMeta(manifest.theme_color);
    try {
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      const next = URL.createObjectURL(blob);
      setManifestHref(next);
      // O blob anterior vira lixo assim que o link deixa de apontar para ele.
      if (_blobUrl) URL.revokeObjectURL(_blobUrl);
      _blobUrl = next;
    } catch (error) {
      // Blob barrado (CSP, browser antigo): a camada 1 já está no href e
      // continua com escopo e id certos — só sem o nome e o logo do lojista.
      console.warn('[Rapidex] Manifest do tenant não pôde ser gerado; usando o estático.', error);
      return null;
    }
    return manifest;
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(null);
    return navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(error => {
        // Um SW que não registra é degradação, não falha: o app funciona igual
        // sem ele. Nunca deixar isso derrubar o boot.
        console.warn('[Rapidex] Service worker não registrado.', error);
        return null;
      });
  }

  window.RapidexPWA = {
    PLATFORM_THEME,
    tenantScope,
    detectTopology,
    buildTenantManifest,
    staticManifestUrl,
    applyStaticTenantManifest,
    applyTenantManifest,
    registerServiceWorker
  };

  // As funções acima são puras e testadas sem browser (o vitest roda em `node`,
  // com window aliasado para globalThis). Só o bootstrap toca no DOM, então ele
  // fica atrás desta guarda — importar o arquivo num teste não pode disparar
  // registro de service worker nem procurar <link>.
  if (typeof document === 'undefined') return;

  applyStaticTenantManifest();

  // Depois do load: o registro do SW não pode disputar banda com o CSS, o JS e
  // a primeira chamada de cardápio.
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
})();
