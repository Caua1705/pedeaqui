(function () {
  const fmt = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const STORAGE_ADDRESS = 'pedeaqui.customerAddress';
  const STORAGE_CUSTOMER = 'pedeaqui.customer';

  let payload = {};
  let restaurant = {};
  let settings = {};
  let branches = [];
  let categories = [];
  let products = [];
  let banners = [];
  let highlightBanners = [];
  let coupons = [];
  let cart = [];
  let currentProd = null;
  let pmQty = 1;
  let deliveryType = 'delivery';
  let paymentMethod = 'Pix';
  let selectedCoupon = null;
  let customer = JSON.parse(localStorage.getItem(STORAGE_CUSTOMER) || 'null');
  let customerAddress = JSON.parse(localStorage.getItem(STORAGE_ADDRESS) || 'null');
  let submittedOrder = null;
  let heroBannerIndex = 0;
  let heroBannerTimer = null;
  let heroSwipeReady = false;
  let heroDragStartX = 0;
  let heroDragDeltaX = 0;
  const HERO_BANNER_INTERVAL_MS = 5000;

  const $ = (id) => document.getElementById(id);
  const isLogged = () => Boolean(customer);
  const serviceFee = () => Number(settings.service_fee_amount ?? 0.99);
  const deliveryFee = () => deliveryType === 'delivery' ? Number(settings.default_delivery_fee ?? 13) : 0;
  const initials = (name) => (name || 'PedeAqui').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const slug = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function getRestaurantSlug() {
    return window.PedeAquiRestaurantSlug?.getRestaurantSlugFromUrl()
      || window.PEDEAQUI_RESTAURANT_SLUG
      || window.APP_CONFIG?.DEFAULT_RESTAURANT_SLUG
      || 'junior-da-picanha';
  }

  function normalizePayload(raw) {
    return window.PedeAquiMenuService?.normalizeMenuPayload
      ? window.PedeAquiMenuService.normalizeMenuPayload(raw)
      : raw;
  }

  function productImage(product, className = 'prod-photo') {
    const image = product.image_url || product.image_path;
    if (image) return `<img class="${className}" src="${image}" alt="${product.name}">`;
    return `<div class="${className} prod-photo--placeholder"><span>${initials(product.name)}</span></div>`;
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('active');
    document.body.classList.add('modal-open');
  }

  function closeModalId(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('active');
    if (!document.querySelector('.overlay.active,.mob-view.active')) document.body.classList.remove('modal-open');
  }

  function closeModal(e, id) {
    if (e.target && e.target.id === id) closeModalId(id);
  }

  function applyTheme() {
    const root = document.documentElement;
    const primary = '#f07020';
    const secondary = restaurant.secondary_color || '#111111';
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);
    root.style.setProperty('--brand-accent', primary);
    root.style.setProperty('--brand', primary);
    root.style.setProperty('--brand-d', secondary);
    root.style.setProperty('--m-accent', primary);
    root.style.setProperty('--m-accent-light', primary + '22');
    document.title = `${restaurant.name || 'Restaurante'} — Pedido Online | PedeAqui`;
  }

  function renderRestaurantShell() {
    const branch = branches[0] || {};
    const restName = restaurant.name || 'Restaurante';
    document.querySelectorAll('.nav-title,.mob-rest-name,.cart-rest-name,.login-rest-name,.prof-hero-label,.hero-rest-name').forEach(el => el.textContent = restName);
    document.querySelectorAll('.hero-rest-desc').forEach(el => el.textContent = restaurant.description || 'Pedido online');
    document.querySelectorAll('.cart-rest-avatar').forEach(el => el.textContent = initials(restName));

    const logoUrl = restaurant.logo_url || restaurant.logo_path;
    const fallbackLogo = `<div class="mob-logo-fallback">${initials(restName)}</div>`;
    const logoHtml = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="${esc(restName)}" onerror="this.replaceWith(this.ownerDocument.createRange().createContextualFragment('${fallbackLogo}'))">`
      : `<div class="mob-logo-fallback">${initials(restName)}</div>`;
    const logo = document.querySelector('.mob-logo');
    if (logo) logo.innerHTML = logoHtml;
    const loginLogo = $('loginLogo');
    if (loginLogo) loginLogo.innerHTML = logoHtml;
    const infoLogo = $('infoStoreLogo');
    if (infoLogo) infoLogo.innerHTML = logoHtml;

    const isOpen = settings.is_open ?? restaurant.is_open;
    const status = isOpen === false ? 'Fechado no momento' : 'Aberto agora';
    const statusEl = document.querySelector('.mob-badge-open');
    if (statusEl) statusEl.textContent = status;
    document.querySelectorAll('.mob-pedido-min').forEach(el => el.textContent = `Mín ${fmt(settings.min_order_value || 0)}`);
    const loc = document.querySelector('.mob-loc');
    if (loc) loc.textContent = [branch.neighborhood, branch.city].filter(Boolean).join(' - ') || 'Unidade principal';
    const loginPrompt = $('homeLoginPrompt');
    if (loginPrompt) loginPrompt.textContent = isLogged() ? customer.name : 'Entre ou cadastre-se';
    document.querySelectorAll('.store-info-name').forEach(el => el.textContent = restName);
    document.querySelectorAll('.store-info-neighborhood').forEach(el => el.textContent = branch.neighborhood || branch.city || '');
    document.querySelectorAll('.store-info-phone').forEach(el => el.textContent = branch.phone || 'Telefone não informado');
    document.querySelectorAll('.store-info-email').forEach(el => el.textContent = restaurant.email || settings.email || 'E-mail não informado');
    document.querySelectorAll('.store-info-whatsapp').forEach(el => el.textContent = branch.whatsapp || 'WhatsApp não informado');
    document.querySelectorAll('.pickup-restaurant-name').forEach(el => el.textContent = `${restName}${branch.name ? ' — ' + branch.name : ''}`);
    const infoAddress = $('storeInfoAddress');
    if (infoAddress) infoAddress.innerHTML = branches.length
      ? branches.map(unit => [unit.address, unit.neighborhood, unit.city, unit.state].filter(Boolean).join(' - ')).join('<br><br>')
      : 'Endereço não informado';
    const primaryAddress = [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(' - ');
    if ($('footerBranchPrimary')) $('footerBranchPrimary').textContent = primaryAddress || 'Endereço não informado';
    if ($('footerContactPrimary')) $('footerContactPrimary').textContent = branch.whatsapp || branch.phone || 'Contato não informado';
    if ($('footerBranchSecondary')) $('footerBranchSecondary').textContent = branches[1] ? [branches[1].address, branches[1].neighborhood, branches[1].city, branches[1].state].filter(Boolean).join(' - ') : 'Informações da loja';
    if ($('footerContactSecondary')) $('footerContactSecondary').textContent = branches[1]?.whatsapp || branches[1]?.phone || '';
    const closeTime = restaurant.closing_time || settings.closing_time || settings.close_time || '';
    const closeEl = $('mobCloseTime');
    if (closeEl) {
      closeEl.style.display = isOpen === false || !closeTime ? 'none' : '';
      closeEl.textContent = closeTime ? `fecha às ${closeTime}` : '';
    }
    const addrMain = $('homeAddressTitle');
    const addrSub = $('homeAddressSub');
    const branchAddress = [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(' - ');
    if (addrMain) addrMain.textContent = customerAddress ? customerAddress.summary : (branchAddress || 'Informe seu endereço e loja');
    if (addrSub) addrSub.textContent = '';
    const highlightsTitle = $('homeHighlightsTitle');
    if (highlightsTitle) highlightsTitle.textContent = `Destaques ${restName}`;

    document.querySelectorAll('.delivery-time-text').forEach(el => {
      el.textContent = `${settings.estimated_delivery_time_min || 90}-${settings.estimated_delivery_time_max || 100} min`;
    });
    document.querySelectorAll('.delivery-fee-text').forEach(el => el.textContent = fmt(settings.default_delivery_fee ?? 13));
  }

  function renderBanners() {
    const img = $('restaurantHeroImg');
    const cover = $('restaurantHeroCover');
    const track = $('restaurantHeroTrack');
    const dots = $('restaurantHeroDots');
    const fallback = $('restaurantHeroFallback');
    if (!img || !cover) return;
    clearInterval(heroBannerTimer);
    heroBannerTimer = null;
    heroBannerIndex = 0;
    const visualBanners = banners.filter(banner => banner.image_url || banner.image_path);

    if (!visualBanners.length) {
      cover.classList.remove('has-carousel');
      if (track) track.innerHTML = '';
      img.removeAttribute('src');
      img.alt = restaurant.name || 'Restaurante';
      if (fallback) fallback.setAttribute('aria-hidden', 'false');
      if (dots) dots.innerHTML = '';
      return;
    }

    const first = visualBanners[0];
    img.src = first.image_url || first.image_path || '';
    img.alt = first.title || first.subtitle || restaurant.name || 'Banner promocional';
    cover.classList.add('has-carousel');
    if (fallback) fallback.setAttribute('aria-hidden', 'true');

    if (track) {
      track.innerHTML = visualBanners.map((banner, index) => {
        const image = banner.image_url || banner.image_path || '';
        const alt = banner.title || banner.subtitle || restaurant.name || `Banner ${index + 1}`;
        return `<div class="restaurant-hero-slide"><img src="${esc(image)}" alt="${esc(alt)}"></div>`;
      }).join('');
      updateHeroCarousel();
      initHeroSwipe();
    }

    if (dots) {
      dots.innerHTML = visualBanners.length > 1
        ? visualBanners.map((_, index) => `<span class="${index === 0 ? 'active' : ''}" onclick="setHeroBanner(${index})"></span>`).join('')
        : '';
    }

    if (visualBanners.length > 1) {
      startHeroAutoplay();
    }
  }

  function setHeroBanner(index) {
    const total = $('restaurantHeroTrack')?.children.length || 0;
    if (!total) return;
    heroBannerIndex = Math.max(0, Math.min(index, total - 1));
    updateHeroCarousel();
    startHeroAutoplay();
  }

  function updateHeroCarousel() {
    const track = $('restaurantHeroTrack');
    if (!track) return;
    track.style.transform = `translateX(-${heroBannerIndex * 100}%)`;
    document.querySelectorAll('#restaurantHeroDots span').forEach((dot, index) => {
      dot.classList.toggle('active', index === heroBannerIndex);
    });
  }

  function startHeroAutoplay() {
    const total = $('restaurantHeroTrack')?.children.length || 0;
    clearInterval(heroBannerTimer);
    heroBannerTimer = null;
    if (total <= 1) return;
    heroBannerTimer = setInterval(() => {
      heroBannerIndex = (heroBannerIndex + 1) % total;
      updateHeroCarousel();
    }, HERO_BANNER_INTERVAL_MS);
  }

  function initHeroSwipe() {
    const track = $('restaurantHeroTrack');
    if (!track || heroSwipeReady) return;
    heroSwipeReady = true;

    const endDrag = () => {
      if (!track.classList.contains('is-dragging')) return;
      const total = track.children.length;
      track.classList.remove('is-dragging');
      if (total > 1 && Math.abs(heroDragDeltaX) > 46) {
        const next = heroBannerIndex + (heroDragDeltaX < 0 ? 1 : -1);
        if (next >= 0 && next < total) heroBannerIndex = next;
      }
      heroDragDeltaX = 0;
      updateHeroCarousel();
      startHeroAutoplay();
    };

    track.addEventListener('pointerdown', event => {
      if (track.children.length <= 1) return;
      clearInterval(heroBannerTimer);
      heroBannerTimer = null;
      heroDragStartX = event.clientX;
      heroDragDeltaX = 0;
      track.classList.add('is-dragging');
      track.setPointerCapture?.(event.pointerId);
    });

    track.addEventListener('pointermove', event => {
      if (!track.classList.contains('is-dragging')) return;
      heroDragDeltaX = event.clientX - heroDragStartX;
      const total = track.children.length;
      const atEdge = (heroBannerIndex === 0 && heroDragDeltaX > 0) ||
                     (heroBannerIndex === total - 1 && heroDragDeltaX < 0);
      const visualDelta = atEdge ? heroDragDeltaX * 0.2 : heroDragDeltaX;
      track.style.transform = `translateX(calc(-${heroBannerIndex * 100}% + ${visualDelta}px))`;
    });

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('lostpointercapture', endDrag);
  }

  function initMenuHeaderHide() {
    window.addEventListener('scroll', () => {
      if (!document.body.classList.contains('menu-tab')) return;
      document.body.classList.toggle('menu-scrolled', (window.scrollY || document.documentElement.scrollTop) > 40);
    }, { passive: true });
  }

  function initPageRubberBand() {
    let startX = 0, startY = 0, delta = 0, tracking = false, isHoriz = false;
    const SKIP = '.coupon-rail,.highlight-rail,.restaurant-hero-cover,.restaurant-hero-track,.restaurant-hero-slide';
    const SNAP = 'transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94)';
    const movables = () => document.querySelectorAll(
      '.restaurant-hero, .home-section, .home-separator'
    );

    const applyMove = tx => movables().forEach(el => {
      el.style.transition = 'none';
      el.style.transform = `translateX(${tx}px)`;
    });

    const snapBack = () => {
      if (!isHoriz) { tracking = false; return; }
      tracking = false; isHoriz = false; delta = 0;
      movables().forEach(el => {
        el.style.transition = SNAP;
        el.style.transform = 'translateX(0px)';
      });
    };

    document.addEventListener('touchstart', e => {
      if (document.body.classList.contains('modal-open')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      delta = 0; tracking = true; isHoriz = false;
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!isHoriz) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) >= Math.abs(dx)) { tracking = false; return; }
        if (e.target.closest(SKIP)) { tracking = false; return; }
        isHoriz = true;
      }
      delta = dx;
      applyMove(parseFloat((delta * 0.18).toFixed(1)));
    }, { passive: true });

    document.addEventListener('touchend', snapBack, { passive: true });
    document.addEventListener('touchcancel', snapBack, { passive: true });
  }

  function renderCoupons() {
    const wrap = $('couponRail');
    if (!wrap) return;
    const section = $('homeCouponsSection');
    if (section) section.style.display = coupons.length ? '' : 'none';
    wrap.innerHTML = coupons.map(coupon => {
      const image = coupon.image_url || coupon.image_path || '';
      const discountType = String(coupon.discount_type || '').toLowerCase();
      const discount = ['percent', 'percentage'].includes(discountType)
        ? `${Number(coupon.discount_value || 0)}% off`
        : discountType === 'free_delivery'
          ? 'Frete gratis'
          : coupon.name || coupon.title || 'Cupom';
      // Fixed template: backend supplies the coupon artwork (image) + title.
      // The gradient + discount text is only a fallback when there's no image
      // (or it fails to load — onerror reverts to the fallback).
      return `
        <article class="coupon-card" onclick="openCouponDetail('${esc(coupon.code)}')">
          <div class="coupon-art${image ? ' coupon-art--has-img' : ''}">
            ${image ? `<img src="${esc(image)}" alt="${esc(coupon.name || coupon.title || 'Cupom')}" onerror="this.closest('.coupon-art').classList.remove('coupon-art--has-img');this.remove()">` : ''}
            <span>Cupom</span>
            <strong>${esc(discount)}</strong>
          </div>
          <div class="coupon-title">${esc(coupon.title || coupon.name || coupon.code || 'Cupom')}</div>
          <div class="coupon-dash"></div>
          <button type="button" class="coupon-use-btn" onclick="event.stopPropagation();openCouponDetail('${esc(coupon.code)}')">Usar cupom</button>
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
    wrap.innerHTML = highlightItems.map(highlight => {
      const image = highlight.image_url || highlight.image_path || '';
      const alt = highlight.title || highlight.subtitle || restaurant.name || 'Destaque';
      return `
        <article class="highlight-banner">
          ${image
            ? `<img src="${esc(image)}" alt="${esc(alt)}">`
            : `<div class="highlight-fallback"><strong>${esc(highlight.title || 'Destaque')}</strong><span>${esc(highlight.subtitle || restaurant.name || '')}</span></div>`}
        </article>
      `;
    }).join('');
    updateHomePromoVisibility();
  }

  function getHomeHighlightItems() {
    return highlightBanners;
  }

  function updateHomePromoVisibility() {
    const hasCoupons = coupons.length > 0;
    const hasHighlights = getHomeHighlightItems().length > 0;
    const couponSection = $('homeCouponsSection');
    const highlightsSection = $('homeHighlightsSection');
    const heroSeparator = $('homeHeroSeparator');
    const separator = $('homeSeparator');
    if (couponSection) couponSection.style.display = hasCoupons ? '' : 'none';
    if (highlightsSection) highlightsSection.style.display = hasHighlights ? '' : 'none';
    if (heroSeparator) heroSeparator.style.display = '';
    if (separator) separator.style.display = hasCoupons && hasHighlights ? '' : 'none';
  }

  function renderMenu() {
    const nav = $('catNav');
    const container = $('menuContainer');
    if (!nav || !container) return;
    nav.innerHTML = '';
    container.innerHTML = '';

    categories.forEach((cat, idx) => {
      const catProducts = products.filter(p => p.is_available && (p.category_slug === cat.slug || p.category_slug === cat.id || slug(p.category) === cat.slug));
      if (!catProducts.length) return;
      nav.insertAdjacentHTML('beforeend', `<button class="cat ${idx === 0 ? 'active' : ''}" onclick="scrollToCategory('${cat.slug}', this)">${cat.name}</button>`);
      container.insertAdjacentHTML('beforeend', `
        <section class="menu-section" id="${cat.slug}">
          <h2 class="menu-section-title">${cat.name}</h2>
          <div class="products-grid">
            ${catProducts.map(product => `
              <article class="prod-card" onclick="openProduct('${product.id}')">
                <div class="prod-info">
                  <h3 class="prod-name">${product.name}</h3>
                  ${product.description ? `<p class="prod-desc">${product.description}</p>` : ''}
                  <div class="prod-price">${Number.isFinite(product.price) ? fmt(product.price) : 'Consultar'}</div>
                </div>
                <div class="prod-img-box">
                  ${productImage(product)}
                  <button class="prod-add-btn" onclick="event.stopPropagation();openProduct('${product.id}')" aria-label="Adicionar ${product.name}">+</button>
                </div>
              </article>
            `).join('')}
          </div>
        </section>
      `);
    });
  }

  let isClickScrolling = false;
  function showHomeTab() {
    document.body.classList.remove('menu-tab', 'menu-scrolled');
    document.body.classList.add('home-tab');
    setMobNavActive('mobNavHome');
  }

  function showMenuTab() {
    document.body.classList.remove('home-tab');
    document.body.classList.add('menu-tab');
    setMobNavActive('mobNavMenu');
  }

  function scrollToFast(targetTop, duration = 260) {
    const startTop = window.pageYOffset || document.documentElement.scrollTop || 0;
    const distance = targetTop - startTop;
    const startedAt = performance.now();
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    function step(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      window.scrollTo(0, startTop + distance * easeOutCubic(progress));
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  function scrollToMenu() {
    closeMobViews();
    showMenuTab();
    const el = $('menu-area');
    if (!el) return;
    scrollToFast(el.getBoundingClientRect().top + window.pageYOffset - 96);
  }

  function scrollToHome() {
    closeMobViews();
    showHomeTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToCategory(id, btn) {
    isClickScrolling = true;
    document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    const el = $(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 92, behavior: 'smooth' });
    setTimeout(() => { isClickScrolling = false; }, 700);
  }

  function initScrollSpy() {
    window.addEventListener('scroll', () => {
      if (isClickScrolling) return;
      let currentId = '';
      document.querySelectorAll('.menu-section').forEach(sec => {
        if (sec.getBoundingClientRect().top <= 150) currentId = sec.id;
      });
      if (!currentId) return;
      document.querySelectorAll('.cat').forEach(btn => {
        const active = btn.getAttribute('onclick')?.includes(`'${currentId}'`);
        btn.classList.toggle('active', Boolean(active));
      });
    }, { passive: true });
  }

  function initSearch() {
    $('searchInput')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      e.target.closest('.search-bar')?.classList.toggle('has-value', Boolean(q));
      let foundAny = false;
      document.querySelectorAll('.menu-section').forEach(sec => {
        let secFound = false;
        sec.querySelectorAll('.prod-card').forEach(card => {
          const match = card.innerText.toLowerCase().includes(q);
          card.style.display = match ? 'flex' : 'none';
          secFound = secFound || match;
          foundAny = foundAny || match;
        });
        sec.style.display = secFound ? 'block' : 'none';
      });
      if ($('emptySearch')) $('emptySearch').style.display = foundAny ? 'none' : 'block';
    });
  }

  function openProduct(id) {
    currentProd = products.find(p => String(p.id) === String(id));
    if (!currentProd) return;
    pmQty = 1;
    $('pmName').textContent = currentProd.name;
    $('pmDesc').textContent = currentProd.description || '';
    $('pmPrice').textContent = Number.isFinite(currentProd.price) ? fmt(currentProd.price) : 'Consultar';
    $('pmObs').value = '';
    const hero = $('pmHero');
    if (hero) hero.innerHTML = productImage(currentProd, 'pm-hero-photo');
    $('pmWarning').style.display = Number.isFinite(currentProd.price) ? 'none' : 'block';
    $('pmForm').style.display = Number.isFinite(currentProd.price) ? 'block' : 'none';
    $('pmFooter').style.display = Number.isFinite(currentProd.price) ? 'flex' : 'none';
    updatePmUI();
    openModal('productModal');
  }

  function changeQty(delta) {
    pmQty = Math.max(1, pmQty + delta);
    updatePmUI();
  }

  function updatePmUI() {
    if ($('pmQty')) $('pmQty').textContent = pmQty;
    if ($('pmAddBtn') && currentProd) $('pmAddBtn').textContent = `Adicionar • ${fmt(currentProd.price * pmQty)}`;
  }

  function addToCart() {
    if (!currentProd || !Number.isFinite(currentProd.price)) return;
    cart.push({ ...currentProd, qty: pmQty, obs: $('pmObs').value.trim(), uid: Date.now() });
    closeModalId('productModal');
    updateCartUI();
  }

  function cartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const svc = settings.service_fee_enabled === false ? 0 : serviceFee();
    const delivery = deliveryFee();
    return { subtotal, svc, delivery, total: subtotal + svc + delivery };
  }

  function updateCartUI() {
    const qty = cart.reduce((sum, item) => sum + item.qty, 0);
    const totals = cartTotals();
    $('cartCountTop') && ($('cartCountTop').textContent = qty);
    $('cartCountTop')?.classList.toggle('show', qty > 0);
    $('cartSticky')?.classList.toggle('show', qty > 0);
    if ($('cartCountSticky')) $('cartCountSticky').textContent = qty;
    if ($('cartTotalSticky')) $('cartTotalSticky').textContent = fmt(totals.total);
    if ($('homeCartTotal')) $('homeCartTotal').textContent = fmt(totals.total);

    $('cartEmpty') && ($('cartEmpty').style.display = qty ? 'none' : 'block');
    $('cartContent') && ($('cartContent').style.display = qty ? 'block' : 'none');
    $('cartFooter') && ($('cartFooter').style.display = qty ? 'block' : 'none');
    if (!qty) return;

    $('cartList').innerHTML = cart.map(item => `
      <div class="cart-item-row">
        <div class="cir-qty-badge">${item.qty}x</div>
        <div class="cir-info">
          <div class="cir-name">${item.name}</div>
          ${item.obs ? `<div class="cir-obs">Obs: ${item.obs}</div>` : ''}
          <div class="cir-actions">
            <button class="cir-edit-btn" onclick="editCartItem(${item.uid})">Editar</button>
            <button class="cir-remove-btn" onclick="removeCartItem(${item.uid})">Remover</button>
          </div>
        </div>
        <div class="cir-price">${fmt(item.price * item.qty)}</div>
      </div>
    `).join('');
    $('csSub').textContent = fmt(totals.subtotal);
    $('csSvcFeeBtn').textContent = fmt(totals.svc);
    $('csDelivery').textContent = deliveryType === 'delivery' ? fmt(totals.delivery) : 'Grátis';
    $('csTotal').textContent = fmt(totals.total);
    $('cartAddrText') && ($('cartAddrText').textContent = customerAddress ? customerAddress.summary : 'Defina seu endereço para entrega');
  }

  function removeCartItem(uid) {
    cart = cart.filter(i => i.uid !== uid);
    updateCartUI();
  }

  function editCartItem(uid) {
    const item = cart.find(i => i.uid === uid);
    if (!item) return;
    openProduct(item.id);
    pmQty = item.qty;
    $('pmObs').value = item.obs || '';
    $('pmAddBtn').onclick = function () {
      cart = cart.filter(i => i.uid !== uid);
      $('pmAddBtn').onclick = addToCart;
      addToCart();
    };
    updatePmUI();
  }

  function setCartTab(type) {
    deliveryType = type;
    $('cartTabEntrega')?.classList.toggle('active', type === 'delivery');
    $('cartTabRetirada')?.classList.toggle('active', type === 'pickup');
    if ($('cartAddrBlock')) $('cartAddrBlock').style.display = type === 'delivery' ? 'block' : 'none';
    if ($('cartDeliveryOpt')) $('cartDeliveryOpt').style.display = type === 'delivery' ? 'block' : 'none';
    if ($('cartPickupBlock')) $('cartPickupBlock').style.display = type === 'pickup' ? 'block' : 'none';
    if ($('csDeliveryRow')) $('csDeliveryRow').style.display = type === 'delivery' ? 'flex' : 'none';
    updateCartUI();
  }

  function openCheckout() {
    if (deliveryType === 'delivery' && !customerAddress) {
      closeModalId('cartModal');
      openAddressScreen();
      return;
    }
    closeModalId('cartModal');
    if (customer) {
      $('chkName').value = customer.name || '';
      $('chkPhone').value = customer.phone || '';
    }
    if (customerAddress) fillCheckoutAddress(customerAddress);
    setDeliveryType(deliveryType);
    openModal('checkoutModal');
  }

  function fillCheckoutAddress(address) {
    $('chkRua').value = address.street || '';
    $('chkNum').value = address.number || '';
    $('chkBairro').value = address.neighborhood || '';
    $('chkComp').value = address.complement || '';
  }

  function backToCart() {
    closeModalId('checkoutModal');
    setTimeout(() => openModal('cartModal'), 180);
  }

  function backToCheckout() {
    closeModalId('orderReviewModal');
    setTimeout(() => openModal('checkoutModal'), 180);
  }

  function setDeliveryType(type) {
    deliveryType = type;
    $('btnDel')?.classList.toggle('active', type === 'delivery');
    $('btnPick')?.classList.toggle('active', type === 'pickup');
    if ($('addressGroup')) $('addressGroup').style.display = type === 'delivery' ? 'block' : 'none';
    updateCartUI();
  }

  function setPayment(btn, type) {
    paymentMethod = type;
    document.querySelectorAll('.fs-pay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function openOrderReview() {
    const name = $('chkName').value.trim();
    const phone = $('chkPhone').value.trim();
    if (!name || !phone) { alert('Preencha nome e WhatsApp.'); return; }
    if (deliveryType === 'delivery') {
      const address = readCheckoutAddress();
      if (!address.street || !address.number || !address.neighborhood) { alert('Informe seu endereço.'); return; }
      customerAddress = address;
      localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(customerAddress));
    }
    customer = { name, phone };
    localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer));
    renderReview();
    closeModalId('checkoutModal');
    openModal('orderReviewModal');
  }

  function readCheckoutAddress() {
    const street = $('chkRua').value.trim();
    const number = $('chkNum').value.trim();
    const neighborhood = $('chkBairro').value.trim();
    const complement = $('chkComp').value.trim();
    return { street, number, neighborhood, complement, summary: `${street}, ${number} - ${neighborhood}` };
  }

  function renderReview() {
    const totals = cartTotals();
    $('revTypeIcon').textContent = deliveryType === 'delivery' ? 'Entrega' : 'Retirada';
    $('revTypeName').textContent = deliveryType === 'delivery' ? 'Entrega' : 'Retirada';
    $('revTypeSub').textContent = deliveryType === 'delivery' ? `Hoje, ${settings.estimated_delivery_time_min || 90}-${settings.estimated_delivery_time_max || 100} min` : 'Retirada no local';
    $('revAddrBlock').style.display = deliveryType === 'delivery' ? 'flex' : 'none';
    if (customerAddress) $('revAddrVal').textContent = customerAddress.summary;
    $('revPayVal').textContent = paymentMethod;
    $('revItemsList').innerHTML = cart.map(item => `
      <div class="cart-item-row">
        <div class="cir-qty-badge">${item.qty}x</div>
        <div class="cir-info"><div class="cir-name">${item.name}</div>${item.obs ? `<div class="cir-obs">${item.obs}</div>` : ''}</div>
        <div class="cir-price">${fmt(item.price * item.qty)}</div>
      </div>
    `).join('');
    $('revSub').textContent = fmt(totals.subtotal);
    $('revSvcFeeVal').textContent = fmt(totals.svc);
    $('revDelivery').textContent = deliveryType === 'delivery' ? fmt(totals.delivery) : 'Grátis';
    $('revTotal').textContent = fmt(totals.total);
  }

  async function submitOrder() {
    const branch = branches[0] || {};
    const orderPayload = {
      branch_id: branch.id || branch.uuid || null,
      customer: {
        name: customer?.name || '',
        phone: customer?.phone || ''
      },
      order_type: deliveryType,
      payment_method: paymentMethod,
      address: deliveryType === 'delivery' ? {
        street: customerAddress?.street || '',
        number: customerAddress?.number || '',
        neighborhood: customerAddress?.neighborhood || '',
        complement: customerAddress?.complement || '',
        reference: customerAddress?.reference || ''
      } : null,
      notes: $('chkObs')?.value?.trim() || '',
      coupon_code: selectedCoupon?.code || null,
      items: cart.map(item => ({
        product_id: item.id,
        quantity: item.qty,
        observation: item.obs || ''
      }))
    };
    submittedOrder = await window.PedeAquiOrderService.createOrder(getRestaurantSlug(), orderPayload);
    window.PedeAquiOrderState?.saveOrder(submittedOrder);
    $('confName').textContent = customer.name;
    $('confTotal').textContent = fmt(submittedOrder.total ?? submittedOrder.total_amount ?? cartTotals().total);
    $('confType').textContent = submittedOrder.order_type || submittedOrder.type || (deliveryType === 'delivery' ? 'Entrega' : 'Retirada');
    $('confPay').textContent = submittedOrder.payment_method || paymentMethod;
    closeModalId('orderReviewModal');
    openModal('confirmModal');
    cart = [];
    updateCartUI();
  }

  function openAddressScreen() {
    if (customerAddress) {
      $('addrStreet').value = customerAddress.street || '';
      $('addrNumber').value = customerAddress.number || '';
      $('addrNeighborhood').value = customerAddress.neighborhood || '';
      $('addrComplement').value = customerAddress.complement || '';
    }
    openModal('addressModal');
  }

  function saveAddressMock() {
    const street = $('addrStreet').value.trim();
    const number = $('addrNumber').value.trim();
    const neighborhood = $('addrNeighborhood').value.trim();
    const complement = $('addrComplement').value.trim();
    if (!street || !number || !neighborhood) { alert('Informe rua, número e bairro.'); return; }
    customerAddress = { street, number, neighborhood, complement, summary: `${street}, ${number} - ${neighborhood}` };
    localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(customerAddress));
    renderRestaurantShell();
    updateCartUI();
    closeModalId('addressModal');
  }

  let _loginOrigin = 'profile';

  function openLoginScreen(origin = 'profile') {
    _loginOrigin = origin;
    openModal('loginModal');
  }

  function mockLogin(mode) {
    customer = { name: mode === 'signup' ? 'Cliente PedeAqui' : 'Cliente identificado', phone: '' };
    localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer));
    closeModalId('loginModal');
    if (_loginOrigin === 'orders') {
      mobNavOrders();
    } else {
      renderProfileView();
    }
  }

  function openPolicyScreen(type) {
    const screen = $('privacyPolicyScreen');
    const body = $('privacyPolicyBody');
    const loyaltyIntro = window.PEDEAQUI_LOYALTY_POLICY_HTML
      ? '<div class="policy-section-label">Programa de fidelidade, cashback e benefícios</div>'
      : '';
    const html = `${window.PEDEAQUI_PRIVACY_POLICY_HTML || ''}${loyaltyIntro}${window.PEDEAQUI_LOYALTY_POLICY_HTML || ''}`;
    if (!screen || !body) return;
    if (!body.innerHTML.trim()) body.innerHTML = html;
    $('loginModal')?.classList.add('active');
    document.body.classList.add('modal-open');
    document.querySelector('#loginModal .modal--login')?.classList.add('policy-hidden');
    document.querySelectorAll('.policy-screen').forEach(el => el.classList.remove('active'));
    screen.classList.add('active');
    body.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function closePolicyScreen(type) {
    $('privacyPolicyScreen')?.classList.remove('active');
    document.querySelector('#loginModal .modal--login')?.classList.remove('policy-hidden');
    $('loginModal')?.classList.add('active');
    document.body.classList.add('modal-open');
  }

  function couponLabel(coupon) {
    const type = String(coupon.discount_type || '').toLowerCase();
    if (['percent', 'percentage'].includes(type)) return `${Number(coupon.discount_value || 0)}% OFF`;
    if (type === 'free_delivery') return 'Frete grátis';
    if (Number(coupon.discount_value) > 0) return `${fmt(coupon.discount_value)} OFF`;
    return coupon.name || coupon.title || coupon.code || 'Cupom';
  }

  function couponRules(coupon) {
    const rules = [];
    if (Number(coupon.min_order_value) > 0) rules.push(`Pedido mínimo ${fmt(coupon.min_order_value)}`);
    if (coupon.expires_at || coupon.valid_until) rules.push(`Válido até ${coupon.expires_at || coupon.valid_until}`);
    if (coupon.description) rules.push(coupon.description);
    rules.push('Disponível para pedidos neste restaurante');
    rules.push('Sujeito à disponibilidade e regras do restaurante');
    return rules;
  }

  function openCouponDetail(code) {
    const coupon = coupons.find(c => String(c.code) === String(code));
    if (!coupon) return;
    selectedCoupon = coupon;
    const image = coupon.image_url || coupon.image_path || '';
    const label = couponLabel(coupon);
    const minText = Number(coupon.min_order_value) > 0 ? `Pedido mínimo ${fmt(coupon.min_order_value)}` : 'Sem mínimo informado';
    const art = $('couponDetailArt');
    if (art) {
      art.innerHTML = image
        ? `<img src="${esc(image)}" alt="${esc(coupon.name || coupon.title || label)}">`
        : `<div class="coupon-detail-art-fallback"><span>Cupom</span><strong>${esc(label)}</strong></div>`;
    }
    if ($('couponDetailTitle')) $('couponDetailTitle').textContent = coupon.name || coupon.title || label;
    if ($('couponDetailCode')) $('couponDetailCode').textContent = coupon.code || 'CUPOM';
    if ($('couponDetailMin')) $('couponDetailMin').textContent = minText;
    const rules = $('couponDetailRules');
    if (rules) rules.innerHTML = couponRules(coupon).map(rule => `<li>${esc(rule)}</li>`).join('');
    $('couponDetailOverlay')?.classList.add('active');
    document.body.classList.add('modal-open');
  }

  function closeCouponDetail(event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    $('couponDetailOverlay')?.classList.remove('active');
    if (!document.querySelector('.overlay.active,.mob-view.active,.coupon-detail-overlay.active')) {
      document.body.classList.remove('modal-open');
    }
  }

  function confirmCouponDetail() {
    if (!selectedCoupon) return;
    if (!isLogged()) {
      closeCouponDetail();
      openLoginScreen();
      return;
    }
    closeCouponDetail();
    alert(`Cupom ${selectedCoupon.code} selecionado.`);
  }

  function useCoupon(code) {
    openCouponDetail(code);
  }

  function handleBannerAction(type, value) {
    if (type === 'category' && value) {
      scrollToMenu();
      setTimeout(() => scrollToCategory(value, document.querySelector(`.cat[onclick*="'${value}'"]`)), 250);
      return;
    }
    scrollToMenu();
  }

  const MOB_VIEWS = ['mobViewOrders', 'mobViewProfile'];
  function closeMobViews() {
    MOB_VIEWS.forEach(id => $(id)?.classList.remove('active'));
    document.body.classList.remove('modal-open');
  }

  function setMobNavActive(id) {
    document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
    $(id)?.classList.add('active');
  }

  function mobNavMenu() {
    closeMobViews();
    showMenuTab();
    window.scrollTo(0, 0);
  }

  function mobNavHome() {
    scrollToHome();
  }

  function mobNavOrders() {
    if (!isLogged()) {
      openLoginScreen('orders');
      return;
    }
    closeMobViews();
    setMobNavActive('mobNavOrders');
    renderOrdersView();
    $('mobViewOrders')?.classList.add('active');
    document.body.classList.add('modal-open');
  }

  function mobNavProfile() {
    closeMobViews();
    setMobNavActive('mobNavProfile');
    if (!isLogged()) {
      openLoginScreen();
      return;
    }
    renderProfileView();
    $('mobViewProfile')?.classList.add('active');
    document.body.classList.add('modal-open');
  }

  function renderOrdersView() {
    const body = $('mobOrdersBody');
    if (!body) return;
    const orders = window.PedeAquiOrderState?.listOrders() || [];
    if (!orders.length) {
      body.innerHTML = `<div class="mob-view-empty"><div class="mob-view-empty-title">Nenhum pedido encontrado</div><div class="mob-view-empty-sub">Pedidos finalizados aparecerão aqui.</div></div>`;
      return;
    }
    body.innerHTML = orders.map(order => `
      <article class="order-card">
        <div class="order-card-head"><strong>Pedido #${order.order_number}</strong><span>Enviado</span></div>
        ${(order.items || []).map(i => `<div class="order-line"><span>${i.qty}x ${i.name}</span><strong>${fmt(i.price * i.qty)}</strong></div>`).join('')}
        <div class="order-total"><span>${order.type} • ${order.payment}</span><strong>${fmt(order.total)}</strong></div>
      </article>
    `).join('');
  }

  function renderProfileView() {
    const box = $('profileIdentity');
    if (box) {
      box.innerHTML = isLogged()
        ? `<div class="prof-hero-label">${customer.name}</div><div class="prof-hero-sub">Cliente identificado</div>`
        : `<div class="prof-hero-label">${restaurant.name || 'Restaurante'}</div><div class="prof-hero-sub">Entre para acessar promoções e pedidos</div><button class="profile-login-btn" onclick="openLoginScreen()">Entrar ou cadastrar</button>`;
    }
  }

  function renderProfPedidos() {
    const body = $('profSubPedidosBody');
    if (!body) return;
    const orders = window.PedeAquiOrderState?.listOrders() || [];
    if (!orders.length) {
      body.innerHTML = `<div class="prof-empty"><div class="prof-empty-title">Nenhum pedido encontrado</div><div class="prof-empty-text">Seus pedidos aparecerão aqui após serem finalizados.</div></div>`;
      return;
    }
    body.innerHTML = orders.map(order => `
      <article class="order-card">
        <div class="order-card-head"><strong>Pedido #${order.order_number}</strong><span>Enviado</span></div>
        ${(order.items || []).map(i => `<div class="order-line"><span>${i.qty}x ${i.name}</span><strong>${fmt(i.price * i.qty)}</strong></div>`).join('')}
        <div class="order-total"><span>${order.type} • ${order.payment}</span><strong>${fmt(order.total)}</strong></div>
      </article>
    `).join('');
  }

  function openProfSub(subId) {
    if (!isLogged() && ['cupons', 'meusdados', 'seguranca'].includes(subId)) {
      openLoginScreen();
      return;
    }
    document.querySelectorAll('#mobViewProfile .prof-sub').forEach(el => el.classList.remove('active'));
    const sub = $('profSub' + subId);
    if (!sub) return;
    if (subId === 'pedidos') renderProfPedidos();
    sub.classList.add('active');
  }

  function closeProfSub() {
    document.querySelectorAll('#mobViewProfile .prof-sub').forEach(el => el.classList.remove('active'));
  }

  function mobFocusSearch() {
    closeMobViews();
    showMenuTab();
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

  function openServiceFeeInfo() {
    openModal('serviceFeeModal');
  }

  async function initRestaurantApp() {
    if ($('menuContainer')) $('menuContainer').innerHTML = '<div class="empty-search">Carregando cardapio...</div>';
    payload = await window.PedeAquiRestaurantService.getRestaurantMenu(getRestaurantSlug());
    restaurant = payload.restaurant || {};
    settings = payload.settings || {};
    branches = Array.isArray(payload.branches) ? payload.branches : [];
    categories = Array.isArray(payload.categories) ? payload.categories : [];
    products = Array.isArray(payload.products) ? payload.products : [];
    banners = Array.isArray(payload.banners) ? payload.banners : [];
    highlightBanners = Array.isArray(payload.highlight_banners) ? payload.highlight_banners : [];
    coupons = Array.isArray(payload.coupons) ? payload.coupons : [];
    submittedOrder = window.PedeAquiOrderState?.listOrders()?.[0] || null;
    applyTheme();
    renderRestaurantShell();
    renderBanners();
    renderCoupons();
    renderHighlights();
    renderMenu();
    renderProfileView();
    initSearch();
    initScrollSpy();
    setCartTab('delivery');
    updateCartUI();
    showHomeTab();
    initPageRubberBand();
    initMenuHeaderHide();
  }

  Object.assign(window, {
    openModal, closeModalId, closeModal, openProduct, changeQty, addToCart, scrollToCategory, scrollToMenu,
    removeCartItem, editCartItem, setCartTab, openCheckout, backToCart, backToCheckout, setDeliveryType,
    setPayment, openOrderReview, submitOrder, openAddressScreen, saveAddressMock, openLoginScreen, mockLogin,
    openPolicyScreen, closePolicyScreen,
    useCoupon, openCouponDetail, closeCouponDetail, confirmCouponDetail, handleBannerAction,
    mobNavHome, mobNavMenu, mobNavOrders, mobNavProfile, goToMenuTab: scrollToMenu,
    openProfSub, closeProfSub, mobFocusSearch, closeSearch, openServiceFeeInfo, setHeroBanner
  });

  initRestaurantApp().catch(error => {
    console.error('Falha ao carregar restaurante', error);
    coupons = [];
    highlightBanners = [];
    updateHomePromoVisibility();
    if ($('menuContainer')) $('menuContainer').innerHTML = '<div class="empty-search">Não foi possível carregar o cardápio.</div>';
  });
})();
