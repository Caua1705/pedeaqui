(function () {
  // API base comes from Vite env (VITE_API_BASE_URL in .env — see .env.example),
  // falling back to the production URL so the app still boots without a .env.
  var envApiBase = '';
  var envRootDomains = '';
  try {
    envApiBase = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || '';
    envRootDomains = (import.meta.env && import.meta.env.VITE_TENANT_ROOT_DOMAINS) || '';
  } catch (error) {
    envApiBase = '';
    envRootDomains = '';
  }

  // Domínios em que um subdomínio significa "restaurante" (<slug>.rapidex.com).
  // Qualquer outro host (preview do Vercel, localhost, IP) resolve o tenant só
  // por path/query. Ver scripts/utils/restaurant-slug.js.
  const rootDomains = String(envRootDomains)
    .split(',')
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);

  const APP_CONFIG = {
    API_BASE_URL: envApiBase || 'https://api.pederapidex.com',
    TENANT_ROOT_DOMAINS: rootDomains.length ? rootDomains : ['rapidex.com', 'pederapidex.com'],
    DEFAULT_RESTAURANT_SLUG: 'junior-da-picanha',
    STORAGE_MODE: 'api',
    USE_MOCK_DATA: false,
    MOCK_DATA_BASE_PATH: 'data/restaurants',
    STORAGE_PREFIX: 'pedeaqui'
  };

  window.APP_CONFIG = APP_CONFIG;
  window.PedeAquiConfig = {
    appName: 'Rapidex',
    defaultRestaurantSlug: APP_CONFIG.DEFAULT_RESTAURANT_SLUG,
    storagePrefix: APP_CONFIG.STORAGE_PREFIX,
    useMockData: APP_CONFIG.USE_MOCK_DATA,
    apiBaseUrl: APP_CONFIG.API_BASE_URL
  };
})();
