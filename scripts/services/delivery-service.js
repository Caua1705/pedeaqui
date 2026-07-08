(function () {
  const CACHE_TTL_MS = 7 * 60 * 1000;
  const cache = new Map();
  const pending = new Map();

  function numberOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeEstimate(response) {
    const data = response?.data ?? response ?? {};
    return {
      ...data,
      serviceable: data.serviceable !== false,
      delivery_fee: numberOrNull(data.delivery_fee ?? data.deliveryFee),
      distance_km: numberOrNull(data.distance_km ?? data.distanceKm),
      travel_time_min: numberOrNull(data.travel_time_min ?? data.travelTimeMin),
      eta_min: numberOrNull(data.eta_min ?? data.min_minutes ?? data.estimated_delivery_time_min),
      eta_max: numberOrNull(data.eta_max ?? data.max_minutes ?? data.estimated_delivery_time_max),
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
    const authHeaders = window.PedeAquiCustomerAuth?.authHeaders?.() || {};
    const request = window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.deliveryEstimate(restaurantSlug),
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload)
      }
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
