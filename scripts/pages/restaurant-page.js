const fmt = (val) => val.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
  const parsePrice = (price) => typeof price === 'number' ? fmt(price) : 'Consultar';

  let restaurantPayload = null;
let restaurantData = null;
let restaurantSettings = {};
let restaurantBranches = [];
let menuData = [];
let cart = [];
  let currentProd = null;
  let pmQty = 1;
  let deliveryType = 'delivery';
  let submittedOrder = null;
  let paymentMethod = 'Pix';
  let serviceFeeAdded = true;

  function slugify(text) {
    return text.toString().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  }

  function renderMenu() {
    const nav = document.getElementById('catNav');
    const container = document.getElementById('menuContainer');
    nav.innerHTML = '';
    container.innerHTML = '';

    menuData.forEach((cat, idx) => {
      const catId = slugify(cat.category);
      nav.innerHTML += `<button class="cat ${idx === 0 ? 'active' : ''}" onclick="scrollToCategory('${catId}', this)">${cat.category}</button>`;
      
      let html = `<div class="menu-section" id="${catId}">
        <h2 class="menu-section-title">${cat.category}</h2>
        <div class="products-grid">`;
      
      cat.items.forEach(item => {
        const pStr = parsePrice(item.price);
        html += `
          <div class="prod-card" onclick="openProduct(${item.id})">
            <div class="prod-info">
              <h3 class="prod-name">${item.name}</h3>
              ${item.desc ? `<p class="prod-desc">${item.desc}</p>` : ''}
              ${item.code ? `<p class="prod-desc" style="margin-bottom:4px">Serve ${item.code}</p>` : ''}
              <div class="prod-price">${pStr}</div>
            </div>
            <div class="prod-img-box">
              <div class="prod-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
              </div>
              <button class="prod-add-btn" onclick="event.stopPropagation();openProduct(${item.id})" aria-label="Adicionar ${item.name}">+</button>
            </div>
          </div>
        `;
      });
      html += `</div></div>`;
      container.innerHTML += html;
    });
  }

  let isClickScrolling = false;
  let clickTimeout = null;

  function scrollToCategory(id, btn) {
    isClickScrolling = true;
    clearTimeout(clickTimeout);

    document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const el = document.getElementById(id);
    if(el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - 110;
      window.scrollTo({top: y, behavior: 'smooth'});
      
      clickTimeout = setTimeout(() => {
        isClickScrolling = false;
      }, 800);
    }

    const catNav = document.getElementById('catNav');
    if (catNav) {
      catNav.scrollTo({
        left: btn.offsetLeft - catNav.offsetWidth / 2 + btn.offsetWidth / 2,
        behavior: 'smooth'
      });
    }
  }

  function initScrollSpy() {
    window.addEventListener('scroll', () => {
      if (isClickScrolling) return;

      const sections = document.querySelectorAll('.menu-section');
      const navButtons = document.querySelectorAll('.cat');
      const catNav = document.getElementById('catNav');
      
      let currentId = '';
      sections.forEach(sec => {
        const rect = sec.getBoundingClientRect();
        if (rect.top <= 140) {
          currentId = sec.id;
        }
      });

      if (currentId) {
        navButtons.forEach(btn => {
          if (btn.getAttribute('onclick').includes(currentId)) {
            if (!btn.classList.contains('active')) {
              document.querySelectorAll('.cat').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              
              if (catNav) {
                catNav.scrollTo({
                  left: btn.offsetLeft - catNav.offsetWidth / 2 + btn.offsetWidth / 2,
                  behavior: 'smooth'
                });
              }
            }
          }
        });
      }
    });
  }
  document.getElementById('searchInput').addEventListener('input', function(e) {
    const q = e.target.value.toLowerCase();
    let foundAny = false;
    document.querySelectorAll('.menu-section').forEach(sec => {
      let secFound = false;
      sec.querySelectorAll('.prod-card').forEach(card => {
        const text = card.innerText.toLowerCase();
        if(text.includes(q)) {
          card.style.display = 'flex';
          secFound = true;
          foundAny = true;
        } else {
          card.style.display = 'none';
        }
      });
      sec.style.display = secFound ? 'block' : 'none';
    });
    document.getElementById('emptySearch').style.display = foundAny ? 'none' : 'block';
  });

  function openModal(id) {
    document.getElementById(id).classList.add('active');
    document.body.classList.add('modal-open');
  }
  function closeModalId(id) {
    document.getElementById(id).classList.remove('active');
    document.body.classList.remove('modal-open');
  }
  function closeModal(e, id) {
    if(e.target.id === id) closeModalId(id);
  }

  function getProductById(id) {
    for(let cat of menuData) {
      for(let item of cat.items) {
        if(item.id === id) return item;
      }
    }
    return null;
  }

  function openProduct(id) {
    currentProd = getProductById(id);
    pmQty = 1;
    document.getElementById('pmName').innerText = currentProd.name;
    document.getElementById('pmDesc').innerText = currentProd.desc || '';
    document.getElementById('pmPrice').innerText = parsePrice(currentProd.price);
    document.getElementById('pmObs').value = '';
    
    if (typeof currentProd.price !== 'number') {
      document.getElementById('pmWarning').style.display = 'block';
      document.getElementById('pmForm').style.display = 'none';
      document.getElementById('pmFooter').style.display = 'none';
    } else {
      document.getElementById('pmWarning').style.display = 'none';
      document.getElementById('pmForm').style.display = 'block';
      document.getElementById('pmFooter').style.display = 'flex';
      updatePmUI();
    }
    openModal('productModal');
  }

  function changeQty(delta) {
    pmQty += delta;
    if(pmQty < 1) pmQty = 1;
    updatePmUI();
  }

  function updatePmUI() {
    document.getElementById('pmQty').innerText = pmQty;
    document.getElementById('pmAddBtn').innerText = `Adicionar • ${fmt(currentProd.price * pmQty)}`;
  }

  function addToCart() {
    if(typeof currentProd.price !== 'number') return;
    const obs = document.getElementById('pmObs').value;
    cart.push({
      ...currentProd,
      qty: pmQty,
      obs: obs,
      uid: Date.now()
    });
    closeModalId('productModal');
    updateCartUI();
  }

  let DELIVERY_FEE = 13.00;

  function toggleServiceFee() {
    serviceFeeAdded = !serviceFeeAdded;
    updateCartUI();
  }

  function updateCartUI() {
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    const totalVal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const deliveryFee = deliveryType === 'delivery' ? DELIVERY_FEE : 0;
    const svcFee = serviceFeeAdded ? 0.99 : 0;
    const grandTotal = totalVal + deliveryFee + svcFee;

    // Top badge
    const badge = document.getElementById('cartCountTop');
    badge.innerText = totalQty;
    if(totalQty > 0) badge.classList.add('show');
    else badge.classList.remove('show');

    // Sticky bar
    const sticky = document.getElementById('cartSticky');
    if(totalQty > 0) {
      sticky.classList.add('show');
      document.getElementById('cartCountSticky').innerText = totalQty;
      document.getElementById('cartTotalSticky').innerText = fmt(grandTotal);
    } else {
      sticky.classList.remove('show');
    }

    const empty = document.getElementById('cartEmpty');
    const content = document.getElementById('cartContent');
    const footer = document.getElementById('cartFooter');
    const list = document.getElementById('cartList');

    if(totalQty === 0) {
      empty.style.display = 'block';
      content.style.display = 'none';
      footer.style.display = 'none';
    } else {
      empty.style.display = 'none';
      content.style.display = 'block';
      footer.style.display = 'block';

      // Build items list with new design
      list.innerHTML = '';
      cart.forEach(item => {
        list.innerHTML += `
          <div class="cart-item-row">
            <div class="cir-qty-badge">${item.qty}×</div>
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
        `;
      });

      // Summary
      const csSubEl = document.getElementById('csSub');
      const csTotalEl = document.getElementById('csTotal');
      const csDeliveryEl = document.getElementById('csDelivery');
      const csSvcBtn = document.getElementById('csSvcFeeBtn');
      if(csSubEl) csSubEl.innerText = fmt(totalVal);
      if(csDeliveryEl) csDeliveryEl.innerText = deliveryType === 'delivery' ? fmt(DELIVERY_FEE) : 'R$ 0,00';
      if(csTotalEl) csTotalEl.innerText = fmt(grandTotal);
      if(csSvcBtn) csSvcBtn.innerText = 'R$ 0,99';
    }
  }

  function setCartTab(type) {
    deliveryType = type;
    const isDelivery = type === 'delivery';
    const tabEnt = document.getElementById('cartTabEntrega');
    const tabRet = document.getElementById('cartTabRetirada');
    if(tabEnt) tabEnt.classList.toggle('active', isDelivery);
    if(tabRet) tabRet.classList.toggle('active', !isDelivery);
    const addrBlock = document.getElementById('cartAddrBlock');
    const delivOpt = document.getElementById('cartDeliveryOpt');
    const pickupBlock = document.getElementById('cartPickupBlock');
    const delivRow = document.getElementById('csDeliveryRow');
    if(addrBlock) addrBlock.style.display = isDelivery ? 'block' : 'none';
    if(delivOpt) delivOpt.style.display = isDelivery ? 'block' : 'none';
    if(pickupBlock) pickupBlock.style.display = isDelivery ? 'none' : 'block';
    if(delivRow) delivRow.style.display = isDelivery ? 'flex' : 'none';
    updateCartUI();
  }

  function removeCartItem(uid) {
    cart = cart.filter(i => i.uid !== uid);
    updateCartUI();
  }

  function editCartItem(uid) {
    const item = cart.find(i => i.uid === uid);
    if(!item) return;
    currentProd = getProductById(item.id);
    pmQty = item.qty;
    document.getElementById('pmName').innerText = currentProd.name;
    document.getElementById('pmDesc').innerText = currentProd.desc || '';
    document.getElementById('pmPrice').innerText = parsePrice(currentProd.price);
    document.getElementById('pmObs').value = item.obs || '';
    document.getElementById('pmWarning').style.display = 'none';
    document.getElementById('pmForm').style.display = 'block';
    document.getElementById('pmFooter').style.display = 'flex';
    updatePmUI();
    // Remove old item first, then add updated
    const editUid = uid;
    document.getElementById('pmAddBtn').onclick = function() {
      cart = cart.filter(i => i.uid !== editUid);
      addToCart();
    };
    openModal('productModal');
  }

  function clearCart() {
    if(cart.length === 0) return;
    if(!confirm('Limpar a sacola?')) return;
    cart = [];
    updateCartUI();
  }

  function openCheckout() {
    closeModalId('cartModal');
    setTimeout(() => {
      document.getElementById('chkName').value = '';
      document.getElementById('chkPhone').value = '';
      document.getElementById('chkRua').value = '';
      document.getElementById('chkNum').value = '';
      document.getElementById('chkBairro').value = '';
      document.getElementById('chkComp').value = '';
      document.getElementById('chkObs').value = '';
      setDeliveryType(deliveryType);
      selectedPayment = 'Pix';
      document.querySelectorAll('.fs-pay-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.fs-pay-btn').classList.add('active');
      openModal('checkoutModal');
    }, 300);
  }

  function backToCart() {
    closeModalId('checkoutModal');
    setTimeout(() => openModal('cartModal'), 300);
  }

  function backToCheckout() {
    closeModalId('orderReviewModal');
    setTimeout(() => openModal('checkoutModal'), 300);
  }

  function setDeliveryType(type) {
    deliveryType = type;
    document.getElementById('btnDel').classList.toggle('active', type === 'delivery');
    document.getElementById('btnPick').classList.toggle('active', type === 'pickup');
    document.getElementById('addressGroup').style.display = type === 'delivery' ? 'block' : 'none';
  }

  function setPayment(btn, type) {
    paymentMethod = type;
    document.querySelectorAll('.fs-pay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function openOrderReview() {
    const name = document.getElementById('chkName').value.trim();
    const phone = document.getElementById('chkPhone').value.trim();
    if(!name || !phone) { alert('Por favor, preencha nome e WhatsApp.'); return; }
    if(deliveryType === 'delivery') {
      const rua = document.getElementById('chkRua').value.trim();
      const num = document.getElementById('chkNum').value.trim();
      const bairro = document.getElementById('chkBairro').value.trim();
      if(!rua || !num || !bairro) { alert('Por favor, preencha os dados de endereço obrigatórios.'); return; }
    }
    const isDelivery = deliveryType === 'delivery';
    document.getElementById('revTypeIcon').innerText = isDelivery ? '🛵' : '🏪';
    document.getElementById('revTypeName').innerText = isDelivery ? 'Entrega' : 'Retirada';
    document.getElementById('revTypeSub').innerText = isDelivery ? 'Hoje, 90–100 min · R$ 13,00' : '~30 min · Retirada no local';
    const addrBlock = document.getElementById('revAddrBlock');
    if(isDelivery) {
      const rua = document.getElementById('chkRua').value.trim();
      const num = document.getElementById('chkNum').value.trim();
      const bairro = document.getElementById('chkBairro').value.trim();
      const comp = document.getElementById('chkComp').value.trim();
      let addrStr = `${rua}, ${num} — ${bairro}`;
      if(comp) addrStr += ` (${comp})`;
      document.getElementById('revAddrVal').innerText = addrStr;
      addrBlock.style.display = 'flex';
    } else {
      addrBlock.style.display = 'none';
    }
    document.getElementById('revPayVal').innerText = paymentMethod;
    const itemsHtml = cart.map(item => `
      <div class="cart-item-row">
        <div class="cir-qty-badge">${item.qty}</div>
        <div class="cir-info">
          <div class="cir-name">${item.name}</div>
          ${item.obs ? `<div class="cir-obs">${item.obs}</div>` : ''}
        </div>
        <div class="cir-price">${fmt(item.price * item.qty)}</div>
      </div>
    `).join('');
    document.getElementById('revItemsList').innerHTML = itemsHtml;
    const totalVal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const deliveryFee = isDelivery ? DELIVERY_FEE : 0;
    const svcFee = serviceFeeAdded ? 0.99 : 0;
    document.getElementById('revSub').innerText = fmt(totalVal);
    document.getElementById('revDelivery').innerText = isDelivery ? fmt(DELIVERY_FEE) : 'Grátis';
    const revSvcRow = document.getElementById('revSvcFeeRow');
    if(revSvcRow) revSvcRow.style.display = serviceFeeAdded ? 'flex' : 'none';
    const revSvcVal = document.getElementById('revSvcFeeVal');
    if(revSvcVal) revSvcVal.innerText = fmt(0.99);
    document.getElementById('revTotal').innerText = fmt(totalVal + deliveryFee + svcFee);
    document.getElementById('revDeliveryRow').style.display = 'flex';
    closeModalId('checkoutModal');
    setTimeout(() => openModal('orderReviewModal'), 300);
  }

  function submitOrder() {
    const name = document.getElementById('chkName').value.trim();
    const totalVal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const deliveryFee = deliveryType === 'delivery' ? DELIVERY_FEE : 0;
    const svcFee = serviceFeeAdded ? 0.99 : 0;
    const grandTotal = totalVal + deliveryFee + svcFee;

    document.getElementById('confName').innerText = name;
    document.getElementById('confTotal').innerText = fmt(grandTotal);
    document.getElementById('confType').innerText = deliveryType === 'delivery' ? 'Entrega' : 'Retirada';
    document.getElementById('confPay').innerText = paymentMethod;

    submittedOrder = {
      order_number: Math.floor(1000 + Math.random() * 9000),
      status: 'submitted',
      created_at: new Date().toISOString(),
      items: cart.map(i => ({...i})),
      total: grandTotal,
      type: deliveryType === 'delivery' ? 'Entrega' : 'Retirada',
      payment: paymentMethod
    };
    if (window.PedeAquiOrderState) window.PedeAquiOrderState.saveOrder(submittedOrder);

    closeModalId('orderReviewModal');
    setTimeout(() => {
      openModal('confirmModal');
      cart = [];
      updateCartUI();
    }, 300);
  }

  // ── MOBILE VIEW MANAGER ──
  const MOB_VIEWS = ['mobViewPromos','mobViewOrders','mobViewProfile'];

  function closeMobViews() {
    MOB_VIEWS.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.classList.remove('active');
    });
  }

  function setMobNavActive(id) {
    document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
    const el = document.getElementById(id);
    if(el) el.classList.add('active');
  }

  function mobNavHome() {
    closeMobViews();
    setMobNavActive('mobNavHome');
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function mobNavPromos() {
    closeMobViews();
    setMobNavActive('mobNavPromos');
    renderPromosView();
    const v = document.getElementById('mobViewPromos');
    if(v) v.classList.add('active');
  }

  function mobNavOrders() {
    closeMobViews();
    setMobNavActive('mobNavOrders');
    renderOrdersView();
    const v = document.getElementById('mobViewOrders');
    if(v) v.classList.add('active');
  }

  function mobNavProfile() {
    closeMobViews();
    setMobNavActive('mobNavProfile');
    closeProfSub();
    const v = document.getElementById('mobViewProfile');
    if(v) v.classList.add('active');
  }

  function openProfSub(subId) {
    document.querySelectorAll('#mobViewProfile .prof-sub').forEach(el => el.classList.remove('active'));
    const sub = document.getElementById('profSub' + subId);
    if(!sub) return;
    if(subId === 'pedidos') renderProfPedidos();
    sub.classList.add('active');
    sub.scrollTop = 0;
  }

  function closeProfSub() {
    document.querySelectorAll('#mobViewProfile .prof-sub').forEach(el => el.classList.remove('active'));
    const hub = document.getElementById('profHubWrap');
    if(hub) hub.scrollTop = 0;
  }

  function renderProfPedidos() {
    const body = document.getElementById('profSubPedidosBody');
    if(!body) return;
    if(submittedOrder) {
      body.innerHTML = `
        <div class="prof-info-card" style="margin-bottom:12px">
          <div style="padding:22px;text-align:center">
            <div style="width:56px;height:56px;border-radius:50%;background:rgba(80,167,115,.1);color:#50a773;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style="font-size:1.05rem;font-weight:800;color:#1a1a1a;margin-bottom:5px">Pedido enviado!</div>
            <div style="font-size:.8rem;color:#aaa">Aguardando confirmação do restaurante</div>
          </div>
        </div>
        <div class="prof-info-card">
          <div class="prof-info-card-header">
            <div class="prof-info-card-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg></div>
            <span class="prof-info-card-title">Itens do pedido</span>
          </div>
          ${submittedOrder.items.map(i => `
            <div class="prof-info-row">
              <div style="width:24px;height:24px;border-radius:6px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;color:#666;flex-shrink:0">${i.qty}×</div>
              <div style="flex:1">
                <div class="prof-info-row-val" style="font-size:.84rem">${i.name}</div>
                <div style="font-size:.78rem;color:#C8520A;font-weight:700;margin-top:2px">${fmt(i.price*i.qty)}</div>
              </div>
            </div>
          `).join('')}
          <div style="padding:13px 16px;border-top:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:.72rem;color:#aaa;margin-bottom:2px">${submittedOrder.type} · ${submittedOrder.payment}</div>
            </div>
            <div style="font-size:1rem;font-weight:800;color:#1a1a1a">${fmt(submittedOrder.total)}</div>
          </div>
        </div>
        <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submittedOrder=null;cart=[];updateCartUI();renderProfPedidos()">Fazer novo pedido</button>
      `;
      return;
    }
    body.innerHTML = `
      <div class="prof-empty">
        <div class="prof-empty-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
        </div>
        <div class="prof-empty-title">Nenhum pedido encontrado</div>
        <div class="prof-empty-text">Seus pedidos aparecerão aqui após serem finalizados.</div>
      </div>
    `;
  }

  function mobFocusSearch() {
    closeMobViews();
    setMobNavActive('mobNavHome');
    const si = document.getElementById('searchInput');
    if(si) {
      si.focus();
      si.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function closeSearch() {
    const sc = document.getElementById('searchCat');
    if(sc) sc.classList.remove('search-open');
    const si = document.getElementById('searchInput');
    if(si) { si.value = ''; si.dispatchEvent(new Event('input')); }
  }

  // ── PROMOÇÕES VIEW ──
  const PROMO_CATS = ['Promoções','Combos','Quinta do Caranguejo'];

  function renderPromosView() {
    const body = document.getElementById('mobPromosBody');
    if(!body) return;
    const promoSections = menuData.filter(c => PROMO_CATS.includes(c.category));
    if(!promoSections.length || promoSections.every(c => !c.items.length)) {
      body.innerHTML = `
        <div class="mob-view-empty">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          <div class="mob-view-empty-title">Nenhuma promoção disponível</div>
          <div class="mob-view-empty-sub">Fique atento às ofertas especiais do Júnior da Picanha.</div>
        </div>`;
      return;
    }
    let html = '';
    promoSections.forEach(sec => {
      html += `<div class="mob-promo-cat">${sec.category}</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:6px">`;
      sec.items.forEach(item => {
        const pStr = parsePrice(item.price);
        html += `<div class="prod-card" onclick="openProduct(${item.id})">
          <div class="prod-info">
            <h3 class="prod-name">${item.name}</h3>
            ${item.desc ? `<p class="prod-desc">${item.desc}</p>` : ''}
            <div class="prod-price">${pStr}</div>
          </div>
          <div class="prod-img-box">
            <div class="prod-placeholder">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            </div>
            <button class="prod-add-btn" onclick="event.stopPropagation();openProduct(${item.id})" aria-label="Adicionar ${item.name}">+</button>
          </div>
        </div>`;
      });
      html += '</div>';
    });
    body.innerHTML = html;
  }


  function renderOrdersView() {
    const body = document.getElementById('mobOrdersBody');
    if(!body) return;

    if(submittedOrder) {
      const orderNum = submittedOrder.order_number || Math.floor(1000 + Math.random() * 9000);
      body.innerHTML = `
        <div style="background:#fff;border-radius:14px;border:1px solid #f0f0f0;margin-bottom:10px;overflow:hidden">
          <div style="background:linear-gradient(135deg,rgba(80,167,115,.08),rgba(80,167,115,.04));padding:20px 16px;text-align:center;border-bottom:1px solid #f0f0f0">
            <div style="width:52px;height:52px;border-radius:50%;background:rgba(80,167,115,.12);color:#50a773;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style="font-size:1rem;font-weight:800;color:#1a1a1a;margin-bottom:4px">Pedido enviado!</div>
            <div style="font-size:.78rem;color:#999;line-height:1.4">Aguardando confirmação do restaurante</div>
          </div>
          <div style="padding:14px 16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span style="font-size:.68rem;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.05em">Pedido #${orderNum}</span>
              <span style="font-size:.72rem;font-weight:700;color:#50a773;background:rgba(80,167,115,.1);padding:3px 8px;border-radius:6px">Enviado</span>
            </div>
            ${submittedOrder.items.map(i => `
              <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f8f8f8">
                <div style="min-width:26px;height:26px;background:#C8520A;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;color:#fff;flex-shrink:0">${i.qty}×</div>
                <div style="flex:1;font-size:.84rem;font-weight:600;color:#1a1a1a">${i.name}</div>
                <div style="font-size:.82rem;font-weight:700;color:#444">${fmt(i.price*i.qty)}</div>
              </div>
            `).join('')}
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:12px;margin-top:2px">
              <div style="font-size:.76rem;color:#999">${submittedOrder.type} · ${submittedOrder.payment}</div>
              <div style="font-size:.98rem;font-weight:800;color:#1a1a1a">${fmt(submittedOrder.total)}</div>
            </div>
          </div>
        </div>
        <button class="cart-cta-btn" style="margin-top:4px" onclick="submittedOrder=null;cart=[];updateCartUI();renderOrdersView()">Fazer novo pedido</button>
      `;
      return;
    }

    body.innerHTML = `
      <div class="mob-view-empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
        <div class="mob-view-empty-title">Nenhum pedido encontrado</div>
        <div class="mob-view-empty-sub">Seus pedidos confirmados aparecerão aqui.</div>
      </div>
    `;
  }

  function mobChangeQty(uid, delta) {
    const item = cart.find(i => i.uid === uid);
    if(!item) return;
    item.qty += delta;
    if(item.qty <= 0) cart = cart.filter(i => i.uid !== uid);
    updateCartUI();
    renderOrdersView();
  }

  function openCheckoutFromOrders() {
    closeMobViews();
    setMobNavActive('mobNavHome');
    openCheckout();
  }

  
  function getRestaurantSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || window.PEDEAQUI_RESTAURANT_SLUG || 'junior-da-picanha';
  }

  function buildMenuFromBackendShape(payload) {
    if (Array.isArray(payload.menu) && payload.menu.length) return payload.menu;
    if (!Array.isArray(payload.categories) || !Array.isArray(payload.products)) return [];

    return payload.categories.map(category => ({
      category: category.name,
      items: payload.products
        .filter(product => product.category_id === category.id || product.category === category.name)
        .map(product => ({
          id: product.id,
          name: product.name,
          desc: product.description || product.desc || '',
          price: product.price,
          image_path: product.image_path || null
        }))
    }));
  }

  function applyRestaurantTheme(restaurant) {
    if (!restaurant) return;
    const root = document.documentElement;
    const primary = restaurant.primary_color || '#D95C04';
    const secondary = restaurant.secondary_color || '#111111';
    const accent = restaurant.accent_color || primary;
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);
    root.style.setProperty('--brand-accent', accent);
    root.style.setProperty('--brand', primary);
    root.style.setProperty('--brand-d', secondary);
    root.style.setProperty('--brand2', accent);

    document.title = restaurant.name + ' — Pedido Online | PedeAqui';
    document.querySelectorAll('.nav-title,.mob-cover-inner h2,.mob-rest-name,.cart-rest-name').forEach(el => {
      el.textContent = restaurant.name;
    });
    const logo = document.querySelector('.mob-logo img');
    if (logo && restaurant.logo_path) {
      logo.src = restaurant.logo_path;
      logo.alt = restaurant.name;
    }
    const city = restaurantBranches?.[0]?.city;
    const state = restaurantBranches?.[0]?.state;
    const loc = document.querySelector('.mob-loc');
    if (loc && city && state) loc.textContent = city + ' - ' + state;
    const minOrder = document.querySelector('.mob-pedido-min');
    if (minOrder && restaurantSettings.min_order_value) minOrder.textContent = 'Pedido mínimo ' + fmt(restaurantSettings.min_order_value);
    const deliverySub = document.querySelector('.mob-delivery-sub');
    if (deliverySub && restaurantSettings.default_delivery_fee) {
      deliverySub.textContent = (restaurantSettings.estimated_delivery_time_min || 90) + '–' + (restaurantSettings.estimated_delivery_time_max || 100) + ' min • Taxa ' + fmt(restaurantSettings.default_delivery_fee);
    }
  }

  async function initRestaurantApp() {
    const slug = getRestaurantSlug();
    restaurantPayload = await window.PedeAquiRestaurantService.getRestaurantMenu(slug);
    restaurantData = restaurantPayload.restaurant || {};
    restaurantSettings = restaurantPayload.settings || {};
    restaurantBranches = restaurantPayload.branches || [];
    menuData = buildMenuFromBackendShape(restaurantPayload);
    submittedOrder = window.PedeAquiOrderState?.listOrders()?.[0] || null;
    DELIVERY_FEE = Number(restaurantSettings.default_delivery_fee ?? DELIVERY_FEE);
    applyRestaurantTheme(restaurantData);
    renderMenu();
    renderPromosView();
    updateCartUI();
    initScrollSpy();
  }

  initRestaurantApp().catch(error => {
    console.error('Falha ao carregar restaurante', error);
    const container = document.getElementById('menuContainer');
    if (container) container.innerHTML = '<div class="empty-search">NÃ£o foi possÃ­vel carregar o cardÃ¡pio.</div>';
  });
