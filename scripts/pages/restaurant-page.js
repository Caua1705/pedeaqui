(function () {
  const fmt = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const STORAGE_ADDRESS = 'pedeaqui.customerAddress';
  const STORAGE_ADDRESS_LIST = 'pedeaqui.customerAddresses.local';
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
  const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

  function renderHomeLoginPrompt() {
    const loginPrompt = $('homeLoginPrompt');
    if (!loginPrompt) return;
    const name = firstName(customer?.name);
    loginPrompt.textContent = name ? `Olá, ${name}` : 'Entre ou cadastre-se';
    loginPrompt.onclick = name ? mobNavProfile : () => openLoginScreen();
  }

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

  function productImage(product, className = 'product-image') {
    const image = product.image_url || product.image_path;
    if (image) return `<img class="${className}" src="${esc(image)}" alt="${esc(product.name)}">`;
    return `<div class="${className} product-image--placeholder"><span>${initials(product.name)}</span></div>`;
  }

  function productOldPrice(product) {
    return product.old_price ?? product.original_price ?? product.price_old ?? product.compare_at_price ?? product.list_price ?? null;
  }

  function paymentMethodLabel(method) {
    const key = String(method || '').toLowerCase();
    const labels = {
      pix: 'Pix',
      credit_card: 'Cartão de crédito',
      debit_card: 'Cartão de débito',
      vr_va: 'Vale-refeição / alimentação',
      cash: 'Dinheiro'
    };
    return labels[key] || String(method || '').replace(/_/g, ' ');
  }

  function renderStoreInfoPayment() {
    const box = $('storeInfoPayment');
    if (!box) return;
    box.innerHTML = `
      <p class="store-payment-title">Pagamento na entrega</p>
      <p class="store-payment-group">Crédito</p>
      <div class="store-payment-grid">
        <span><i class="pay-brand pay-brand--amex"></i>American Express</span>
        <span><i class="pay-brand pay-brand--elo"></i>Elo</span>
        <span><i class="pay-brand pay-brand--hiper"></i>Hiper</span>
        <span><i class="pay-brand pay-brand--master"></i>Mastercard</span>
        <span><i class="pay-brand pay-brand--visa"></i>Visa</span>
      </div>
      <p class="store-payment-group store-payment-group--debit">Débito</p>
      <div class="store-payment-grid">
        <span><i class="pay-brand pay-brand--elo"></i>Elo</span>
        <span><i class="pay-brand pay-brand--hiper"></i>Hiper</span>
        <span><i class="pay-brand pay-brand--master"></i>Mastercard</span>
        <span><i class="pay-brand pay-brand--visa"></i>Visa</span>
      </div>
    `;
  }

  function setStoreInfoTab(tab = 'hours') {
    const order = { hours: 0, address: 1, payment: 2 };
    const modal = $('infoModal');
    const tabs = document.querySelector('#infoModal .store-info-tabs');
    if (modal) modal.dataset.storeInfoTab = tab;
    if (tabs) tabs.style.setProperty('--store-tab-index', order[tab] ?? 0);
    document.querySelectorAll('[data-store-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.storeTab === tab);
    });
    const map = {
      hours: document.querySelector('.store-hours-card'),
      address: document.querySelector('.store-address-card'),
      payment: $('storeInfoPayment')
    };
    Object.entries(map).forEach(([key, element]) => {
      if (element) element.style.display = key === tab ? '' : 'none';
    });
  }

  function initStoreInfoModal() {
    const header = document.querySelector('#infoModal .store-info-header');
    const close = document.querySelector('#infoModal .store-info-close');
    const title = document.querySelector('#infoModal .store-info-header h2');
    const tabs = document.querySelector('#infoModal .store-info-tabs');
    const addressCard = document.querySelector('#infoModal .store-address-card');
    const hoursCard = document.querySelector('#infoModal .store-hours-card');
    if (close) {
      close.setAttribute('aria-label', 'Voltar');
      close.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
    }
    if (title) title.textContent = 'Informações';
    if (header && close && title) {
      const spacer = header.querySelector('.store-info-spacer');
      header.insertBefore(close, header.firstElementChild);
      if (spacer) header.appendChild(spacer);
    }
    if (header) header.classList.add('store-info-header--reference');
    if (tabs) {
      tabs.innerHTML = [
        '<button class="active" type="button" data-store-tab="hours" onclick="setStoreInfoTab(\'hours\')">Horários</button>',
        '<button type="button" data-store-tab="address" onclick="setStoreInfoTab(\'address\')">Endereço</button>',
        '<button type="button" data-store-tab="payment" onclick="setStoreInfoTab(\'payment\')">Pagamento</button>'
      ].join('');
    }
    if (hoursCard) {
      hoursCard.innerHTML = [
        '<div class="store-hours-row"><span>Segunda-feira</span><strong>16:45 às 22:15</strong></div>',
        '<div class="store-hours-row"><span>Terça-feira</span><strong>16:45 às 22:15</strong></div>',
        '<div class="store-hours-row"><span>Quarta-feira</span><strong>16:45 às 22:15</strong></div>',
        '<div class="store-hours-row"><span>Quinta-feira</span><strong>16:45 às 22:15</strong></div>',
        '<div class="store-hours-row"><span>Sexta-feira</span><strong>16:45 às 22:15</strong></div>',
        '<div class="store-hours-row active"><span>Sábado</span><strong>16:45 às 22:15</strong></div>',
        '<div class="store-hours-row"><span>Domingo</span><strong>16:45 às 22:15 - 22:30 - 22:45</strong></div>'
      ].join('');
    }
    if (addressCard && !$('storeInfoPayment')) {
      addressCard.insertAdjacentHTML('afterend', '<section class="store-payment-card" id="storeInfoPayment"><h3>Pagamento</h3><p>Formas de pagamento não informadas</p></section>');
    }
    setStoreInfoTab('hours');
  }

  function ProductCard(product) {
    const currentPrice = Number.isFinite(product.price) ? fmt(product.price) : 'Consultar';
    const oldPrice = Number(productOldPrice(product));
    const hasOldPrice = Number.isFinite(oldPrice) && Number.isFinite(product.price) && oldPrice > product.price;
    return `
      <article class="product-card" data-product-id="${esc(product.id)}" onclick="openProduct('${esc(product.id)}')">
        <div class="product-content">
          <h3 class="product-name">${esc(product.name)}</h3>
          ${product.description ? `<p class="product-description">${esc(product.description)}</p>` : ''}
          <div class="product-price-row">
            <span class="product-price">${Number.isFinite(product.price) ? `A partir de ${currentPrice}` : currentPrice}</span>
            ${hasOldPrice ? `<span class="product-old-price">${fmt(oldPrice)}</span>` : ''}
          </div>
        </div>
        <div class="product-image-frame">
          ${productImage(product, 'product-image')}
        </div>
      </article>
    `;
  }

  /* ---- Scroll-lock robusta para mobile (iOS / Android) ----
     overflow:hidden no body não basta no iOS — o conteúdo de fundo
     ainda recebe eventos de toque e desliza. A solução é fixar o body
     em position:fixed com top = -scrollY, e restaurar ao fechar. */
  let _savedScrollY = 0;
  let _bodyScrollLocked = false;
  let _softScrollLocked = false;

  function currentScrollY() {
    return window.pageYOffset
      || document.documentElement.scrollTop
      || document.body.scrollTop
      || 0;
  }

  function hasBlockingUiOpen() {
    return Boolean(document.querySelector(
      '.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.policy-screen.active,.vfy-screen.active,.coupon-detail-overlay.active,.vfy-alert-overlay.active'
    ));
  }

  function lockBodyScroll(scrollY = currentScrollY(), mode = 'fixed') {
    if (mode === 'soft') {
      if (_bodyScrollLocked) {
        document.body.classList.add('modal-open');
        return;
      }
      _savedScrollY = scrollY;
      _softScrollLocked = true;
      return;
    }
    if (_bodyScrollLocked) {
      document.body.classList.add('modal-open');
      return;
    }
    _bodyScrollLocked = true;
    _savedScrollY = scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${_savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';
    document.body.classList.add('modal-open');
  }

  function unlockBodyScroll(restoreY = _savedScrollY) {
    if (_softScrollLocked && !_bodyScrollLocked) {
      _softScrollLocked = false;
      _savedScrollY = restoreY;
      window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
      requestAnimationFrame(() => {
        if (!hasBlockingUiOpen()) window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
      });
      return;
    }
    if (!_bodyScrollLocked) {
      document.body.classList.remove('modal-open');
      return;
    }
    _bodyScrollLocked = false;
    _savedScrollY = restoreY;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflowY = '';
    document.body.classList.remove('modal-open');
    window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      if (!hasBlockingUiOpen()) window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
    });
  }

  function unlockBodyScrollIfClear() {
    if (!hasBlockingUiOpen()) unlockBodyScroll();
    else document.body.classList.add('modal-open');
  }

  const KEEP_NAV_OVERLAYS = new Set([
    'productModal',
    'operationModal',
    'loginModal',
    'couponDetailOverlay'
  ]);

  function syncBottomNavVisibility() {
    const keep = Array.from(KEEP_NAV_OVERLAYS).some(id => $(id)?.classList.contains('active'));
    document.body.classList.toggle('keep-bottom-nav', keep);
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    const scrollY = currentScrollY();
    el.classList.add('active');
    syncBottomNavVisibility();
    lockBodyScroll(scrollY, ['loginModal', 'productModal'].includes(id) ? 'soft' : 'fixed');
  }

  function openModalImmediately(id) {
    const el = $(id);
    if (!el) return;
    const scrollY = currentScrollY();
    el.classList.add('no-motion');
    el.classList.add('active');
    syncBottomNavVisibility();
    lockBodyScroll(scrollY, ['loginModal', 'productModal'].includes(id) ? 'soft' : 'fixed');
    setTimeout(() => el.classList.remove('no-motion'), 50);
  }

  function closeModalId(id) {
    const el = $(id);
    if (!el) return;
    if (['loginModal', 'productModal'].includes(id) && (_bodyScrollLocked || _softScrollLocked)) {
      const restoreY = _savedScrollY;
      el.classList.remove('active');
      syncBottomNavVisibility();
      setTimeout(() => {
        if (!hasBlockingUiOpen()) unlockBodyScroll(restoreY);
      }, 560);
      return;
    }
    el.classList.remove('active');
    syncBottomNavVisibility();
    unlockBodyScrollIfClear();
  }

  function closeModalImmediately(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('no-motion');
    const panel = el.querySelector('.modal--fs,.modal--login,.modal--product');
    el.style.transition = 'none';
    if (panel) panel.style.transition = 'none';
    el.classList.remove('active');
    setTimeout(() => {
      el.style.transition = '';
    if (panel) panel.style.transition = '';
    el.classList.remove('no-motion');
    }, 50);
    syncBottomNavVisibility();
    unlockBodyScrollIfClear();
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
    if ($('addrSearchHeaderTitle')) $('addrSearchHeaderTitle').textContent = restName;
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
    renderHomeLoginPrompt();
    document.querySelectorAll('.store-info-name').forEach(el => el.textContent = restName);
    document.querySelectorAll('.store-info-neighborhood').forEach(el => el.textContent = branch.neighborhood || branch.city || '');
    document.querySelectorAll('.store-info-phone').forEach(el => el.textContent = branch.phone || 'Telefone não informado');
    document.querySelectorAll('.store-info-email').forEach(el => el.textContent = restaurant.email || settings.email || 'E-mail não informado');
    document.querySelectorAll('.store-info-whatsapp').forEach(el => el.textContent = branch.whatsapp || 'WhatsApp não informado');
    document.querySelectorAll('.store-contact-row--wa').forEach(el => {
      const phone = onlyDigits(branch.whatsapp || branch.phone || '');
      if (phone) el.href = `https://wa.me/55${phone}`;
      else el.removeAttribute('href');
    });
    document.querySelectorAll('.pickup-restaurant-name').forEach(el => el.textContent = `${restName}${branch.name ? ' — ' + branch.name : ''}`);
    const infoAddress = $('storeInfoAddress');
    if (infoAddress) {
      const selectedBranch = branches.find(unit => String(unit.id) === String(operationContext?.branch_id)) || branch;
      infoAddress.textContent = [selectedBranch.address, selectedBranch.neighborhood, selectedBranch.city, selectedBranch.state]
        .filter(Boolean)
        .join(' - ') || 'Endereço não informado';
    }
    renderStoreInfoPayment();
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
    renderWidget();
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
    heroBannerIndex = 1;
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
      const mkSlide = banner => {
        const image = banner.image_url || banner.image_path || '';
        const alt = banner.title || banner.subtitle || restaurant.name || 'Banner';
        return `<div class="restaurant-hero-slide"><img src="${esc(image)}" alt="${esc(alt)}"></div>`;
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
        ? visualBanners.map((_, index) => `<span class="${index === 0 ? 'active' : ''}" onclick="setHeroBanner(${index})"></span>`).join('')
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

  function startHeroAutoplay() {
    const total = $('restaurantHeroTrack')?.children.length || 0;
    clearInterval(heroBannerTimer);
    heroBannerTimer = null;
    if (total <= 3) return;
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
      track.style.transform = `translateX(calc(-${heroBannerIndex * 100}% + ${heroDragDeltaX}px))`;
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
    let renderedCategoryCount = 0;

    categories.forEach(cat => {
      const catProducts = products.filter(p => p.is_available && (p.category_slug === cat.slug || p.category_slug === cat.id || slug(p.category) === cat.slug));
      if (!catProducts.length) return;
      const isFirstRenderedCategory = renderedCategoryCount === 0;
      nav.insertAdjacentHTML('beforeend', `<button class="cat ${isFirstRenderedCategory ? 'active' : ''}" onclick="scrollToCategory('${cat.slug}', this)">${cat.name}</button>`);
      container.insertAdjacentHTML('beforeend', `
        <section class="menu-section" id="${cat.slug}">
          <h2 class="menu-section-title">${cat.name}</h2>
          <div class="products-grid">
            ${catProducts.map(product => ProductCard(product)).join('')}
          </div>
        </section>
      `);
      renderedCategoryCount += 1;
    });
    setFirstCategoryActive();
  }

  let isClickScrolling = false;
  function setFirstCategoryActive() {
    const firstCat = document.querySelector('.cat');
    if (!firstCat) return;
    document.querySelectorAll('.cat').forEach(btn => btn.classList.toggle('active', btn === firstCat));
  }

  function showHomeTab() {
    document.body.classList.remove('menu-tab', 'menu-scrolled');
    document.body.classList.add('home-tab');
    setMobNavActive('mobNavHome');
  }

  function showMenuTab() {
    document.body.classList.remove('home-tab');
    document.body.classList.add('menu-tab');
    setMobNavActive('mobNavMenu');
    setFirstCategoryActive();
    initCatStuckObserver();
  }

  let _catStuckObserver = null;
  function initCatStuckObserver() {
    if (_catStuckObserver) return;
    const sentinel = $('searchCat');
    const catNav   = $('catNav');
    if (!sentinel || !catNav) return;
    _catStuckObserver = new IntersectionObserver(([entry]) => {
      catNav.classList.toggle('is-stuck', !entry.isIntersecting);
    }, { threshold: 0 });
    _catStuckObserver.observe(sentinel);
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
      if (!currentId) {
        setFirstCategoryActive();
        return;
      }
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
        sec.querySelectorAll('.product-card').forEach(card => {
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
    if ($('cartCountSticky')) {
      $('cartCountSticky').textContent = qty;
      $('cartCountSticky').dataset.count = qty;
    }
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

  function handleHomeCartValueClick() {
    if (!isLogged()) {
      openLoginScreen();
      return;
    }
    openModal('cartModal');
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
    syncOrderTypeFromCart(type);
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
    syncOrderTypeFromCart(type);
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
      if (operationContext) {
        operationContext.address = {
          street: address.street, number: address.number, neighborhood: address.neighborhood,
          complement: address.complement || '', reference: address.reference || ''
        };
        persistOperationContext();
        renderWidget();
      }
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
    if (!cart.length) { alert('Seu carrinho está vazio.'); return; }
    if (!operationContext?.branch_id) { alert('Selecione uma unidade para continuar.'); openOperationScreen(); return; }
    const orderType = operationContext.order_type;
    if (orderType === 'delivery' && !operationContext.address) {
      alert('Informe seu endereço de entrega.'); openAddressScreen(); return;
    }
    const address = operationContext.address;
    // When the customer is logged in and picked a saved address, reference it by
    // id. The backend resolves customer_id from the JWT — never send it here.
    const savedAddressId = window.PedeAquiCustomerAuth?.isLoggedIn()
      ? (address?.id || address?.address_id || customerAddress?.id || null)
      : null;
    const orderPayload = {
      branch_id: operationContext.branch_id,
      customer: {
        name: customer?.name || '',
        phone: customer?.phone || ''
      },
      order_type: orderType,
      payment_method: paymentMethod,
      ...(orderType === 'delivery' && savedAddressId ? { customer_address_id: savedAddressId } : {}),
      address: orderType === 'delivery' ? {
        street: address?.street || '',
        number: address?.number || '',
        neighborhood: address?.neighborhood || '',
        complement: address?.complement || '',
        reference: address?.reference || ''
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

  // ============================================================
  //  Operation context — single source of truth (per restaurant)
  // ============================================================
  const OP_STORAGE_PREFIX = 'rapidex_operation_context_';
  let operationContext = null;
  let opDraft = null; // working copy edited while the operation modal is open
  let operationConfirmed = false;
  let _opOpenedImmediately = false; // true quando aberta sem animação (acesso forçado sem endereço)

  const opStorageKey = () => OP_STORAGE_PREFIX + getRestaurantSlug();

  function loadOperationContext() {
    try { return JSON.parse(localStorage.getItem(opStorageKey()) || 'null'); }
    catch { return null; }
  }

  function persistOperationContext() {
    if (operationContext) {
      localStorage.setItem(opStorageKey(), JSON.stringify({ ...operationContext, confirmed: operationConfirmed }));
    }
  }

  function addressSummary(a) {
    return a ? `${a.street}, ${a.number} - ${a.neighborhood}` : '';
  }

  function readLocalAddressList() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_ADDRESS_LIST) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeLocalAddressList(list) {
    localStorage.setItem(STORAGE_ADDRESS_LIST, JSON.stringify(Array.isArray(list) ? list : []));
  }

  function compatibleBranches(orderType) {
    return branches.filter(b => orderType === 'pickup' ? b.accepts_pickup : b.accepts_delivery);
  }

  function defaultBranchFor(orderType) {
    const list = compatibleBranches(orderType);
    return list.find(b => b.is_open) || list[0] || branches[0] || null;
  }

  function branchById(id) {
    return branches.find(b => String(b.id) === String(id)) || null;
  }

  function branchSnapshot(branch) {
    return {
      branch_id: branch?.id || null,
      branch_label: branch?.label || '',
      branch_name: branch?.name || '',
      branch_address: branch?.full_address || ''
    };
  }

  function truncateAddress(text, max = 40) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }

  function branchAccepts(branch, orderType) {
    return orderType === 'pickup' ? branch.accepts_pickup : branch.accepts_delivery;
  }

  function initOperationContext() {
    const stored = loadOperationContext();
    operationConfirmed = stored?.confirmed === true;
    const orderType = stored?.order_type === 'pickup' ? 'pickup' : 'delivery';
    let branch = stored?.branch_id ? branchById(stored.branch_id) : null;
    if (!branch || !branchAccepts(branch, orderType)) branch = defaultBranchFor(orderType);
    let address = stored?.address || null;
    if (!address && customerAddress) {
      address = {
        street: customerAddress.street, number: customerAddress.number,
        neighborhood: customerAddress.neighborhood,
        complement: customerAddress.complement || '', reference: customerAddress.reference || ''
      };
    }
    operationContext = { order_type: orderType, ...branchSnapshot(branch), address };
    applyOperationToLegacy();
  }

  function applyOperationToLegacy() {
    deliveryType = operationContext.order_type;
    customerAddress = operationContext.address
      ? { ...operationContext.address, summary: addressSummary(operationContext.address) }
      : null;
    if (customerAddress) localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(customerAddress));
  }

  function operationValid(ctx) {
    if (!ctx || !ctx.branch_id) return false;
    if (ctx.order_type === 'delivery' && !ctx.address) return false;
    return true;
  }

  // ---- Home location widget ----
  function renderWidget() {
    if (!operationContext) return;
    const isPickup = operationContext.order_type === 'pickup';
    const widget = document.querySelector('.delivery-widget');
    widget?.classList.toggle('pending-selection', !operationConfirmed);
    const opTab = $('dwTabDelivery');
    if (opTab) { opTab.textContent = isPickup ? 'RETIRADA' : 'DELIVERY'; opTab.classList.add('active'); }
    const brandTab = $('dwTabBrand');
    if (brandTab) brandTab.textContent = (restaurant.name || 'Restaurante').toUpperCase();
    const branchTab = $('dwTabBranch');
    if (branchTab) branchTab.textContent = operationContext.branch_label || 'UNIDADE';
    const addrMain = $('homeAddressTitle');
    let text;
    if (!operationConfirmed) text = 'Informe seu endereço e loja';
    else if (operationContext.address) text = addressSummary(operationContext.address);
    else text = 'Use seu endereço para melhores resultados';
    if (addrMain) addrMain.textContent = text;
    document.querySelector('.delivery-widget .address-strip')
      ?.classList.toggle('has-address', operationConfirmed && !isPickup && !!operationContext.address);
  }

  // ---- Operation / location modal ----
  function openOperationScreen(immediate) {
    if (!operationContext) return;
    _opOpenedImmediately = !!immediate;
    opDraft = JSON.parse(JSON.stringify(operationContext));
    if ($('opBranchSearch')) $('opBranchSearch').value = '';
    renderOperationScreen();
    if (immediate) openModalImmediately('operationModal');
    else openModal('operationModal');
  }

  function closeOperationScreen() {
    if (_opOpenedImmediately) closeModalImmediately('operationModal');
    else closeModalId('operationModal');
    _opOpenedImmediately = false;
  }

  function renderOperationScreen() {
    if (!opDraft) return;
    const isPickup = opDraft.order_type === 'pickup';
    $('opSegDelivery')?.classList.toggle('active', !isPickup);
    $('opSegPickup')?.classList.toggle('active', isPickup);
    const title = $('opAddrTitle');
    const sub = $('opAddrSub');
    $('opAddrCard')?.classList.toggle('has-address', !!opDraft.address);
    if (opDraft.address) {
      if (title) title.textContent = addressSummary(opDraft.address);
      if (sub) {
        sub.textContent = '';
        sub.style.display = 'none';
      }
    } else {
      if (title) title.textContent = 'Informe seu endereço';
      if (sub) sub.style.display = 'none';
    }
    renderOperationBranches();
  }

  function setOperationType(type) {
    if (!opDraft) return;
    opDraft.order_type = type;
    const current = branchById(opDraft.branch_id);
    if (!current || !branchAccepts(current, type)) {
      Object.assign(opDraft, branchSnapshot(defaultBranchFor(type)));
    }
    renderOperationScreen();
  }

  function renderOperationBranches() {
    const list = $('opBranchList');
    if (!list || !opDraft) return;
    const query = ($('opBranchSearch')?.value || '').toLowerCase().trim();
    let items = compatibleBranches(opDraft.order_type);
    if (query) {
      items = items.filter(b => `${b.name} ${b.full_address} ${b.neighborhood}`.toLowerCase().includes(query));
    }
    if (!items.length) {
      list.innerHTML = '<div class="op-branch-empty">Nenhuma unidade disponível para esta operação.</div>';
      updateConfirmButton();
      return;
    }
    list.innerHTML = items.map(b => {
      const selected = String(b.id) === String(opDraft.branch_id);
      const badge = b.is_open
        ? '<span class="op-branch-badge open">Aberto</span>'
        : '<span class="op-branch-badge closed">Fechado</span>';
      return `<button type="button" class="op-branch-card${selected ? ' selected' : ''}" onclick="selectBranch('${esc(b.id)}')">
        <span class="op-branch-radio"></span>
        <span class="op-branch-body">
          <span class="op-branch-name">${esc(b.name)}</span>
          <span class="op-branch-addr" title="${esc(b.full_address)}">${esc(truncateAddress(b.full_address))}</span>
          ${badge}
        </span>
        <svg class="op-branch-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>
      </button>`;
    }).join('');
    updateConfirmButton();
  }

  function selectBranch(id) {
    if (!opDraft) return;
    const branch = branchById(id);
    if (!branch) return;
    Object.assign(opDraft, branchSnapshot(branch));
    renderOperationBranches();
  }

  function updateConfirmButton() {
    const btn = $('opConfirmBtn');
    if (btn) btn.disabled = !opDraft?.branch_id;
  }

  function confirmOperation() {
    if (!opDraft?.branch_id) return;
    // Delivery sem endereço: confirma assim mesmo e mostra o widget com os 3
    // mini-widgets. O endereço fica como "Use seu endereço para melhores
    // resultados" (renderWidget) e só é exigido no checkout.
    operationContext = JSON.parse(JSON.stringify(opDraft));
    operationConfirmed = true;
    persistOperationContext();
    applyOperationToLegacy();
    renderWidget();
    setCartTab(operationContext.order_type);
    updateCartUI();
    closeOperationScreen();
    if (_pendingMenuNav) {
      _pendingMenuNav = false;
      closeMobViews();
      showMenuTab();
      window.scrollTo(0, 0);
    }
  }

  // Keep operation context in sync when the cart/checkout tabs change order type
  function syncOrderTypeFromCart(type) {
    if (!operationContext || !operationConfirmed || operationContext.order_type === type) return;
    operationContext.order_type = type;
    const current = branchById(operationContext.branch_id);
    if (!current || !branchAccepts(current, type)) {
      Object.assign(operationContext, branchSnapshot(defaultBranchFor(type)));
    }
    persistOperationContext();
    renderWidget();
  }

  function openAddressScreen() {
    openAddressChoice();
  }

  function openAddressChoice() {
    if (opDraft?.address) { openAddrPicker(); return; }
    openAddressChoiceDirect(true);
  }

  let _addAddressOrigin = 'operation';
  let _returnToAddAddressChoice = false;

  function openAddressChoiceDirect(withMotion = true) {
    const btn = $('adcConfirmBtn');
    if (btn) btn.disabled = true;
    _adcSelection = null;
    const fromPicker = $('addrPickerModal')?.classList.contains('active');
    _addAddressOrigin = fromPicker ? 'picker' : 'operation';
    const geo = $('adcBtnGeo');
    const manual = $('adcBtnManual');
    if (geo) geo.classList.remove('selected');
    if (manual) manual.classList.remove('selected');
    if (!fromPicker) closeModalImmediately('addrPickerModal');
    $('addAddressModal')?.classList.toggle('from-picker', fromPicker);
    $('addAddressModal')?.classList.toggle('no-motion', !withMotion);
    openModal('addAddressModal');
  }

  function backFromAddAddress() {
    const fromPicker = _addAddressOrigin === 'picker';
    closeModalId('addAddressModal');
    _returnToAddAddressChoice = false;
    if (fromPicker) {
      setTimeout(() => {
        $('addAddressModal')?.classList.remove('from-picker', 'no-motion');
      }, 560);
    }
  }

  let _adcSelection = null;

  function selectAdcOption(type) {
    _adcSelection = type;
    const geo = $('adcBtnGeo');
    const manual = $('adcBtnManual');
    if (geo) geo.classList.toggle('selected', type === 'geo');
    if (manual) manual.classList.toggle('selected', type === 'manual');
    const btn = $('adcConfirmBtn');
    if (btn) btn.disabled = false;
  }

  function adcConfirm() {
    if (!_adcSelection) return;
    _returnToAddAddressChoice = true;
    if (_adcSelection === 'geo') {
      adcUseGeoSearch(true);
      return;
    }
    openAddrSearch(true);
    closeAddressEntryStackImmediately();
  }

  function closeAddressEntryStackImmediately() {
    closeModalImmediately('addAddressModal');
    if (_addAddressOrigin === 'picker') closeModalImmediately('addrPickerModal');
    $('addAddressModal')?.classList.remove('from-picker');
  }

  function reopenAddressChoiceImmediately() {
    if (_addAddressOrigin === 'picker') {
      $('addrPickerModal')?.classList.add('no-motion');
      openModalImmediately('addrPickerModal');
    }
    $('addAddressModal')?.classList.toggle('from-picker', _addAddressOrigin === 'picker');
    $('addAddressModal')?.classList.add('no-motion');
    openModalImmediately('addAddressModal');
  }

  function backFromAddrSearch() {
    if (!_returnToAddAddressChoice) {
      closeModalId('addrSearchModal');
      return;
    }
    reopenAddressChoiceImmediately();
    closeModalImmediately('addrSearchModal');
  }

  function backFromAddrMap() {
    if (!_returnToAddAddressChoice) {
      closeModalId('addrMapModal');
      return;
    }
    reopenAddressChoiceImmediately();
    closeModalImmediately('addrMapModal');
  }

  function editAddrDetailsLocation() {
    closeModalImmediately('addrDetailsModal');
    openAddrSearch(true);
  }

  let _addrPickerSelected = null;
  let _addrPickerItems = [];
  let _addrJustSavedAddress = null;
  let _addrPickerDeleteId = null;
  const ADDR_PICKER_DOTS_VERTICAL = '<svg width="16" height="23" viewBox="0 0 24 32" fill="none" stroke="#aaa" stroke-width="2"><circle cx="12" cy="5" r="1.45" fill="#aaa"/><circle cx="12" cy="16" r="1.45" fill="#aaa"/><circle cx="12" cy="27" r="1.45" fill="#aaa"/></svg>';
  const ADDR_PICKER_DOTS_HORIZONTAL = '<svg width="21" height="8" viewBox="0 0 30 10" fill="none" stroke="#aaa" stroke-width="2"><circle cx="5" cy="5" r="1.45" fill="#aaa"/><circle cx="15" cy="5" r="1.45" fill="#aaa"/><circle cx="25" cy="5" r="1.45" fill="#aaa"/></svg>';
  const ADDR_PICKER_DELETE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
  function truncateAddrPickerText(text, max = 25) {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;
  }

  function getCurrentPickerAddress() {
    return _addrJustSavedAddress || opDraft?.address || operationContext?.address || customerAddress || null;
  }

  function addrPickerId(addr, fallback = '__current__') {
    return String(addr?.id || addr?.address_id || fallback);
  }

  function sameAddress(a, b) {
    if (!a || !b) return false;
    const aId = a.id || a.address_id;
    const bId = b.id || b.address_id;
    if (aId && bId && String(aId) === String(bId)) return true;
    return String(a.street || '') === String(b.street || '')
      && String(a.number || '') === String(b.number || '')
      && String(a.neighborhood || '') === String(b.neighborhood || '');
  }

  function currentPickerItem(current) {
    if (!current) return null;
    return {
      ...current,
      id: current.id || current.address_id || '__current__',
      label: current.label || current.alias || current.tag || current.name || current.street || 'Endereco'
    };
  }

  function mergeAddressPickerItems(...groups) {
    const merged = [];
    groups.flat().filter(Boolean).forEach(addr => {
      const id = addrPickerId(addr, '');
      if (!id || !merged.some(item => addrPickerId(item, '') === id)) {
        merged.push(addr);
      }
    });
    return merged;
  }

  function openAddrPicker() {
    $('addrPickerModal')?.classList.add('no-motion');
    _addrPickerSelected = null;
    _addrPickerItems = [];
    _addrPickerDeleteId = null;
    setAddrDeleteConfirm(false);
    const confirmBtn = $('addrPickerConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    const current = getCurrentPickerAddress();
    const currentItem = currentPickerItem(current);
    const localItems = readLocalAddressList().map(currentPickerItem).filter(Boolean);
    if (currentItem) {
      _addrPickerItems = mergeAddressPickerItems([currentItem], localItems);
      _addrPickerSelected = addrPickerId(currentItem);
    } else {
      _addrPickerItems = localItems;
    }
    _renderAddrPickerList();
    openModal('addrPickerModal');
    const auth = window.PedeAquiCustomerAuth;
    if (auth?.isLoggedIn()) {
      auth.getCustomerAddresses().then(res => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (list.length) {
          const current = getCurrentPickerAddress();
          const currentItem = currentPickerItem(current);
          const localItems = readLocalAddressList().map(currentPickerItem).filter(Boolean);
          _addrPickerItems = mergeAddressPickerItems(currentItem ? [currentItem] : [], localItems, list);
          if (currentItem) _addrPickerSelected = addrPickerId(currentItem);
          _renderAddrPickerList();
        }
      }).catch(() => {});
    }
  }

  function _renderAddrPickerList() {
    const list = $('addrPickerList');
    if (!list) return;
    const current = getCurrentPickerAddress();
    list.innerHTML = _addrPickerItems.map(addr => {
      const id = addrPickerId(addr);
      const label = addr.label || addr.tag || addr.name || 'Endereço';
      const summary = addr.formatted_address || addressSummary(addr);
      const isSel = _addrPickerSelected
        ? _addrPickerSelected === id
        : current && (sameAddress(addr, current) || id === '__current__');
      if (isSel) {
        _addrPickerSelected = id;
        const btn = $('addrPickerConfirmBtn');
        if (btn) btn.disabled = false;
      }
      return `<button class="addr-picker-item${isSel ? ' selected' : ''}" onclick="selectAddrPickerItem('${esc(id)}')" data-addr-id="${esc(id)}">
        <span class="addr-picker-pin${isSel ? ' active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </span>
        <span class="addr-picker-copy"><strong>${esc(label)}</strong><small data-full-text="${esc(summary)}" data-short-text="${esc(truncateAddrPickerText(summary, 35))}">${esc(truncateAddrPickerText(summary, 35))}</small></span>
        ${isSel
          ? `<span class="addr-picker-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#15803d"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
             <span class="addr-picker-dots" onclick="toggleAddrPickerActions(event,this)">${ADDR_PICKER_DOTS_VERTICAL}</span>
             <span class="addr-picker-delete" onclick="removeAddrPickerItem(event,this)" aria-label="Excluir endereÃ§o">${ADDR_PICKER_DELETE_ICON}</span>`
          : `<span class="addr-picker-dots" onclick="toggleAddrPickerActions(event,this)">${ADDR_PICKER_DOTS_VERTICAL}</span>
             <span class="addr-picker-delete" onclick="removeAddrPickerItem(event,this)" aria-label="Excluir endereço">${ADDR_PICKER_DELETE_ICON}</span>`}
      </button>`;
    }).join('');
  }

  function setAddrDeleteConfirm(open) {
    const confirm = $('addrDeleteConfirm');
    if (!confirm) return;
    confirm.classList.toggle('active', Boolean(open));
    confirm.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function closeAddrPickerActions(exceptCard) {
    document.querySelectorAll('#addrPickerModal .addr-picker-item.actions-open').forEach(card => {
      if (exceptCard && card === exceptCard) return;
      card.classList.remove('actions-open');
      const copy = card.querySelector('.addr-picker-copy small');
      if (copy?.dataset.shortText) copy.textContent = copy.dataset.shortText;
      const dots = card.querySelector('.addr-picker-dots');
      if (dots) dots.innerHTML = ADDR_PICKER_DOTS_VERTICAL;
    });
  }

  function toggleAddrPickerActions(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    const card = target?.closest?.('.addr-picker-item');
    if (!card) return;
    const willOpen = !card.classList.contains('actions-open');
    closeAddrPickerActions(card);
    card.classList.toggle('actions-open', willOpen);
    const copy = card.querySelector('.addr-picker-copy small');
    if (copy) {
      const full = copy.dataset.fullText || copy.textContent || '';
      copy.dataset.fullText = full;
      const short = copy.dataset.shortText || truncateAddrPickerText(full, 35);
      copy.dataset.shortText = short;
      copy.textContent = willOpen ? truncateAddrPickerText(full, 25) : short;
    }
    const dots = card.querySelector('.addr-picker-dots');
    if (dots) dots.innerHTML = willOpen ? ADDR_PICKER_DOTS_HORIZONTAL : ADDR_PICKER_DOTS_VERTICAL;
  }

  function removeAddrPickerItem(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    const card = target?.closest?.('.addr-picker-item');
    const id = card?.dataset.addrId;
    if (!id) return;
    _addrPickerDeleteId = String(id);
    closeAddrPickerActions();
    setAddrDeleteConfirm(true);
  }

  function cancelAddrPickerDelete() {
    _addrPickerDeleteId = null;
    setAddrDeleteConfirm(false);
  }

  function confirmAddrPickerDelete() {
    const id = _addrPickerDeleteId;
    if (!id) return;
    _addrPickerDeleteId = null;
    setAddrDeleteConfirm(false);
    const card = Array.from(document.querySelectorAll('#addrPickerList .addr-picker-item'))
      .find(item => String(item.dataset.addrId) === String(id));
    if (card && id === 'example1') {
      card.remove();
      return;
    }
    _addrPickerItems = _addrPickerItems.filter(a => String(a.id || a.address_id || '__current__') !== String(id));
    writeLocalAddressList(readLocalAddressList().filter(a => String(a.id || a.address_id || '__current__') !== String(id)));
    if (_addrPickerSelected === String(id)) {
      _addrPickerSelected = null;
      const btn = $('addrPickerConfirmBtn');
      if (btn) btn.disabled = true;
    }
    _renderAddrPickerList();
  }

  function selectAddrPickerItem(id) {
    closeAddrPickerActions();
    _addrPickerSelected = id;
    const selectedConfirmBtn = $('addrPickerConfirmBtn');
    if (selectedConfirmBtn) selectedConfirmBtn.disabled = false;
    _renderAddrPickerList();
    return;
    document.querySelectorAll('#addrPickerList .addr-picker-item').forEach(el => {
      const sel = el.dataset.addrId === id;
      el.classList.toggle('selected', sel);
      const pin = el.querySelector('.addr-picker-pin');
      if (pin) pin.classList.toggle('active', sel);
      const indicator = el.querySelector('.addr-picker-check, .addr-picker-dots');
      if (!indicator) return;
      if (sel) {
        indicator.className = 'addr-picker-check';
        indicator.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      } else {
        indicator.className = 'addr-picker-dots';
        indicator.setAttribute('onclick', 'toggleAddrPickerActions(event,this)');
        indicator.innerHTML = ADDR_PICKER_DOTS_VERTICAL;
        if (!el.querySelector('.addr-picker-delete')) {
          el.insertAdjacentHTML('beforeend', `<span class="addr-picker-delete" onclick="removeAddrPickerItem(event,this)" aria-label="Excluir endereço">${ADDR_PICKER_DELETE_ICON}</span>`);
        }
      }
    });
    const confirmBtn = $('addrPickerConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = false;
  }

  function confirmAddrPicker() {
    if (!_addrPickerSelected || !opDraft) return;
    const addr = _addrPickerItems.find(a => String(a.id || a.address_id || '__current__') === _addrPickerSelected);
    if (!addr) return;
    _addrJustSavedAddress = null;
    opDraft.address = addr;
    customerAddress = { ...addr, summary: addressSummary(addr) };
    localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(customerAddress));
    persistOperationContext();
    renderOperationScreen();
    closeModalImmediately('addrPickerModal');
  }

  // ============================================================
  //  Google Maps address flow (search → map → details)
  // ============================================================

  let _googleMapsLoading = false;
  let _addrTempLoc = null;   // { lat, lng, formatted_address, place_id, street_name, number, street, neighborhood, city, state, postal_code }
  let _addrMap = null;
  let _addrMapMarker = null;
  let _addrSearchDebounce = null;
  let _googleMapsPromise = null;
  let _placesLibraryPromise = null;
  let _mapsLibraryPromise = null;
  let _geocodingLibraryPromise = null;
  let _addrSuggestionCache = [];
  let _addrAutocompleteSessionToken = null;
  let _geocoder = null;
  let _legacyAutocompleteService = null;

  // ----------------------------------------------------------------
  //  Places autocomplete: implementation switch + debug
  // ----------------------------------------------------------------
  // TEMPORARY ISOLATION FLAG.
  //   true  -> legacy google.maps.places.AutocompleteService
  //            (routes through maps.googleapis.com / "Places API")
  //   false -> new AutocompleteSuggestion.fetchAutocompleteSuggestions
  //            (routes through places.googleapis.com / "Places API (New)")
  // The 403 "caller does not have permission" comes from the NEW path
  // (AutocompletePlaces RPC). Keeping this true lets address search work
  // through the legacy/JS endpoint while the Places API (New) key
  // permission is sorted out in Google Cloud. Flip to false to retest New.
  const USE_LEGACY_PLACES_AUTOCOMPLETE = true;

  // Verbose, key-safe diagnostics in the console. Set to false to silence.
  const MAPS_DEBUG = true;
  let _mapsDebugLogged = false;

  function _maskKey(k) {
    if (!k) return '(none)';
    return `${String(k).slice(0, 10)}…(len ${String(k).length})`;
  }

  function _loadedMapsScripts() {
    return Array.from(document.querySelectorAll('script[src*="maps.googleapis.com"]'));
  }

  function _scriptKeyPrefix() {
    const s = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (!s) return null;
    try { return (new URL(s.src).searchParams.get('key') || '').slice(0, 10) || null; }
    catch (_) { return null; }
  }

  function _logMapsDebug(stage, extra) {
    if (!MAPS_DEBUG) return;
    const cfgKey = window.GOOGLE_MAPS_API_KEY || '';
    const scripts = _loadedMapsScripts();
    const scriptKey = _scriptKeyPrefix();
    /* eslint-disable no-console */
    console.groupCollapsed(`[PedeAqui][maps-debug] ${stage}`);
    console.log('location.href      :', window.location.href);
    console.log('location.origin    :', window.location.origin);
    console.log('document.referrer  :', document.referrer || '(empty)');
    console.log('configured key     :', _maskKey(cfgKey));
    console.log('loaded script key  :', scriptKey ? `${scriptKey}…` : '(no maps script yet)');
    console.log('keys match         :', scriptKey ? cfgKey.startsWith(scriptKey) : 'n/a (script not injected yet)');
    console.log('maps scripts count :', scripts.length, scripts.length > 1 ? '⚠ MULTIPLE — duplicate injection' : '(single — ok)');
    scripts.forEach((s, i) => console.log(`  script[${i}]       :`, s.src.replace(/key=[^&]+/, 'key=***')));
    console.log('google.maps        :', !!(window.google && window.google.maps));
    console.log('importLibrary      :', !!(window.google && window.google.maps && window.google.maps.importLibrary));
    console.log('autocomplete mode  :', USE_LEGACY_PLACES_AUTOCOMPLETE
      ? 'LEGACY AutocompleteService → maps.googleapis.com (Places API)'
      : 'NEW AutocompleteSuggestion → places.googleapis.com (Places API New)');
    if (extra) Object.keys(extra).forEach(k => console.log(`${k.padEnd(19)}:`, extra[k]));
    console.groupEnd();
    /* eslint-enable no-console */
  }

  // Map raw Google errors / status codes to friendly Portuguese messages.
  function _mapPlacesError(err) {
    const msg = String((err && err.message) || err || '');
    if (/Chave do Google Maps/i.test(msg) || /API key/i.test(msg))
      return 'Chave do Google Maps nao configurada.';
    if (/caller does not have permission|PERMISSION_DENIED/i.test(msg))
      return 'Nao foi possivel buscar enderecos agora. Verifique a configuracao do Google Places.';
    if (/RefererNotAllowed|referer|referrer/i.test(msg))
      return 'Este dominio local nao esta autorizado na chave do Google Maps.';
    if (/REQUEST_DENIED|not.*enabled|disabled|ApiNotActivated/i.test(msg))
      return 'Google Places API nao esta ativada para este projeto.';
    if (/ZERO_RESULTS|Nenhum/i.test(msg))
      return 'Nenhum endereco encontrado.';
    return 'Nao foi possivel buscar enderecos agora. Use "Nao achei meu endereco".';
  }

  const FORTALEZA_LOCATION_BIAS = {
    north: -2.35,
    south: -5.1,
    east: -37.0,
    west: -40.2
  };

  function _showAddrSearchMessage(message) {
    const sug = $('addrSuggestions');
    if (sug) sug.innerHTML = `<p class="addr-no-results">${_esc(message)}</p>`;
  }

  function _ensureGoogleMapsLoader() {
    if (!_mapsDebugLogged) { _mapsDebugLogged = true; _logMapsDebug('loader-start'); }
    if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
    if (_googleMapsPromise) return _googleMapsPromise;

    const key = window.GOOGLE_MAPS_API_KEY || '';
    if (!key) {
      const err = new Error('Chave do Google Maps nao configurada.');
      console.warn('[PedeAqui] Google Maps API key not configured. Edit scripts/config/maps-config.js.');
      _googleMapsPromise = Promise.reject(err);
      return _googleMapsPromise;
    }

    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      _googleMapsPromise = new Promise((resolve, reject) => {
        if (window.google?.maps?.importLibrary) { resolve(window.google.maps); return; }
        existing.addEventListener('load', () => {
          if (window.google?.maps?.importLibrary) resolve(window.google.maps);
          else reject(new Error('Google Maps carregou sem importLibrary.'));
        }, { once: true });
        existing.addEventListener('error', () => reject(new Error('Falha ao carregar o script do Google Maps.')), { once: true });
      });
      return _googleMapsPromise;
    }

    _googleMapsLoading = true;
    _googleMapsPromise = new Promise((resolve, reject) => {
      const bootstrapCallback = '__pedeAquiGoogleMapsReady';
      window.google = window.google || {};
      window.google.maps = window.google.maps || {};
      window.google.maps[bootstrapCallback] = () => {
        _googleMapsLoading = false;
        resolve(window.google.maps);
        try { delete window.google.maps[bootstrapCallback]; } catch (_) { window.google.maps[bootstrapCallback] = undefined; }
      };

      const s = document.createElement('script');
      const params = new URLSearchParams({
        key,
        v: 'weekly',
        loading: 'async',
        callback: `google.maps.${bootstrapCallback}`
      });
      s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      s.async = true;
      s.onerror = () => {
        _googleMapsLoading = false;
        reject(new Error('Falha ao carregar o script do Google Maps.'));
      };
      document.head.appendChild(s);
    });
    return _googleMapsPromise;
  }

  async function _importGoogleMapsLibrary(name) {
    await _ensureGoogleMapsLoader();
    try {
      return await google.maps.importLibrary(name);
    } catch (err) {
      throw new Error(`Falha ao carregar a biblioteca ${name} do Google Maps.`);
    }
  }

  function _loadPlacesLibrary() {
    if (!_placesLibraryPromise) _placesLibraryPromise = _importGoogleMapsLibrary('places');
    return _placesLibraryPromise;
  }

  function _loadMapsLibrary() {
    if (!_mapsLibraryPromise) {
      _mapsLibraryPromise = Promise.all([
        _importGoogleMapsLibrary('maps'),
        _importGoogleMapsLibrary('marker')
      ]);
    }
    return _mapsLibraryPromise;
  }

  async function _loadGeocoder() {
    if (!_geocodingLibraryPromise) _geocodingLibraryPromise = _importGoogleMapsLibrary('geocoding');
    await _geocodingLibraryPromise;
    if (!_geocoder) _geocoder = new google.maps.Geocoder();
    return _geocoder;
  }

  function openAddrSearch(instant = false) {
    const inp = $('addrSearchInput');
    const sug = $('addrSuggestions');
    if (inp) inp.value = '';
    if (sug) sug.innerHTML = '';
    _addrSuggestionCache = [];
    _addrAutocompleteSessionToken = null;
    if (instant) openModalImmediately('addrSearchModal');
    else openModal('addrSearchModal');
    _loadPlacesLibrary()
      .then(() => {
        if (MAPS_DEBUG) _logMapsDebug('places-library-loaded', {
          placesLibrary: 'loaded ok',
          AutocompleteService: !!(window.google?.maps?.places?.AutocompleteService),
          AutocompleteSuggestion: !!(window.google?.maps?.places?.AutocompleteSuggestion)
        });
      })
      .catch(err => {
        console.warn('[PedeAqui] Places library unavailable:', err);
        _showAddrSearchMessage(_mapPlacesError(err));
      })
      .finally(() => setTimeout(() => { if (inp) inp.focus(); }, 200));
  }

  function onAddrSearchInput() {
    clearTimeout(_addrSearchDebounce);
    const val = ($('addrSearchInput') || {}).value?.trim() || '';
    const sug = $('addrSuggestions');
    if (!sug) return;
    if (val.length < 2) { sug.innerHTML = ''; return; }
    _renderAddrSkeleton();
    _addrSearchDebounce = setTimeout(() => _fetchAddrSuggestions(val), 350);
  }

  function _renderAddrSkeleton() {
    const sug = $('addrSuggestions');
    if (!sug) return;
    let h = '';
    for (let i = 0; i < 4; i++) {
      h += `<div class="addr-sug-skeleton">
        <div class="addr-sug-sk-icon"></div>
        <div class="addr-sug-sk-text">
          <div class="addr-sug-sk-line addr-sug-sk-line--main"></div>
          <div class="addr-sug-sk-line addr-sug-sk-line--sub"></div>
        </div>
      </div>`;
    }
    sug.innerHTML = h;
  }

  async function _fetchAddrSuggestions(query) {
    const currentValue = ($('addrSearchInput') || {}).value?.trim() || '';
    if (query !== currentValue) return;
    try {
      const normalized = USE_LEGACY_PLACES_AUTOCOMPLETE
        ? await _fetchLegacySuggestions(query)
        : await _fetchNewSuggestions(query);
      if (query !== (($('addrSearchInput') || {}).value?.trim() || '')) return;
      _renderAddrSuggestions(normalized);
    } catch (err) {
      console.warn('[PedeAqui] Places autocomplete failed:', err);
      if (MAPS_DEBUG) _logMapsDebug('autocomplete-error', {
        rawError: String((err && err.message) || err),
        diagnosis: USE_LEGACY_PLACES_AUTOCOMPLETE
          ? 'Legacy path failed — likely "Places API" (old) not enabled or key referrer/restriction issue.'
          : 'New path failed — likely "Places API (New)" permission/restriction on the key (the AutocompletePlaces 403).'
      });
      _showAddrSearchMessage(_mapPlacesError(err));
    }
  }

  // NEW Places API (places.googleapis.com / AutocompletePlaces RPC).
  // Returns normalized [{ main, sub, placeId, placePrediction }].
  async function _fetchNewSuggestions(query) {
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await _loadPlacesLibrary();
    if (!_addrAutocompleteSessionToken && AutocompleteSessionToken) {
      _addrAutocompleteSessionToken = new AutocompleteSessionToken();
    }
    const req = {
      input: query,
      includedRegionCodes: ['br'],
      language: 'pt-BR',
      region: 'br',
      locationBias: FORTALEZA_LOCATION_BIAS,
      sessionToken: _addrAutocompleteSessionToken
    };
    const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return suggestions
      .filter(s => s.placePrediction)
      .map(s => {
        const p = s.placePrediction;
        return {
          main: _predictionText(p.mainText) || _predictionText(p.text) || '',
          sub: _predictionText(p.secondaryText) || '',
          placeId: p.placeId || '',
          placePrediction: p
        };
      });
  }

  // LEGACY AutocompleteService (maps.googleapis.com / "Places API").
  // Returns normalized [{ main, sub, placeId, placePrediction:null }].
  async function _fetchLegacySuggestions(query) {
    await _loadPlacesLibrary();
    if (!_legacyAutocompleteService) {
      _legacyAutocompleteService = new google.maps.places.AutocompleteService();
    }
    const bounds = new google.maps.LatLngBounds(
      { lat: FORTALEZA_LOCATION_BIAS.south, lng: FORTALEZA_LOCATION_BIAS.west },
      { lat: FORTALEZA_LOCATION_BIAS.north, lng: FORTALEZA_LOCATION_BIAS.east }
    );
    return new Promise((resolve, reject) => {
      _legacyAutocompleteService.getPlacePredictions({
        input: query,
        language: 'pt-BR',
        region: 'br',
        componentRestrictions: { country: 'br' },
        bounds
      }, (predictions, status) => {
        const S = google.maps.places.PlacesServiceStatus;
        if (status === S.ZERO_RESULTS) { resolve([]); return; }
        if (status !== S.OK || !predictions) {
          reject(new Error(`PLACES_STATUS_${status}`));
          return;
        }
        resolve(predictions.map(p => ({
          main: (p.structured_formatting && p.structured_formatting.main_text) || p.description || '',
          sub: (p.structured_formatting && p.structured_formatting.secondary_text) || '',
          placeId: p.place_id || '',
          placePrediction: null
        })));
      });
    });
  }

  // Legacy predictions carry only a placeId — resolve full details via Geocoder
  // (Geocoding API), which is already enabled on the key.
  async function _legacyPlaceIdToLocation(placeId) {
    if (!placeId) throw new Error('Sugestao invalida.');
    const r = await _geocodePlaceId(placeId);
    return {
      lat: r.geometry.location.lat(),
      lng: r.geometry.location.lng(),
      formatted_address: r.formatted_address || '',
      place_id: placeId,
      ..._parseAddrComponents(r.address_components || [])
    };
  }

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function _predictionText(textValue) {
    if (!textValue) return '';
    return typeof textValue === 'string' ? textValue : (textValue.text || '');
  }

  function _normalizePlaceAddressComponents(comps) {
    return (comps || []).map(c => ({
      long_name: c.long_name || c.longText || '',
      short_name: c.short_name || c.shortText || '',
      types: c.types || []
    }));
  }

  function _placeLocationToLatLng(location) {
    if (!location) return null;
    const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
    const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
  }

  function _geocodePlaceId(placeId) {
    return _loadGeocoder().then(geocoder => new Promise((resolve, reject) => {
      geocoder.geocode({ placeId }, (results, status) => {
        if (status !== 'OK' || !results?.[0]) {
          reject(new Error('Nao foi possivel carregar este endereco.'));
          return;
        }
        resolve(results[0]);
      });
    }));
  }

  async function _placePredictionToLocation(placePrediction) {
    const placeId = placePrediction?.placeId || '';
    if (!placePrediction) throw new Error('Sugestao invalida.');
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ['id', 'formattedAddress', 'location', 'addressComponents'] });
      const loc = _placeLocationToLatLng(place.location);
      if (!loc) throw new Error('Endereco sem coordenadas.');
      return {
        lat: loc.lat,
        lng: loc.lng,
        formatted_address: place.formattedAddress || '',
        place_id: place.id || placeId,
        ..._parseAddrComponents(_normalizePlaceAddressComponents(place.addressComponents || []))
      };
    } catch (err) {
      if (!placeId) throw err;
      const r = await _geocodePlaceId(placeId);
      return {
        lat: r.geometry.location.lat(),
        lng: r.geometry.location.lng(),
        formatted_address: r.formatted_address || '',
        place_id: placeId,
        ..._parseAddrComponents(r.address_components || [])
      };
    }
  }

  function _renderAddrSuggestions(suggestions) {
    const sug = $('addrSuggestions');
    if (!sug) return;
    _addrSuggestionCache = suggestions || [];
    if (!_addrSuggestionCache.length) {
      sug.innerHTML = '<p class="addr-no-results">Nenhum resultado encontrado.</p>';
      return;
    }
    sug.innerHTML = _addrSuggestionCache.map((s, index) => {
      const main = _esc([s.main, s.sub].filter(Boolean).join(s.sub ? ' - ' : ''));
      return `<button class="addr-sug-item" onclick="selectAddrSuggestion(${index})">
        <svg class="addr-sug-pin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div class="addr-sug-copy">
          <span class="addr-sug-main">${main}</span>
        </div>
      </button>`;
    }).join('');
  }

  async function selectAddrSuggestion(index) {
    const suggestion = _addrSuggestionCache[Number(index)];
    if (!suggestion) {
      _showAddrSearchMessage('Sugestao indisponivel. Tente buscar novamente.');
      return;
    }
    try {
      if (suggestion.placePrediction) {
        // NEW Places API prediction object.
        _addrTempLoc = await _placePredictionToLocation(suggestion.placePrediction);
      } else if (suggestion.placeId) {
        // LEGACY prediction — resolve by placeId through the Geocoder.
        _addrTempLoc = await _legacyPlaceIdToLocation(suggestion.placeId);
      } else {
        throw new Error('Sugestao invalida.');
      }
      _addrAutocompleteSessionToken = null;
      closeModalImmediately('addrSearchModal');
      _openAddrDetailsForm(true);
    } catch (err) {
      console.warn('[PedeAqui] Failed to select address suggestion:', err);
      _showAddrSearchMessage(_mapPlacesError(err));
    }
  }
  function _parseAddrComponents(comps) {
    const get = (...types) => { for (const t of types) { const c = comps.find(x => x.types.includes(t)); if (c) return c.long_name; } return ''; };
    const route = get('route');
    const sNum  = get('street_number');
    return {
      street_name: route,
      number: sNum,
      street: route ? (sNum ? `${route}, ${sNum}` : route) : '',
      neighborhood: get('sublocality_level_1','sublocality','neighborhood','political'),
      city: get('administrative_area_level_2','locality'),
      state: get('administrative_area_level_1'),
      postal_code: get('postal_code')
    };
  }

  function adcUseGeoSearch(instant = false) {
    if (!navigator.geolocation) { alert('Geolocalizacao nao disponivel neste navegador.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        _addrTempLoc = { lat, lng, formatted_address:'', place_id:'', street_name:'', number:'', street:'', neighborhood:'', city:'', state:'', postal_code:'' };
        _loadGeocoder()
          .then(geocoder => {
            geocoder.geocode({ location:{ lat, lng } }, (results, status) => {
              if (status === 'OK' && results?.[0]) {
                _addrTempLoc = { lat, lng, formatted_address: results[0].formatted_address || '', place_id: results[0].place_id||'', ..._parseAddrComponents(results[0].address_components||[]) };
              }
              closeModalImmediately('addrSearchModal');
              if (instant) closeAddressEntryStackImmediately();
              _openAddrMapScreen(lat, lng, instant);
            });
          })
          .catch(err => {
            console.warn('[PedeAqui] Geocoder unavailable for current location:', err);
            closeModalImmediately('addrSearchModal');
            if (instant) closeAddressEntryStackImmediately();
            _openAddrMapScreen(lat, lng, instant);
          });
      },
      err => {
        console.warn('[PedeAqui] User location permission denied or unavailable:', err);
        alert('Nao foi possivel acessar sua localizacao. Digite seu endereco manualmente.');
      }
    );
  }

  function _openAddrMapScreen(lat, lng, instant = false) {
    if (instant) openModalImmediately('addrMapModal');
    else openModal('addrMapModal');
    _loadMapsLibrary()
      .then(() => setTimeout(() => _initAddrMap(lat, lng), 160))
      .catch(err => {
        console.warn('[PedeAqui] Maps library unavailable:', err);
        alert('Nao foi possivel carregar o mapa. Tente novamente.');
      });
  }
  function _initAddrMap(lat, lng) {
    if (!window.google) return;
    const el = $('addrMapContainer');
    if (!el) return;
    _addrMap = new google.maps.Map(el, { center:{lat,lng}, zoom:17, disableDefaultUI:true, zoomControl:true, gestureHandling:'greedy' });
    _addrMapMarker = new google.maps.Marker({ position:{lat,lng}, map:_addrMap, draggable:true, animation:google.maps.Animation.DROP });
    _addrMapMarker.addListener('dragend', () => {
      const p = _addrMapMarker.getPosition();
      if (_addrTempLoc) { _addrTempLoc.lat = p.lat(); _addrTempLoc.lng = p.lng(); }
    });
  }

  function confirmAddrMap() {
    if (!_addrTempLoc?.lat) return;
    if (_addrMapMarker) {
      const p = _addrMapMarker.getPosition();
      _addrTempLoc.lat = p.lat(); _addrTempLoc.lng = p.lng();
    }
    if (!_addrTempLoc.formatted_address) {
      _loadGeocoder()
        .then(geocoder => {
          geocoder.geocode({ location:{ lat:_addrTempLoc.lat, lng:_addrTempLoc.lng } }, (results, status) => {
            if (status === 'OK' && results?.[0]) {
              const parsed = _parseAddrComponents(results[0].address_components||[]);
              _addrTempLoc = { ..._addrTempLoc, formatted_address: results[0].formatted_address||'', ...parsed };
            }
            closeModalImmediately('addrMapModal');
            _openAddrDetailsForm(true);
          });
        })
        .catch(err => {
          console.warn('[PedeAqui] Reverse geocoding unavailable:', err);
          closeModalImmediately('addrMapModal');
          _openAddrDetailsForm(true);
        });
      return;
    }
    closeModalImmediately('addrMapModal');
    _openAddrDetailsForm(true);
  }

  function finishAddressDetails(address) {
    const savedAddress = {
      ...address,
      id: address.id || address.address_id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: address.label || address.alias || address.street || 'Endereco'
    };
    const localList = readLocalAddressList();
    writeLocalAddressList([savedAddress, ...localList.filter(item => addrPickerId(item, '') !== addrPickerId(savedAddress, ''))]);

    customerAddress = { ...savedAddress, summary: addressSummary(savedAddress) };
    localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(customerAddress));
    if (opDraft) opDraft.address = savedAddress;
    if (!opDraft && operationContext) { operationContext.address = savedAddress; persistOperationContext(); }
    _addrJustSavedAddress = savedAddress;
    renderWidget();
    updateCartUI();
    _returnToAddAddressChoice = false;
    closeModalImmediately('addrDetailsModal');
    closeModalImmediately('addrMapModal');
    closeModalImmediately('addrSearchModal');
    $('addrPickerModal')?.classList.add('no-motion');
    openAddrPicker();
    _addrPickerItems = mergeAddressPickerItems([currentPickerItem(savedAddress)], _addrPickerItems);
    _addrPickerSelected = addrPickerId(savedAddress);
    _renderAddrPickerList();
    if ($('operationModal')?.classList.contains('active')) renderOperationScreen();

    const auth = window.PedeAquiCustomerAuth;
    if (auth?.isLoggedIn() && typeof auth.createCustomerAddress === 'function') {
      const { id, address_id, summary, ...addressPayload } = savedAddress;
      auth.createCustomerAddress(addressPayload)
        .then(res => {
          const created = res?.data || res;
          if (!created || typeof created !== 'object') return;
          const updated = {
            ...savedAddress,
            ...created,
            id: created.id || created.address_id || savedAddress.id,
            label: created.label || created.alias || savedAddress.label
          };
          writeLocalAddressList(readLocalAddressList().map(item => (
            addrPickerId(item, '') === addrPickerId(savedAddress, '') ? updated : item
          )));
          if (_addrPickerSelected === addrPickerId(savedAddress)) _addrPickerSelected = addrPickerId(updated);
          _addrPickerItems = _addrPickerItems.map(item => (
            addrPickerId(item, '') === addrPickerId(savedAddress, '') ? updated : item
          ));
          if (sameAddress(customerAddress, savedAddress)) {
            customerAddress = { ...updated, summary: addressSummary(updated) };
            localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(customerAddress));
            if (opDraft) opDraft.address = updated;
          }
          _addrJustSavedAddress = updated;
          _renderAddrPickerList();
        })
        .catch(() => {});
    }
  }

  function _openAddrDetailsForm(instant = false) {
    const loc = _addrTempLoc || {};
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const setDis = (id, v) => { const el = $(id); if (el) { el.value = v; el.disabled = false; } };
    setDis('addrDetStreet', loc.street_name || loc.street || '');
    setDis('addrDetNumber', loc.number || '');
    set('addrDetNeighborhood', loc.neighborhood || '');
    set('addrDetCep', loc.postal_code ? _fmtCep(loc.postal_code) : '');
    set('addrDetComplement', '');
    set('addrDetReference', '');
    const noNum = $('addrDetNoNumber');
    if (noNum) noNum.checked = false;
    const titleStreet = loc.street_name || String(loc.street || '').replace(/,\s*[^,]+$/, '');
    const titleNumber = String(loc.number || '').trim();
    const titleHasNumber = titleNumber && new RegExp(`(^|\\D)${titleNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(titleStreet);
    const title = titleStreet
      ? `${titleStreet}${titleNumber && !titleHasNumber ? `, ${titleNumber}` : ''}`
      : loc.formatted_address || 'Endereco';
    const sub = [loc.neighborhood, loc.city, loc.state].filter(Boolean).join(', ');
    const titleEl = $('addrDetLocationTitle');
    const subEl = $('addrDetLocationSub');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub || loc.formatted_address || '';
    validateAddrDetails();
    if (instant) openModalImmediately('addrDetailsModal');
    else openModal('addrDetailsModal');
    _loadMapsLibrary()
      .then(() => setTimeout(_initAddrDetailsMiniMap, 160))
      .catch(err => console.warn('[PedeAqui] Mini map unavailable:', err));
  }

  function _initAddrDetailsMiniMap() {
    if (!window.google || !_addrTempLoc?.lat) return;
    const el = $('addrDetailsMiniMap');
    if (!el) return;
    const map = new google.maps.Map(el, { center:{lat:_addrTempLoc.lat,lng:_addrTempLoc.lng}, zoom:16, disableDefaultUI:true, gestureHandling:'none', clickableIcons:false });
    new google.maps.Marker({ position:{lat:_addrTempLoc.lat,lng:_addrTempLoc.lng}, map });
  }

  function _fmtCep(cep) {
    const d = String(cep).replace(/\D/g,'');
    return d.length === 8 ? d.replace(/(\d{5})(\d{3})/,'$1-$2') : cep;
  }

  function maskCep(el) {
    let v = el.value.replace(/\D/g,'').slice(0,8);
    if (v.length > 5) v = v.slice(0,5) + '-' + v.slice(5);
    el.value = v;
  }

  function toggleAddrNoNumber() {
    const noNum = $('addrDetNoNumber');
    const numEl = $('addrDetNumber');
    if (!noNum || !numEl) return;
    if (noNum.checked) { numEl.value = 's/n'; numEl.disabled = true; }
    else { numEl.value = ''; numEl.disabled = false; }
    validateAddrDetails();
  }

  function validateAddrDetails() {
    const v = id => ($( id)||{}).value?.trim()||'';
    const street = v('addrDetStreet');
    const number = v('addrDetNumber');
    const neighborhood = v('addrDetNeighborhood');
    const noNum = $('addrDetNoNumber')?.checked;
    const btn = $('addrDetSaveBtn');
    if (btn) btn.disabled = !(street && (number || noNum) && neighborhood);
  }

  function saveAddressDetails() {
    const v = id => ($(id)||{}).value?.trim()||'';
    const street       = v('addrDetStreet');
    const rawNum       = v('addrDetNumber');
    const noNum        = $('addrDetNoNumber')?.checked;
    const number       = noNum ? 's/n' : rawNum;
    const neighborhood = v('addrDetNeighborhood');
    const complement   = v('addrDetComplement');
    const reference    = v('addrDetReference');
    const alias        = v('addrDetAlias');
    const postal_code  = v('addrDetCep').replace(/\D/g,'');
    if (!street || (!number && !noNum) || !neighborhood) { alert('Preencha os campos obrigatórios.'); return; }
    const loc = _addrTempLoc || {};
    const address = { street, number, neighborhood, complement, reference, alias, label: alias || street, postal_code,
      formatted_address: loc.formatted_address || `${street}, ${number} - ${neighborhood}`,
      latitude: loc.lat || null, longitude: loc.lng || null, place_id: loc.place_id || '' };
    finishAddressDetails(address);
  }

  // ── end Google Maps address flow ──

  let _loginOrigin = 'profile';

  function openLoginScreen(origin = 'profile') {
    _loginOrigin = origin;
    $('loginModal')?.classList.toggle('from-add-address', origin === 'address');
    $('loginModal')?.classList.toggle('from-coupon', origin === 'coupon');
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

  /* ---------- Register screen ("Cadastre-se") ---------- */

  function openRegisterScreen() {
    closeModalId('loginModal');
    $('registerScreen')?.classList.add('active');
    lockBodyScroll();
    $('registerForm')?.scrollTo?.(0, 0);
    clearAllRegErrors();
  }

  function closeRegisterScreen() {
    $('registerScreen')?.classList.remove('active');
    // Return to the login sheet the user came from.
    openModalImmediately('loginModal');
  }

  function maskRegPhone(el) {
    const d = onlyDigits(el.value).slice(0, 11);
    let out = '';
    if (d.length) out = '(' + d.slice(0, 2);
    if (d.length >= 2) out += ') ';
    if (d.length >= 3) out += d.slice(2, 3);
    if (d.length >= 4) out += ' ' + d.slice(3, 7);
    if (d.length >= 8) out += '-' + d.slice(7, 11);
    el.value = out;
  }

  function maskRegCpf(el) {
    const d = onlyDigits(el.value).slice(0, 11);
    let out = d.slice(0, 3);
    if (d.length >= 4) out += '.' + d.slice(3, 6);
    if (d.length >= 7) out += '.' + d.slice(6, 9);
    if (d.length >= 10) out += '-' + d.slice(9, 11);
    el.value = out;
  }

  function maskRegBirth(el) {
    const d = onlyDigits(el.value).slice(0, 8);
    let out = d.slice(0, 2);
    if (d.length >= 3) out += '/' + d.slice(2, 4);
    if (d.length >= 5) out += '/' + d.slice(4, 8);
    el.value = out;
  }

  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

  function toggleRegPassword(inputId, btn) {
    const input = $(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OPEN_SVG : EYE_OFF_SVG;
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  }

  function isValidCpf(digits) {
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
    let d1 = (sum * 10) % 11;
    if (d1 === 10) d1 = 0;
    if (d1 !== parseInt(digits[9], 10)) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
    let d2 = (sum * 10) % 11;
    if (d2 === 10) d2 = 0;
    return d2 === parseInt(digits[10], 10);
  }

  function isValidBirthDate(value) {
    const d = onlyDigits(value);
    if (d.length !== 8) return false;
    const day = +d.slice(0, 2);
    const month = +d.slice(2, 4);
    const year = +d.slice(4, 8);
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return false;
    return year >= 1900 && dt <= new Date();
  }

  // Field-level validators. Each returns '' when valid or an error message.
  const REG_FIELDS = [
    { id: 'regFullName', err: 'regFullNameErr', validate(v) {
      // No strict validation — any non-empty value is accepted.
      if (!(v || '').trim()) return 'Campo obrigatório';
      return '';
    } },
    { id: 'regEmail', err: 'regEmailErr', validate(v) {
      const s = (v || '').trim();
      if (!s) return 'Campo obrigatório';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'Email inválido';
      return '';
    } },
    { id: 'regPhone', err: 'regPhoneErr', validate(v) {
      const d = onlyDigits(v);
      if (!d) return 'Campo obrigatório';
      if (d.length < 10 || d.length > 11) return 'Informe o telefone completo';
      return '';
    } },
    { id: 'regBirth', err: 'regBirthErr', validate(v) {
      if (!onlyDigits(v)) return 'Campo obrigatório';
      if (!isValidBirthDate(v)) return 'O formato deve ser DD/MM/AAAA';
      return '';
    } },
    { id: 'regCpf', err: 'regCpfErr', validate(v) {
      const d = onlyDigits(v);
      if (!d) return 'Campo obrigatório';
      if (!isValidCpf(d)) return 'CPF inválido';
      return '';
    } },
    { id: 'regPassword', err: 'regPasswordErr', validate(v) {
      if (!v) return 'Campo obrigatório';
      if (v.length < 8) return 'Informe ao menos 8 caracteres';
      return '';
    } },
    { id: 'regPasswordConfirm', err: 'regPasswordConfirmErr', validate(v) {
      if (!v) return 'Campo obrigatório';
      if (v !== ($('regPassword')?.value || '')) return 'As senhas não coincidem';
      return '';
    } }
  ];

  function showRegError(errId, msg) {
    const e = $(errId);
    if (e) { e.textContent = msg; e.classList.add('show'); }
  }
  function hideRegError(errId) {
    const e = $(errId);
    if (e) { e.textContent = ''; e.classList.remove('show'); }
  }
  function setRegFieldError(def, msg) {
    $(def.id)?.closest('.reg-field')?.classList.add('reg-field--error');
    showRegError(def.err, msg);
  }
  function clearRegFieldError(def) {
    $(def.id)?.closest('.reg-field')?.classList.remove('reg-field--error');
    hideRegError(def.err);
  }

  // Tracks which fields the user has interacted with, so errors only show
  // after a field has been touched/edited (or after submit).
  const regTouched = new Set();

  let _regSummaryTimer = null;
  function showRegSummary(message) {
    const el = $('regSummary');
    if (!el) return;
    // The summary holds an icon span + a message span; update the message text.
    const msgSpan = el.querySelector('span:last-child');
    if (msgSpan) msgSpan.textContent = message || 'Preencha todos os campos';
    if (_regSummaryTimer) { clearTimeout(_regSummaryTimer); _regSummaryTimer = null; }
    el.classList.remove('hiding');
    el.classList.add('show');
    _regSummaryTimer = setTimeout(() => hideRegSummary(), 5000);
  }
  function hideRegSummary(immediate) {
    const el = $('regSummary');
    if (!el) return;
    if (_regSummaryTimer) { clearTimeout(_regSummaryTimer); _regSummaryTimer = null; }
    if (immediate || !el.classList.contains('show')) {
      el.classList.remove('show', 'hiding'); return;
    }
    el.classList.add('hiding');
    setTimeout(() => el.classList.remove('show', 'hiding'), 320);
  }

  function clearAllRegErrors() {
    document.querySelectorAll('#registerScreen .reg-field--error').forEach(el => el.classList.remove('reg-field--error'));
    document.querySelectorAll('#registerScreen .reg-error').forEach(el => { el.textContent = ''; el.classList.remove('show'); });
    hideRegSummary(true);
    regTouched.clear();
  }

  // Hide the generic summary once no field/checkbox is flagged anymore.
  function maybeHideRegSummary() {
    const anyError = document.querySelector('#registerScreen .reg-field--error');
    if (!anyError) hideRegSummary();
  }

  // Validate a single touched field and show/clear only its own error.
  function validateRegField(id) {
    const def = REG_FIELDS.find(f => f.id === id);
    if (!def || !regTouched.has(id)) return;
    const msg = def.validate($(id)?.value);
    if (msg) setRegFieldError(def, msg);
    else clearRegFieldError(def);
  }

  // Real-time validation: mark the field touched, validate it live, and keep
  // the confirm-password field in sync when the password changes.
  function handleRegFieldInput(id) {
    regTouched.add(id);
    validateRegField(id);
    if (id === 'regPassword' && regTouched.has('regPasswordConfirm')) {
      validateRegField('regPasswordConfirm');
    }
    maybeHideRegSummary();
  }

  // Validate on blur (the field counts as touched once it loses focus).
  function handleRegFieldBlur(id) {
    regTouched.add(id);
    validateRegField(id);
    maybeHideRegSummary();
  }

  function handleRegPrivacyInput() {
    regTouched.add('regPrivacy');
    const privacy = $('regPrivacy');
    hideRegError('regPrivacyErr');
    maybeHideRegSummary();
  }

  // Validate every field, render errors, and return the first invalid element.
  function runRegisterValidation() {
    let firstInvalid = null;
    REG_FIELDS.forEach(def => {
      const input = $(def.id);
      if (!input) return;
      regTouched.add(def.id);
      const msg = def.validate(input.value);
      if (msg) {
        setRegFieldError(def, msg);
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearRegFieldError(def);
      }
    });
    const privacy = $('regPrivacy');
    regTouched.add('regPrivacy');
    hideRegError('regPrivacyErr');
    if (privacy && !privacy.checked) {
      if (!firstInvalid) firstInvalid = privacy;
    }
    if (firstInvalid) showRegSummary(); else hideRegSummary();
    return firstInvalid;
  }

  // Build the API payload: digits-only phone/CPF and DD/MM/YYYY -> YYYY-MM-DD.
  function buildRegisterPayload() {
    const birth = onlyDigits($('regBirth').value); // DDMMYYYY
    const birth_date = `${birth.slice(4, 8)}-${birth.slice(2, 4)}-${birth.slice(0, 2)}`;
    return {
      name: ($('regFullName').value || '').trim(),
      email: ($('regEmail').value || '').trim(),
      phone: onlyDigits($('regPhone').value),
      birth_date,
      cpf: onlyDigits($('regCpf').value),
      password: $('regPassword').value || '',
      marketing_opt_in: Boolean($('regPromo')?.checked),
      privacy_accepted: Boolean($('regPrivacy')?.checked)
    };
  }

  function regFieldDef(id) {
    return REG_FIELDS.find(f => f.id === id);
  }
  function showRegFieldApiError(fieldId, msg) {
    const def = regFieldDef(fieldId);
    if (def) { setRegFieldError(def, msg); return true; }
    return false;
  }

  // Map backend register errors onto the right fields (or the form summary).
  function applyRegisterApiError(error) {
    const data = error?.data;
    let handled = false;

    // FastAPI-style validation array: [{ loc: ['body','email'], msg }]
    if (Array.isArray(data?.detail)) {
      const map = { name: 'regFullName', email: 'regEmail', phone: 'regPhone', birth_date: 'regBirth', cpf: 'regCpf', password: 'regPassword' };
      data.detail.forEach(item => {
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : '';
        if (map[field] && showRegFieldApiError(map[field], item.msg || 'Valor inválido')) handled = true;
      });
      if (handled) { showRegSummary('Revise os campos destacados'); return; }
    }

    const raw = String(error?.message || data?.detail || data?.message || '');
    const msg = raw.toLowerCase();
    const dup = /(already|já|ja |cadastrad|registr|exist|in use|em uso|duplicad)/.test(msg);

    if ((msg.includes('email') || msg.includes('e-mail')) && dup) {
      showRegFieldApiError('regEmail', 'Este e-mail já está cadastrado'); handled = true;
    } else if ((msg.includes('phone') || msg.includes('telefone') || msg.includes('celular')) && dup) {
      showRegFieldApiError('regPhone', 'Este telefone já está cadastrado'); handled = true;
    } else if (msg.includes('cpf') && dup) {
      showRegFieldApiError('regCpf', 'Este CPF já está cadastrado'); handled = true;
    } else if (msg.includes('cpf')) {
      showRegFieldApiError('regCpf', 'CPF inválido'); handled = true;
    } else if (msg.includes('password') || msg.includes('senha')) {
      showRegFieldApiError('regPassword', raw || 'Senha inválida'); handled = true;
    } else if (msg.includes('privacy') || msg.includes('privacidade')) {
      showRegError('regPrivacyErr', 'É necessário aceitar a política de privacidade');
      handled = true;
    }

    showRegSummary(handled ? 'Revise os campos destacados' : (raw || 'Não foi possível concluir o cadastro.'));
  }

  let _registerSubmitting = false;
  async function submitRegister(event) {
    if (event) event.preventDefault();
    const firstInvalid = runRegisterValidation();
    if (firstInvalid) {
      const target = firstInvalid.closest('.reg-field') || firstInvalid.closest('.reg-check') || firstInvalid;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus({ preventScroll: true });
      return;
    }
    if (_registerSubmitting) return;
    _registerSubmitting = true;
    const btn = $('regSubmitBtn');
    const restore = () => { _registerSubmitting = false; if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); } };
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    try {
      const reg = buildRegisterPayload();
      const res = await window.PedeAquiCustomerAuth.registerCustomer(reg);
      // Do not auto-login. Move the user to e-mail verification.
      const email = res?.email || reg.email;
      restore();
      openVerifyScreen({ email, source: 'register', customer: { name: reg.name, email: reg.email, phone: reg.phone } });
    } catch (error) {
      applyRegisterApiError(error);
      restore();
    }
  }

  /* ---------- Code verification screen (e-mail verify + password reset) ---------- */

  let verifyCtx = { email: '', source: 'register', customer: null };
  let _vfyTimer = null;
  let _vfyRemaining = 0;
  let _vfySubmitting = false;
  const VFY_RESEND_SECONDS = 60;

  // 'cliente@email.com' -> 'c***@email.com'
  function maskEmail(email) {
    const s = String(email || '');
    const at = s.indexOf('@');
    if (at <= 0) return s;
    return `${s.slice(0, 1)}***${s.slice(at)}`;
  }

  const vfyDigits = () => Array.from(document.querySelectorAll('#vfyCode .vfy-digit'));
  const getVfyCode = () => vfyDigits().map(i => i.value).join('');

  function updateVfySubmitState() {
    const btn = $('vfySubmitBtn');
    if (btn) btn.disabled = getVfyCode().length !== 6;
  }
  function clearVfyInputs() {
    vfyDigits().forEach(i => { i.value = ''; i.classList.remove('filled'); });
    $('verifyScreen')?.classList.remove('vfy-error');
    updateVfySubmitState();
  }
  function showVfyMsg(msg, type) {
    const el = $('vfyMsg');
    if (!el) return;
    const textEl = el.querySelector('.vfy-msg-text') || el;
    textEl.textContent = msg || '';
    el.classList.remove('is-error', 'is-success', 'show');
    if (msg) el.classList.add('show', type === 'success' ? 'is-success' : 'is-error');
  }

  function openVerifyScreen(ctx) {
    verifyCtx = {
      email: ctx?.email || '',
      source: ctx?.source || 'register',
      customer: ctx?.customer || null
    };
    const isReset = verifyCtx.source === 'reset';
    const titleText = isReset ? 'Recuperar senha' : 'Validação de e-mail';
    if ($('vfyHeaderTitle')) $('vfyHeaderTitle').textContent = titleText;
    if ($('vfyText')) {
      $('vfyText').innerHTML = `Nós enviamos um código de 6 dígitos para <strong>${esc(maskEmail(verifyCtx.email))}</strong>. O código expira em alguns minutos, insira o código abaixo:`;
    }
    showVfyMsg('');
    clearVfyInputs();
    $('registerScreen')?.classList.remove('active');
    $('loginScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('verifyScreen')?.classList.add('active');
    lockBodyScroll();
    startVfyTimer();
    setTimeout(() => vfyDigits()[0]?.focus(), 60);
  }

  function closeVerifyScreen() {
    stopVfyTimer();
    $('verifyScreen')?.classList.remove('active');
    // Return to a sensible previous screen.
    if (verifyCtx.source === 'register') $('registerScreen')?.classList.add('active');
    else openModal('loginModal');
  }

  function handleVfyInput(el, index) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    el.classList.toggle('filled', Boolean(el.value));
    $('verifyScreen')?.classList.remove('vfy-error');
    showVfyMsg('');
    if (el.value && index < 5) vfyDigits()[index + 1]?.focus();
    updateVfySubmitState();
  }

  function handleVfyKeydown(event, index) {
    const inputs = vfyDigits();
    if (event.key === 'Backspace') {
      if (!inputs[index].value && index > 0) {
        const prev = inputs[index - 1];
        prev.focus();
        prev.value = '';
        prev.classList.remove('filled');
        event.preventDefault();
        updateVfySubmitState();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      inputs[index - 1].focus(); event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < 5) {
      inputs[index + 1].focus(); event.preventDefault();
    }
  }

  function handleVfyPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const digits = text.replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const inputs = vfyDigits();
    inputs.forEach((inp, i) => {
      inp.value = digits[i] || '';
      inp.classList.toggle('filled', Boolean(digits[i]));
    });
    inputs[Math.min(digits.length, 5)]?.focus();
    updateVfySubmitState();
  }

  function renderVfyTimer() {
    const btn = $('vfyResend');
    const hint = $('vfyResendHint');
    if (!btn) return;
    if (_vfyRemaining > 0) {
      const mm = String(Math.floor(_vfyRemaining / 60)).padStart(2, '0');
      const ss = String(_vfyRemaining % 60).padStart(2, '0');
      btn.textContent = `Reenviar código em ${mm}:${ss}`;
      if (hint) hint.style.display = 'none';
    } else {
      btn.textContent = 'Reenviar código';
      if (hint) hint.style.display = '';
    }
  }
  function stopVfyTimer() {
    if (_vfyTimer) { clearInterval(_vfyTimer); _vfyTimer = null; }
  }
  function startVfyTimer() {
    stopVfyTimer();
    _vfyRemaining = VFY_RESEND_SECONDS;
    const btn = $('vfyResend');
    if (btn) btn.disabled = true;
    renderVfyTimer();
    _vfyTimer = setInterval(() => {
      _vfyRemaining -= 1;
      if (_vfyRemaining <= 0) {
        stopVfyTimer();
        if (btn) btn.disabled = false;
      }
      renderVfyTimer();
    }, 1000);
  }

  async function resendVfyCode() {
    const btn = $('vfyResend');
    if (btn?.disabled) return; // respect the running timer (no endpoint spam)
    try {
      if (verifyCtx.source === 'reset') {
        await window.PedeAquiCustomerAuth.forgotPassword({ email: verifyCtx.email });
      } else {
        await window.PedeAquiCustomerAuth.resendEmailCode({ email: verifyCtx.email });
      }
      // Sem mensagem de confirmação — apenas reinicia o timer.
      showVfyMsg('');
    } catch (error) {
      showVfyMsg(error?.message || 'Não foi possível reenviar o código.', 'error');
    }
    startVfyTimer();
  }

  async function submitVerify(event) {
    if (event) event.preventDefault();
    const code = getVfyCode();
    if (code.length !== 6) { updateVfySubmitState(); return; }
    if (_vfySubmitting) return;
    _vfySubmitting = true;
    const btn = $('vfySubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Validando...'; }
    try {
      if (verifyCtx.source === 'reset') {
        const res = await window.PedeAquiCustomerAuth.verifyResetCode({ email: verifyCtx.email, code });
        stopVfyTimer();
        $('verifyScreen')?.classList.remove('active');
        openResetPasswordScreen(res?.reset_token, verifyCtx.email);
      } else {
        const res = await window.PedeAquiCustomerAuth.verifyEmailCode({ email: verifyCtx.email, code });
        stopVfyTimer();
        const fallbackCustomer = verifyCtx.customer || { email: verifyCtx.email };
        const verifiedCustomer = customerFromAuthResponse(res, fallbackCustomer);
        const accessToken = tokenFromAuthResponse(res);
        if (accessToken) applyLoggedSession(accessToken, verifiedCustomer);
        else if (verifiedCustomer?.name || verifyCtx.source === 'register') applyLocalCustomer(verifiedCustomer);
        $('verifyScreen')?.classList.remove('active');
        goToInitialScreenAfterAuth();
      }
    } catch (error) {
      $('verifyScreen')?.classList.add('vfy-error');
      showVfyMsg('O código de verificação é inválido ou expirou!', 'error');
    } finally {
      _vfySubmitting = false;
      if (btn) btn.textContent = 'Validar código';
      updateVfySubmitState();
    }
  }

  /* ---------- New password screen (password reset step 3) ---------- */

  let resetPwCtx = { reset_token: '', email: '' };
  let _resetSubmitting = false;

  function openResetPasswordScreen(resetToken, email) {
    resetPwCtx = { reset_token: resetToken || '', email: email || '' };
    if ($('resetNewPw')) $('resetNewPw').value = '';
    if ($('resetConfirmPw')) $('resetConfirmPw').value = '';
    hideResetPwErr();
    $('resetPasswordScreen')?.classList.add('active');
    lockBodyScroll();
    setTimeout(() => $('resetNewPw')?.focus(), 60);
  }
  function closeResetPasswordScreen() {
    $('resetPasswordScreen')?.classList.remove('active');
    openModal('loginModal');
  }
  // Per-field error below each password input (same style as the register form).
  function showResetFieldErr(fieldId, errId, msg) {
    const e = $(errId);
    if (e) { e.textContent = msg; e.classList.add('show'); }
    $(fieldId)?.closest('.vfy-field')?.classList.add('vfy-field--error');
  }
  function hideResetPwErr() {
    [['resetNewPw', 'resetNewPwErr'], ['resetConfirmPw', 'resetConfirmPwErr']].forEach(([fieldId, errId]) => {
      const e = $(errId);
      if (e) { e.textContent = ''; e.classList.remove('show'); }
      $(fieldId)?.closest('.vfy-field')?.classList.remove('vfy-field--error');
    });
  }
  function handleResetPwInput() { hideResetPwErr(); }

  async function submitResetPassword(event) {
    if (event) event.preventDefault();
    const np = $('resetNewPw')?.value || '';
    const cp = $('resetConfirmPw')?.value || '';
    hideResetPwErr();
    if (np.length < 8) { showResetFieldErr('resetNewPw', 'resetNewPwErr', 'Informe ao menos 8 caracteres'); return; }
    if (np !== cp) { showResetFieldErr('resetConfirmPw', 'resetConfirmPwErr', 'As senhas não coincidem'); return; }
    if (_resetSubmitting) return;
    _resetSubmitting = true;
    const btn = $('resetPwSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      await window.PedeAquiCustomerAuth.resetPassword({ reset_token: resetPwCtx.reset_token, new_password: np, confirm_password: cp });
      const email = resetPwCtx.email;
      showVfyMsg('');
      openVfyAlert('Senha alterada com sucesso!', () => {
        $('resetPasswordScreen')?.classList.remove('active');
        openSigninScreen();
        if ($('loginEmail')) $('loginEmail').value = email;
        $('loginEmail')?.focus();
      }, 'Ok');
    } catch (error) {
      showResetFieldErr('resetConfirmPw', 'resetConfirmPwErr', error?.message || 'Não foi possível redefinir a senha.');
    } finally {
      _resetSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
    }
  }

  /* ---------- Login screen ("Entrar") ---------- */

  // Field-level validators for the sign-in form (same pattern as register).
  const LOGIN_FIELDS = [
    { id: 'loginEmail', err: 'loginEmailErr', validate(v) {
      const s = (v || '').trim();
      if (!s) return 'Campo obrigatório';
      // Accept either a valid e-mail or a phone number (the field allows both).
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
      const isPhone = /^\d{10,11}$/.test(onlyDigits(s));
      if (!isEmail && !isPhone) return 'Informe um e-mail ou telefone válido';
      return '';
    } },
    { id: 'loginPassword', err: 'loginPasswordErr', validate(v) {
      if (!v) return 'Campo obrigatório';
      if (v.length < 8) return 'Informe ao menos 8 caracteres';
      return '';
    } }
  ];

  const loginTouched = new Set();

  function setLgnFieldError(def, msg) {
    $(def.id)?.closest('.lgn-field')?.classList.add('lgn-field--error');
    const e = $(def.err);
    if (e) { e.textContent = msg; e.classList.add('show'); }
  }
  function clearLgnFieldError(def) {
    $(def.id)?.closest('.lgn-field')?.classList.remove('lgn-field--error');
    const e = $(def.err);
    if (e) { e.textContent = ''; e.classList.remove('show'); }
  }
  function clearAllLoginErrors() {
    LOGIN_FIELDS.forEach(clearLgnFieldError);
    hideLgnSummary(true);
    loginTouched.clear();
  }

  let _lgnSummaryTimer = null;
  function showLgnSummary(message) {
    const el = $('lgnSummary');
    if (!el) return;
    const msgSpan = el.querySelector('span:last-child');
    if (msgSpan) msgSpan.textContent = message || 'Dados de login incorretos. Verifique suas informações.';
    if (_lgnSummaryTimer) { clearTimeout(_lgnSummaryTimer); _lgnSummaryTimer = null; }
    el.classList.remove('hiding');
    el.classList.add('show');
    _lgnSummaryTimer = setTimeout(() => hideLgnSummary(), 5000);
  }
  function hideLgnSummary(immediate) {
    const el = $('lgnSummary');
    if (!el) return;
    if (_lgnSummaryTimer) { clearTimeout(_lgnSummaryTimer); _lgnSummaryTimer = null; }
    if (immediate || !el.classList.contains('show')) {
      el.classList.remove('show', 'hiding'); return;
    }
    el.classList.add('hiding');
    setTimeout(() => el.classList.remove('show', 'hiding'), 320);
  }
  function validateLoginField(id) {
    const def = LOGIN_FIELDS.find(f => f.id === id);
    if (!def || !loginTouched.has(id)) return;
    const msg = def.validate($(id)?.value);
    if (msg) setLgnFieldError(def, msg);
    else clearLgnFieldError(def);
  }
  function handleLoginFieldInput(id) {
    loginTouched.add(id);
    validateLoginField(id);
  }
  function handleLoginFieldBlur(id) {
    loginTouched.add(id);
    validateLoginField(id);
  }

  function openSigninScreen() {
    $('loginModal')?.classList.add('signin-open');
    $('loginScreen')?.classList.add('active');
    lockBodyScroll();
    $('loginForm')?.scrollTo?.(0, 0);
    clearAllLoginErrors();
  }

  function closeSigninScreen() {
    $('loginScreen')?.classList.remove('active');
    $('loginModal')?.classList.remove('signin-open');
  }

  const isEmailValue = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

  /* ---------- Forgot password — step 1: dedicated "Redefina sua senha" screen ---------- */

  let _forgotSubmitting = false;

  // Open the recovery screen. Never auto-fill from the login form — the screen
  // always asks for the e-mail on its own page (an empty login field is fine).
  function loginForgotPassword() {
    openForgotPasswordScreen();
  }

  function openForgotPasswordScreen() {
    if ($('forgotEmail')) $('forgotEmail').value = '';
    hideForgotEmailErr();
    $('loginScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('forgotPasswordScreen')?.classList.add('active');
    lockBodyScroll();
    setTimeout(() => $('forgotEmail')?.focus(), 60);
  }

  function closeForgotPasswordScreen() {
    $('forgotPasswordScreen')?.classList.remove('active');
    openModal('loginModal');
  }

  function showForgotEmailErr(msg) {
    const el = $('forgotEmailErr');
    if (el) { el.textContent = msg; el.classList.add('show'); }
    $('forgotEmail')?.closest('.vfy-field')?.classList.add('vfy-field--error');
  }
  function hideForgotEmailErr() {
    const el = $('forgotEmailErr');
    if (el) { el.textContent = ''; el.classList.remove('show'); }
    $('forgotEmail')?.closest('.vfy-field')?.classList.remove('vfy-field--error');
  }
  function handleForgotEmailInput() { hideForgotEmailErr(); }

  let _vfyAlertAfterClose = null;

  // Card alert reused by password-recovery screens.
  function openVfyAlert(message, afterClose, buttonLabel = 'Tentar novamente') {
    const modal = $('forgotNotFoundModal');
    if (!modal) return;
    const title = $('forgotNotFoundTitle');
    if (title) title.textContent = message || 'Não foi possível continuar';
    const button = modal.querySelector('.vfy-alert-btn');
    if (button) button.textContent = buttonLabel;
    _vfyAlertAfterClose = typeof afterClose === 'function' ? afterClose : null;
    modal.classList.remove('closing');
    modal.classList.add('active');
    lockBodyScroll();
  }

  // Card shown when the backend says the e-mail isn't registered.
  function openForgotNotFound() {
    openVfyAlert('E-mail não encontrado', () => $('forgotEmail')?.focus());
  }
  let _forgotNotFoundClosing = false;
  function closeForgotNotFound(event) {
    // When triggered from the overlay backdrop, ignore clicks on the card.
    if (event && event.target !== event.currentTarget) return;
    const modal = $('forgotNotFoundModal');
    if (!modal || !modal.classList.contains('active') || _forgotNotFoundClosing) return;
    // Play the slide-up/fade-out animation, then hide and return focus.
    _forgotNotFoundClosing = true;
    modal.classList.add('closing');
    setTimeout(() => {
      modal.classList.remove('active', 'closing');
      _forgotNotFoundClosing = false;
      const afterClose = _vfyAlertAfterClose;
      _vfyAlertAfterClose = null;
      if (afterClose) afterClose();
      unlockBodyScrollIfClear();
    }, 220);
  }

  async function submitForgotPassword(event) {
    if (event) event.preventDefault();
    const email = ($('forgotEmail')?.value || '').trim();
    // Client-side format check → inline error (does not call the backend).
    if (!email) { showForgotEmailErr('E-mail inválido'); return; }
    if (!isEmailValue(email)) { showForgotEmailErr('E-mail inválido'); return; }
    if (_forgotSubmitting) return;
    _forgotSubmitting = true;
    const btn = $('forgotSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
    try {
      // Backend verifies the e-mail exists. Success → advance to the code screen.
      await window.PedeAquiCustomerAuth.forgotPassword({ email });
      $('forgotPasswordScreen')?.classList.remove('active');
      openRecoverCodeScreen(email);
    } catch (error) {
      const detail = String(error?.data?.detail || error?.message || '').toLowerCase();
      const notFound = error?.status === 404 || /não encontrad|nao encontrad|not found/.test(detail);
      if (notFound) {
        // E-mail not registered → show the "not found" card.
        openForgotNotFound();
      } else {
        // Other failures (network/server) → inline message, keep the user here.
        showForgotEmailErr('Não foi possível enviar o código. Tente novamente.');
      }
    } finally {
      _forgotSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Continuar'; }
    }
  }

  /* ---------- Recover password — code step (own screen) ---------- */

  let recoverCtx = { email: '' };
  let _recSubmitting = false;
  let _recResendCooldown = false;

  const recDigits = () => Array.from(document.querySelectorAll('#recCode .vfy-digit'));
  const getRecCode = () => recDigits().map(i => i.value).join('');

  function updateRecSubmitState() {
    const btn = $('recSubmitBtn');
    if (btn) btn.disabled = getRecCode().length !== 6;
  }
  function clearRecInputs() {
    recDigits().forEach(i => { i.value = ''; i.classList.remove('filled'); });
    showRecMsg('');
    updateRecSubmitState();
  }
  function showRecMsg(msg, type) {
    const el = $('recMsg');
    if (!el) return;
    const textEl = el.querySelector('.vfy-msg-text') || el;
    textEl.textContent = msg || '';
    el.classList.remove('is-error', 'is-success', 'show');
    if (msg) el.classList.add('show', type === 'success' ? 'is-success' : 'is-error');
  }

  function openRecoverCodeScreen(email) {
    recoverCtx = { email: email || '' };
    if ($('recEmailText')) {
      $('recEmailText').innerHTML = `Um código foi enviado para o email <strong>${esc(recoverCtx.email)}</strong>.`;
    }
    clearRecInputs();
    $('forgotPasswordScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('recoverCodeScreen')?.classList.add('active');
    lockBodyScroll();
    setTimeout(() => recDigits()[0]?.focus(), 60);
  }

  function closeRecoverCodeScreen() {
    $('recoverCodeScreen')?.classList.remove('active');
    openForgotPasswordScreen();
  }

  function handleRecInput(el, index) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    el.classList.toggle('filled', Boolean(el.value));
    showRecMsg('');
    if (el.value && index < 5) recDigits()[index + 1]?.focus();
    updateRecSubmitState();
  }

  function handleRecKeydown(event, index) {
    const inputs = recDigits();
    if (event.key === 'Backspace') {
      if (!inputs[index].value && index > 0) {
        const prev = inputs[index - 1];
        prev.focus();
        prev.value = '';
        prev.classList.remove('filled');
        event.preventDefault();
        updateRecSubmitState();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      inputs[index - 1].focus(); event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < 5) {
      inputs[index + 1].focus(); event.preventDefault();
    }
  }

  function handleRecPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData)?.getData('text') || '';
    const digits = text.replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const inputs = recDigits();
    inputs.forEach((inp, i) => {
      inp.value = digits[i] || '';
      inp.classList.toggle('filled', Boolean(digits[i]));
    });
    inputs[Math.min(digits.length, 5)]?.focus();
    updateRecSubmitState();
  }

  async function resendRecoverCode() {
    if (_recResendCooldown) return;
    _recResendCooldown = true;
    setTimeout(() => { _recResendCooldown = false; }, 30000);
    try {
      await window.PedeAquiCustomerAuth.forgotPassword({ email: recoverCtx.email });
      showRecMsg('');
    } catch (error) {
      showRecMsg('Não foi possível reenviar o código.', 'error');
      _recResendCooldown = false;
    }
  }

  async function submitRecoverCode(event) {
    if (event) event.preventDefault();
    const code = getRecCode();
    if (code.length !== 6) { updateRecSubmitState(); return; }
    if (_recSubmitting) return;
    _recSubmitting = true;
    const btn = $('recSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Validando...'; }
    try {
      const res = await window.PedeAquiCustomerAuth.verifyResetCode({ email: recoverCtx.email, code });
      $('recoverCodeScreen')?.classList.remove('active');
      openResetPasswordScreen(res?.reset_token, recoverCtx.email);
    } catch (error) {
      openVfyAlert('O código de verificação expirou!', () => {
        clearRecInputs();
        recDigits()[0]?.focus();
      });
    } finally {
      _recSubmitting = false;
      if (btn) btn.textContent = 'Continuar';
      updateRecSubmitState();
    }
  }

  // Persist a successful login into both the shared auth store and the
  // existing in-page `customer` shape so the current UI keeps working.
  function applyLoggedSession(accessToken, apiCustomer) {
    window.PedeAquiCustomerAuth.saveSession({ access_token: accessToken, customer: apiCustomer });
    customer = {
      id: apiCustomer?.id || null,
      name: apiCustomer?.name || '',
      phone: apiCustomer?.phone || '',
      email: apiCustomer?.email || ''
    };
    localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer));
  }

  function applyLocalCustomer(apiCustomer) {
    customer = {
      id: apiCustomer?.id || null,
      name: apiCustomer?.name || '',
      phone: apiCustomer?.phone || '',
      email: apiCustomer?.email || ''
    };
    localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer));
    window.PedeAquiCustomerAuth?.setStoredCustomer?.(apiCustomer);
  }

  function tokenFromAuthResponse(res) {
    return res?.access_token || res?.token || res?.accessToken || res?.auth?.access_token || '';
  }

  function customerFromAuthResponse(res, fallback = {}) {
    return res?.customer || res?.user || res?.data?.customer || res?.data?.user || fallback;
  }

  function goToInitialScreenAfterAuth() {
    document.querySelectorAll('.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.vfy-screen.active').forEach(el => {
      el.classList.remove('active');
    });
    closeProfSub();
    renderHomeLoginPrompt();
    renderProfileView();
    showHomeTab();
    window.scrollTo(0, 0);
    unlockBodyScrollIfClear();
  }

  function finishLoginNavigation() {
    renderHomeLoginPrompt();
    if (_loginOrigin === 'coupon') {
      closeModalId('loginModal');
      return;
    }
    closeModalId('loginModal');
    if (_loginOrigin === 'orders') mobNavOrders();
    else renderProfileView();
  }

  let _loginSubmitting = false;
  async function submitLogin(event) {
    if (event) event.preventDefault();
    let firstInvalid = null;
    LOGIN_FIELDS.forEach(def => {
      const input = $(def.id);
      if (!input) return;
      loginTouched.add(def.id);
      const msg = def.validate(input.value);
      if (msg) {
        setLgnFieldError(def, msg);
        if (!firstInvalid) firstInvalid = input;
      } else {
        clearLgnFieldError(def);
      }
    });
    if (firstInvalid) {
      (firstInvalid.closest('.lgn-field') || firstInvalid).scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus({ preventScroll: true });
      return;
    }
    if (_loginSubmitting) return;
    _loginSubmitting = true;
    const btn = $('loginSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
    const rawLogin = ($('loginEmail').value || '').trim();
    const login = isEmailValue(rawLogin) ? rawLogin : onlyDigits(rawLogin);
    try {
      const res = await window.PedeAquiCustomerAuth.loginCustomer({ login, password: $('loginPassword').value || '' });
      // Unverified customer → route them to e-mail verification (not re-register).
      if (res?.requires_email_verification) {
        openVerifyScreen({ email: res.email || (isEmailValue(rawLogin) ? rawLogin : ''), source: 'login' });
        return;
      }
      if (res?.access_token) {
        applyLoggedSession(res.access_token, res.customer);
        $('loginScreen')?.classList.remove('active');
        finishLoginNavigation();
      } else {
        showLgnSummary('Dados de login incorretos. Verifique suas informações.');
      }
    } catch (error) {
      showLgnSummary('Dados de login incorretos. Verifique suas informações.');
    } finally {
      _loginSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
    }
  }

  // Sync the logged customer against /customers/me; clear session on 401.
  async function syncCustomerSession() {
    const auth = window.PedeAquiCustomerAuth;
    if (!auth?.isLoggedIn()) return;
    const stored = auth.getStoredCustomer();
    if (stored && !customer) {
      customer = { id: stored.id || null, name: stored.name || '', phone: stored.phone || '', email: stored.email || '' };
    }
    try {
      const me = await auth.getCurrentCustomer();
      if (me) {
        customer = { id: me.id || null, name: me.name || '', phone: me.phone || '', email: me.email || '' };
        localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer));
        auth.setStoredCustomer(me);
        renderHomeLoginPrompt();
        renderProfileView();
      }
    } catch (error) {
      if (error?.status === 401) {
        auth.logout();
        customer = null;
        localStorage.removeItem(STORAGE_CUSTOMER);
        renderHomeLoginPrompt();
        renderProfileView();
      }
    }
  }

  let _policyReturn = 'login';

  function openPolicyScreen(type) {
    const screen = $('privacyPolicyScreen');
    const body = $('privacyPolicyBody');
    const loyaltyIntro = window.PEDEAQUI_LOYALTY_POLICY_HTML
      ? '<div class="policy-section-label">Programa de fidelidade, cashback e benefícios</div>'
      : '';
    const html = `${window.PEDEAQUI_PRIVACY_POLICY_HTML || ''}${loyaltyIntro}${window.PEDEAQUI_LOYALTY_POLICY_HTML || ''}`;
    if (!screen || !body) return;
    if (!body.innerHTML.trim()) body.innerHTML = html;
    // Remember which screen to return to when the policy screen closes.
    _policyReturn = $('registerScreen')?.classList.contains('active') ? 'register' : 'login';
    if (_policyReturn === 'login') {
      $('loginModal')?.classList.add('active');
      document.querySelector('#loginModal .modal--login')?.classList.add('policy-hidden');
    }
    document.querySelectorAll('.policy-screen').forEach(el => el.classList.remove('active'));
    screen.classList.add('active');
    lockBodyScroll();
    body.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function closePolicyScreen(type) {
    $('privacyPolicyScreen')?.classList.remove('active');
    document.querySelector('#loginModal .modal--login')?.classList.remove('policy-hidden');
    // The register screen stays active underneath, so only restore the login modal.
    if (_policyReturn !== 'register') $('loginModal')?.classList.add('active');
    unlockBodyScrollIfClear();
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
    document.body.classList.add('coupon-nav-keep');
    lockBodyScroll(currentScrollY(), 'soft');
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
  }

  function closeCouponDetail(event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    const restoreY = _savedScrollY;
    const overlay = $('couponDetailOverlay');
    overlay?.classList.remove('active');
    document.body.classList.remove('coupon-nav-keep');
    setTimeout(() => {
      if (!hasBlockingUiOpen()) unlockBodyScroll(restoreY);
    }, 560);
  }

  function confirmCouponDetail() {
    if (!selectedCoupon) return;
    if (!isLogged()) {
      openLoginScreen('coupon');
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
    unlockBodyScrollIfClear();
  }

  function setMobNavActive(id) {
    document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
    $(id)?.classList.add('active');
  }

  let _pendingMenuNav = false;

  function mobNavMenu() {
    if (!operationConfirmed) {
      _pendingMenuNav = true;
      openOperationScreen(true); // immediate = sem animação de entrada
      return;
    }
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
    lockBodyScroll();
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
    lockBodyScroll();
  }

  // Tolerant order-card renderer that copes with both the local order shape and
  // the backend /customers/me/orders shape (field names differ).
  function orderCardHtml(order) {
    const number = order.order_number ?? order.number ?? order.id ?? '';
    const items = order.items || [];
    const status = order.status_label || order.status || 'Enviado';
    const type = order.type || order.order_type || '';
    const payment = order.payment || order.payment_method || '';
    const total = order.total ?? order.total_amount ?? order.total_price ?? 0;
    const itemHtml = items.map(i => {
      const qty = i.qty ?? i.quantity ?? 1;
      const name = i.name || i.product_name || i.product?.name || 'Item';
      const price = i.price ?? i.unit_price ?? i.total ?? 0;
      return `<div class="order-line"><span>${esc(qty)}x ${esc(name)}</span><strong>${fmt(price * qty)}</strong></div>`;
    }).join('');
    return `
      <article class="order-card">
        <div class="order-card-head"><strong>Pedido #${esc(number)}</strong><span>${esc(status)}</span></div>
        ${itemHtml}
        <div class="order-total"><span>${esc(type)}${type && payment ? ' • ' : ''}${esc(payment)}</span><strong>${fmt(total)}</strong></div>
      </article>`;
  }

  function paintOrders(body, orders) {
    if (!orders.length) {
      body.innerHTML = `<div class="mob-view-empty"><div class="mob-view-empty-title">Nenhum pedido encontrado</div><div class="mob-view-empty-sub">Pedidos finalizados aparecerão aqui.</div></div>`;
      return;
    }
    body.innerHTML = orders.map(orderCardHtml).join('');
  }

  function renderOrdersView() {
    const body = $('mobOrdersBody');
    if (!body) return;
    // Render local orders immediately for a responsive view.
    paintOrders(body, window.PedeAquiOrderState?.listOrders() || []);
    // When logged in, replace with the customer's server-side order history.
    const auth = window.PedeAquiCustomerAuth;
    if (!auth?.isLoggedIn()) return;
    auth.getCustomerOrders()
      .then(res => {
        const orders = Array.isArray(res) ? res : (res?.orders || res?.items || res?.data || []);
        if (Array.isArray(orders)) paintOrders(body, orders);
      })
      .catch(error => { if (error?.status === 401) syncCustomerSession(); });
  }

  function renderProfileView() {
    const box = $('profileIdentity');
    if (box) {
      box.innerHTML = isLogged()
        ? `<div class="prof-hero-label">${customer.name}</div><div class="prof-hero-sub">Cliente identificado</div>`
        : `<div class="prof-hero-label">${restaurant.name || 'Restaurante'}</div><div class="prof-hero-sub">Entre para acessar promoções e pedidos</div><button class="profile-login-btn" onclick="openLoginScreen()">Entrar ou cadastrar</button>`;
    }
    const logoutGroup = $('profLogoutGroup');
    if (logoutGroup) logoutGroup.style.display = isLogged() ? '' : 'none';
  }

  function logout() {
    if (!confirm('Deseja sair da sua conta?')) return;
    customer = null;
    localStorage.removeItem(STORAGE_CUSTOMER);
    window.PedeAquiCustomerAuth?.logout();
    closeProfSub();
    renderProfileView();
    renderHomeLoginPrompt();
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
    initOperationContext();
    applyTheme();
    initStoreInfoModal();
    renderRestaurantShell();
    renderBanners();
    renderCoupons();
    renderHighlights();
    renderMenu();
    renderProfileView();
    initSearch();
    initScrollSpy();
    setCartTab(operationContext?.order_type || 'delivery');
    updateCartUI();
    showHomeTab();
    initPageRubberBand();
    initMenuHeaderHide();
    // Best-effort: refresh the logged customer against the backend (clears
    // the session on 401). Runs after first paint so it never blocks the page.
    syncCustomerSession();
  }

  Object.assign(window, {
    openModal, closeModalId, closeModal, openProduct, changeQty, addToCart, handleHomeCartValueClick, scrollToCategory, scrollToMenu,
    removeCartItem, editCartItem, setCartTab, openCheckout, backToCart, backToCheckout, setDeliveryType,
    setPayment, openOrderReview, submitOrder, openAddressScreen, openAddressChoice, openAddressChoiceDirect, backFromAddAddress, backFromAddrSearch, backFromAddrMap, selectAdcOption, adcConfirm,
    openAddrSearch, onAddrSearchInput, selectAddrSuggestion, adcUseGeoSearch, confirmAddrMap, editAddrDetailsLocation, toggleAddrNoNumber, maskCep, validateAddrDetails, saveAddressDetails,
    openLoginScreen, mockLogin,
    openRegisterScreen, closeRegisterScreen, maskRegPhone, maskRegCpf, maskRegBirth,
    toggleRegPassword, handleRegFieldInput, handleRegFieldBlur, handleRegPrivacyInput, submitRegister, logout,
    openSigninScreen, closeSigninScreen, submitLogin, loginForgotPassword,
    handleLoginFieldInput, handleLoginFieldBlur,
    closeVerifyScreen, handleVfyInput, handleVfyKeydown, handleVfyPaste, submitVerify, resendVfyCode,
    openResetPasswordScreen, closeResetPasswordScreen, submitResetPassword, handleResetPwInput,
    openForgotPasswordScreen, closeForgotPasswordScreen, submitForgotPassword, handleForgotEmailInput,
    openForgotNotFound, closeForgotNotFound,
    openRecoverCodeScreen, closeRecoverCodeScreen, handleRecInput, handleRecKeydown, handleRecPaste,
    resendRecoverCode, submitRecoverCode,
    openOperationScreen, closeOperationScreen, setOperationType, renderOperationBranches, selectBranch, confirmOperation,
    openAddrPicker, selectAddrPickerItem, confirmAddrPicker, toggleAddrPickerActions, removeAddrPickerItem, confirmAddrPickerDelete, cancelAddrPickerDelete,
    openPolicyScreen, closePolicyScreen,
    useCoupon, openCouponDetail, closeCouponDetail, confirmCouponDetail, handleBannerAction,
    setStoreInfoTab,
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
