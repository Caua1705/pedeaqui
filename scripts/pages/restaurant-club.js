(function () {
  function createRestaurantClubController(deps) {
    const {
      appState,
      getRestaurantSlug,
      getCouponContext,
      getCart,
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

    const fmtClubCurrency = (value) => window.PedeAquiCurrency.formatCurrency(value);

    // Rótulo do card: implementação única em
    // scripts/services/coupon-format.js — esta cópia e a da folha de detalhe já
    // tinham divergido (cupom fixo sem valor virava "R$ 0,00 OFF" aqui). O
    // rótulo vem PRONTO em `title` no contrato do cliente; `discount_value` não
    // existe em CustomerCouponResponse e não vai voltar.
    const getCouponLabel = (coupon) => window.PedeAquiCouponFormat.couponLabel(coupon);

    /** "30.00" -> 30. Os valores do contrato novo são string decimal. */
    const couponAmount = (value) => window.PedeAquiCouponFormat.couponAmount(value);

    /**
     * O que o botão do card pode fazer com ESTA sacola.
     *
     * A decisão saiu daqui em 02/09/2026 para `services/coupon-cta.js`, porque
     * ela é a MESMA em três superfícies (card do Clube, folha de detalhe,
     * checkout) e duas cópias de uma regra de cupom já divergiram neste
     * repositório antes — `couponLabel` tinha duas versões que anunciavam
     * descontos diferentes para o mesmo cupom (ver o cabeçalho de
     * coupon-format.js).
     *
     * Antes disso o botão dizia "Usar cupom" nos três casos: para quem não
     * estava logado levava a um cupom que não aplicava sem explicar por quê, e
     * para quem não tinha atingido o mínimo, a um desconto de R$ 0,00
     * anunciado como aplicado.
     */
    function couponCta(coupon) {
      return window.PedeAquiCouponCta.couponCta(coupon, {
        sacolaVazia: !(getCart?.() || []).length,
        fmt: fmtClubCurrency
      });
    }

    function getCouponCode(coupon, index) {
      return String(coupon.id ?? coupon.code ?? `club-coupon-${index}`);
    }

    function getCouponImage(coupon) {
      return coupon.image_url || '';
    }

    /**
     * A tarja do topo do card — OU ELA DIZ ALGO, OU ELA NÃO EXISTE.
     *
     * `label` é o único selo do contrato, e `CustomerCouponLabel` tem UM valor:
     * `selected_for_you`. O `@description` dele é explícito sobre o que NÃO
     * existe: "Nao ha `exclusivo`: o alvo e um SEGMENTO, nao uma pessoa, e
     * prometer exclusividade para um recorte de milhares de clientes e
     * propaganda que nao se sustenta."
     *
     * Duas tarjas saíram em 02/09/2026:
     *
     * - **"Cupom disponível"** aparecia em todo card sem label, ou seja na
     *   maioria deles. Uma tarja que todo mundo tem não distingue ninguém — é
     *   ruído com aparência de informação. (A versão anterior a essa procurava
     *   `badge_label`, `audience`, `segment` e `campaign_type`, nenhum dos
     *   quais existe no contrato.)
     * - **"Frete grátis"** para `discount_type: free_delivery` REPETIA o
     *   `title`, que no contrato do cliente já é o rótulo do desconto — o card
     *   dizia "Frete grátis" duas vezes, uma na tarja e outra no destaque.
     *
     * BLOQUEADO POR BACKEND: a regra pede "para todos" no cupom público e nada
     * no de segmento, mas `CustomerCouponResponse` não publica `visibility` —
     * ele existe só em `CouponCreate`/`CouponAdminResponse`. Sem esse campo o
     * front não tem como distinguir os dois, e inventar a distinção seria
     * anunciar audiência por chute.
     */
    function getCouponBadge(coupon) {
      return coupon.label === 'selected_for_you' ? 'Selecionado para você' : '';
    }

    function formatCouponDate(value) {
      if (!value) return '';
      const raw = String(value);
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[3]}/${match[2]}`;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
    }

    /**
     * As linhas pequenas do rodapé do card.
     *
     * `max_discount` saiu: é limite interno da campanha e o contrato não o
     * publica de propósito — quem aplica o teto é quem calcula. O que entrou é
     * o `discount_amount` JÁ CALCULADO para esta sacola, que é o número que o
     * cliente quer ver e o único que combina com o que o checkout vai tirar.
     */
    function renderCouponMeta(coupon) {
      const rows = [];
      const minimum = couponAmount(coupon.min_order_value);
      const discount = couponAmount(coupon.discount_amount);
      const validUntil = formatCouponDate(coupon.valid_until);
      // Só quando o cupom de fato aplica agora: com `missing_amount` ou
      // `login_required` o desconto vem 0,00, e escrever "Desconto de R$ 0,00"
      // seria anunciar a ausência como se fosse o benefício.
      if (coupon.state === 'applicable' && discount > 0) {
        rows.push(`<div>Desconto de ${esc(fmtClubCurrency(discount))} nesta sacola</div>`);
      }
      if (minimum > 0) rows.push(`<div>Em pedidos a partir de ${esc(fmtClubCurrency(minimum))}</div>`);
      if (validUntil) rows.push(`<div>Válido até ${esc(validUntil)}</div>`);
      return rows.join('');
    }

    function renderClubCoupon(coupon, index) {
      const code = getCouponCode(coupon, index);
      const badge = getCouponBadge(coupon);
      const label = getCouponLabel(coupon);
      const image = getCouponImage(coupon);
      const title = coupon.title || coupon.code || 'Cupom';
      // `short_description` vinha NA FRENTE de `description`, e só `description`
      // existe em CustomerCouponResponse. Enquanto o backend não publica aquele
      // nome, isto lê `undefined` e cai no campo certo; no dia em que publicar,
      // a regra do cupom troca de campo sozinha, sem uma linha mudar aqui.
      const description = coupon.description || '';
      // No contrato do cliente `title` JÁ É o rótulo do desconto ("10% OFF") —
      // não existe um nome de campanha separado como havia no contrato antigo.
      // Repetir os dois deixaria o card com a mesma frase duas vezes, empilhada.
      // Quando coincidem, o rótulo grande basta e o <h3> sai.
      const subtitle = title === label ? '' : title;
      return `
        <article class='club-available-coupon-card' data-coupon-key='${esc(code)}'>
          ${badge ? `<div class='club-available-coupon-badge'>${esc(badge)}</div>` : ''}
          ${image ? `<img class='club-available-coupon-image' src='${esc(image)}' alt='${esc(title)}' loading='lazy'>` : ''}
          <div class='club-available-coupon-content'>
            <strong class='club-available-coupon-discount'>${esc(label)}</strong>
            ${subtitle ? `<h3>${esc(subtitle)}</h3>` : ''}
            ${description ? `<p>${esc(description)}</p>` : ''}
            <div class='club-available-coupon-meta'>${renderCouponMeta(coupon)}</div>
          </div>
          <button type='button' class='club-available-coupon-use' data-coupon-state='${esc(coupon.state || '')}' data-coupon-acao='${esc(couponCta(coupon).acao)}'>${esc(couponCta(coupon).rotulo)}</button>
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
      // Sem onclick inline: a CSP de produção roda script-src 'self' sem
      // 'unsafe-inline', então um handler em atributo é bloqueado ao ser
      // reparseado por innerHTML — o widget ficaria morto e ainda geraria
      // relatório de violação. O clone já traz o data-act-click do original
      // (restaurant.html), que o despachante por delegação resolve.
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
            <!-- "Usar saldo de cashback" removido na Fase 1: o backend ainda grava
                 cashback = 0, então oferecer o resgate criaria divergência entre o
                 total exibido e o cobrado. Saldo e extrato seguem visíveis.
                 Reativar junto com o suporte de resgate no backend. -->
          </section>
          <div class="club-section-divider" aria-hidden="true"></div>
          <section class="club-coupons-section" aria-label="Meus cupons">
            <h2 class="club-coupons-title">Meus cupons</h2>
            ${renderClubCoupons(clubData)}
          </section>
        </section>`;
      body.querySelectorAll('.club-available-coupon-card').forEach(card => {
        const open = () => window.openCouponDetail?.(card.dataset.couponKey, card);
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
