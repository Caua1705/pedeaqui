/**
 * Rapi — Assistente inteligente de pedido — PREMIUM UI v3
 * Módulo isolado. Não altera lógica existente.
 * Acessa produtos/cupons via variáveis globais já expostas.
 */
(function () {
  'use strict';

  /* ── Constants ── */
  const RAPI_AVATAR_SRC = 'assets/brand/rapi-mascot.png';
  const RAPI_SESSION_STORAGE_KEY = 'rapi.session_id';

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
  let _rapiAbortController = null;
  let _rapiResponseTimer = null;
  let _rapiActiveReveal = null;
  let _rapiOptionCache = [];
  let _rapiProductDetailCache = [];
  let _rapiActiveDetailProduct = null;
  let _rapiTypingStatusTimer = null;
  let _rapiCartUnsubscribe = null;

  const RAPI_TYPING_STATUSES = [
    'Preparando sugestões...',
    'Buscando no cardápio...',
    'Digitando...'
  ];

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

  function rapiCartQuantity(snapshot) {
    return (snapshot?.items || []).reduce((total, item) => total + Number(item?.qty || 0), 0);
  }

  function syncRapiCartButton(snapshot = window.PedeAquiCartStore?.get?.()) {
    const button = document.getElementById('rapiCartButton');
    const count = document.getElementById('rapiCartCount');
    if (!button || !count) return;
    const quantity = rapiCartQuantity(snapshot);
    button.hidden = quantity <= 0;
    count.textContent = String(quantity);
    button.setAttribute('aria-label', quantity === 1
      ? 'Abrir sacola com 1 item'
      : `Abrir sacola com ${quantity} itens`);
  }

  function ensureRapiCartSubscription() {
    const store = window.PedeAquiCartStore;
    if (_rapiCartUnsubscribe || !store?.subscribe) return;
    _rapiCartUnsubscribe = store.subscribe((current, previous) => {
      syncRapiCartButton(current);
      const addedQuantity = rapiCartQuantity(current) - rapiCartQuantity(previous);
      if (addedQuantity > 0 && document.getElementById('mobViewRapi')?.classList.contains('active')) {
        showRapiToast('Adicionado à sacola');
      }
    });
  }

  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatProductTitle(value) {
    const minorWords = new Set(['a','à','ao','aos','as','às','com','da','das','de','do','dos','e','em','na','nas','no','nos','ou','para','por']);
    let firstWord = true;
    let segmentStart = true;
    return String(value || '').toLocaleLowerCase('pt-BR').split(/(\s+|\|)/).map(token => {
      if (!token || /^\s+$/.test(token)) return token;
      if (token === '|') { segmentStart = true; return token; }
      const word = token.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+|[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+$/g, '');
      const keepLowercase = minorWords.has(word) && !firstWord && !segmentStart;
      const formatted = keepLowercase ? token : token.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]/, letter => letter.toLocaleUpperCase('pt-BR'));
      firstWord = false;
      segmentStart = false;
      return formatted;
    }).join('');
  }

  function renderRapiMarkdown(text) {
    return esc(text).replace(/(?:\r?\n){3,}/g, '\n\n')
      .replace(/\n([^\n]*\?\s*)$/, '<span class="rapi-final-question">$1</span>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderRapiStreamingMarkdown(text) {
    const escaped = esc(text).replace(/(?:\r?\n){3,}/g, '\n\n');
    const completed = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    return completed.replace(/\*\*([^*]*)$/, '<strong>$1</strong>');
  }

  /* ── Intent detection ── */
  function getRapiRestaurantId() {
    const store = window.PedeAquiRestaurantStore?.get?.() || {};
    return store.restaurant?.id
      || store.branches?.[0]?.restaurant_id
      || store.products?.[0]?.restaurant_id
      || store.restaurant?.slug
      || window.RapidexTenant?.resolveSlug?.()
      || '';
  }

  function ensureRapiSessionId() {
    if (_rapiSessionId) return _rapiSessionId;

    const storedSessionId = window.sessionStorage?.getItem(RAPI_SESSION_STORAGE_KEY);
    if (storedSessionId) {
      _rapiSessionId = storedSessionId;
      return _rapiSessionId;
    }

    const cryptoObj = window.crypto;
    _rapiSessionId = cryptoObj?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => {
      const randomValue = cryptoObj?.getRandomValues?.(new Uint8Array(1))[0] || Math.floor(Math.random() * 256);
      return (Number(c) ^ randomValue & 15 >> Number(c) / 4).toString(16);
    });
    window.sessionStorage?.setItem(RAPI_SESSION_STORAGE_KEY, _rapiSessionId);
    return _rapiSessionId;
  }

  function setRapiInputDisabled(disabled) {
    const inputEl = document.getElementById('rapiInput');
    if (inputEl) inputEl.disabled = Boolean(disabled);
  }

  function updateRapiSendButton() {
    const inputEl = document.getElementById('rapiInput');
    const sendBtn = document.querySelector('.rapi-ai-send');
    if (!sendBtn || _rapiSending) return;
    const hasText = Boolean(inputEl?.value?.trim());
    sendBtn.disabled = !hasText;
    sendBtn.classList.toggle('is-ready', hasText);
    sendBtn.classList.toggle('is-inactive', !hasText);
  }

  function setRapiGenerating(generating) {
    const sendBtn = document.querySelector('.rapi-ai-send');
    if (!sendBtn) return;
    sendBtn.classList.toggle('is-stopping', Boolean(generating));
    sendBtn.classList.remove('is-ready', 'is-inactive');
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', generating ? 'Parar resposta' : 'Enviar');
    sendBtn.setAttribute('title', generating ? 'Parar resposta' : 'Enviar');
    sendBtn.innerHTML = generating
      ? '<span class="rapi-stop-icon" aria-hidden="true"></span>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
    if (!generating) updateRapiSendButton();
  }

  function finishRapiGeneration() {
    _rapiSending = false;
    _rapiAbortController = null;
    _rapiActiveReveal = null;
    setRapiInputDisabled(false);
    setRapiGenerating(false);
  }

  function stopRapiGeneration() {
    if (!_rapiSending) return;
    _rapiAbortController?.abort();
    _rapiAbortController = null;
    if (_rapiResponseTimer) {
      clearTimeout(_rapiResponseTimer);
      _rapiResponseTimer = null;
    }
    removeRapiTypingIndicator();
    const title = _rapiActiveReveal;
    if (title?._rapiRevealTimer) {
      clearTimeout(title._rapiRevealTimer);
      title._rapiRevealTimer = null;
    }
    title?.closest('.rapi-chat-assistant-message')?.classList.remove('is-typing-response');
    finishRapiGeneration();
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

  function renderRapiFeedbackActions() {
    return `
      <div class="rapi-feedback-actions" aria-label="Acoes da resposta">
        <button class="rapi-feedback-btn rapi-copy-btn" type="button" aria-label="Copiar resposta" onclick="rapiCopyResponse(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="rapi-feedback-btn rapi-rating-btn" type="button" aria-label="Gostei da resposta" aria-pressed="false" data-feedback="like" onclick="rapiRateResponse(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/><path d="M7 11 11 2a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2l-1 7a3 3 0 0 1-3 3H7Z"/></svg>
        </button>
        <button class="rapi-feedback-btn rapi-rating-btn" type="button" aria-label="Nao gostei da resposta" aria-pressed="false" data-feedback="dislike" onclick="rapiRateResponse(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/><path d="M17 13 13 22a3 3 0 0 1-3-3v-4H5a2 2 0 0 1-2-2l1-7a3 3 0 0 1 3-3h10Z"/></svg>
        </button>
      </div>`;
  }
  const RAPI_REVEAL_MS_PER_CHARACTER = 34;

  function typeRapiText(element, text, options = {}) {
    if (!element) return;
    const characters = Array.from(String(text || ''));
    let visibleCharacters = 0;
    let startedAt = null;

    if (element._rapiTypingFrame) cancelAnimationFrame(element._rapiTypingFrame);
    element.textContent = '';
    element.classList.add('is-typing');

    const finish = () => {
      element._rapiTypingFrame = null;
      element.classList.remove('is-typing');
      options.renderFinal?.();
      options.onComplete?.();
    };

    if (!characters.length) {
      finish();
      return;
    }

    const tick = timestamp => {
      if (!element.isConnected) {
        element._rapiTypingFrame = null;
        return;
      }
      if (startedAt === null) startedAt = timestamp;
      const nextVisibleCharacters = Math.min(
        characters.length,
        Math.floor((timestamp - startedAt) / RAPI_REVEAL_MS_PER_CHARACTER) + 1
      );
      if (nextVisibleCharacters > visibleCharacters) {
        visibleCharacters = nextVisibleCharacters;
        element.textContent = characters.slice(0, visibleCharacters).join('');
        options.onProgress?.(visibleCharacters);
      }
      if (visibleCharacters >= characters.length) {
        finish();
        return;
      }
      element._rapiTypingFrame = requestAnimationFrame(tick);
      options.onFrame?.(element._rapiTypingFrame);
    };

    element._rapiTypingFrame = requestAnimationFrame(tick);
    options.onFrame?.(element._rapiTypingFrame);
  }
  const RAPI_RESPONSE_WORDS_PER_STEP = 3;
  const RAPI_RESPONSE_REVEAL_INTERVAL = 80;

  function revealRapiResponse(element, text, options = {}) {
    if (!element) return;
    _rapiActiveReveal = element;
    const wordSegments = String(text || '').match(/\S+\s*/g) || [];
    let visibleWords = 0;

    if (element._rapiRevealTimer) clearTimeout(element._rapiRevealTimer);
    element.textContent = '';

    const finish = () => {
      element._rapiRevealTimer = null;
      if (_rapiActiveReveal === element) _rapiActiveReveal = null;
      options.renderFinal?.();
      options.onComplete?.();
      if (_rapiSending) finishRapiGeneration();
    };

    if (!wordSegments.length) {
      finish();
      return;
    }

    const revealNextBlock = () => {
      if (!element.isConnected) {
        element._rapiRevealTimer = null;
        return;
      }
      visibleWords = Math.min(
        wordSegments.length,
        visibleWords + RAPI_RESPONSE_WORDS_PER_STEP
      );
      element.innerHTML = renderRapiStreamingMarkdown(
        wordSegments.slice(0, visibleWords).join('')
      );
      options.onProgress?.(visibleWords);
      if (visibleWords >= wordSegments.length) {
        finish();
        return;
      }
      element._rapiRevealTimer = setTimeout(
        revealNextBlock,
        RAPI_RESPONSE_REVEAL_INTERVAL
      );
    };

    revealNextBlock();
  }
  function appendRapiTextMessage(message, feedbackContext = null, onComplete = null) {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl) return;
    const text = message || 'Certo.';
    const preview = document.createElement('div');
    preview.innerHTML = renderRapiMarkdown(text);
    const plainText = preview.textContent || text;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-result-card rapi-chat-assistant-message is-typing-response">
        <div class="rapi-result-content">
          <div class="rapi-result-title" aria-label="${esc(plainText)}"></div>
          ${renderRapiFeedbackActions()}
        </div>
      </div>`);
    const messageElement = resultsEl.lastElementChild;
    const title = messageElement?.querySelector('.rapi-result-title');
    if (messageElement && feedbackContext) messageElement._rapiFeedbackContext = feedbackContext;

    revealRapiResponse(title, text, {
      onProgress: scrollRapiToLatest,
      renderFinal: () => {
        title.innerHTML = renderRapiMarkdown(text);
        messageElement.classList.remove('is-typing-response');
        scrollRapiToLatest();
      },
      onComplete
    });
    scrollRapiToLatest();
  }
  function appendRapiTypingIndicator() {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl || document.getElementById('rapiTypingMessage')) return;
    let statusIndex = Math.floor(Math.random() * RAPI_TYPING_STATUSES.length);
    const typingDots = Array.from({ length: 49 }, (_, index) => {
      const row = Math.floor(index / 7);
      const column = index % 7;
      const inset = Math.max(0, Math.abs(row - 3) - 1);
      const hidden = column < inset || column > 6 - inset;
      const ring = Math.max(Math.abs(row - 3), Math.abs(column - 3));
      return `<span class="${hidden ? 'is-shape-cut' : `is-ring-${ring}`}"></span>`;
    }).join('');
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-result-card rapi-chat-assistant-message rapi-chat-typing" id="rapiTypingMessage" aria-live="polite">
        <div class="rapi-result-content">
          <div class="rapi-typing-row">
            <div class="rapi-thinking rapi-thinking--dark visible">
              <div class="rapi-thinking-dots rapi-thinking-dots--dark">${typingDots}</div>
            </div>
            <span class="rapi-typing-label" data-text="${RAPI_TYPING_STATUSES[statusIndex]}">${RAPI_TYPING_STATUSES[statusIndex]}</span>
          </div>
        </div>
      </div>`);
    clearTimeout(_rapiTypingStatusTimer);
    const scheduleNextStatus = () => {
      const delay = 4200 + Math.floor(Math.random() * 2801);
      _rapiTypingStatusTimer = setTimeout(() => {
        const label = document.querySelector('#rapiTypingMessage .rapi-typing-label');
        if (!label) {
          _rapiTypingStatusTimer = null;
          return;
        }
        const alternatives = RAPI_TYPING_STATUSES
          .map((_, index) => index)
          .filter(index => index !== statusIndex);
        statusIndex = alternatives[Math.floor(Math.random() * alternatives.length)];
        label.textContent = RAPI_TYPING_STATUSES[statusIndex];
        label.dataset.text = RAPI_TYPING_STATUSES[statusIndex];
        scheduleNextStatus();
      }, delay);
    };
    scheduleNextStatus();
    scrollRapiToLatest();
  }

  function removeRapiTypingIndicator() {
    clearTimeout(_rapiTypingStatusTimer);
    _rapiTypingStatusTimer = null;
    const typingEl = document.getElementById('rapiTypingMessage');
    if (!typingEl) return;
    typingEl.style.transition = 'opacity .18s ease';
    typingEl.style.opacity = '0';
    setTimeout(() => typingEl.remove(), 180);
  }
  function renderRapiOptions(data, feedbackContext) {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl) return;
    const message = responseMessage(data);
    const options = responseOptions(data);
    const revealOptions = () => {
      if (!options.length) return;
      _rapiOptionCache = options;
      resultsEl.insertAdjacentHTML('beforeend', `
        <div class="rapi-suggest-rail rapi-suggest-rail--ready">
          ${options.map((option, index) => `<button class="rapi-suggest-chip" type="button" onclick="rapiUseOption(${index})">${esc(option.label)}</button>`).join('')}
        </div>`);
      scrollRapiToLatest();
    };
    if (message) appendRapiTextMessage(message, feedbackContext, revealOptions);
    else revealOptions();
  }

  function renderRapiProducts(data, feedbackContext) {
    const resultsEl = document.getElementById('rapiResults');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    if (!resultsEl) return;
    const message = responseMessage(data);
    const products = responseProducts(data);
    _allResults = products;

    const revealProducts = () => {
      if (!products.length) {
        appendRapiTextMessage('Nao encontrei produtos para essa busca.', feedbackContext);
        return;
      }
      resultsEl.insertAdjacentHTML('beforeend', `
        <div class="rapi-product-rail" aria-label="Produtos sugeridos">
          ${products.map((p, i) => renderResultCard(p, i)).join('')}
        </div>`);
      if (showMoreBtn) showMoreBtn.classList.remove('visible');
      scrollRapiToLatest();
    };

    if (message) appendRapiTextMessage(message, feedbackContext, revealProducts);
    else revealProducts();
  }
  function renderRapiChatResponse(data, userMessage = '') {
    const type = String(data?.response_type || 'error').toLowerCase();
    const message = responseMessage(data) || 'Nao consegui responder agora. Tente novamente.';
    const explicitProductIds = Array.isArray(data?.selected_product_ids) ? data.selected_product_ids : null;
    const selectedProductIds = (explicitProductIds || responseProducts(data).map(product => product?.id || product?.product_id))
      .filter(productId => productId !== undefined && productId !== null && productId !== '');
    const feedbackContext = {
      user_message: userMessage,
      assistant_message: message,
      response_type: type,
      selected_product_ids: selectedProductIds
    };

    if (type === 'text') {
      appendRapiTextMessage(message, feedbackContext);
      return;
    }
    if (type === 'options') {
      renderRapiOptions(data, feedbackContext);
      return;
    }
    if (type === 'products') {
      renderRapiProducts(data, feedbackContext);
      return;
    }
    appendRapiTextMessage(message, feedbackContext);
  }

  async function postRapiChatMessage(message, signal) {
    const payload = {
      restaurant_id: getRapiRestaurantId(),
      session_id: ensureRapiSessionId(),
      message
    };
    const apiResponse = await window.PedeAquiApiClient.request('/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
      // LLM answer, much slower than a normal endpoint — the 8s default would cut it off.
      timeout: 30000
    });
    console.log('[Rapi] Resposta completa da API:', apiResponse);
    return normalizeChatResponse(apiResponse);
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

  function cacheRapiDetailProduct(product) {
    const productId = product?.id || product?.product_id || '';
    const cachedIndex = _rapiProductDetailCache.findIndex(cachedProduct => {
      const cachedId = cachedProduct?.id || cachedProduct?.product_id || '';
      return productId && cachedId && String(cachedId) === String(productId);
    });
    if (cachedIndex >= 0) {
      _rapiProductDetailCache[cachedIndex] = product;
      return cachedIndex;
    }
    _rapiProductDetailCache.push(product);
    return _rapiProductDetailCache.length - 1;
  }

  function renderResultCard(product, index) {
    const detailIndex = cacheRapiDetailProduct(product);
    const productName = formatProductTitle(product.name);
    return `
      <article class="rapi-result-card rapi-product-card" style="animation-delay:${index * 0.06}s"
        role="button" tabindex="0" aria-label="Ver detalhes de ${esc(productName)}"
        onclick="rapiOpenProductDetail(${detailIndex})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();rapiOpenProductDetail(${detailIndex})}">
        <div class="rapi-result-image-wrap">${renderProductImg(product)}</div>
        <div class="rapi-result-content">
          <div class="rapi-result-title">${esc(productName)}</div>
          <div class="rapi-result-price">${fmtPrice(product.price)}</div>
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
              <small class='delivery-time-text'>${esc(sub)}</small>
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
      <header class="rapi-utility-header" aria-label="Ações do Rapi">
        <button class="rapi-cart-button" id="rapiCartButton" type="button" onclick="openModal('cartModal')" aria-label="Abrir sacola" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <span class="rapi-cart-count" id="rapiCartCount">0</span>
        </button>
      </header>

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
        <div class="rapi-suggest-rail rapi-suggest-rail--waiting" id="rapiStarter"
          style="opacity:0!important;visibility:hidden!important;pointer-events:none!important">
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Me recomenda um prato')">Me recomenda um prato</button>
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Quero gastar ate R$ 50')">Quero gastar at&eacute; R$ 50</button>
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Pedido para 2 pessoas')">Pedido para 2 pessoas</button>
          <button class="rapi-suggest-chip" type="button" onclick="rapiUseSuggestion('Me surpreenda')">Me surpreenda</button>
        </div>

        <!-- Input bar -->
        <div class="rapi-ai-input-bar">
          <input class="rapi-ai-input" id="rapiInput" type="text"
            placeholder="Pergunte qualquer coisa..."
            oninput="rapiUpdateSendButton()"
            onkeydown="rapiInputKeydown(event)">
          <button class="rapi-ai-send is-inactive" onclick="rapiSendMessage()" type="button" aria-label="Enviar" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
            </svg>
          </button>
        </div>

      </div>

      <div class="rapi-product-detail" id="rapiProductDetail" role="dialog" aria-modal="true"
        aria-labelledby="rapiProductDetailTitle" hidden onclick="rapiCloseProductDetail()">
        <article class="rapi-product-detail-panel" onclick="event.stopPropagation()">
          <div class="rapi-product-detail-media">
            <img class="rapi-product-detail-image" id="rapiProductDetailImage" alt="">
            <div class="rapi-product-detail-placeholder" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16v16H4z"/><circle cx="9" cy="9" r="2"/><path d="m4 17 4-4 3 3 3-3 6 6"/>
              </svg>
            </div>
            <span class="rapi-product-detail-handle" aria-hidden="true"></span>
            <button class="rapi-product-detail-close" type="button" onclick="rapiCloseProductDetail()" aria-label="Fechar detalhes">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <div class="rapi-product-detail-content">
            <div class="rapi-product-detail-copy">
              <h3 class="rapi-product-detail-title" id="rapiProductDetailTitle"></h3>
              <div class="rapi-product-detail-price" id="rapiProductDetailPrice"></div>
              <p class="rapi-product-detail-description" id="rapiProductDetailDescription"></p>
              <div class="rapi-product-detail-recommendation">
                <strong>Escolha do Rapi</strong>
                <span id="rapiProductDetailRecommendation"></span>
              </div>
            </div>
            <button class="rapi-product-detail-question" type="button" onclick="rapiAddActiveProduct()">Adicionar à sacola</button>
          </div>
        </article>
      </div>

    </div>

    <div class="rapi-toast" id="rapiToast"></div>
    `;
  }

  /* ── Show toast ── */
  window.rapiOpenProductDetail = function (index) {
    const product = _rapiProductDetailCache[Number(index)];
    const detail = document.getElementById('rapiProductDetail');
    if (!product || !detail) return;

    const title = detail.querySelector('#rapiProductDetailTitle');
    const price = detail.querySelector('#rapiProductDetailPrice');
    const description = detail.querySelector('#rapiProductDetailDescription');
    const recommendation = detail.querySelector('#rapiProductDetailRecommendation');
    const image = detail.querySelector('#rapiProductDetailImage');
    const media = detail.querySelector('.rapi-product-detail-media');
    const imageSrc = product.image_url || product.image_path || '';
    const productName = formatProductTitle(product.name);

    _rapiActiveDetailProduct = product;
    if (title) title.textContent = productName;
    if (price) price.textContent = fmtPrice(product.price);
    if (description) {
      description.textContent = product.description || product.short_description || '';
      description.hidden = !description.textContent.trim();
    }
    if (recommendation) {
      recommendation.textContent = product.recommendation_reason
        || product.reason
        || product._reason
        || 'Uma sugestão selecionada de acordo com o que você pediu.';
    }
    if (image && media) {
      media.classList.toggle('has-no-image', !imageSrc);
      image.alt = productName;
      image.onerror = () => media.classList.add('has-no-image');
      image.onload = () => media.classList.remove('has-no-image');
      image.src = imageSrc;
    }

    if (detail._rapiCloseTimer) clearTimeout(detail._rapiCloseTimer);
    detail.hidden = false;
    document.body.classList.add('rapi-product-detail-open');
    detail.getBoundingClientRect();
    detail.classList.add('is-open');
    setTimeout(() => {
      detail.querySelector('.rapi-product-detail-close')?.focus({ preventScroll: true });
    }, 0);
  };

  window.rapiCloseProductDetail = function () {
    const detail = document.getElementById('rapiProductDetail');
    if (!detail || detail.hidden) return;
    detail.classList.remove('is-open');
    document.body.classList.remove('rapi-product-detail-open');
    detail._rapiCloseTimer = setTimeout(() => {
      detail.hidden = true;
      detail._rapiCloseTimer = null;
    }, 540);
  };

  window.rapiAddActiveProduct = function () {
    const product = _rapiActiveDetailProduct;
    if (!product) return;
    window.rapiCloseProductDetail();
    window.rapiAddProduct(product);
  };

  window.rapiViewProductInMenu = function () {
    const product = _rapiActiveDetailProduct;
    if (!product) return;
    const productId = product.id || product.product_id;
    const menuHasProduct = getRapiProducts().some(menuProduct => String(menuProduct.id) === String(productId));
    if (!menuHasProduct || typeof window.openProduct !== 'function') {
      showRapiToast('Produto não disponível no cardápio agora');
      return;
    }

    window.rapiCloseProductDetail();
    window.openProduct(productId);

    if (typeof window.mobNavMenu === 'function') {
      Promise.resolve(window.mobNavMenu())
        .catch(error => console.error('[Rapi] Não foi possível preparar o cardápio atrás do produto:', error));
    }
  };

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
    inputEl?.blur?.();

    _activeChipId = chipId || null;
    _rapiSending = true;
    _rapiAbortController = new AbortController();
    if (_introTypeTimer) {
      cancelAnimationFrame(_introTypeTimer);
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
    setRapiGenerating(true);
    appendRapiTypingIndicator();

    try {
      const response = await postRapiChatMessage(cleanMessage, _rapiAbortController.signal);
      console.log('[Rapi] Resumo da resposta:', {
        response_type: response?.response_type,
        products_count: Array.isArray(response?.products) ? response.products.length : 0
      });
      removeRapiTypingIndicator();
      _rapiResponseTimer = setTimeout(() => {
        _rapiResponseTimer = null;
        if (!_rapiSending) return;
        renderRapiChatResponse(response, cleanMessage);
        if (!_rapiActiveReveal) finishRapiGeneration();
      }, 190);
    } catch (error) {
      removeRapiTypingIndicator();
      if (error?.name === 'AbortError') {
        finishRapiGeneration();
        return;
      }
      _rapiResponseTimer = setTimeout(() => {
        _rapiResponseTimer = null;
        if (!_rapiSending) return;
        renderRapiChatResponse({
          response_type: 'error',
          message: error?.message || 'Nao consegui conectar ao Rapi agora. Tente novamente.'
        }, cleanMessage);
        if (!_rapiActiveReveal) finishRapiGeneration();
      }, 190);
    }
  }
  function setupRapiKeyboardViewport() {
    const view = document.getElementById('mobViewRapi');
    const input = document.getElementById('rapiInput');
    const viewport = window.visualViewport;
    if (!view || !input || input.dataset.keyboardViewportReady === '1') return;
    input.dataset.keyboardViewportReady = '1';

    let baselineHeight = 0;
    const updateKeyboardOffset = () => {
      if (document.activeElement !== input) return;
      const visibleHeight = Math.min(viewport?.height || window.innerHeight, window.innerHeight);
      const viewportTop = viewport?.offsetTop || 0;
      const keyboardHeight = Math.max(0, baselineHeight - visibleHeight - viewportTop);
      const introShift = Math.min(290, Math.max(180, keyboardHeight * .75));
      view.style.setProperty('--rapi-keyboard-height', `${keyboardHeight}px`);
      view.style.setProperty('--rapi-intro-shift', introShift + 'px');
      view.classList.toggle('rapi-keyboard-open', keyboardHeight > 60);
    };

    input.addEventListener('focus', () => {
      baselineHeight = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport?.height || 0);
      requestAnimationFrame(updateKeyboardOffset);
      setTimeout(updateKeyboardOffset, 120);
      setTimeout(updateKeyboardOffset, 320);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement === input) return;
        view.classList.remove('rapi-keyboard-open');
        view.style.removeProperty('--rapi-keyboard-height');
        view.style.removeProperty('--rapi-intro-shift');
      }, 80);
    });
    viewport?.addEventListener('resize', updateKeyboardOffset);
    viewport?.addEventListener('scroll', updateKeyboardOffset);
    window.addEventListener('resize', updateKeyboardOffset);
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
      cancelAnimationFrame(_introTypeTimer);
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

    typeRapiText(questionEl, text, {
      onFrame: frame => { _introTypeTimer = frame; },
      onComplete: () => {
        _introTypeTimer = null;
        revealSuggestions();
      }
    });
  }

  window.rapiUpdateSendButton = updateRapiSendButton;

  window.rapiSendMessage = function () {
    if (_rapiSending) {
      stopRapiGeneration();
      return;
    }
    const inputEl = document.getElementById('rapiInput');
    const msg = (inputEl?.value || '').trim();
    if (!msg) return;
    if (inputEl) inputEl.value = '';
    rapiSearch(msg, null, null);
  };

  const RAPI_COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const RAPI_COPIED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/></svg>';

  async function copyRapiText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Falha ao copiar a resposta');
  }

  window.rapiCopyResponse = async function (button) {
    const response = button?.closest('.rapi-chat-assistant-message')?.querySelector('.rapi-result-title');
    const text = response?.innerText?.trim();
    if (!button || !text) return;

    try {
      await copyRapiText(text);
      if (button._rapiCopyTimer) clearTimeout(button._rapiCopyTimer);
      button.classList.remove('is-copied');
      void button.offsetWidth;
      button.innerHTML = RAPI_COPIED_ICON;
      button.classList.add('is-copied');
      button.setAttribute('aria-label', 'Resposta copiada');

      button._rapiCopyTimer = setTimeout(() => {
        button.classList.remove('is-copied');
        button.innerHTML = RAPI_COPY_ICON;
        void button.offsetWidth;
        button.classList.add('is-restoring');
        button.setAttribute('aria-label', 'Copiar resposta');
        setTimeout(() => button.classList.remove('is-restoring'), 280);
        button._rapiCopyTimer = null;
      }, 3000);
    } catch (_) {
      showRapiToast('Não foi possível copiar a resposta');
    }
  };
  window.rapiRateResponse = async function (button) {
    if (!button) return;
    const actions = button.closest('.rapi-feedback-actions');
    const messageElement = button.closest('.rapi-chat-assistant-message');
    if (!actions) return;

    const wasSelected = button.classList.contains('is-selected');
    actions.querySelectorAll('.rapi-rating-btn').forEach(ratingButton => {
      ratingButton.classList.remove('is-selected');
      ratingButton.setAttribute('aria-pressed', 'false');
    });

    if (wasSelected) {
      actions.classList.remove('is-restoring-ratings');
      void actions.offsetWidth;
      actions.classList.add('is-restoring-ratings');
      setTimeout(() => actions.classList.remove('is-restoring-ratings'), 280);
    } else {
      button.classList.add('is-selected');
      button.setAttribute('aria-pressed', 'true');
    }

    if (actions.dataset.feedbackSent === '1') return;

    const feedback = button.dataset.feedback;
    const context = messageElement?._rapiFeedbackContext;
    if (!context || (feedback !== 'like' && feedback !== 'dislike')) return;

    actions.dataset.feedbackSent = '1';

    try {
      await window.PedeAquiApiClient.post('/chat/feedback', {
        restaurant_id: getRapiRestaurantId(),
        session_id: ensureRapiSessionId(),
        user_message: context.user_message,
        assistant_message: context.assistant_message,
        response_type: context.response_type,
        selected_product_ids: context.selected_product_ids,
        feedback
      });
    } catch (error) {
      console.error('[Rapi] Erro ao enviar feedback:', error);
    }
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
    resultsEl.innerHTML = `<div class="rapi-product-rail">${_allResults.map((p, i) => renderResultCard(p, i)).join('')}</div>`;
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
        const btn = typeof window.findCategoryButton === 'function'
          ? window.findCategoryButton(categorySlug)
          : Array.from(document.querySelectorAll('.cat')).find(b => b.dataset.catSlug === categorySlug) || null;
        window.scrollToCategory(categorySlug, btn);
      }, 400);
    }
  };

  window.renderRapiView = function (options = {}) {
    const view = document.getElementById('mobViewRapi');
    if (!view) return;
    const deferIntro = Boolean(options.deferIntro);
    view.classList.toggle('rapi-intro-deferred', deferIntro);

    if (!_rapiLoaded || !view.querySelector('.rapi-page')) {
      view.innerHTML = buildRapiView();
      _rapiLoaded = true;
      ensureRapiSessionId();
    } else {
      // Refresh location widget only
      const locationWrap = view.querySelector('.rapi-location-wrap');
      if (locationWrap) {
        const newWidget = buildRapiLocationWidget();
        const tmp = document.createElement('div');
        tmp.innerHTML = newWidget;
        locationWrap.replaceWith(tmp.firstElementChild);
      }
    }

    ensureRapiCartSubscription();
    syncRapiCartButton();
    setupRapiSuggestionDrag();
    setupRapiKeyboardViewport();

    // Reset inline ready styles before the browser paints a reused Rapi view.
    const introBody = view.querySelector('#rapiAiBody');
    const introQuestion = view.querySelector('#rapiIntroQuestion');
    const introStarter = view.querySelector('#rapiStarter');
    if (!introBody?.classList.contains('rapi-ai-body--searching') && introStarter) {
      if (introQuestion) {
        introQuestion.textContent = '';
        introQuestion.classList.remove('is-typing');
      }
      introStarter.classList.remove('hidden', 'rapi-suggest-rail--ready');
      introStarter.classList.add('rapi-suggest-rail--waiting');
      introStarter.style.setProperty('opacity', '0', 'important');
      introStarter.style.setProperty('visibility', 'hidden', 'important');
      introStarter.style.setProperty('pointer-events', 'none', 'important');
      introStarter.querySelectorAll('.rapi-suggest-chip').forEach(chip => {
        chip.style.setProperty('opacity', '0', 'important');
        chip.style.setProperty('visibility', 'hidden', 'important');
        chip.style.setProperty('transition', 'none', 'important');
        chip.style.setProperty('transition-delay', '0ms', 'important');
      });
    }
    const beginIntro = () => {
      view.classList.remove('rapi-intro-deferred');
      startRapiIntroAnimation();
    };
    if (!deferIntro) {
      setTimeout(beginIntro, 0);
      return;
    }

    const startedAt = performance.now();
    const waitForKeyboardLayout = () => {
      if (view.classList.contains('rapi-keyboard-open') || performance.now() - startedAt > 900) {
        setTimeout(beginIntro, 140);
        return;
      }
      requestAnimationFrame(waitForKeyboardLayout);
    };
    requestAnimationFrame(waitForKeyboardLayout);
  };
  window.rapiReset = function () {
    _activeChipId = null;
    _allResults = [];
    _rapiProductDetailCache = [];
    _rapiActiveDetailProduct = null;
    window.rapiCloseProductDetail();
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

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('rapi-product-detail-open')) {
      window.rapiCloseProductDetail();
    }
  });

})();
