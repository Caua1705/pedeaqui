/**
 * Assistente de pedido — a tela de chat do app do consumidor.
 *
 * O assistente é TRANSPORTE, não motor de recomendação: manda mensagem +
 * restaurant_id para POST /chat (onde o backend faz o RAG sobre o cardápio
 * daquele restaurante) e renderiza a resposta. Nada aqui pode saber o que o
 * restaurante vende — qualquer heurística de segmento (nomes de pratos, faixas
 * de preço em reais) quebra no primeiro tenant de outro vertical.
 *
 * MARCA: o app é white-label e o consumidor final nunca ouviu falar em Rapi nem
 * em Rapidex. Nada nesta superfície pode nomear a plataforma — nem o cabeçalho,
 * nem uma mensagem de erro, nem o alt de uma imagem. O mascote continua no repo
 * (assets/brand/rapi-*) para o produto do lojista; aqui ele deu lugar a uma
 * esfera abstrata desenhada em CSS a partir do primary_color do restaurante,
 * que por construção não pertence à plataforma. Os prefixos `rapi*` no código e
 * nos ids ficam: são nomes INTERNOS, não aparecem para o cliente, e renomear
 * 3,5 mil linhas de CSS por eles seria churn sem ganho.
 */
(function () {
  'use strict';

  /* ── Constants ── */
  const RAPI_SESSION_STORAGE_KEY = 'rapi.session_id';

  /* ── State ── */
  let _rapiLoaded = false;
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

  function getRapiRestaurant() {
    return window.PedeAquiRestaurantStore?.get?.()?.restaurant || {};
  }

  function getRapiRestaurantName() {
    return String(getRapiRestaurant().name || '').trim() || 'Restaurante';
  }

  function rapiInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = words[0][0] || '';
    const last = words.length > 1 ? words[words.length - 1][0] : '';
    return (first + last).toLocaleUpperCase('pt-BR');
  }

  /**
   * A esfera do assistente.
   *
   * É CSS puro — nem vídeo, nem GIF, nem sprite: as três camadas abaixo são
   * pintadas com as variáveis de marca do tenant (ver styles/rapi.css, seção
   * "ESFERA"). Um vídeo custaria uma requisição por estado e chegaria sempre na
   * cor errada, porque a cor só existe em runtime.
   *
   * Estados (data-state): `idle` respira devagar, `thinking` gira e pulsa mais
   * rápido com o brilho variando, `answering` volta ao ritmo calmo e `static`
   * não anima nunca (é o da barra de navegação, que precisa ler a 20px).
   */
  function sphereMarkup(modifier, state = 'idle', id = '') {
    return `
      <span class="rapi-sphere${modifier ? ` rapi-sphere--${modifier}` : ''}"${id ? ` id="${id}"` : ''} data-state="${state}" aria-hidden="true">
        <span class="rapi-sphere-halo"></span>
        <span class="rapi-sphere-body">
          <span class="rapi-sphere-swirl rapi-sphere-swirl--light"></span>
          <span class="rapi-sphere-swirl rapi-sphere-swirl--deep"></span>
          <span class="rapi-sphere-gloss"></span>
        </span>
      </span>`;
  }

  // A esfera grande espelha o estado da conversa. `static` nunca entra aqui: a
  // única esfera parada do app é a do menu inferior, que não representa estado.
  function setRapiSphereState(state) {
    document.getElementById('rapiIntroSphere')?.setAttribute('data-state', state);
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

  // Atributo de ação para markup gerado (ver scripts/utils/actions.js).
  // Mesmo contrato do helper de restaurant-page.js: passe o valor CRU, que a
  // spec vira JSON e só então é escapada.
  const act = (event, name, ...args) =>
    `data-act-${event}="${esc(args.length ? JSON.stringify([name, ...args]) : name)}"`;
  const actAll = (event, steps) => `data-act-${event}="${esc(JSON.stringify(steps))}"`;

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
    setRapiSphereState('idle');
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
    return payload || { response_type: 'error', message: 'Não consegui responder agora. Tente novamente.' };
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
        <button class="rapi-feedback-btn rapi-copy-btn" type="button" aria-label="Copiar resposta" ${act('click', 'rapiCopyResponse', '$this')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="rapi-feedback-btn rapi-rating-btn" type="button" aria-label="Gostei da resposta" aria-pressed="false" data-feedback="like" ${act('click', 'rapiRateResponse', '$this')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/><path d="M7 11 11 2a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2l-1 7a3 3 0 0 1-3 3H7Z"/></svg>
        </button>
        <button class="rapi-feedback-btn rapi-rating-btn" type="button" aria-label="Nao gostei da resposta" aria-pressed="false" data-feedback="dislike" ${act('click', 'rapiRateResponse', '$this')}>
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
  /**
   * Esqueleto de carregamento.
   *
   * Antes, "Preparando sugestões..." ficava sozinho no alto com meia tela em
   * branco embaixo — o cliente não tinha como saber se vinha texto, cartão ou
   * nada. O esqueleto ocupa EXATAMENTE o lugar da resposta: as barras têm a
   * medida das linhas do texto e a régua tem a medida dos cartões de produto,
   * então quando a resposta chega ela substitui blocos do mesmo tamanho em vez
   * de empurrar a tela. A esfera ao lado fica no estado "pensando".
   */
  function appendRapiTypingIndicator() {
    const resultsEl = document.getElementById('rapiResults');
    if (!resultsEl || document.getElementById('rapiTypingMessage')) return;
    let statusIndex = Math.floor(Math.random() * RAPI_TYPING_STATUSES.length);
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="rapi-result-card rapi-chat-assistant-message rapi-chat-typing" id="rapiTypingMessage" aria-live="polite">
        <div class="rapi-result-content">
          <div class="rapi-typing-row">
            ${sphereMarkup('mini', 'thinking')}
            <span class="rapi-typing-label" data-text="${RAPI_TYPING_STATUSES[statusIndex]}">${RAPI_TYPING_STATUSES[statusIndex]}</span>
          </div>
          <div class="rapi-skeleton-lines" aria-hidden="true">
            <span class="rapi-skeleton-line"></span>
            <span class="rapi-skeleton-line"></span>
            <span class="rapi-skeleton-line"></span>
          </div>
          <div class="rapi-skeleton-rail" aria-hidden="true">
            <span class="rapi-skeleton-card"></span>
            <span class="rapi-skeleton-card"></span>
            <span class="rapi-skeleton-card"></span>
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
          ${options.map((option, index) => `<button class="rapi-suggest-chip" type="button" ${act('click', 'rapiUseOption', index)}>${esc(option.label)}</button>`).join('')}
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

  /* ── Render helpers ── */
  function renderProductImg(product) {
    const src = product.image_url || product.image_path || '';
    if (!src) return `<div class="rapi-result-image-placeholder">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.2">
        <path d="M3 2h18l-2 7H5L3 2z"/><path d="M5 9l-1 13h16l-1-13"/>
      </svg></div>`;
    // O fallback era um onerror inline que montava HTML por string. Virou ação
    // registrada: o evento `error` não borbulha, mas o despachante escuta na
    // fase de captura, então a delegação alcança imagens criadas depois do boot.
    return `<img class="rapi-result-image" src="${esc(src)}" alt="${esc(product.name)}" loading="lazy"
      data-act-error="rapiImagePlaceholder">`;
  }

  // Troca a imagem quebrada pelo mesmo placeholder de sempre, montado por DOM.
  function rapiImagePlaceholder(image) {
    const parent = image?.parentNode;
    if (!parent) return;
    const box = document.createElement('div');
    box.className = 'rapi-result-image-placeholder';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '38');
    svg.setAttribute('height', '38');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#ccc');
    svg.setAttribute('stroke-width', '1.2');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3 2h18l-2 7H5L3 2z');
    svg.appendChild(path);
    box.appendChild(svg);
    parent.replaceChildren(box);
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
        ${act('click', 'rapiOpenProductDetail', detailIndex)}
        ${actAll('keydown', [['$enter'], ['rapiOpenProductDetail', detailIndex]])}>
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
        <div class="delivery-widget rapi-location-widget ${classes}" role="button" tabindex="0" ${act('click', 'openOperationScreen')} aria-label="Selecionar unidade e operação">
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

  // Sugestões iniciais. Vêm do restaurante quando ele as configura; o padrão é
  // deliberadamente neutro — sem nome de prato, sem segmento e sem valor em
  // reais, que era o caso de "Me recomenda um prato" / "Quero gastar até R$ 50"
  // (essas frases só fazem sentido num restaurante de comida com esse ticket).
  // As duas primeiras valem em qualquer vertical e são sempre estas.
  const RAPI_SUGGESTION_HEAD = [
    'O que você recomenda?',
    'Quais são os mais pedidos?'
  ];
  // As duas últimas saem do cardápio do tenant; estas só entram quando o
  // cardápio ainda não chegou, para a tela nunca abrir com duas sozinhas.
  const RAPI_SUGGESTION_TAIL = [
    'Quero uma sugestão para duas pessoas',
    'Me surpreenda'
  ];

  const RAPI_SUGGESTION_LIMIT = 4;

  /**
   * As duas últimas sugestões saem do CARDÁPIO do próprio tenant, não de uma
   * lista chumbada: "Tem sobremesas?" no Júnior, "Tem temakis?" num japonês.
   * Quem nomeia a categoria é o lojista, então a frase acompanha o vertical de
   * graça — e um app sem cardápio carregado simplesmente fica com as duas
   * perguntas neutras em vez de inventar uma terceira.
   *
   * O corte de 18 caracteres é de layout: acima disso o nome estoura a linha do
   * cartão de sugestão a 390px e o texto quebra no meio de uma palavra.
   */
  function rapiCategorySuggestions(limit) {
    if (limit <= 0) return [];
    const categories = (window.PedeAquiRestaurantStore?.get?.()?.categories || [])
      .map(category => String(category?.name || '').trim())
      .filter(name => name && Array.from(name).length <= 18);
    // De trás para a frente: o fim de um cardápio é onde o lojista põe o que
    // complementa o pedido, e é sobre isso que o cliente costuma ter dúvida.
    return categories.slice(-limit).reverse()
      .map(name => `Tem ${name.toLocaleLowerCase('pt-BR')}?`);
  }

  function rapiStarterSuggestions() {
    const store = window.PedeAquiRestaurantStore?.get?.() || {};
    const configured = store.restaurant?.rapi_suggestions || store.settings?.rapi_suggestions;
    const list = (Array.isArray(configured) ? configured : [])
      .map(item => String(item?.label ?? item ?? '').trim())
      .filter(Boolean);
    if (list.length) return list.slice(0, RAPI_SUGGESTION_LIMIT);
    const openSlots = RAPI_SUGGESTION_LIMIT - RAPI_SUGGESTION_HEAD.length;
    const fromMenu = rapiCategorySuggestions(openSlots);
    return RAPI_SUGGESTION_HEAD
      .concat(fromMenu.length ? fromMenu : RAPI_SUGGESTION_TAIL.slice(0, openSlots))
      .slice(0, RAPI_SUGGESTION_LIMIT);
  }

  // O texto vem da API ou do nome de uma categoria, então ele NÃO pode ser
  // interpolado dentro de um onclick="...('texto')": um apóstrofo quebraria o JS
  // do atributo. Vai como data-attribute e o clique é tratado por delegação.
  function starterSuggestionCards() {
    return rapiStarterSuggestions().map(suggestion => `
      <button class="rapi-starter-card" type="button" data-rapi-suggestion="${esc(suggestion)}">
        <span class="rapi-starter-card-label">${esc(suggestion)}</span>
        <svg class="rapi-starter-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="m12 5 7 7-7 7"/></svg>
      </button>`).join('');
  }

  function renderRapiStarterSuggestions() {
    const container = document.getElementById('rapiStarter');
    if (container) container.innerHTML = starterSuggestionCards();
  }

  /* ── Header ──
     Mesma estrutura das outras telas cheias do app (Pagamento PIX, Unidades e
     Operação, Usar cupom): botão à esquerda, título ao centro, botão à direita.

     A identidade é a do RESTAURANTE: logo e nome. Antes eram o mascote e o nome
     da plataforma, que o consumidor nunca viu na vida.

     Sem indicador "online": ele imitava presença humana e prometia uma resposta
     imediata que um bot atrás de um LLM não tem como cumprir — quando a resposta
     demorava oito segundos, o ponto verde virava mentira. O que a tela ainda
     precisa dizer sobre falha ela diz onde a falha acontece: na mensagem de erro
     dentro da conversa. */
  function buildRapiHeader() {
    return `
      <header class="rapi-hdr">
        <button class="rapi-hdr-btn" type="button" ${act('click', 'rapiGoBack')} aria-label="Voltar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>

        <div class="rapi-hdr-copy">
          <h2 class="rapi-hdr-title">
            <span class="rapi-hdr-logo" id="rapiHdrLogo" aria-hidden="true"></span>
            <span class="rapi-hdr-name" id="rapiHdrName"></span>
          </h2>
        </div>

        <div class="rapi-hdr-actions">
          <button class="rapi-hdr-btn rapi-cart-button" id="rapiCartButton" type="button" ${act('click', 'openModal', 'cartModal')} aria-label="Abrir sacola" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            <span class="rapi-cart-count" id="rapiCartCount">0</span>
          </button>

          <div class="rapi-hdr-menu-wrap">
            <button class="rapi-hdr-btn" id="rapiHdrMenuBtn" type="button" ${act('click', 'rapiToggleHeaderMenu')}
              aria-label="Mais ações" aria-haspopup="true" aria-expanded="false" aria-controls="rapiHdrMenu">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
            </button>
            <div class="rapi-hdr-menu" id="rapiHdrMenu" role="menu" aria-label="Ações da conversa" hidden>
              <button class="rapi-hdr-menu-item" type="button" role="menuitem" ${act('click', 'rapiClearConversation')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="m6 7 .9 11.2A2 2 0 0 0 8.9 20h6.2a2 2 0 0 0 2-1.8L18 7"/><path d="M10 11v5M14 11v5"/></svg>
                <span>Limpar conversa</span>
              </button>
            </div>
          </div>
        </div>
      </header>`;
  }

  /* ── Build the full view HTML ── */
  function buildRapiView() {
    const locationWidget = buildRapiLocationWidget();

    return `
    <div class="rapi-page" id="rapiPage">
      ${buildRapiHeader()}

      ${locationWidget}

      <!-- AI body -->
      <div class="rapi-ai-body" id="rapiAiBody">

        <!-- Abertura: esfera, pergunta e sugestões. A tela nunca abre vazia:
             ninguém sabe de cabeça o que perguntar a um chat de restaurante. -->
        <div class="rapi-orb-wrap">
          ${sphereMarkup('intro', 'idle', 'rapiIntroSphere')}
        </div>

        <!-- Question -->
        <div class="rapi-ai-question" id="rapiIntroQuestion" data-text="Como posso ajudar hoje?" aria-label="Como posso ajudar hoje?"></div>
        <div class="rapi-ai-subtitle">Me diga o que procura e eu encontro as melhores op&ccedil;&otilde;es do card&aacute;pio.</div>

        <div class="rapi-starter" id="rapiStarter" aria-label="Sugest&otilde;es de pergunta">
          ${starterSuggestionCards()}
        </div>

        <!-- Results area (shown after search) -->
        <div class="rapi-ai-results-wrap" id="rapiAiResultsWrap" style="display:none">
          <div class="rapi-thinking rapi-thinking--dark" id="rapiThinking">
            <div class="rapi-thinking-dots rapi-thinking-dots--dark">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div class="rapi-results-label rapi-results-label--dark" id="rapiResultsLabel">Sugestões para você</div>
          <div class="rapi-results" id="rapiResults"></div>
          <button class="rapi-show-more-btn rapi-show-more-btn--dark" id="rapiShowMoreBtn" ${act('click', 'rapiShowMoreResults')} type="button">
            Ver mais sugestões
          </button>
        </div>

      </div>

      <!-- Bottom dock: input -->
      <div class="rapi-bottom-dock">

        <!-- Input bar -->
        <div class="rapi-ai-input-bar">
          <input class="rapi-ai-input" id="rapiInput" type="text"
            placeholder="Pergunte qualquer coisa..."
            ${act('input', 'rapiUpdateSendButton')}
            ${act('keydown', 'rapiInputKeydown', '$event')}>
          <button class="rapi-ai-send is-inactive" ${act('click', 'rapiSendMessage')} type="button" aria-label="Enviar" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
            </svg>
          </button>
        </div>

      </div>

      <div class="rapi-product-detail" id="rapiProductDetail" role="dialog" aria-modal="true"
        aria-labelledby="rapiProductDetailTitle" hidden ${act('click', 'rapiCloseProductDetail')}>
        <article class="rapi-product-detail-panel" ${act('click', '$stop')}>
          <div class="rapi-product-detail-media">
            <img class="rapi-product-detail-image" id="rapiProductDetailImage" alt="">
            <div class="rapi-product-detail-placeholder" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16v16H4z"/><circle cx="9" cy="9" r="2"/><path d="m4 17 4-4 3 3 3-3 6 6"/>
              </svg>
            </div>
            <span class="rapi-product-detail-handle" aria-hidden="true"></span>
            <button class="rapi-product-detail-close" type="button" ${act('click', 'rapiCloseProductDetail')} aria-label="Fechar detalhes">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <div class="rapi-product-detail-content">
            <div class="rapi-product-detail-copy">
              <h3 class="rapi-product-detail-title" id="rapiProductDetailTitle"></h3>
              <div class="rapi-product-detail-price" id="rapiProductDetailPrice"></div>
              <p class="rapi-product-detail-description" id="rapiProductDetailDescription"></p>
              <!-- Era "Escolha do Rapi": a plataforma assinando a sugestão numa
                   tela onde ela não existe para o cliente. -->
              <div class="rapi-product-detail-recommendation">
                <strong>Por que indicamos</strong>
                <span id="rapiProductDetailRecommendation"></span>
              </div>
            </div>
            <button class="rapi-product-detail-question" type="button" ${act('click', 'rapiAddActiveProduct')}>Adicionar à sacola</button>
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
  async function rapiSearch(message) {
    const resultsEl = document.getElementById('rapiResults');
    const labelEl = document.getElementById('rapiResultsLabel');
    const showMoreBtn = document.getElementById('rapiShowMoreBtn');
    const aiBody = document.getElementById('rapiAiBody');
    const resultsWrap = document.getElementById('rapiAiResultsWrap');
    const inputEl = document.getElementById('rapiInput');
    if (!resultsEl || _rapiSending) return;

    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) return;
    inputEl?.blur?.();

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

    appendRapiUserMessage(cleanMessage);
    setRapiInputDisabled(true);
    setRapiGenerating(true);
    setRapiSphereState('thinking');
    appendRapiTypingIndicator();

    try {
      const response = await postRapiChatMessage(cleanMessage, _rapiAbortController.signal);
      console.log('[Rapi] Resumo da resposta:', {
        response_type: response?.response_type,
        products_count: Array.isArray(response?.products) ? response.products.length : 0
      });
      removeRapiTypingIndicator();
      setRapiSphereState('answering');
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
      setRapiSphereState('answering');
      _rapiResponseTimer = setTimeout(() => {
        _rapiResponseTimer = null;
        if (!_rapiSending) return;
        renderRapiChatResponse({
          response_type: 'error',
          message: error?.message || 'Não consegui responder agora. Tente novamente.'
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
    // O visualViewport sobrevive a qualquer view: sem o signal, estes tres
    // ficariam medindo teclado ate a pagina morrer.
    const signal = window.RapidexLifecycle?.signal;
    viewport?.addEventListener('resize', updateKeyboardOffset, { signal });
    viewport?.addEventListener('scroll', updateKeyboardOffset, { signal });
    window.addEventListener('resize', updateKeyboardOffset, { signal });
  }
  // Delegação: o rótulo da sugestão vem da API ou do nome de uma categoria,
  // então ele viaja em data-attribute em vez de ser interpolado num onclick —
  // um apóstrofo no nome quebraria o JS do atributo.
  function setupRapiSuggestionClicks() {
    const starter = document.getElementById('rapiStarter');
    if (!starter || starter.dataset.clicksReady === '1') return;
    starter.dataset.clicksReady = '1';
    starter.addEventListener('click', event => {
      const card = event.target.closest?.('[data-rapi-suggestion]');
      const suggestion = card?.dataset?.rapiSuggestion;
      if (suggestion) window.rapiUseSuggestion(suggestion);
    });
  }

  /**
   * Abertura da tela: a pergunta é digitada e as sugestões entram atrás dela.
   *
   * As classes fazem todo o trabalho (ver "ABERTURA" em styles/rapi.css). A
   * versão anterior escrevia doze propriedades inline com !important em cada
   * chip a cada abertura, porque a régua de sugestões morava no dock e brigava
   * com meia dúzia de regras antigas; fora do dock não há com quem brigar.
   */
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
    starterEl.classList.remove('is-ready');
    setRapiSphereState('idle');

    // Movimento reduzido: a abertura aparece pronta. Digitar letra a letra é
    // movimento como qualquer outro, e aqui ele ainda ATRASA as sugestões — que
    // só entram quando a frase termina.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      questionEl.classList.remove('is-typing');
      questionEl.textContent = text;
      starterEl.classList.add('is-ready');
      return;
    }

    typeRapiText(questionEl, text, {
      onFrame: frame => { _introTypeTimer = frame; },
      onComplete: () => {
        _introTypeTimer = null;
        if (document.getElementById('rapiAiBody')?.classList.contains('rapi-ai-body--searching')) return;
        starterEl.classList.add('is-ready');
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
    rapiSearch(msg);
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
    rapiSearch(message);
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
    syncRapiHeaderIdentity();
    setRapiHeaderMenuOpen(false);
    setupRapiSuggestionClicks();
    setupRapiKeyboardViewport();

    // A view é reaproveitada entre visitas: a abertura precisa voltar ao ponto
    // de partida antes do próximo quadro, ou a pergunta reaparece já escrita e
    // as sugestões piscam prontas antes de serem reveladas de novo.
    const introBody = view.querySelector('#rapiAiBody');
    const introQuestion = view.querySelector('#rapiIntroQuestion');
    const introStarter = view.querySelector('#rapiStarter');
    if (!introBody?.classList.contains('rapi-ai-body--searching') && introStarter) {
      if (introQuestion) {
        introQuestion.textContent = '';
        introQuestion.classList.remove('is-typing');
      }
      // O cardápio pode ter chegado depois da primeira montagem — daí as
      // sugestões de categoria só existirem a partir da segunda visita.
      renderRapiStarterSuggestions();
      introStarter.classList.remove('is-ready');
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
  /* ── Header: identidade do restaurante e menu ── */

  // Logo e nome saem do store a cada abertura, não da montagem: a view é
  // construída uma vez só, e a primeira construção pode acontecer antes de o
  // /info responder. O fallback são as iniciais, como nas outras telas.
  function syncRapiHeaderIdentity() {
    const logoBox = document.getElementById('rapiHdrLogo');
    const nameEl = document.getElementById('rapiHdrName');
    const name = getRapiRestaurantName();
    if (nameEl) nameEl.textContent = name;
    if (!logoBox) return;

    const restaurant = getRapiRestaurant();
    const logoUrl = restaurant.logo_url || restaurant.logo_path || '';
    const initials = rapiInitials(name);
    const showInitials = () => {
      logoBox.classList.add('is-fallback');
      logoBox.textContent = initials;
    };

    if (!logoUrl) {
      showInitials();
      return;
    }
    const image = document.createElement('img');
    image.src = logoUrl;
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', showInitials, { once: true });
    logoBox.classList.remove('is-fallback');
    logoBox.replaceChildren(image);
  }

  function setRapiHeaderMenuOpen(open) {
    const menu = document.getElementById('rapiHdrMenu');
    const button = document.getElementById('rapiHdrMenuBtn');
    if (!menu || !button) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-active', open);
    if (open) menu.querySelector('.rapi-hdr-menu-item')?.focus({ preventScroll: true });
  }

  window.rapiToggleHeaderMenu = function () {
    setRapiHeaderMenuOpen(Boolean(document.getElementById('rapiHdrMenu')?.hidden));
  };

  window.rapiClearConversation = function () {
    setRapiHeaderMenuOpen(false);
    stopRapiGeneration();
    // Sessão nova, e não só a tela em branco: o backend guarda a conversa por
    // session_id, então reaproveitar o id faria o assistente responder com a
    // memória do que o cliente acabou de apagar.
    _rapiSessionId = null;
    window.sessionStorage?.removeItem(RAPI_SESSION_STORAGE_KEY);
    ensureRapiSessionId();
    _rapiOptionCache = [];
    window.rapiReset();
    startRapiIntroAnimation();
    showRapiToast('Conversa limpa');
  };

  window.rapiReset = function () {
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
    document.getElementById('rapiStarter')?.classList.remove('is-ready');
    setRapiSphereState('idle');
    // Reset new AI layout elements
    const resultsWrap = document.getElementById('rapiAiResultsWrap');
    if (resultsWrap) resultsWrap.style.display = 'none';
    const aiBody = document.getElementById('rapiAiBody');
    if (aiBody) aiBody.classList.remove('rapi-ai-body--searching');
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.body.classList.contains('rapi-product-detail-open')) {
      window.rapiCloseProductDetail();
      return;
    }
    if (document.getElementById('rapiHdrMenu')?.hidden === false) {
      setRapiHeaderMenuOpen(false);
      document.getElementById('rapiHdrMenuBtn')?.focus({ preventScroll: true });
    }
  }, { signal: window.RapidexLifecycle?.signal });

  // Clique fora fecha o menu do cabeçalho. Na captura: o menu precisa sumir
  // mesmo quando o alvo do clique interrompe a propagação — o dispatcher de
  // ações escuta na fase de borbulha, então o que estava embaixo ainda executa.
  document.addEventListener('click', event => {
    if (document.getElementById('rapiHdrMenu')?.hidden !== false) return;
    if (event.target instanceof Element && event.target.closest('.rapi-hdr-menu-wrap')) return;
    setRapiHeaderMenuOpen(false);
  }, { capture: true, signal: window.RapidexLifecycle?.signal });

  // rapiImagePlaceholder é a única ação deste módulo que NÃO existe em window —
  // ela nasceu já como ação. As demais continuam globais porque restaurant-page.js
  // as chama por nome; o despachante resolve por window como fallback.
  window.RapidexActions?.register({ rapiImagePlaceholder });

})();
