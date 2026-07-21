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
      renderTabLoader,
      renderSectionLoader,
      renderSectionError,
      logAppError,
      esc
    } = deps;
    let clubLoadPromise = null;

    async function ensureClubLoaded() {
      if (clubLoadPromise) return clubLoadPromise;
      setLoading('club', true);
      clubLoadPromise = (async () => {
        try {
          const coupons = getCoupons();
          const loadClubData = window.PedeAquiClubService?.getClubData?.(getRestaurantSlug(), { coupons })
            || Promise.resolve({ coupons: coupons || [], cashback_balance: null, cashback_status: 'error' });
          const clubData = await loadClubData;
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
        <article class="coupon-card" role="button" tabindex="0" onclick="${action}">
          <div class="coupon-availability-ribbon">Dispon&iacute;vel para todos</div>
          <div class="coupon-art${image ? ' coupon-art--has-img' : ''}">
            ${image
              ? `<img src="${esc(image)}" alt="${esc(label)}">`
              : `<span>Cupom</span><strong>${label}</strong>`}
          </div>
          <div class="coupon-title">${esc(coupon.title || coupon.name || coupon.code || 'Cupom')}</div>
          <div class="coupon-dash" aria-hidden="true"></div>
          <button type="button" class="coupon-use-btn" onclick="event.stopPropagation();${action}">Usar cupom</button>
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
      if (!sourceWidget) return '';
      const clone = sourceWidget.cloneNode(true);
      clone.classList.add('club-location-widget');
      clone.querySelector('#dwTabBrand')?.classList.add('club-location-brand');
      clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      clone.setAttribute('onclick', 'openOperationScreen()');
      clone.setAttribute('aria-label', 'Selecionar unidade e operacao');
      return `<div class="club-location-wrap">${clone.outerHTML}</div>`;
    }

    function renderClubBody(body, clubData = {}) {
      const coupons = Array.isArray(clubData.coupons) && clubData.coupons.length ? clubData.coupons : (getCoupons() || []);
      const cashback = clubData.cashback_balance;
      const hasCashbackBalance = Number.isFinite(Number(cashback)) && Number(cashback) > 0;
      const cashbackText = clubData.cashback_status === 'error' && cashback == null
        ? 'R$ --,--'
        : fmtClubCurrency(cashback ?? 0);
      body.innerHTML = `
        <section class="club-page" aria-label="Clube">
          ${buildClubLocationWidget()}
          <div class="club-section-divider" aria-hidden="true"></div>
          <section class="club-cashback-panel${hasCashbackBalance ? '' : ' club-cashback-panel--no-balance'}" aria-label="Saldo de cashback">
            <div class="club-cashback-card">
              <div class="club-cashback-copy">
                <span>Saldo de cashback</span>
                <strong id='clubCashbackBalance'>${cashbackText}</strong>
              </div>
              <button type="button" class="club-cashback-icon" aria-label="Extrato de cashback">
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h10"/><path d="M8 12h10"/><path d="M8 18h10"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>
              </button>
            </div>
            ${hasCashbackBalance ? '<button type="button" class="club-cashback-use" aria-label="Usar saldo de cashback">Usar saldo de cashback</button>' : ''}
          </section>
          <div class="club-section-divider" aria-hidden="true"></div>
          <section class="club-coupons-section" aria-label="Meus cupons">
            <h2 class="club-coupons-title">Meus cupons</h2>
            <div class="coupon-rail">${renderClubCoupons(coupons)}</div>
          </section>
        </section>`;
      body.querySelector('.club-cashback-icon')?.addEventListener('click', () => {
        window.openCashbackStatement?.();
      });
    }

    async function renderClubView() {
      const body = document.getElementById('mobClubBody');
      if (!body) return;

      // Show the Club shell immediately; cashback refreshes in the background.
      renderClubBody(body, appState.clubData || {
        coupons: getCoupons(),
        cashback_balance: null,
        cashback_status: 'loading'
      });

      const clubData = await ensureClubLoaded();
      if (clubData) renderClubBody(body, clubData);
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
