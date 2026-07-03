(function () {
  const CACHE_TTL_MS = 7 * 60 * 1000;
  const cache = new Map();
  const pending = new Map();

  function normalizeEstimate(response) {
    const data = response?.data ?? response ?? {};
    return {
      ...data,
      serviceable: data.serviceable !== false,
      eta_min: Number(data.eta_min ?? data.min_minutes ?? data.estimated_delivery_time_min),
      eta_max: Number(data.eta_max ?? data.max_minutes ?? data.estimated_delivery_time_max),
      message: data.message || data.detail || ''
    };
  }

  async function getEstimate(restaurantSlug, payload, options = {}) {
    const key = options.key;
    if (!key) throw new Error('Delivery estimate key is required.');
    const cached = cache.get(key);
    if (!options.force && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return { data: cached.data, updatedAt: cached.updatedAt, fromCache: true };
    }
    if (pending.has(key)) return pending.get(key);
    const request = window.PedeAquiApiClient.post(
      window.PedeAquiApiRoutes.deliveryEstimate(restaurantSlug),
      payload
    ).then(response => {
      const data = normalizeEstimate(response);
      const result = { data, updatedAt: Date.now(), fromCache: false };
      cache.set(key, result);
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function invalidate(key) {
    if (key) cache.delete(key);
    else cache.clear();
  }

  window.PedeAquiDeliveryService = { CACHE_TTL_MS, getEstimate, invalidate };
})();