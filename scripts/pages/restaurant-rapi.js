/**
 * Rapi — Assistente inteligente de pedido — PREMIUM UI v2
 * Módulo isolado. Não altera lógica existente.
 * Acessa produtos/cupons via variáveis globais já expostas.
 */
(function () {
  'use strict';

  /* ── Constants ── */
  const RAPI_AVATAR_SRC = 'assets/brand/rapi-mascot.png';

  const ALCOHOL_KEYWORDS = [
    'cerveja', 'cervejas', 'drink', 'drinks', 'whisky', 'whiskey',
    'licor', 'licores', 'aperitivo', 'caipirinha', 'vinho', 'vinhos',
    'chopp', 'draft', 'gin', 'vodka', 'rum', 'espumante', 'sake',
    'club do whisky', 'alcool', 'alcoólico', 'alcoólica'
  ];

  const QUICK_ACTIONS_PRIMARY = [
    { id: 'budget',   icon: '💰', label: 'Gasto pouco',        intent: 'budget'  },
    { id: 'for2',     icon: '👫', label: 'Para 2 pessoas',     intent: 'for2'    },
    { id: 'hungry',   icon: '🍽️', label: 'Muita fome',         intent: 'hungry'  },
    { id: 'coupon',   icon: '🎟️', label: 'Usar cupom',          intent: 'coupon'  },
  ];

  const QUICK_ACTIONS_MORE = [
    { id: 'quick',    icon: '⚡', label: 'Pedido rápido',       intent: 'quick'   },
    { id: 'value',    icon: '⭐', label: 'Melhor custo-benefício', intent: 'value' },
    { id: 'surprise', icon: '🎲', label: 'Me surpreenda',       intent: 'surprise'},
    { id: 'popular',  icon: '🔥', label: 'Mais pedidos',        intent: 'popular' },
    { id: 'dessert',  icon: '🍰', label: 'Sobremesa',           intent: 'dessert' },
    { id: 'drink',    icon: '🥤', label: 'Bebida',              intent: 'drink'   },
  ];

  const MAX_INITIAL_RESULTS = 3;

  /* ── State ── */
  let _rapiLoaded = false;
  let _activeChipId = null;
  let _moreActionsOpen = false;
  let _allResults = [];

  /* ── Helpers ── */
  function getRapiProducts() {
    return (window.PedeAquiRestaurantStore?.get?.()?.products || []);
  }

  function getRapiCoupons() {
    return (window.PedeAquiRestaurantStore?.get?.()?.coupons || []);
  }

  function isAlcoholic(product) {
    const text = [
      product.name || '',
      product.description || '',
      product.category_name || ''
    ].join(' ').toLowerCase();
    return ALCOHOL_KEYWORDS.some(k => text.includes(k));
  }

  function safeProducts() {
    return getRapiProducts().filter(p => !isAlcoholic(p) && Number.isFinite(p.price));
  }

  function fmtPrice(val) {
    return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── Intent detection ── */
  function detectIntent(message) {
    const msg = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/barato|economico|pouco|baratao|menos|ate \d|r\$\s*\d/.test(msg)) return 'budget';
    if (/muita fome|faminto|esfomeado|serve \d|kg|1kg|porcao grande|grand/.test(msg)) return 'hungry';
    if (/2 pessoa|para dois|dividir|casal|duas pessoas/.test(msg)) return 'for2';
    if (/cupom|desconto|promo/.test(msg)) return 'coupon';
    if (/surpreend|qualquer|tanto faz|escolha/.test(msg)) return 'surprise';
    if (/popular|mais pedido|destaque|famoso/.test(msg)) return 'popular';
    if (/rapido|rapida|pratico|simples|basico/.test(msg)) return 'quick';
    if (/sobremesa|docin|doce|pudim|brownie|sorvete/.test(msg)) return 'dessert';
    if (/bebida|suco|refrigerante|agua/.test(msg)) return 'drink';
    if (/carne|frango|peixe|file|bife|picanha/.test(msg)) return { type: 'category', term: msg };
    if (/massa|macarrao|pizza|lasanha/.test(msg)) return { type: 'category', term: 'massa' };
    const priceMatch = msg.match(/ate\s*r?\$?\s*(\d+)|r\$\s*(\d+)/);
    if (priceMatch) {
      return { type: 'price', limit: Number(priceMatch[1] || priceMatch[2]) };
    }
    return 'value';
  }

  /* ── Local recommendation engine ── */
  function getLocalRapiRecommendations({ intent, products, coupons }) {
    const all = products || safeProducts();
    if (!all.length) return [];
    const sorted = [...all].sort((a, b) => a.price - b.price);
    let result = [];
    let reasons = {};

    if (intent === 'budget' || intent?.type === 'price') {
      const limit = intent?.limit || 45;
      result = sorted.filter(p => p.price <= limit).slice(0, 6);
      result.forEach(p => { reasons[p.id || p.name] = `Cabe no orçamento de ${fmtPrice(limit)}.`; });
      if (!result.length) result = sorted.slice(0, 5);
    } else if (intent === 'hungry') {
      const kw = ['serve 2', 'serve 3', 'serve 4', '1kg', 'combo', 'completo', 'família', 'porção'];
      result = all.filter(p => kw.some(k => (p.name + ' ' + (p.description || '')).toLowerCase().includes(k)));
      result.forEach(p => { reasons[p.id || p.name] = 'Ideal para quem está com muita fome.'; });
      if (result.length < 2) result = [...all].sort((a, b) => b.price - a.price).slice(0, 5);
    } else if (intent === 'for2') {
      const kw = ['2 pessoas', 'serve 2', 'para 2', 'casal', 'combo'];
      result = all.filter(p => kw.some(k => (p.name + ' ' + (p.description || '')).toLowerCase().includes(k)));
      result.forEach(p => { reasons[p.id || p.name] = 'Serve bem para dividir.'; });
      if (result.length < 2) result = all.filter(p => p.price >= 30 && p.price <= 80).slice(0, 5);
    } else if (intent === 'coupon') {
      const activeCoupons = coupons || getRapiCoupons();
      if (activeCoupons.length) {
        const minVal = Math.max(...activeCoupons.map(c => Number(c.min_order_value || 0)));
        result = sorted.filter(p => p.price >= minVal * 0.4 && p.price <= minVal * 1.3).slice(0, 5);
        result.forEach(p => { reasons[p.id || p.name] = 'Boa escolha para aproveitar seu cupom.'; });
      }
      if (!result.length) result = sorted.slice(0, 5);
    } else if (intent === 'surprise') {
      const shuffled = [...all].sort(() => Math.random() - 0.5);
      result = shuffled.slice(0, 5);
      result.forEach(p => { reasons[p.id || p.name] = 'Escolha especial do Rapi pra você ✨'; });
    } else if (intent === 'quick') {
      result = sorted.slice(0, 5);
      result.forEach(p => { reasons[p.id || p.name] = 'Rápido, simples e muito bom.'; });
    } else if (intent === 'popular') {
      result = [...all].sort(() => Math.random() - 0.5).slice(0, 5);
      result.forEach(p => { reasons[p.id || p.name] = 'Um dos mais pedidos da casa.'; });
    } else if (intent === 'dessert') {
      const kw = ['sobremesa', 'doce', 'pudim', 'brownie', 'sorvete', 'mousse', 'torta'];
      result = all.filter(p => kw.some(k => (p.name + ' ' + (p.description || '') + ' ' + (p.category_name || '')).toLowerCase().includes(k))).slice(0, 5);
      result.forEach(p => { reasons[p.id || p.name] = 'Boa pedida para finalizar.'; });
      if (!result.length) result = sorted.slice(-5).reverse();
    } else if (intent === 'drink') {
      const kw = ['suco', 'refrigerante', 'água', 'agua', 'limonada', 'chá', 'cha', 'vitamina'];
      result = all.filter(p => kw.some(k => (p.name + ' ' + (p.description || '') + ' ' + (p.category_name || '')).toLowerCase().includes(k))).slice(0, 5);
      result.forEach(p => { reasons[p.id || p.name] = 'Boa bebida para acompanhar.'; });
      if (!result.length) result = sorted.slice(0, 5);
    } else if (intent?.type === 'category') {
      const term = intent.term;
      result = all.filter(p => (p.name + ' ' + (p.description || '') + ' ' + (p.category_name || '')).toLowerCase().includes(term)).slice(0, 6);
      result.forEach(p => { reasons[p.id || p.name] = `Boa escolha de ${term}.`; });
      if (!result.length) result = sorted.slice(0, 5);
    } else {
      // value / default
      const mid = all.filter(p => p.price >= 20 && p.price <= 60);
      result = (mid.length >= 3 ? mid : sorted).slice(0, 5);
      result.forEach(p => { reasons[p.id || p.name] = 'Boa escolha para gastar bem.'; });
    }

    return result.map(p => ({ ...p, _reason: reasons[p.id || p.name] || 'Recomendado pelo Rapi.' }));
  }

  /* ── AI endpoint hook ── */
  async function askRapiAssistant(input) {
    // Replace with real API call when available
    return null;
  }

  async function getRapiRecommendations({ message, intent, products, coupons }) {
    try {
      const remote = await askRapiAssistant({ message });
      if (remote && Array.isArray(remote) && remote.length) return remote;
    } catch (_) {}
    return getLocalRapiRecommendations({ intent, products, coupons, message });
  }

  /* ── Render helpers ── */
  function renderChipButton(a, isActive) {
    return `<button class="rapi-chip${isActive ? ' rapi-chip--active' : ''}"
      id="rapiChip_${a.id}"
      onclick="rapiHandleChip('${a.id}','${esc(a.label)}','${a.intent}')"
      type="button">
      <span class="rapi-chip-icon">${a.icon}</span>
      ${esc(a.label)}
    </button>`;
  }

  function renderProductImg(product) {
    const src = product.image_url || product.image_path || '';
    if (!src) return `<div class="rapi-result-image-placeholder">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.2">
        <path d="M3 2h18l-2 7H5L3 2z"/><path d="M5 9l-1 13h16l-1-13"/>
      </svg></div>`;
    return `<img class="rapi-result-image" src="${esc(src)}" alt="${esc(product.name)}" loading="lazy"
      onerror="this.parentNode.innerHTML='<div class=rapi-result-image-placeholder><svg width=38 height=38 viewBox=\\'0 0 24 24\\' fill=none stroke=#ccc stroke-width=1.2><path d=\\'M3 2h18l-2 7H5L3 2z\\'/></svg></div>'">`;
  }

  function renderResultCard(product, index) {
    const catName = product.category_name || '';
    const desc = product.description || '';
    const reason = product._reason || 'Recomendado pelo Rapi.';
    const pid = product.id || product.slug || index;
    const hasImg = !!(product.image_url || product.image_path);
    return `
      <article class="rapi-result-card" style="animation-delay:${index * 0.06}s">
        ${hasImg ? `<div class="rapi-result-image-wrap">${renderProductImg(product)}</div>` : ''}
        <div class="rapi-result-content">
          ${catName ? `<div class="rapi-result-category">${esc(catName)}</div>` : ''}
          <div class="rapi-result-title">${esc(product.name)}</div>
          ${desc ? `<div class="rapi-result-description">${esc(desc)}</div>` : ''}
          <div class="rapi-result-reason">✨ ${esc(reason)}</div>
          <div class="rapi-result-actions">
            <div class="rapi-result-price">${fmtPrice(product.price)}</div>
            <button class="rapi-menu-btn" onclick="rapiViewInMenu('${esc(product.category_slug || product.category_id || '')}')" type="button">Cardápio</button>
            <button class="rapi-add-btn" onclick="rapiAddProduct(${JSON.stringify(JSON.stringify(product)).slice(1,-1)})" data-rapi-pid="${esc(String(pid))}" type="button">Adicionar</button>
          </div>
        </div>
      </article>`;
  }

  /* ── Build the full view HTML ── */
  function buildRapiView() {
    const primaryChips = QUICK_ACTIONS_PRIMARY.map(a => renderChipButton(a, _activeChipId === a.id)).join('');
    const moreChips = QUICK_ACTIONS_MORE.map(a => renderChipButton(a, _activeChipId === a.id)).join('');

    return `
    <div class="rapi-page" id="rapiPage">

      <!-- Header igual ao de Unidades -->
      <div class="cart-hdr" style="position: sticky; top: 0; z-index: 10;">
        <button class="cart-hdr-back" onclick="if(window.mobNavHome) window.mobNavHome()" aria-label="Voltar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <h2 class="cart-hdr-title">Rapi</h2>
        <div class="cart-hdr-spacer"></div>
      </div>

      <!-- Hero premium -->
      <div class="rapi-hero">
        <div class="rapi-avatar-wrap">
          <div class="rapi-avatar-glow"></div>
          <img class="rapi-avatar-img" src="${RAPI_AVATAR_SRC}" alt="Rapi mascote" onerror="this.style.display='none'">
        </div>
        <div class="rapi-title-block">
          <h2>Rapi</h2>
          <p>Seu assistente de pedido</p>
          <div class="rapi-status-pill">
            <span class="rapi-status-dot"></span>
            online agora
          </div>
        </div>
      </div>

      <!-- Prompt card -->
      <div class="rapi-prompt-card">
        <div class="rapi-prompt-headline">O que você quer pedir hoje?</div>
        <div class="rapi-prompt-sub">Eu encontro boas opções no cardápio para você.</div>
        <div class="rapi-input-card" id="rapiInputCard">
          <input class="rapi-input" id="rapiInput" type="text"
            placeholder="Ex: quero algo com carne até R$ 50"
            onkeydown="rapiInputKeydown(event)">
          <button class="rapi-send-btn" onclick="rapiSendMessage()" type="button" aria-label="Enviar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="rapi-content">

        <div class="rapi-section-label">Atalhos rápidos</div>

        <div class="rapi-quick-grid" id="rapiChipsPrimary">
          ${primaryChips}
        </div>

        <div class="rapi-more-actions" id="rapiChipsMore">
          ${moreChips}
        </div>

        <button class="rapi-expand-btn" id="rapiExpandBtn" onclick="rapiToggleMore()" type="button">
          <span>Ver mais ideias</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>

        <!-- Thinking -->
        <div class="rapi-thinking" id="rapiThinking">
          <img class="rapi-thinking-avatar" src="${RAPI_AVATAR_SRC}" alt="Rapi" onerror="this.style.display='none'">
          <div class="rapi-thinking-content">
            <div class="rapi-thinking-label">Rapi está pensando...</div>
            <div class="rapi-thinking-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>

        <!-- Results label -->
        <div class="rapi-results-label" id="rapiResultsLabel">Sugestões para você</div>

        <!-- Results -->
        <div class="rapi-results" id="rapiResults"></div>

        <!-- Show more results -->
        <button class="rapi-show-more-btn" id="rapiShowMoreBtn" onclick="rapiShowMoreResults()" type="button">
          Ver mais sugestões
        </button>

      </div>
    </div>

    <div class="rapi-toast" id="rapiToast"></div>
    `;
  }

  /* ── Show toast ── */
  function showRapiToast(msg) {
    const t = document.getElementById('rapiToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('rapi-toast--visible');
    setTimeout(() => t.classList.remove('rapi-toast--visible'), 2400);
  }

  /* ── Show/hide results ── */
  async function rapiSearch(message, intent, chipId) {
    const resultsEl = document.getElementById('rapiResults');
    const thinkingEl = document.getElementById('rapiThinking');
    const labelEl = document.getElementById('rapiResultsLabel');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    if (!resultsEl) return;

    _activeChipId = chipId || null;

    // Update chip active states
    document.querySelectorAll('.rapi-chip').forEach(btn => btn.classList.remove('rapi-chip--active'));
    if (chipId) document.getElementById('rapiChip_' + chipId)?.classList.add('rapi-chip--active');

    // Show thinking
    thinkingEl?.classList.add('visible');
    if (labelEl) labelEl.classList.remove('visible');
    if (showMoreBtn) showMoreBtn.classList.remove('visible');
    resultsEl.innerHTML = '';

    const delay = 350 + Math.random() * 350;
    await new Promise(r => setTimeout(r, delay));

    const products = safeProducts();
    const coupons = getRapiCoupons();
    _allResults = await getRapiRecommendations({ message, intent, products, coupons });

    thinkingEl?.classList.remove('visible');

    if (!_allResults.length) {
      if (labelEl) labelEl.classList.remove('visible');
      resultsEl.innerHTML = `
        <div class="rapi-empty">
          <span class="rapi-empty-emoji">🤔</span>
          <div class="rapi-empty-title">Não encontrei a opção ideal</div>
          <div class="rapi-empty-sub">Mas posso tentar de outro jeito. Toca em um atalho ou escreve o que quer.</div>
        </div>`;
      return;
    }

    if (labelEl) labelEl.classList.add('visible');
    const initialItems = _allResults.slice(0, MAX_INITIAL_RESULTS);
    resultsEl.innerHTML = initialItems.map((p, i) => renderResultCard(p, i)).join('');

    if (_allResults.length > MAX_INITIAL_RESULTS && showMoreBtn) {
      showMoreBtn.classList.add('visible');
    }

    // Scroll to results
    setTimeout(() => {
      const page = document.getElementById('rapiPage');
      if (page) {
        const label = document.getElementById('rapiResultsLabel');
        if (label) page.scrollTo({ top: label.offsetTop - 16, behavior: 'smooth' });
      }
    }, 100);
  }

  /* ── Public API ── */

  window.rapiHandleChip = function (id, label, intent) {
    const inputEl = document.getElementById('rapiInput');
    if (inputEl) inputEl.value = label;
    rapiSearch(label, intent, id);
  };

  window.rapiSendMessage = function () {
    const inputEl = document.getElementById('rapiInput');
    const msg = (inputEl?.value || '').trim();
    if (!msg) return;
    const intent = detectIntent(msg);
    rapiSearch(msg, intent, null);
  };

  window.rapiInputKeydown = function (event) {
    if (event.key === 'Enter') { event.preventDefault(); window.rapiSendMessage(); }
  };

  window.rapiToggleMore = function () {
    _moreActionsOpen = !_moreActionsOpen;
    const moreEl = document.getElementById('rapiChipsMore');
    const btn = document.getElementById('rapiExpandBtn');
    if (moreEl) moreEl.classList.toggle('open', _moreActionsOpen);
    if (btn) {
      btn.classList.toggle('expanded', _moreActionsOpen);
      btn.querySelector('span').textContent = _moreActionsOpen ? 'Ver menos' : 'Ver mais ideias';
    }
  };

  window.rapiShowMoreResults = function () {
    const resultsEl = document.getElementById('rapiResults');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    if (!resultsEl || !_allResults.length) return;
    resultsEl.innerHTML = _allResults.map((p, i) => renderResultCard(p, i)).join('');
    if (showMoreBtn) showMoreBtn.classList.remove('visible');
  };

  window.rapiAddProduct = function (productJson) {
    try {
      const product = typeof productJson === 'string' ? JSON.parse(productJson) : productJson;
      if (typeof window.openProduct === 'function') {
        window.openProduct(product.id || product);
      } else {
        showRapiToast('Abra o cardápio para adicionar este item');
      }
    } catch (e) {
      showRapiToast('Não foi possível adicionar. Tente pelo cardápio.');
    }
  };

  window.rapiViewInMenu = function (categorySlug) {
    if (typeof window.mobNavMenu === 'function') window.mobNavMenu();
    if (categorySlug && typeof window.scrollToCategory === 'function') {
      setTimeout(() => {
        const btn = document.querySelector(`.cat[onclick*="'${categorySlug}'"]`);
        window.scrollToCategory(categorySlug, btn);
      }, 400);
    }
  };

  window.renderRapiView = function () {
    const view = document.getElementById('mobViewRapi');
    if (!view) return;
    if (!_rapiLoaded) {
      view.innerHTML = buildRapiView();
      _rapiLoaded = true;
    }
    // Refresh chip active states
    document.querySelectorAll('.rapi-chip').forEach(btn => btn.classList.remove('rapi-chip--active'));
    if (_activeChipId) document.getElementById('rapiChip_' + _activeChipId)?.classList.add('rapi-chip--active');
  };

  window.rapiReset = function () {
    _activeChipId = null;
    _moreActionsOpen = false;
    _allResults = [];
    const inputEl = document.getElementById('rapiInput');
    if (inputEl) inputEl.value = '';
    const resultsEl = document.getElementById('rapiResults');
    if (resultsEl) resultsEl.innerHTML = '';
    const labelEl = document.getElementById('rapiResultsLabel');
    if (labelEl) labelEl.classList.remove('visible');
    const thinkingEl = document.getElementById('rapiThinking');
    if (thinkingEl) thinkingEl.classList.remove('visible');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    if (showMoreBtn) showMoreBtn.classList.remove('visible');
    const moreEl = document.getElementById('rapiChipsMore');
    if (moreEl) moreEl.classList.remove('open');
    const expandBtn = document.getElementById('rapiExpandBtn');
    if (expandBtn) {
      expandBtn.classList.remove('expanded');
      const span = expandBtn.querySelector('span');
      if (span) span.textContent = 'Ver mais ideias';
    }
    document.querySelectorAll('.rapi-chip').forEach(btn => btn.classList.remove('rapi-chip--active'));
  };

})();
