(function () {
  function createRestaurantClubController(deps) {
    const {
      appState,
      fallback,
      getRestaurantSlug,
      getCoupons,
      restaurantStore,
      setLoading,
      wait,
      tabLoaderMinMs = 500,
      renderTabLoader,
      renderSectionLoader,
      renderSectionError,
      logAppError,
      esc
    } = deps;
    let clubLoadPromise = null;

    async function ensureClubLoaded() {
      if (appState.clubLoaded) return appState.clubData;
      if (clubLoadPromise) return clubLoadPromise;
      setLoading('club', true);
      if (renderTabLoader) renderTabLoader('mobClubBody', 'Carregando clube...');
      else renderSectionLoader('mobClubBody', 'Carregando clube...', 'club-skeleton');
      clubLoadPromise = (async () => {
        try {
          const coupons = getCoupons();
          const loadClubData = window.PedeAquiClubService?.getClubData?.(getRestaurantSlug(), { coupons })
            || Promise.resolve({ coupons: coupons || [], ...(fallback().club || {}) });
          const [clubData] = await Promise.all([
            loadClubData,
            wait ? wait(tabLoaderMinMs) : Promise.resolve()
          ]);
          appState.clubData = clubData;
          appState.clubLoaded = true;
          restaurantStore()?.setClubData?.(appState.clubData);
          return appState.clubData;
        } catch (error) {
          appState.clubLoaded = false;
          logAppError('Falha ao carregar clube', error);
          renderSectionError('mobClubBody', 'Não foi possível carregar o clube.', 'retryClubLoad()');
          return null;
        } finally {
          setLoading('club', false);
          clubLoadPromise = null;
        }
      })();
      return clubLoadPromise;
    }

    async function renderClubView() {
      const body = document.getElementById('mobClubBody');
      if (!body) return;
      const clubData = await ensureClubLoaded();
      if (!clubData) return;
      const benefitCount = Number(clubData.coupons?.length || 0) + Number(clubData.benefits?.length || 0);
      if (benefitCount) {
        body.innerHTML = `
          <div class="mob-view-empty">
            <div class="mob-view-empty-title">Clube</div>
            <div class="mob-view-empty-sub">${benefitCount} benefício${benefitCount === 1 ? '' : 's'} disponível${benefitCount === 1 ? '' : 'is'} para você.</div>
          </div>`;
        return;
      }
      body.innerHTML = `
        <div class="mob-view-empty">
          <div class="mob-view-empty-title">Clube</div>
          <div class="mob-view-empty-sub">Benefícios, cashback, cupons e ofertas exclusivas aparecerão aqui.</div>
        </div>`;
    }

    function retryClubLoad() {
      appState.clubLoaded = false;
      clubLoadPromise = null;
      return renderClubView();
    }

    return { ensureClubLoaded, renderClubView, retryClubLoad };
  }

  window.PedeAquiRestaurantClub = { createRestaurantClubController };
})();
