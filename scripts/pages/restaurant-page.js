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

  const $ = (id) => document.getElementById(id);
  const isLogged = () => Boolean(customer);
  const serviceFee = () => Number(settings.service_fee_amount ?? 0.99);
  const deliveryFee = () => deliveryType === 'delivery' ? Number(settings.default_delivery_fee ?? 13) : 0;
  const initials = (name) => (name || 'PedeAqui').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const slug = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

  function getRestaurantSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || window.PEDEAQUI_RESTAURANT_SLUG || window.APP_CONFIG?.DEFAULT_RESTAURANT_SLUG || 'junior-da-picanha';
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
    const primary = restaurant.primary_color || '#D95C04';
    const secondary = restaurant.secondary_color || '#111111';
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);
    root.style.setProperty('--brand-accent', restaurant.accent_color || primary);
    root.style.setProperty('--brand', primary);
    root.style.setProperty('--brand-d', secondary);
    root.style.setProperty('--m-accent', primary);
    root.style.setProperty('--m-accent-light', primary + '12');
    document.title = `${restaurant.name || 'Restaurante'} — Pedido Online | PedeAqui`;
  }

  function renderRestaurantShell() {
    const branch = branches[0] || {};
    const restName = restaurant.name || 'Restaurante';
    document.querySelectorAll('.nav-title,.mob-rest-name,.cart-rest-name,.login-rest-name,.prof-hero-label,.hero-rest-name').forEach(el => el.textContent = restName);
    document.querySelectorAll('.hero-rest-desc').forEach(el => el.textContent = restaurant.description || 'Pedido online');
    document.querySelectorAll('.cart-rest-avatar').forEach(el => el.textContent = initials(restName));

    const logoUrl = restaurant.logo_url || restaurant.logo_path;
    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="${restName}">`
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
    document.querySelectorAll('.mob-pedido-min').forEach(el => el.textContent = `Pedido mínimo ${fmt(settings.min_order_value || 0)}`);
    const loc = document.querySelector('.mob-loc');
    if (loc) loc.textContent = [branch.neighborhood, branch.city].filter(Boolean).join(' - ') || 'Unidade principal';
    const neighborhood = $('mobRestNeighborhood');
    if (neighborhood) neighborhood.textContent = branch.neighborhood || branch.name || '';
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
    const heroImg = $('restaurantHeroImg');
    if (heroImg) {
      const cover = restaurant.cover_url || banners.find(b => b.image_url)?.image_url || restaurant.hero_image_path || restaurant.cover_path || banners.find(b => b.image_path)?.image_path || '';
      if (cover) {
        heroImg.src = cover;
        heroImg.alt = restName;
      } else {
        heroImg.removeAttribute('src');
      }
    }

    const addrMain = $('homeAddressTitle');
    const addrSub = $('homeAddressSub');
    const branchAddress = [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(' - ');
    if (addrMain) addrMain.textContent = customerAddress ? customerAddress.summary : (branchAddress || 'Use seu endereço para melhores resultados');
    if (addrSub) addrSub.textContent = '';

    document.querySelectorAll('.delivery-time-text').forEach(el => {
      el.textContent = `${settings.estimated_delivery_time_min || 90}-${settings.estimated_delivery_time_max || 100} min`;
    });
    document.querySelectorAll('.delivery-fee-text').forEach(el => el.textContent = fmt(settings.default_delivery_fee ?? 13));
  }

  function renderBanners() {
    const wrap = $('bannerCarousel');
    if (!wrap) return;
    const data = banners;
    wrap.innerHTML = data.map(banner => `
      <button class="home-banner" onclick="handleBannerAction('${banner.action_type || ''}','${banner.action_value || ''}')">
        ${banner.image_url || banner.image_path ? `<img src="${banner.image_url || banner.image_path}" alt="${banner.title || restaurant.name || 'Banner'}">` : ''}
        <div class="home-banner-copy">
          <span>${restaurant.name || 'Restaurante'}</span>
          <strong>${banner.title || 'Promoção'}</strong>
          <small>${banner.subtitle || 'Oferta selecionada para hoje'}</small>
        </div>
      </button>
    `).join('');
    updatePromosEmptyState();
  }

  function renderCoupons() {
    const wrap = $('couponRail');
    if (!wrap) return;
    wrap.innerHTML = coupons.map(coupon => `
      <button class="coupon-card" onclick="useCoupon('${coupon.code}')">
        <span>${coupon.discount_type === 'free_delivery' ? 'Frete grátis' : coupon.title}</span>
        <strong>${coupon.title}</strong>
        <small>${coupon.description || 'Promocao disponivel no app'}</small>
        <em>Usar cupom</em>
      </button>
    `).join('');
    updatePromosEmptyState();
  }

  function updatePromosEmptyState() {
    const empty = $('promosEmpty');
    if (!empty) return;
    const hasContent = Boolean($('bannerCarousel')?.children.length || $('couponRail')?.children.length);
    empty.style.display = hasContent ? 'none' : 'block';
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
  function scrollToMenu() {
    closeMobViews();
    setMobNavActive('mobNavMenu');
    const el = $('menu-area');
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 96, behavior: 'smooth' });
  }

  function scrollToPromos() {
    closeMobViews();
    setMobNavActive('mobNavPromos');
    const el = $('promos-section');
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 76, behavior: 'smooth' });
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

  function openLoginScreen() {
    openModal('loginModal');
  }

  function mockLogin(mode) {
    customer = { name: mode === 'signup' ? 'Cliente PedeAqui' : 'Cliente identificado', phone: '' };
    localStorage.setItem(STORAGE_CUSTOMER, JSON.stringify(customer));
    closeModalId('loginModal');
    renderProfileView();
  }

  function useCoupon(code) {
    selectedCoupon = coupons.find(c => c.code === code) || null;
    if (!isLogged()) {
      openLoginScreen();
      return;
    }
    alert(`Cupom ${code} selecionado para uso futuro.`);
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
    scrollToMenu();
  }

  function mobNavPromos() {
    scrollToPromos();
  }

  function mobNavOrders() {
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
    setMobNavActive('mobNavMenu');
    $('searchCat')?.classList.add('search-open');
    $('searchInput')?.focus();
    scrollToMenu();
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
    coupons = Array.isArray(payload.coupons) ? payload.coupons : [];
    submittedOrder = window.PedeAquiOrderState?.listOrders()?.[0] || null;
    applyTheme();
    renderRestaurantShell();
    renderBanners();
    renderCoupons();
    renderMenu();
    renderProfileView();
    initSearch();
    initScrollSpy();
    setCartTab('delivery');
    updateCartUI();
  }

  Object.assign(window, {
    openModal, closeModalId, closeModal, openProduct, changeQty, addToCart, scrollToCategory, scrollToMenu,
    removeCartItem, editCartItem, setCartTab, openCheckout, backToCart, backToCheckout, setDeliveryType,
    setPayment, openOrderReview, submitOrder, openAddressScreen, saveAddressMock, openLoginScreen, mockLogin,
    useCoupon, handleBannerAction, mobNavMenu, mobNavPromos, mobNavOrders, mobNavProfile,
    openProfSub, closeProfSub, mobFocusSearch, closeSearch, openServiceFeeInfo
  });

  initRestaurantApp().catch(error => {
    console.error('Falha ao carregar restaurante', error);
    if ($('menuContainer')) $('menuContainer').innerHTML = '<div class="empty-search">Não foi possível carregar o cardápio.</div>';
  });
})();
