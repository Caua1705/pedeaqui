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
          renderSectionError('mobClubBody', 'Nao foi possivel carregar o clube.', 'retryClubLoad()');
          return null;
        } finally {
          setLoading('club', false);
          clubLoadPromise = null;
        }
      })();
      return clubLoadPromise;
    }

    function fmtClubCurrency(value) {
      const number = Number(value || 0);
      return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function getCouponLabel(coupon) {
      const type = String(coupon.type || coupon.discount_type || '').toLowerCase();
      const value = Number(coupon.value ?? coupon.discount ?? coupon.discount_value ?? 0);
      const title = coupon.title || coupon.name || coupon.code || 'Cupom';
      if (type.includes('free') || type.includes('frete')) return 'FRETE GR&Aacute;TIS';
      if (type.includes('percent') || type.includes('percentage')) return `${Math.round(value)}% OFF`;
      if (value > 0) return `${fmtClubCurrency(value)} OFF`;
      return esc(title).toUpperCase();
    }

    function getCouponArtText(coupon) {
      const label = getCouponLabel(coupon);
      if (label.includes('FRETE')) return 'Cupom<br><strong>frete<br>gr&aacute;tis</strong>';
      return `Cupom<br><strong>${label.toLowerCase()}</strong>`;
    }

    function getCouponCode(coupon, index) {
      return coupon.code || coupon.coupon_code || coupon.id || `club-coupon-${index}`;
    }

    function getCouponImage(coupon) {
      return coupon.image_url || coupon.image || coupon.banner_url || coupon.cover_url || '';
    }

    function renderClubCoupon(coupon, index) {
      const code = getCouponCode(coupon, index);
      const label = getCouponLabel(coupon);
      const image = getCouponImage(coupon);
      const artClass = label.includes('FRETE') ? 'club-coupon-art club-coupon-art--green' : 'club-coupon-art';
      const action = coupon.code || coupon.coupon_code
        ? `openCouponDetail('${esc(code)}')`
        : 'void 0';
      return `
        <article class="club-coupon-card" role="button" tabindex="0" onclick="${action}">
          <div class="club-coupon-ribbon">Dispon&iacute;vel para todos</div>
          <div class="${artClass}">
            ${image
              ? `<img src="${esc(image)}" alt="${esc(label)}">`
              : `<span>${getCouponArtText(coupon)}</span>`}
          </div>
          <div class="club-coupon-title">${label}</div>
          <div class="club-coupon-dash" aria-hidden="true"></div>
          <button type="button" class="club-coupon-use" onclick="event.stopPropagation();${action}">Usar cupom</button>
        </article>`;
    }

    function renderClubCoupons(coupons) {
      if (!Array.isArray(coupons) || !coupons.length) {
        return '<div class="club-coupon-empty">Cupons dispon&iacute;veis aparecer&atilde;o aqui.</div>';
      }
      return coupons.map(renderClubCoupon).join('');
    }

    function buildClubLocationWidget() {
      const sourceWidget = document.querySelector('.home-sticky-header .delivery-widget') || document.querySelector('.delivery-widget');
      const delivery = sourceWidget?.querySelector('#dwTabDelivery, .delivery-widget-tab.active')?.textContent?.trim() || 'DELIVERY';
      const brand = sourceWidget?.querySelector('#dwTabBrand')?.textContent?.trim() || 'RESTAURANTE';
      const branch = sourceWidget?.querySelector('#dwTabBranch')?.textContent?.trim() || 'LJ. SUL';
      const title = sourceWidget?.querySelector('#homeAddressTitle, .address-card-copy strong')?.textContent?.trim() || 'Use seu endereco para melhores resultados';

      return `
        <div class="club-location-wrap">
          <div class="delivery-widget club-location-widget" role="button" tabindex="0" onclick="openOperationScreen()" aria-label="Selecionar unidade e operacao">
            <div class="delivery-widget-tabs">
              <span class="delivery-widget-tab active">${esc(delivery)}</span>
              <span class="delivery-widget-tab">${esc(brand)}</span>
              <span class="delivery-widget-tab">${esc(branch)}</span>
              <svg class="delivery-widget-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>
            </div>
            <div class="delivery-widget-divider"></div>
            <div class="club-location-address">
              <span class="club-location-address-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </span>
              <span class="club-location-address-text">
                ${esc(title)}
              </span>
            </div>
          </div>
        </div>`;
    }

    async function renderClubView() {
      const body = document.getElementById('mobClubBody');
      if (!body) return;
      const clubData = await ensureClubLoaded();
      if (!clubData) return;
      const coupons = Array.isArray(clubData.coupons) && clubData.coupons.length ? clubData.coupons : (getCoupons() || []);
      const cashback = clubData.cashback_balance ?? clubData.cashback ?? clubData.wallet_balance ?? 0;
      body.innerHTML = `
        <section class="club-page" aria-label="Clube">
          ${buildClubLocationWidget()}
          <div class="club-section-divider" aria-hidden="true"></div>
          <section class="club-cashback-card" aria-label="Saldo de cashback">
            <div class="club-cashback-copy">
              <span>Saldo de cashback</span>
              <strong>${fmtClubCurrency(cashback)}</strong>
            </div>
            <button type="button" class="club-cashback-icon" aria-label="Extrato de cashback">
              <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h10"/><path d="M8 12h10"/><path d="M8 18h10"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>
            </button>
          </section>
          <div class="club-section-divider" aria-hidden="true"></div>
          <section class="club-coupons-section" aria-label="Meus cupons">
            <h2 class="club-coupons-title">Meus cupons</h2>
            <div class="club-coupon-rail">${renderClubCoupons(coupons)}</div>
          </section>
        </section>`;
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
