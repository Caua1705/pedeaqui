(function () {
  const cache = new Map();
  const pending = new Map();

  function cacheKey(restaurantSlug, branchId) {
    return `${restaurantSlug}::${branchId || 'default'}`;
  }

  function getInfo(restaurantSlug, branchId, options = {}) {
    const key = cacheKey(restaurantSlug, branchId);
    if (!options.force && cache.has(key)) return Promise.resolve({ data: cache.get(key), fromCache: true, key });
    if (pending.has(key)) return pending.get(key);
    const request = window.PedeAquiApiClient.get(
      window.PedeAquiApiRoutes.restaurantInfo(restaurantSlug, branchId)
    ).then(response => {
      const data = response?.data ?? response ?? {};
      cache.set(key, data);
      return { data, fromCache: false, key };
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function invalidate(restaurantSlug, branchId) {
    if (!restaurantSlug) {
      cache.clear();
      return;
    }
    cache.delete(cacheKey(restaurantSlug, branchId));
  }

  window.PedeAquiRestaurantInfoService = { getInfo, invalidate, cacheKey };
})();
