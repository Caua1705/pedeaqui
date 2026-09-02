// ============================================================================
//  Tela de Início (home): carrossel do hero (autoplay + swipe), vitrine de
//  cupons, destaques, busca e a ação dos banners. Contrato mount(ctx) —
//  skill §9.
//
//  A troca de filial NÃO mora aqui de propósito: operationContext e toda a
//  transação de troca continuam no restaurant-page (skill §2 — 94 fios/mil
//  linhas, recusado por medida). Esta tela só DESENHA o que o cardápio da
//  filial corrente publica; quando ele muda, o page anuncia pela ação
//  'renderHomeContent'.
//
//  As assinaturas de render (bannersRenderSignature etc.) e o estado do
//  carrossel moram aqui. Os registros de visibilidade/teardown do autoplay
//  são feitos em mount() — no corpo do módulo seriam a armadilha 1 da skill
//  §2.1 (executar no import, antes de tudo).
// ============================================================================
(function () {
  let $, esc, act, showEl, fallback;
  let app, shell;

  let heroBannerIndex = 0;
  let heroBannerTimer = null;
  let heroSwipeReady = false;
  let heroDragStartX = 0;
  let heroDragDeltaX = 0;
  let bannersRenderSignature = '';
  let couponsRenderSignature = '';
  let highlightsRenderSignature = '';
  const HERO_BANNER_INTERVAL_MS = 5000;
  const HERO_FLUID = { widths: [480, 768, 1080, 1440], sizes: '(max-width: 1080px) 100vw, 1080px' };
  // .coupon-card tem 168px de largura (styles/utilities.css:1205) e a arte
  // dentro dela tem 90px de altura (.coupon-art — styles/utilities.css:768).
  const RAIL_BOX = { w: 168, h: 90 };
  // .highlight-banner troca de regime por breakpoint: 290px fixos no desktop,
  // 65%/78% da viewport no mobile (styles/utilities.css:857/1260/1414). Como
  // não é largura fixa em todo lugar, vai de `w` + sizes.
  const HIGHLIGHT_FLUID = {
    widths: [290, 440, 580, 780, 870],
    sizes: '(max-width: 900px) 78vw, 290px'
  };

  function renderHomeContent() {
    renderBanners();
    renderCoupons();
    renderHighlights();
  }

  function renderBanners() {
    const img = $('restaurantHeroImg');
    const cover = $('restaurantHeroCover');
    const track = $('restaurantHeroTrack');
    const dots = $('restaurantHeroDots');
    const heroFallback = $('restaurantHeroFallback');
    if (!img || !cover) return;
    const nextSignature = JSON.stringify(shell.getBanners().map(banner => [
      banner.image_url || banner.image_path || ''
    ]));
    if (bannersRenderSignature === nextSignature) return;
    bannersRenderSignature = nextSignature;
    stopHeroAutoplay();
    heroBannerIndex = 1;
    const visualBanners = shell.getBanners().filter(banner => banner.image_url || banner.image_path);

    if (!visualBanners.length) {
      cover.classList.remove('has-carousel');
      if (track) track.innerHTML = '';
      img.removeAttribute('src');
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.alt = app.restaurant.name || fallback().restaurantName || '';
      if (heroFallback) heroFallback.setAttribute('aria-hidden', 'false');
      if (dots) dots.innerHTML = '';
      return;
    }

    // O alt sai do nome do restaurante porque BannerResponse nao tem texto
    // nenhum (nem title, nem subtitle) — ver a nota em menu-service.js.
    const first = visualBanners[0];
    const firstImage = first.image_url || first.image_path || '';
    img.src = firstImage;
    shell.applyResponsiveImage(img, firstImage, { fluid: HERO_FLUID });
    img.alt = app.restaurant.name || 'Banner promocional';
    img.loading = 'eager';
    img.decoding = 'async';
    img.fetchPriority = 'high';
    cover.classList.add('has-carousel');
    if (heroFallback) heroFallback.setAttribute('aria-hidden', 'true');

    if (track) {
      const mkSlide = banner => {
        const image = banner.image_url || banner.image_path || '';
        const alt = app.restaurant.name || 'Banner';
        const responsive = shell.responsiveImageAttrs(image, { fluid: HERO_FLUID });
        return `<div class="restaurant-hero-slide"><img src="${esc(image)}"${responsive} alt="${esc(alt)}" ${shell.imageAttrs({ lazy: true })}></div>`;
      };
      const cloneLast  = mkSlide(visualBanners[visualBanners.length - 1]);
      const cloneFirst = mkSlide(visualBanners[0]);
      track.innerHTML  = cloneLast + visualBanners.map(mkSlide).join('') + cloneFirst;
      track.style.transition = 'none';
      track.style.transform  = 'translateX(-100%)';
      track.offsetHeight;
      track.style.transition = '';
      initHeroSwipe();
    }

    if (dots) {
      dots.innerHTML = visualBanners.length > 1
        ? visualBanners.map((_, index) => `<span class="${index === 0 ? 'active' : ''}" ${act('click', 'setHeroBanner', index)}></span>`).join('')
        : '';
    }

    if (visualBanners.length > 1) {
      startHeroAutoplay();
    }
  }

  function setHeroBanner(realIndex) {
    const track = $('restaurantHeroTrack');
    if (!track) return;
    const total = track.children.length;
    heroBannerIndex = Math.min(Math.max(realIndex + 1, 1), total - 2);
    updateHeroCarousel();
    startHeroAutoplay();
  }

  function updateHeroCarousel() {
    const track = $('restaurantHeroTrack');
    if (!track) return;
    track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
    const realIndex = heroBannerIndex - 1;
    document.querySelectorAll('#restaurantHeroDots span').forEach((dot, i) => {
      dot.classList.toggle('active', i === realIndex);
    });
  }

  function stopHeroAutoplay() {
    clearInterval(heroBannerTimer);
    heroBannerTimer = null;
  }

  function startHeroAutoplay() {
    const total = $('restaurantHeroTrack')?.children.length || 0;
    stopHeroAutoplay();
    if (total <= 3) return;
    // Aba oculta não anima. Sem esta guarda o intervalo continuaria girando o
    // carrossel — escrita no DOM e recálculo de estilo — numa página que
    // ninguém está vendo, e o usuário voltaria para um banner que "andou
    // sozinho" enquanto ele estava em outro lugar.
    if (document.visibilityState === 'hidden') return;
    heroBannerTimer = setInterval(() => {
      const track = $('restaurantHeroTrack');
      if (!track) return;
      const total = track.children.length;
      heroBannerIndex += 1;
      updateHeroCarousel();
      if (heroBannerIndex >= total - 1) {
        setTimeout(() => {
          heroBannerIndex = 1;
          track.style.transition = 'none';
          track.style.transform = 'translateX(-100%)';
          track.offsetHeight;
          track.style.transition = '';
        }, 490);
      }
    }, HERO_BANNER_INTERVAL_MS);
  }


  function initHeroSwipe() {
    const track = $('restaurantHeroTrack');
    if (!track || heroSwipeReady) return;
    heroSwipeReady = true;

    track.addEventListener('transitionend', () => {
      const total = track.children.length;
      if (heroBannerIndex <= 0 || heroBannerIndex >= total - 1) {
        track.style.transition = 'none';
        heroBannerIndex = heroBannerIndex <= 0 ? total - 2 : 1;
        track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
        track.offsetHeight;
        track.style.transition = '';
        const realIndex = heroBannerIndex - 1;
        document.querySelectorAll('#restaurantHeroDots span').forEach((dot, i) => {
          dot.classList.toggle('active', i === realIndex);
        });
      }
    });

    const endDrag = () => {
      if (!track.classList.contains('is-dragging')) return;
      const total = track.children.length;
      track.classList.remove('is-dragging');
      if (Math.abs(heroDragDeltaX) > 46) {
        const next = heroBannerIndex + (heroDragDeltaX < 0 ? 1 : -1);
        heroBannerIndex = Math.max(0, Math.min(next, total - 1));
      }
      heroDragDeltaX = 0;
      updateHeroCarousel();
      startHeroAutoplay();
    };

    track.addEventListener('pointerdown', event => {
      const total = track.children.length;
      if (total <= 3) return;
      // Se ainda estiver num clone (transitionend ainda não disparou),
      // faz o salto silencioso imediatamente antes de começar o novo drag
      if (heroBannerIndex <= 0 || heroBannerIndex >= total - 1) {
        track.style.transition = 'none';
        heroBannerIndex = heroBannerIndex <= 0 ? total - 2 : 1;
        track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
        track.offsetHeight;
        track.style.transition = '';
        const realIndex = heroBannerIndex - 1;
        document.querySelectorAll('#restaurantHeroDots span').forEach((dot, i) => {
          dot.classList.toggle('active', i === realIndex);
        });
      }
      stopHeroAutoplay();
      heroDragStartX = event.clientX;
      heroDragDeltaX = 0;
      track.classList.add('is-dragging');
      track.setPointerCapture?.(event.pointerId);
    });

    track.addEventListener('pointermove', event => {
      if (!track.classList.contains('is-dragging')) return;
      heroDragDeltaX = event.clientX - heroDragStartX;
      track.style.transform = `translateX(calc(-${heroBannerIndex * 100}% + ${heroDragDeltaX}px))`;
    });

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('lostpointercapture', endDrag);
  }

  function renderCoupons() {
    const wrap = $('couponRail');
    if (!wrap) return;
    const section = $('homeCouponsSection');
    if (section) section.style.display = shell.getCoupons().length ? '' : 'none';
    const nextSignature = JSON.stringify(shell.getCoupons().map(coupon => [
      coupon.code,
      coupon.name || '',
      shell.couponImageUrl(coupon),
      coupon.discount_type || '',
      coupon.discount_value || ''
    ]));
    if (couponsRenderSignature === nextSignature && wrap.children.length) {
      updateHomePromoVisibility();
      return;
    }
    couponsRenderSignature = nextSignature;
    wrap.innerHTML = shell.getCoupons().map(coupon => {
      const image = shell.couponImageUrl(coupon);
      const discountType = String(coupon.discount_type || '').toLowerCase();
      const discount = ['percent', 'percentage'].includes(discountType)
        ? `${Number(coupon.discount_value || 0)}% off`
        : discountType === 'free_delivery'
          ? 'Frete gratis'
          : coupon.name || 'Cupom';
      // Fixed template: backend supplies the coupon artwork (image) + title.
      // The gradient + discount text is only a fallback when there's no image
      // (or it fails to load — onerror reverts to the fallback).
      return `
        <article class="coupon-card" ${act('click', 'openCouponDetail', coupon.code, '$this')}>
          <div class="coupon-art${image ? ' coupon-art--has-img' : ''}">
            ${image ? `<img src="${esc(image)}"${shell.responsiveImageAttrs(image, { box: RAIL_BOX })} alt="${esc(coupon.name || 'Cupom')}" ${shell.imageAttrs({ lazy: true })} ${act('error', 'couponArtImageFailed')}>` : ''}
            <span>Cupom</span>
            <strong>${esc(discount)}</strong>
          </div>
          <div class="coupon-title">${esc(coupon.name || coupon.code || 'Cupom')}</div>
          <div class="coupon-dash"></div>
          <button type="button" class="coupon-use-btn" ${shell.actAll('click', [['$stop'], ['openCouponDetail', coupon.code, '$this']])}>Usar cupom</button>
        </article>
      `;
    }).join('');
    updateHomePromoVisibility();
  }

  function renderHighlights() {
    const wrap = $('highlightRail');
    if (!wrap) return;
    const highlightItems = getHomeHighlightItems();
    const section = $('homeHighlightsSection');
    if (section) section.style.display = highlightItems.length ? '' : 'none';
    const nextSignature = JSON.stringify(highlightItems.map(highlight => [
      highlight.image_url || highlight.image_path || ''
    ]));
    if (highlightsRenderSignature === nextSignature && wrap.children.length) {
      updateHomePromoVisibility();
      return;
    }
    highlightsRenderSignature = nextSignature;
    wrap.innerHTML = highlightItems.map(highlight => {
      const image = highlight.image_url || highlight.image_path || '';
      const alt = app.restaurant.name || 'Destaque';
      return `
        <article class="highlight-banner">
          ${image
            ? `<img src="${esc(image)}"${shell.responsiveImageAttrs(image, { fluid: HIGHLIGHT_FLUID })} alt="${esc(alt)}" ${shell.imageAttrs({ lazy: true })}>`
            : `<div class="highlight-fallback"><strong>Destaque</strong><span>${esc(app.restaurant.name || '')}</span></div>`}
        </article>
      `;
    }).join('');
    updateHomePromoVisibility();
  }

  function getHomeHighlightItems() {
    return shell.getHighlightBanners();
  }

  function updateHomePromoVisibility() {
    const hasCoupons = shell.getCoupons().length > 0;
    const hasHighlights = getHomeHighlightItems().length > 0;
    const couponSection = $('homeCouponsSection');
    const highlightsSection = $('homeHighlightsSection');
    const heroSeparator = $('homeHeroSeparator');
    const separator = $('homeSeparator');
    showEl(couponSection, hasCoupons);
    showEl(highlightsSection, hasHighlights);
    showEl(heroSeparator, true);
    showEl(separator, hasCoupons && hasHighlights);
  }

  function handleBannerAction(type, value) {
    if (type === 'category' && value) {
      shell.scrollToMenu();
      setTimeout(() => shell.scrollToCategory(value, shell.findCategoryButton(value)), 250);
      return;
    }
    shell.scrollToMenu();
  }

  function mobFocusSearch() {
    shell.closeMobViews();
    shell.showMenuTab();
    shell.ensureMenuLoaded();
    $('searchCat')?.classList.add('search-open');
    $('searchInput')?.focus();
    const el = $('menu-area');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 96, behavior: 'smooth' });
  }

  function closeSearch() {
    $('searchCat')?.classList.remove('search-open');
    if ($('searchInput')) {
      $('searchInput').value = '';
      $('searchInput').dispatchEvent(new Event('input'));
    }
  }

  function couponArtImageFailed(image) {
    image?.closest('.coupon-art')?.classList.remove('coupon-art--has-img');
    image?.remove();
  }

  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('home-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, act, showEl, fallback } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['getBanners', 'getHighlightBanners', 'getCoupons', 'couponImageUrl', 'responsiveImageAttrs', 'applyResponsiveImage', 'imageAttrs', 'actAll', 'closeMobViews', 'showMenuTab', 'ensureMenuLoaded', 'scrollToMenu', 'scrollToCategory', 'findCategoryButton']) {
      if (typeof shell[nome] !== 'function') throw new Error(`home-screen: shell.${nome} ausente`);
    }
    // O par que fecha o intervalo do hero: pausa quando a aba sai de vista,
    // volta quando ela retorna, e some no teardown. AQUI, não no corpo do
    // módulo: no import as portas ainda não existem (skill §2.1, armadilha 1).
    window.RapidexLifecycle?.onVisibility({
      onHidden: stopHeroAutoplay,
      onVisible: () => {
        if ($('restaurantHeroTrack')) startHeroAutoplay();
      }
    });
    window.RapidexLifecycle?.onTeardown(stopHeroAutoplay);
    window.RapidexActions.register({
      renderHomeContent,
      setHeroBanner,
      handleBannerAction,
      mobFocusSearch,
      closeSearch,
      couponArtImageFailed
    });
  }

  window.PedeAquiHomeScreen = { mount };
})();
