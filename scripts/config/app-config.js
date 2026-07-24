(function () {
  const APP_CONFIG = {
    API_BASE_URL: 'https://api.pederapidex.com',
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
