(function () {
  function fallbackClubData() {
    const fallback = window.PedeAquiFallbackConfig?.club || {};
    return {
      cashback: fallback.cashback ?? null,
      points: fallback.points ?? null,
      benefits: Array.isArray(fallback.benefits) ? fallback.benefits : [],
      coupons: []
    };
  }

  async function getClubData(restaurantSlug, context = {}) {
    const base = fallbackClubData();
    return {
      ...base,
      restaurant_slug: restaurantSlug,
      coupons: Array.isArray(context.coupons) ? context.coupons : base.coupons
    };
  }

  window.PedeAquiClubService = { getClubData };
})();
