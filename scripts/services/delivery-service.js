(function () {
  const CACHE_TTL_MS = 7 * 60 * 1000;

  // Teto de estimativas guardadas. A chave é endereço + filial + tipo de
  // entrega, então um cliente com vários endereços salvos multiplica as
  // entradas — e, antes do teto, as vencidas ficavam na Map para sempre: o TTL
  // só era conferido na leitura da própria chave, nunca em varredura.
  const CACHE_MAX_ENTRIES = 20;

  const cache = window.RapidexTtlCache.createTtlCache({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES
  });
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
      // `detail` pode vir como string, array ou objeto — este `message` é
      // exibido ao cliente, então nunca pode virar "[object Object]".
      message: data.message || window.PedeAquiApiError?.detailText?.(data.detail) || ''
    };
  }

  async function getEstimate(restaurantSlug, payload, options = {}) {
    const key = options.key;
    if (!key) throw new Error('Delivery estimate key is required.');
    // O prazo agora é do cache: quem lê recebe null quando venceu, em vez de
    // receber a entrada velha e ter de conferir a idade no chamador.
    const cached = options.force ? null : cache.getEntry(key);
    if (cached) {
      return { data: cached.value, updatedAt: cached.storedAt, fromCache: true };
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
      cache.set(key, data);
      return { data, updatedAt: cache.getEntry(key)?.storedAt ?? Date.now(), fromCache: false };
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function invalidate(key) {
    if (key) cache.delete(key);
    else cache.clear();
  }

  window.PedeAquiDeliveryService = { CACHE_TTL_MS, CACHE_MAX_ENTRIES, getEstimate, invalidate, cache };
})();
