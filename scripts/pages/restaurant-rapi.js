/**
 * Rapi — Assistente inteligente de pedido — PREMIUM UI v3
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

  const MAX_INITIAL_RESULTS = 3;

  /* ── State ── */
  let _rapiLoaded = false;
  let _activeChipId = null;
  let _allResults = [];
  let _introTypeTimer = null;
  let _rapiSessionId = null;
  let _rapiSending = false;
  let _rapiOptionCache = [];

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
  function getRapiRestaurantId() {
    const store = window.PedeAquiRestaurantStore?.get?.() || {};
    return store.restaurant?.id
      || store.branches?.[0]?.restaurant_id
      || store.products?.[0]?.restaurant_id
      || store.restaurant?.slug
      || window.PedeAquiRestaurantSlug?.get?.()
      || window.APP_CONFIG?.DEFAULT_RESTAURANT_SLUG
      || '';
  }

  function ensureRapiSessionId() {
    if (!_rapiSessionId) {
      const cryptoId = window.crypto?.randomUUID?.();
      _rapiSessionId = cryptoId || `rapi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
    return _rapiSessionId;
  }

  function setRapiInputDisabled(disabled) {
    const inputEl = document.getElementById('rapiInput');
    const sendBtn = document.querySelector('.rapi-ai-send');
    if (inputEl) inputEl.disabled = Boolean(disabled);
    if (sendBtn) sendBtn.disabled = Boolean(disabled);
  }

  function scrollRapiToLatest() {
    const wrap = document.getElementById('rapiAiResultsWrap');
    const page = document.getElementById('rapiPage');
    requestAnimationFrame(() => {
      if (wrap) wrap.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' });
      if (page) page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' });
    });
  }

  function normalizeChatResponse(data) {
    const payload = data?.data && data.data.response_type ? data.data : data;
    return payload || { response_type: 'error', message: 'Resposta vazia do Rapi.' };
  }

  function responseMessage(data) {
    return data?.message || data?.text || data?.content || '';
  }

  function responseOptions(data) {
    const source = Array.isArray(data?.options) ? data.options : [];
    return source.map(option => {
      if (typeof option === 'string') return { label: option, message: option };
      return {
        label: option.label || option.title || option.text || option.message || '',
        message: option.message || option.value || option.text || option.label || option.title || ''
      };
    }).filter(option => option.label && option.message);
  }

  function responseProducts(data) {
    return Array.isArray(data?.products) ? data.products : [];
  }

  function appendRapiUserMessage(message) {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl) return;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-result-card rapi-chat-user-message">
        <div class="rapi-result-content">
          <div class="rapi-result-title">${esc(message)}</div>
        </div>
      </div>`);
    scrollRapiToLatest();
  }

  function appendRapiTextMessage(message) {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl) return;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-result-card rapi-chat-assistant-message">
        <div class="rapi-result-content">
          <div class="rapi-result-title">${esc(message || 'Certo.')}</div>
        </div>
      </div>`);
    scrollRapiToLatest();
  }

  function appendRapiTypingIndicator() {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl || document.getElementById('rapiTypingMessage')) return;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-result-card rapi-chat-assistant-message rapi-chat-typing" id="rapiTypingMessage" aria-live="polite">
        <div class="rapi-result-content">
          <div class="rapi-typing-row">
            <div class="rapi-thinking rapi-thinking--dark visible">
              <div class="rapi-thinking-dots rapi-thinking-dots--dark"><span></span><span></span><span></span></div>
            </div>
            <span class="rapi-typing-label">Digitando...</span>
          </div>
        </div>
      </div>`);
    scrollRapiToLatest();
  }

  function removeRapiTypingIndicator() {
    const typingEl = document.getElementById('rapiTypingMessage');
    if (!typingEl) return;
    typingEl.style.transition = 'opacity .18s ease';
    typingEl.style.opacity = '0';
    setTimeout(() => typingEl.remove(), 180);
  }
  function renderRapiOptions(data) {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl) return;
    const message = responseMessage(data);
    const options = responseOptions(data);
    if (message) appendRapiTextMessage(message);
    if (!options.length) return;
    _rapiOptionCache = options;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-suggest-rail rapi-suggest-rail--ready">
        ${options.map((option, index) => `<button class="rapi-suggest-chip" type="button" onclick="rapiUseOption(${index})">${esc(option.label)}</button>`).join('')}
      </div>`);
    scrollRapiToLatest();
  }
  function renderRapiProducts(data) {
    const resultsEl = document.getElementById('rapiResults');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    if (!resultsEl) return;
    const message = responseMessage(data);
    const products = responseProducts(data);
    if (message) appendRapiTextMessage(message);
    _allResults = products;
    if (!products.length) {
      appendRapiTextMessage('Nao encontrei produtos para essa busca.');
      return;
    }
    const initialItems = products.slice(0, MAX_INITIAL_RESULTS);
    resultsEl.insertAdjacentHTML('beforeend', initialItems.map((p, i) => renderResultCard(p, i)).join(''));
    if (products.length > MAX_INITIAL_RESULTS && showMoreBtn) showMoreBtn.classList.add('visible');
    scrollRapiToLatest();
  }

  function renderRapiChatResponse(data) {
    const type = String(data?.response_type || 'error').toLowerCase();
    if (type === 'text') {
      appendRapiTextMessage(responseMessage(data));
      return;
    }
    if (type === 'options') {
      renderRapiOptions(data);
      return;
    }
    if (type === 'products') {
      renderRapiProducts(data);
      return;
    }
    appendRapiTextMessage(responseMessage(data) || 'Nao consegui responder agora. Tente novamente.');
  }

  async function postRapiChatMessage(message) {
    const payload = {
      restaurant_id: getRapiRestaurantId(),
      session_id: ensureRapiSessionId(),
      message
    };
    return normalizeChatResponse(await window.PedeAquiApiClient.post('/chat', payload));
  }
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

  /* ── Build the location widget (clone from home tab) ── */
  function buildRapiLocationWidget() {
    const sourceWidget = document.querySelector('.home-sticky-header .delivery-widget') || document.querySelector('.delivery-widget');
    const sourceStrip = sourceWidget?.querySelector('.address-strip');
    const classes = [
      sourceWidget?.classList.contains('pending-selection') ? 'pending-selection' : '',
      sourceWidget?.classList.contains('needs-address-hint') ? 'needs-address-hint' : ''
    ].filter(Boolean).join(' ');
    const stripClasses = [
      sourceStrip?.classList.contains('has-address') ? 'has-address' : '',
      sourceStrip?.classList.contains('needs-address-hint') ? 'needs-address-hint' : ''
    ].filter(Boolean).join(' ');
    const delivery = document.getElementById('dwTabDelivery')?.textContent || 'DELIVERY';
    const brand = document.getElementById('dwTabBrand')?.textContent || 'RESTAURANTE';
    const branch = document.getElementById('dwTabBranch')?.textContent || 'UNIDADE';
    const address = document.getElementById('homeAddressTitle')?.textContent || 'Use seu endereço para melhores resultados';
    const sub = document.getElementById('homeAddressSub')?.textContent || '';

    return `
      <div class="rapi-location-wrap">
        <div class="delivery-widget rapi-location-widget ${classes}" role="button" tabindex="0" onclick="openOperationScreen()" aria-label="Selecionar unidade e operação">
          <div class="delivery-widget-tabs">
            <span class="delivery-widget-tab rapi-location-tab rapi-location-tab--mode active">${esc(delivery)}</span>
            <span class="delivery-widget-tab rapi-location-tab rapi-location-tab--brand">${esc(brand)}</span>
            <span class="delivery-widget-tab rapi-location-tab rapi-location-tab--branch">${esc(branch)}</span>
            <svg class="delivery-widget-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>
          </div>
          <div class="delivery-widget-divider"></div>
          <span class="address-card address-strip ${stripClasses}">
            <span class="address-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </span>
            <span class="address-card-copy">
              <strong>${esc(address)}</strong>
              <small>${esc(sub)}</small>
            </span>
            <svg class="address-card-chevron" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>
          </span>
        </div>
      </div>`;
  }

  /* ── Build the full view HTML ── */
  function buildRapiView() {
    const locationWidget = buildRapiLocationWidget();

    return `
    <div class="rapi-page" id="rapiPage">

      ${locationWidget}

      <!-- Dark AI body -->
      <div class="rapi-ai-body" id="rapiAiBody">

        <!-- Glowing orb -->
        <div class="rapi-orb-wrap">
          <div class="rapi-orb-glow"></div>
          <div class="rapi-orb">
            <img class="rapi-orb-img" src="${RAPI_AVATAR_SRC}" alt="Rapi" onerror="this.style.display='none'">
          </div>
        </div>

        <!-- Question -->
        <div class="rapi-ai-question" id="rapiIntroQuestion" data-text="Como posso ajudar hoje?" aria-label="Como posso ajudar hoje?"></div>
        <div class="rapi-ai-subtitle">Me diga o que procura e eu encontro as melhores op&ccedil;&otilde;es do card&aacute;pio.</div>

        <!-- Results area (shown after search) -->
        <div class="rapi-ai-results-wrap" id="rapiAiResultsWrap" style="display:none">
          <div class="rapi-thinking rapi-thinking--dark" id="rapiThinking">
            <div class="rapi-thinking-dots rapi-thinking-dots--dark">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div class="rapi-results-label rapi-results-label--dark" id="rapiResultsLabel">Sugestões para você</div>
          <div class="rapi-results" id="rapiResults"></div>
          <button class="rapi-show-more-btn rapi-show-more-btn--dark" id="rapiShowMoreBtn" onclick="rapiShowMoreResults()" type="button">
            Ver mais sugestões
          </button>
        </div>

      </div>

      <!-- Bottom dock: chips + input -->
      <div class="rapi-bottom-dock">

        <!-- Suggestion chips (horizontal scroll) -->
        <div class="rapi-suggest-rail rapi-suggest-rail--waiting" id="rapiStarter">
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Me recomenda um prato')">Me recomenda um prato</button>
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Quero gastar ate R$ 50')">Quero gastar at&eacute; R$ 50</button>
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Pedido para 2 pessoas')">Pedido para 2 pessoas</button>
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Me surpreenda')">Me surpreenda</button>
        </div>

        <!-- Input bar -->
        <div class="rapi-ai-input-bar">
          <input class="rapi-ai-input" id="rapiInput" type="text"
            placeholder="Pergunte qualquer coisa..."
            onkeydown="rapiInputKeydown(event)">
          <button class="rapi-ai-send" onclick="rapiSendMessage()" type="button" aria-label="Enviar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
            </svg>
          </button>
        </div>

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
    const labelEl = document.getElementById('rapiResultsLabel');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    const starterEl = document.getElementById('rapiStarter');
    const aiBody = document.getElementById('rapiAiBody');
    const resultsWrap = document.getElementById('rapiAiResultsWrap');
    const inputEl = document.getElementById('rapiInput');
    if (!resultsEl || _rapiSending) return;

    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) return;

    _activeChipId = chipId || null;
    _rapiSending = true;
    if (_introTypeTimer) {
      clearTimeout(_introTypeTimer);
      _introTypeTimer = null;
    }

    if (resultsWrap) resultsWrap.style.display = 'block';
    if (aiBody) aiBody.classList.add('rapi-ai-body--searching');
    if (labelEl) labelEl.classList.remove('visible');
    if (showMoreBtn) showMoreBtn.classList.remove('visible');
    if (starterEl) {
      starterEl.classList.add('hidden');
      starterEl.style.setProperty('display', 'none', 'important');
      starterEl.style.setProperty('opacity', '0', 'important');
      starterEl.style.setProperty('visibility', 'hidden', 'important');
      starterEl.style.setProperty('pointer-events', 'none', 'important');
    }

    appendRapiUserMessage(cleanMessage);
    setRapiInputDisabled(true);
    appendRapiTypingIndicator();

    try {
      const response = await postRapiChatMessage(cleanMessage);
      removeRapiTypingIndicator();
      setTimeout(() => renderRapiChatResponse(response), 190);
    } catch (error) {
      removeRapiTypingIndicator();
      setTimeout(() => renderRapiChatResponse({
        response_type: 'error',
        message: error?.message || 'Nao consegui conectar ao Rapi agora. Tente novamente.'
      }), 190);
    } finally {
      _rapiSending = false;
      setTimeout(() => {
        setRapiInputDisabled(false);
        inputEl?.focus?.();
      }, 190);
    }
  }
  function setupRapiSuggestionDrag() {
    const rail = document.getElementById('rapiStarter');
    if (!rail || rail.dataset.dragReady === '1') return;
    rail.dataset.dragReady = '1';

    let pointerId = null;
    let startX = 0;
    let startScrollLeft = 0;
    let dragged = false;

    rail.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScrollLeft = rail.scrollLeft;
      dragged = false;
      rail.classList.add('is-dragging');
      try { rail.setPointerCapture(pointerId); } catch (_) {}
    });

    rail.addEventListener('pointermove', event => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 4) dragged = true;
      if (dragged) {
        rail.scrollLeft = startScrollLeft - dx;
        event.preventDefault();
      }
    }, { passive: false });

    const endDrag = event => {
      if (pointerId !== null && event.pointerId === pointerId) {
        try { rail.releasePointerCapture(pointerId); } catch (_) {}
        pointerId = null;
      }
      rail.classList.remove('is-dragging');
    };

    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
    rail.addEventListener('click', event => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = false;
    }, true);
  }
  function startRapiIntroAnimation() {
    const questionEl = document.getElementById('rapiIntroQuestion');
    const starterEl = document.getElementById('rapiStarter');
    const aiBody = document.getElementById('rapiAiBody');
    if (!questionEl || !starterEl || aiBody?.classList.contains('rapi-ai-body--searching')) return;

    if (_introTypeTimer) {
      clearTimeout(_introTypeTimer);
      _introTypeTimer = null;
    }

    const text = questionEl.getAttribute('data-text') || 'Como posso ajudar hoje?';
    questionEl.textContent = '';
    questionEl.classList.add('is-typing');
    starterEl.classList.remove('hidden', 'rapi-suggest-rail--ready');
    starterEl.classList.add('rapi-suggest-rail--waiting');
    starterEl.style.setProperty('display', 'flex', 'important');
    starterEl.style.setProperty('opacity', '0', 'important');
    starterEl.style.setProperty('visibility', 'hidden', 'important');
    starterEl.style.setProperty('pointer-events', 'none', 'important');
    starterEl.style.setProperty('height', 'auto', 'important');
    starterEl.style.setProperty('overflow-x', 'auto', 'important');
    starterEl.style.setProperty('overflow-y', 'hidden', 'important');

    const revealSuggestions = () => {
      const currentBody = document.getElementById('rapiAiBody');
      if (currentBody?.classList.contains('rapi-ai-body--searching')) return;
      starterEl.classList.remove('hidden', 'rapi-suggest-rail--waiting');
      starterEl.classList.add('rapi-suggest-rail--ready');
      starterEl.style.setProperty('display', 'flex', 'important');
      starterEl.style.setProperty('opacity', '1', 'important');
      starterEl.style.setProperty('visibility', 'visible', 'important');
      starterEl.style.setProperty('pointer-events', 'auto', 'important');
      starterEl.style.setProperty('height', 'auto', 'important');
      starterEl.style.setProperty('overflow-x', 'auto', 'important');
      starterEl.style.setProperty('overflow-y', 'hidden', 'important');
      starterEl.querySelectorAll('.rapi-suggest-chip').forEach((chip, index) => {
        chip.style.setProperty('visibility', 'visible', 'important');
        chip.style.setProperty('display', 'inline-flex', 'important');
        chip.style.setProperty('animation', 'none', 'important');
        chip.style.setProperty('opacity', '0', 'important');
        chip.style.setProperty('transform', 'translateY(14px) scale(.98)', 'important');
        window.requestAnimationFrame(() => {
          chip.style.setProperty('transition', 'opacity .38s ease, transform .38s cubic-bezier(.2,.8,.2,1)', 'important');
          chip.style.setProperty('transition-delay', (index * 70) + 'ms', 'important');
          chip.style.setProperty('opacity', '1', 'important');
          chip.style.setProperty('transform', 'translateY(0) scale(1)', 'important');
        });
      });
    };
    const fallbackTimer = setTimeout(revealSuggestions, 2600);

    let index = 0;
    const tick = () => {
      questionEl.textContent = text.slice(0, index);
      if (index <= text.length) {
        index += 1;
        _introTypeTimer = setTimeout(tick, index === 1 ? 120 : 42);
        return;
      }
      questionEl.classList.remove('is-typing');
      _introTypeTimer = setTimeout(() => {
        clearTimeout(fallbackTimer);
        revealSuggestions();
      }, 180);
    };

    tick();
  }

  window.rapiSendMessage = function () {
    if (_rapiSending) return;
    const inputEl = document.getElementById('rapiInput');
    const msg = (inputEl?.value || '').trim();
    if (!msg) return;
    if (inputEl) inputEl.value = '';
    rapiSearch(msg, null, null);
  };

  window.rapiUseSuggestion = function (message) {
    if (_rapiSending) return;
    const inputEl = document.getElementById('rapiInput');
    if (inputEl) inputEl.value = '';
    rapiSearch(message, null, null);
  };

  window.rapiUseOption = function (index) {
    const option = _rapiOptionCache[Number(index)];
    if (!option) return;
    window.rapiUseSuggestion(option.message);
  };
  window.rapiInputKeydown = function (event) {
    if (event.key === 'Enter') { event.preventDefault(); window.rapiSendMessage(); }
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
    if (!_rapiLoaded || !view.querySelector('.rapi-page')) {
      view.innerHTML = buildRapiView();
      _rapiLoaded = true;
      ensureRapiSessionId();
      setupRapiSuggestionDrag();
      setTimeout(startRapiIntroAnimation, 0);
    } else {
      // Refresh location widget only
      const locationWrap = view.querySelector('.rapi-location-wrap');
      if (locationWrap) {
        const newWidget = buildRapiLocationWidget();
        const tmp = document.createElement('div');
        tmp.innerHTML = newWidget;
        locationWrap.replaceWith(tmp.firstElementChild);
      }
      setupRapiSuggestionDrag();
      setTimeout(startRapiIntroAnimation, 0);
    }
  };

  window.rapiReset = function () {
    _activeChipId = null;
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
    const starterEl = document.getElementById('rapiStarter');
    if (starterEl) {
      starterEl.classList.remove('hidden');
      starterEl.style.removeProperty('display');
      starterEl.style.removeProperty('opacity');
      starterEl.style.removeProperty('visibility');
      starterEl.style.removeProperty('pointer-events');
    }
    // Reset new AI layout elements
    const resultsWrap = document.getElementById('rapiAiResultsWrap');
    if (resultsWrap) resultsWrap.style.display = 'none';
    const aiBody = document.getElementById('rapiAiBody');
    if (aiBody) aiBody.classList.remove('rapi-ai-body--searching');
  };

})();
