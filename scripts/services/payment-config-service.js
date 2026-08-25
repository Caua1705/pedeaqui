(function () {
  /** @typedef {import('../types/api').components['schemas']['PaymentConfigResponse']} PaymentConfigResponse */

  const CACHE_TTL_MS = 5 * 60 * 1000;
  /** @type {Map<string, {value: PaymentConfigResponse, expiresAt: number}>} */
  const cache = new Map();
  /** @type {Map<string, Promise<PaymentConfigResponse>>} */
  const pending = new Map();

  function normalizedSlug(value) {
    return String(value || '').trim();
  }

  /**
   * @param {string} restaurantSlug
   * @param {{force?: boolean}} [options]
   * @returns {Promise<PaymentConfigResponse>}
   */
  function getPaymentConfig(restaurantSlug, options = {}) {
    const slug = normalizedSlug(restaurantSlug);
    if (!slug) return Promise.reject(new Error('Restaurante não informado.'));
    const cached = cache.get(slug);
    if (!options.force && cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value);
    }
    if (pending.has(slug)) return /** @type {Promise<PaymentConfigResponse>} */ (pending.get(slug));

    const request = window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.restaurantPaymentConfig(slug),
      { method: 'GET' }
    ).then(raw => {
      const config = /** @type {PaymentConfigResponse} */ (raw);
      cache.set(slug, { value: config, expiresAt: Date.now() + CACHE_TTL_MS });
      return config;
    }).finally(() => pending.delete(slug));
    pending.set(slug, request);
    return request;
  }

  /** @param {PaymentConfigResponse | null} config */
  function cardIsAvailable(config) {
    return Boolean(
      config?.card_enabled === true
      && String(config.provider || '').toLowerCase() === 'mercadopago'
      && String(config.public_key || '').trim()
    );
  }

  /** @param {string} [restaurantSlug] */
  function invalidate(restaurantSlug) {
    const slug = normalizedSlug(restaurantSlug);
    if (slug) cache.delete(slug);
    else cache.clear();
  }

  window.PedeAquiPaymentConfigService = {
    CACHE_TTL_MS,
    getPaymentConfig,
    cardIsAvailable,
    invalidate
  };
})();
