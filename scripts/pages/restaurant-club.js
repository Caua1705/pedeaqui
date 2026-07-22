(function () {
  function createRestaurantClubController(deps) {
    const {
      appState,
      getRestaurantSlug,
      getCouponContext,
      restaurantStore,
      setLoading,
      logAppError,
      handleUnauthorized,
      esc
    } = deps;
    let clubLoadPromise = null;
    let currentCoupons = [];
    let loadedContextKey = '';

    function couponContext() {
      return getCouponContext?.() || {};
    }

    function couponContextKey(context = couponContext()) {
      return JSON.stringify([context.subtotal ?? 0, context.deliveryFee ?? 0, context.orderType || 'delivery']);
    }

    async function ensureClubLoaded({ force = false } = {}) {
      const context = couponContext();
      const contextKey = couponContextKey(context);
      if (!force && appState.clubLoaded && appState.clubData?.coupons_status === 'success' && loadedContextKey === contextKey) return appState.clubData;
      if (clubLoadPromise) return clubLoadPromise;
      setLoading('club', true);
      clubLoadPromise = (async () => {
        try {
          const clubData = await window.PedeAquiClubService.getClubData(getRestaurantSlug(), context);
          currentCoupons = Array.isArray(clubData.coupons) ? clubData.coupons : [];
          appState.clubData = { ...clubData, coupons_status: 'success' };
          appState.clubLoaded = true;
          loadedContextKey = contextKey;
          restaurantStore()?.setClubData?.(appState.clubData);
          return appState.clubData;
        } catch (error) {
          appState.clubLoaded = false;
          currentCoupons = [];
          appState.clubData = { ...(appState.clubData || {}), coupons: [], coupons_status: 'error' };
          if (error?.status === 401) await handleUnauthorized?.(error);
          else logAppError('Falha ao carregar cupons', error);
          return appState.clubData;
        } finally {
          setLoading('club', false);
          clubLoadPromise = null;
        }
      })();
      return clubLoadPromise;
    }

    function fmtClubCurrency(value) {
      const number = Number(value || 0);
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number);
    }

    function getCouponLabel(coupon) {
      const type = String(coupon.discount_type || coupon.type || '').toLowerCase();
      const value = Number(coupon.discount_value ?? coupon.value ?? coupon.amount ?? 0);
      if (type === 'free_delivery' || type === 'free_shipping') return 'Frete grátis';
      if (type === 'percent' || type === 'percentage') return `${value.toLocaleString('pt-BR')}% OFF`;
      if (type === 'fixed' || type === 'fixed_amount' || value > 0) return `${fmtClubCurrency(value)} OFF`;
      return coupon.discount_label || coupon.title || coupon.name || 'Cupom';
    }

    function getCouponCode(coupon, index) {
      return String(coupon.id ?? coupon.coupon_id ?? coupon.code ?? coupon.coupon_code ?? `club-coupon-${index}`);
    }

    function getCouponImage(coupon) {
      return coupon.image_url || coupon.image || coupon.image_path || coupon.banner_url || coupon.cover_url || '';
    }

    function getCouponBadge(coupon) {
      const explicit = coupon.badge_label || coupon.badge || coupon.audience_label || coupon.public_label;
      if (explicit) return String(explicit);
      const type = String(coupon.discount_type || coupon.type || '').toLowerCase();
      if (type === 'free_delivery' || type === 'free_shipping') return 'Frete grátis';
      const audience = String(coupon.audience || coupon.target_audience || coupon.segment || coupon.campaign_type || '').toLowerCase();
      if (['public', 'all', 'everyone'].includes(audience)) return 'Disponível para todos';
      if (['first_purchase', 'first_order', 'new_customer'].includes(audience)) return 'Exclusivo para primeira compra';
      if (['loyal_customer', 'loyalty', 'vip'].includes(audience)) return 'Benefício para cliente fiel';
      return 'Cupom disponível';
    }

    function formatCouponDate(value) {
      if (!value) return '';
      const raw = String(value);
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[3]}/${match[2]}`;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
    }

    function renderCouponMeta(coupon) {
      const rows = [];
      const minimum = Number(coupon.min_order_value ?? coupon.minimum_order_value ?? coupon.min_subtotal ?? 0);
      const maximum = Number(coupon.max_discount ?? coupon.maximum_discount ?? coupon.max_discount_value ?? 0);
      const validUntil = formatCouponDate(coupon.valid_until || coupon.expires_at || coupon.end_date || coupon.valid_to);
      if (minimum > 0) rows.push(`<div>Em pedidos a partir de ${esc(fmtClubCurrency(minimum))}</div>`);
      if (validUntil) rows.push(`<div>Válido até ${esc(validUntil)}</div>`);
      if (maximum > 0) rows.push(`<div>Desconto máximo de ${esc(fmtClubCurrency(maximum))}</div>`);
      return rows.join('');
    }

    function renderClubCoupon(coupon, index) {
      const code = getCouponCode(coupon, index);
      const label = getCouponLabel(coupon);
      const image = getCouponImage(coupon);
      const title = coupon.title || coupon.name || coupon.code || coupon.coupon_code || 'Cupom';
      const description = coupon.short_description || coupon.description || coupon.subtitle || '';
      return `
        <article class='club-available-coupon-card' data-coupon-key='${esc(code)}'>
          <div class='club-available-coupon-badge'>${esc(getCouponBadge(coupon))}</div>
          ${image ? `<img class='club-available-coupon-image' src='${esc(image)}' alt='${esc(title)}' loading='lazy'>` : ''}
          <div class='club-available-coupon-content'>
            <strong class='club-available-coupon-discount'>${esc(label)}</strong>
            <h3>${esc(title)}</h3>
            ${description ? `<p>${esc(description)}</p>` : ''}
            <div class='club-available-coupon-meta'>${renderCouponMeta(coupon)}</div>
          </div>
          <button type='button' class='club-available-coupon-use'>Usar cupom</button>
        </article>`;
    }

    function renderClubCoupons(clubData = {}) {
      if (clubData.coupons_status === 'loading') return '<div class="club-coupon-skeleton-rail" aria-label="Carregando cupons"><div class="club-coupon-skeleton"></div><div class="club-coupon-skeleton"></div></div>';
      if (clubData.coupons_status === 'error') return '<div class="club-coupon-error" role="alert"><span>Não foi possível carregar seus cupons.</span><button type="button" data-retry-coupons>Tentar novamente</button></div>';
      const coupons = Array.isArray(clubData.coupons) ? clubData.coupons : [];
      if (!coupons.length) return '<div class="club-coupon-empty">Nenhum cupom disponível no momento.</div>';
      return `<div class='club-available-coupon-rail'>${coupons.map(renderClubCoupon).join('')}</div>`;
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
            ${renderClubCoupons(clubData)}
          </section>
        </section>`;
      body.querySelectorAll('.club-available-coupon-card').forEach(card => {
        const open = () => window.openCouponDetail?.(card.dataset.couponKey);
        card.addEventListener('click', event => {
          if (!event.target.closest('button')) open();
        });
        card.querySelector('.club-available-coupon-use')?.addEventListener('click', open);
      });
      body.querySelector('[data-retry-coupons]')?.addEventListener('click', () => retryClubLoad());
      body.querySelector('.club-cashback-icon')?.addEventListener('click', () => {
        window.openCashbackStatement?.();
      });
    }

    async function renderClubView({ force = false } = {}) {
      const body = document.getElementById('mobClubBody');
      if (!body) return;

      const contextChanged = loadedContextKey !== couponContextKey();
      if (!appState.clubLoaded || force || contextChanged) {
        renderClubBody(body, {
          ...(appState.clubData || {}),
          coupons: [],
          coupons_status: 'loading',
          cashback_status: appState.clubData?.cashback_status || 'loading'
        });
      } else {
        renderClubBody(body, appState.clubData);
      }

      const clubData = await ensureClubLoaded({ force });
      if (clubData) renderClubBody(body, clubData);
    }

    function retryClubLoad() {
      appState.clubLoaded = false;
      clubLoadPromise = null;
      return renderClubView({ force: true });
    }

    function invalidateCoupons() {
      appState.clubLoaded = false;
      loadedContextKey = '';
      if (appState.clubData) appState.clubData.coupons_status = 'idle';
    }

    function getCoupon(key) {
      return currentCoupons.find((coupon, index) => getCouponCode(coupon, index) === String(key)) || null;
    }

    return { ensureClubLoaded, renderClubView, retryClubLoad, invalidateCoupons, getCoupon };
  }

  window.PedeAquiRestaurantClub = { createRestaurantClubController };
})();
