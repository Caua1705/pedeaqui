(function () {
  // Este cache NÃO tinha prazo. Uma vez buscado, o payload de /info valia a
  // sessão inteira — e ele não é dado estável:
  //
  //   payment_methods   o lojista desliga o Pix no painel e o cliente continua
  //                     vendo Pix no checkout até fechar a aba;
  //   business_hours    e o current_weekday/current_day_label, que vêm
  //                     CALCULADOS no fuso da loja: depois da meia-noite a
  //                     tabela de horários seguia marcando o dia anterior como
  //                     "hoje";
  //   branch            endereço e telefone da unidade.
  //
  // 5 minutos: curto o bastante para que uma forma de pagamento desligada ou
  // uma virada de dia não sobrevivam à sessão, e longo o bastante para juntar a
  // rajada de chamadas que uma visita faz (home, modal de informações, aba de
  // pagamento do perfil, checkout). É mais curto que o da entrega (7 min)
  // porque aqui há dado que muda por decisão do lojista, não só por distância.
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // Teto por filial navegada. Um restaurante tem poucas, mas o cache é do
  // aparelho e acumula entre tenants ao longo da sessão.
  const CACHE_MAX_ENTRIES = 20;

  const cache = window.RapidexTtlCache.createTtlCache({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES
  });
  const pending = new Map();

  // O slug entra na chave: sem isso, duas lojas na mesma sessão dividiriam
  // horário, endereço e formas de pagamento.
  function cacheKey(restaurantSlug, branchId) {
    return `${restaurantSlug}::${branchId || 'default'}`;
  }

  function getInfo(restaurantSlug, branchId, options = {}) {
    const key = cacheKey(restaurantSlug, branchId);
    if (!options.force) {
      const cached = cache.getEntry(key);
      if (cached) return Promise.resolve({ data: cached.value, fromCache: true, key });
    }
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

  window.PedeAquiRestaurantInfoService = {
    CACHE_TTL_MS,
    CACHE_MAX_ENTRIES,
    getInfo,
    invalidate,
    cacheKey,
    cache
  };
})();
