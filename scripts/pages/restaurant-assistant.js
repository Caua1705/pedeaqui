/**
 * Assistente de pedido — a tela de chat do app do consumidor.
 *
 * O assistente é TRANSPORTE, não motor de recomendação: manda mensagem +
 * restaurant_id para POST /chat (onde o backend faz o RAG sobre o cardápio
 * daquele restaurante) e renderiza a resposta. Nada aqui pode saber o que o
 * restaurante vende — qualquer heurística de segmento (nomes de pratos, faixas
 * de preço em reais) quebra no primeiro tenant de outro vertical.
 *
 * MARCA: o app é white-label e o consumidor final nunca ouviu falar na
 * plataforma nem no mascote dela. Nada nesta superfície pode nomear nenhum dos
 * dois — nem o cabeçalho, nem uma mensagem de erro, nem um aria-label. Os
 * arquivos do mascote saíram do repositório; no lugar dele há uma janela
 * desenhada em CSS a partir do primary_color do restaurante, que por construção
 * não pertence à plataforma.
 *
 * A ÚNICA exceção é `rapi_suggestions`, logo abaixo: é o nome do campo que a
 * API devolve, não um texto de tela. Renomear aqui não renomeia lá — só faria o
 * app parar de ler as sugestões que o lojista cadastrou.
 */
(function () {
  'use strict';

  /* ── Constants ── */
  const ASSISTANT_SESSION_STORAGE_KEY = 'assistant.session_id';

  /* ── State ── */
  let _assistantLoaded = false;
  let _allResults = [];
  let _introTypeTimer = null;
  let _assistantSessionId = null;
  let _assistantSending = false;
  let _assistantAbortController = null;
  let _assistantResponseTimer = null;
  let _assistantActiveReveal = null;
  let _assistantOptionCache = [];
  let _assistantProductDetailCache = [];
  let _assistantActiveDetailProduct = null;
  let _assistantTypingStatusTimer = null;
  let _assistantCartUnsubscribe = null;

  const ASSISTANT_TYPING_STATUSES = [
    'Preparando sugestões...',
    'Buscando no cardápio...',
    'Digitando...'
  ];

  /* ── Helpers ── */
  function getAssistantProducts() {
    return (window.PedeAquiRestaurantStore?.get?.()?.products || []);
  }

  /**
   * A marca do assistente: um sparkle de quatro pontas na cor do restaurante,
   * dentro de um círculo suave da mesma cor.
   *
   * VETOR NÍTIDO, SEM DESFOQUE. O que existia aqui antes era uma nuvem de ruído
   * fractal (feTurbulence + feDisplacementMap + feGaussianBlur). Sete tentativas
   * mostraram que desfoque sobre fundo claro sempre degenera em mancha
   * pixelada, principalmente na tela do celular, onde o filtro é rasterizado
   * numa resolução baixa. O problema era a técnica, não a calibragem — daí a
   * troca por geometria de borda definida, que escala em qualquer tamanho e
   * nunca vira artefato. Nada aqui pode voltar a introduzir blur.
   *
   * A cor sai de --brand-primary, como antes: nenhum hex fixo, senão o
   * componente chega na cor de outro restaurante.
   *
   * É decorativo (aria-hidden): quem diz o que a tela é, é o título logo abaixo.
   */
  function markMarkup({ size = '', id = '', thinking = false } = {}) {
    const classes = ['assistant-mark'];
    if (size) classes.push(`assistant-mark--${size}`);
    if (thinking) classes.push('is-thinking');
    return `
      <div class="${classes.join(' ')}"${id ? ` id="${id}"` : ''} aria-hidden="true">
        <svg viewBox="0 0 24 24" class="assistant-mark__glyph" focusable="false"
             xmlns="http://www.w3.org/2000/svg">
          <path class="assistant-mark__star" d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10Z"/>
          <path class="assistant-mark__spark" d="M19 3.2c.2 1.7 1.6 3.1 3.3 3.3-1.7.2-3.1 1.6-3.3 3.3-.2-1.7-1.6-3.1-3.3-3.3 1.7-.2 3.1-1.6 3.3-3.3Z"/>
        </svg>
      </div>`;
  }

  // Só existem dois ritmos: pensando e o resto. "Respondendo" é o ritmo calmo —
  // a resposta já está entrando na tela e uma marca agitada atrás dela
  // competiria com o texto.
  function setAssistantMarkState(state) {
    document.getElementById('assistantIntroMark')
      ?.classList.toggle('is-thinking', state === 'thinking');
  }

  function fmtPrice(val) {
    return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function assistantCartQuantity(snapshot) {
    return (snapshot?.items || []).reduce((total, item) => total + Number(item?.qty || 0), 0);
  }

  function syncAssistantCartButton(snapshot = window.PedeAquiCartStore?.get?.()) {
    const button = document.getElementById('assistantCartButton');
    const count = document.getElementById('assistantCartCount');
    if (!button || !count) return;
    const quantity = assistantCartQuantity(snapshot);
    button.hidden = quantity <= 0;
    count.textContent = String(quantity);
    button.setAttribute('aria-label', quantity === 1
      ? 'Abrir sacola com 1 item'
      : `Abrir sacola com ${quantity} itens`);
  }

  function ensureAssistantCartSubscription() {
    const store = window.PedeAquiCartStore;
    if (_assistantCartUnsubscribe || !store?.subscribe) return;
    _assistantCartUnsubscribe = store.subscribe((current, previous) => {
      syncAssistantCartButton(current);
      const addedQuantity = assistantCartQuantity(current) - assistantCartQuantity(previous);
      if (addedQuantity > 0 && document.getElementById('mobViewAssistant')?.classList.contains('active')) {
        showAssistantToast('Adicionado à sacola');
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

  function renderAssistantMarkdown(text) {
    return esc(text).replace(/(?:\r?\n){3,}/g, '\n\n')
      .replace(/\n([^\n]*\?\s*)$/, '<span class="assistant-final-question">$1</span>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderAssistantStreamingMarkdown(text) {
    const escaped = esc(text).replace(/(?:\r?\n){3,}/g, '\n\n');
    const completed = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    return completed.replace(/\*\*([^*]*)$/, '<strong>$1</strong>');
  }

  /* ── Intent detection ── */
  function getAssistantRestaurantId() {
    const store = window.PedeAquiRestaurantStore?.get?.() || {};
    return store.restaurant?.id
      || store.branches?.[0]?.restaurant_id
      || store.products?.[0]?.restaurant_id
      || store.restaurant?.slug
      || window.RapidexTenant?.resolveSlug?.()
      || '';
  }

  function ensureAssistantSessionId() {
    if (_assistantSessionId) return _assistantSessionId;

    const storedSessionId = window.sessionStorage?.getItem(ASSISTANT_SESSION_STORAGE_KEY);
    if (storedSessionId) {
      _assistantSessionId = storedSessionId;
      return _assistantSessionId;
    }

    const cryptoObj = window.crypto;
    _assistantSessionId = cryptoObj?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => {
      const randomValue = cryptoObj?.getRandomValues?.(new Uint8Array(1))[0] || Math.floor(Math.random() * 256);
      return (Number(c) ^ randomValue & 15 >> Number(c) / 4).toString(16);
    });
    window.sessionStorage?.setItem(ASSISTANT_SESSION_STORAGE_KEY, _assistantSessionId);
    return _assistantSessionId;
  }

  function setAssistantInputDisabled(disabled) {
    const inputEl = document.getElementById('assistantInput');
    if (inputEl) inputEl.disabled = Boolean(disabled);
  }

  function updateAssistantSendButton() {
    const inputEl = document.getElementById('assistantInput');
    const sendBtn = document.querySelector('.assistant-ai-send');
    if (!sendBtn || _assistantSending) return;
    const hasText = Boolean(inputEl?.value?.trim());
    sendBtn.disabled = !hasText;
    sendBtn.classList.toggle('is-ready', hasText);
    sendBtn.classList.toggle('is-inactive', !hasText);
  }

  function setAssistantGenerating(generating) {
    const sendBtn = document.querySelector('.assistant-ai-send');
    if (!sendBtn) return;
    sendBtn.classList.toggle('is-stopping', Boolean(generating));
    sendBtn.classList.remove('is-ready', 'is-inactive');
    sendBtn.disabled = false;
    sendBtn.setAttribute('aria-label', generating ? 'Parar resposta' : 'Enviar');
    sendBtn.setAttribute('title', generating ? 'Parar resposta' : 'Enviar');
    sendBtn.innerHTML = generating
      ? '<span class="assistant-stop-icon" aria-hidden="true"></span>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
    if (!generating) updateAssistantSendButton();
  }

  function finishAssistantGeneration() {
    _assistantSending = false;
    _assistantAbortController = null;
    _assistantActiveReveal = null;
    setAssistantInputDisabled(false);
    setAssistantGenerating(false);
  }

  function stopAssistantGeneration() {
    if (!_assistantSending) return;
    _assistantAbortController?.abort();
    _assistantAbortController = null;
    if (_assistantResponseTimer) {
      clearTimeout(_assistantResponseTimer);
      _assistantResponseTimer = null;
    }
    removeAssistantTypingIndicator();
    const title = _assistantActiveReveal;
    if (title?._assistantRevealTimer) {
      clearTimeout(title._assistantRevealTimer);
      title._assistantRevealTimer = null;
    }
    title?.closest('.assistant-chat-assistant-message')?.classList.remove('is-typing-response');
    setAssistantMarkState('idle');
    finishAssistantGeneration();
  }

  function scrollAssistantToLatest() {
    const wrap = document.getElementById('assistantAiResultsWrap');
    const page = document.getElementById('assistantPage');
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

  function appendAssistantUserMessage(message) {
    const resultsEl = document.getElementById('assistantResults');
    if (!resultsEl) return;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="assistant-result-card assistant-chat-user-message">
        <div class="assistant-result-content">
          <div class="assistant-result-title">${esc(message)}</div>
        </div>
      </div>`);
    scrollAssistantToLatest();
  }

  function renderAssistantFeedbackActions() {
    return `
      <div class="assistant-feedback-actions" aria-label="Acoes da resposta">
        <button class="assistant-feedback-btn assistant-copy-btn" type="button" aria-label="Copiar resposta" ${act('click', 'assistantCopyResponse', '$this')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="assistant-feedback-btn assistant-rating-btn" type="button" aria-label="Gostei da resposta" aria-pressed="false" data-feedback="like" ${act('click', 'assistantRateResponse', '$this')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/><path d="M7 11 11 2a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2l-1 7a3 3 0 0 1-3 3H7Z"/></svg>
        </button>
        <button class="assistant-feedback-btn assistant-rating-btn" type="button" aria-label="Nao gostei da resposta" aria-pressed="false" data-feedback="dislike" ${act('click', 'assistantRateResponse', '$this')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/><path d="M17 13 13 22a3 3 0 0 1-3-3v-4H5a2 2 0 0 1-2-2l1-7a3 3 0 0 1 3-3h10Z"/></svg>
        </button>
      </div>`;
  }
  const ASSISTANT_REVEAL_MS_PER_CHARACTER = 34;

  function typeAssistantText(element, text, options = {}) {
    if (!element) return;
    const characters = Array.from(String(text || ''));
    let visibleCharacters = 0;
    let startedAt = null;

    if (element._assistantTypingFrame) cancelAnimationFrame(element._assistantTypingFrame);
    element.textContent = '';
    element.classList.add('is-typing');

    const finish = () => {
      element._assistantTypingFrame = null;
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
        element._assistantTypingFrame = null;
        return;
      }
      if (startedAt === null) startedAt = timestamp;
      const nextVisibleCharacters = Math.min(
        characters.length,
        Math.floor((timestamp - startedAt) / ASSISTANT_REVEAL_MS_PER_CHARACTER) + 1
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
      element._assistantTypingFrame = requestAnimationFrame(tick);
      options.onFrame?.(element._assistantTypingFrame);
    };

    element._assistantTypingFrame = requestAnimationFrame(tick);
    options.onFrame?.(element._assistantTypingFrame);
  }
  const ASSISTANT_RESPONSE_WORDS_PER_STEP = 3;
  const ASSISTANT_RESPONSE_REVEAL_INTERVAL = 80;

  function revealAssistantResponse(element, text, options = {}) {
    if (!element) return;
    _assistantActiveReveal = element;
    const wordSegments = String(text || '').match(/\S+\s*/g) || [];
    let visibleWords = 0;

    if (element._assistantRevealTimer) clearTimeout(element._assistantRevealTimer);
    element.textContent = '';

    const finish = () => {
      element._assistantRevealTimer = null;
      if (_assistantActiveReveal === element) _assistantActiveReveal = null;
      options.renderFinal?.();
      options.onComplete?.();
      if (_assistantSending) finishAssistantGeneration();
    };

    if (!wordSegments.length) {
      finish();
      return;
    }

    const revealNextBlock = () => {
      if (!element.isConnected) {
        element._assistantRevealTimer = null;
        return;
      }
      visibleWords = Math.min(
        wordSegments.length,
        visibleWords + ASSISTANT_RESPONSE_WORDS_PER_STEP
      );
      element.innerHTML = renderAssistantStreamingMarkdown(
        wordSegments.slice(0, visibleWords).join('')
      );
      options.onProgress?.(visibleWords);
      if (visibleWords >= wordSegments.length) {
        finish();
        return;
      }
      element._assistantRevealTimer = setTimeout(
        revealNextBlock,
        ASSISTANT_RESPONSE_REVEAL_INTERVAL
      );
    };

    revealNextBlock();
  }
  function appendAssistantTextMessage(message, feedbackContext = null, onComplete = null) {
    const resultsEl = document.getElementById('assistantResults');
    if (!resultsEl) return;
    const text = message || 'Certo.';
    const preview = document.createElement('div');
    preview.innerHTML = renderAssistantMarkdown(text);
    const plainText = preview.textContent || text;
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="assistant-result-card assistant-chat-assistant-message is-typing-response">
        <div class="assistant-result-content">
          <div class="assistant-result-title" aria-label="${esc(plainText)}"></div>
          ${renderAssistantFeedbackActions()}
        </div>
      </div>`);
    const messageElement = resultsEl.lastElementChild;
    const title = messageElement?.querySelector('.assistant-result-title');
    if (messageElement && feedbackContext) messageElement._assistantFeedbackContext = feedbackContext;

    revealAssistantResponse(title, text, {
      onProgress: scrollAssistantToLatest,
      renderFinal: () => {
        title.innerHTML = renderAssistantMarkdown(text);
        messageElement.classList.remove('is-typing-response');
        scrollAssistantToLatest();
      },
      onComplete
    });
    scrollAssistantToLatest();
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
  function appendAssistantTypingIndicator() {
    const resultsEl = document.getElementById('assistantResults');
    if (!resultsEl || document.getElementById('assistantTypingMessage')) return;
    let statusIndex = Math.floor(Math.random() * ASSISTANT_TYPING_STATUSES.length);
    resultsEl.insertAdjacentHTML('beforeend', `
      <div class="assistant-result-card assistant-chat-assistant-message assistant-chat-typing" id="assistantTypingMessage" aria-live="polite">
        <div class="assistant-result-content">
          <div class="assistant-typing-row">
            ${markMarkup({ size: 'mini', thinking: true })}
            <span class="assistant-typing-label" data-text="${ASSISTANT_TYPING_STATUSES[statusIndex]}">${ASSISTANT_TYPING_STATUSES[statusIndex]}</span>
          </div>
          <div class="assistant-skeleton-lines" aria-hidden="true">
            <span class="assistant-skeleton-line"></span>
            <span class="assistant-skeleton-line"></span>
            <span class="assistant-skeleton-line"></span>
          </div>
          <div class="assistant-skeleton-rail" aria-hidden="true">
            <span class="assistant-skeleton-card"></span>
            <span class="assistant-skeleton-card"></span>
            <span class="assistant-skeleton-card"></span>
          </div>
        </div>
      </div>`);
    clearTimeout(_assistantTypingStatusTimer);
    const scheduleNextStatus = () => {
      const delay = 4200 + Math.floor(Math.random() * 2801);
      _assistantTypingStatusTimer = setTimeout(() => {
        const label = document.querySelector('#assistantTypingMessage .assistant-typing-label');
        if (!label) {
          _assistantTypingStatusTimer = null;
          return;
        }
        const alternatives = ASSISTANT_TYPING_STATUSES
          .map((_, index) => index)
          .filter(index => index !== statusIndex);
        statusIndex = alternatives[Math.floor(Math.random() * alternatives.length)];
        label.textContent = ASSISTANT_TYPING_STATUSES[statusIndex];
        label.dataset.text = ASSISTANT_TYPING_STATUSES[statusIndex];
        scheduleNextStatus();
      }, delay);
    };
    scheduleNextStatus();
    scrollAssistantToLatest();
  }

  function removeAssistantTypingIndicator() {
    clearTimeout(_assistantTypingStatusTimer);
    _assistantTypingStatusTimer = null;
    const typingEl = document.getElementById('assistantTypingMessage');
    if (!typingEl) return;
    typingEl.style.transition = 'opacity .18s ease';
    typingEl.style.opacity = '0';
    setTimeout(() => typingEl.remove(), 180);
  }
  function renderAssistantOptions(data, feedbackContext) {
    const resultsEl = document.getElementById('assistantResults');
    if (!resultsEl) return;
    const message = responseMessage(data);
    const options = responseOptions(data);
    const revealOptions = () => {
      if (!options.length) return;
      _assistantOptionCache = options;
      resultsEl.insertAdjacentHTML('beforeend', `
        <div class="assistant-suggest-rail assistant-suggest-rail--ready">
          ${options.map((option, index) => `<button class="assistant-suggest-chip" type="button" ${act('click', 'assistantUseOption', index)}>${esc(option.label)}</button>`).join('')}
        </div>`);
      scrollAssistantToLatest();
    };
    if (message) appendAssistantTextMessage(message, feedbackContext, revealOptions);
    else revealOptions();
  }

  function renderAssistantProducts(data, feedbackContext) {
    const resultsEl = document.getElementById('assistantResults');
    const showMoreBtn = document.getElementById('assistantShowMoreBtn');
    if (!resultsEl) return;
    const message = responseMessage(data);
    const products = responseProducts(data);
    _allResults = products;

    const revealProducts = () => {
      if (!products.length) {
        appendAssistantTextMessage('Nao encontrei produtos para essa busca.', feedbackContext);
        return;
      }
      resultsEl.insertAdjacentHTML('beforeend', `
        <div class="assistant-product-rail" aria-label="Produtos sugeridos">
          ${products.map((p, i) => renderResultCard(p, i)).join('')}
        </div>`);
      if (showMoreBtn) showMoreBtn.classList.remove('visible');
      scrollAssistantToLatest();
    };

    if (message) appendAssistantTextMessage(message, feedbackContext, revealProducts);
    else revealProducts();
  }
  function renderAssistantChatResponse(data, userMessage = '') {
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
      appendAssistantTextMessage(message, feedbackContext);
      return;
    }
    if (type === 'options') {
      renderAssistantOptions(data, feedbackContext);
      return;
    }
    if (type === 'products') {
      renderAssistantProducts(data, feedbackContext);
      return;
    }
    appendAssistantTextMessage(message, feedbackContext);
  }

  async function postAssistantChatMessage(message, signal) {
    const payload = {
      restaurant_id: getAssistantRestaurantId(),
      session_id: ensureAssistantSessionId(),
      message
    };
    const apiResponse = await window.PedeAquiApiClient.request('/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
      // LLM answer, much slower than a normal endpoint — the 8s default would cut it off.
      timeout: 30000
    });
    console.log('[Assistente] Resposta completa da API:', apiResponse);
    return normalizeChatResponse(apiResponse);
  }

  /* ── Render helpers ── */
  function renderProductImg(product) {
    const src = product.image_url || product.image_path || '';
    if (!src) return `<div class="assistant-result-image-placeholder">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.2">
        <path d="M3 2h18l-2 7H5L3 2z"/><path d="M5 9l-1 13h16l-1-13"/>
      </svg></div>`;
    // O fallback era um onerror inline que montava HTML por string. Virou ação
    // registrada: o evento `error` não borbulha, mas o despachante escuta na
    // fase de captura, então a delegação alcança imagens criadas depois do boot.
    return `<img class="assistant-result-image" src="${esc(src)}" alt="${esc(product.name)}" loading="lazy"
      data-act-error="assistantImagePlaceholder">`;
  }

  // Troca a imagem quebrada pelo mesmo placeholder de sempre, montado por DOM.
  function assistantImagePlaceholder(image) {
    const parent = image?.parentNode;
    if (!parent) return;
    const box = document.createElement('div');
    box.className = 'assistant-result-image-placeholder';
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

  function cacheAssistantDetailProduct(product) {
    const productId = product?.id || product?.product_id || '';
    const cachedIndex = _assistantProductDetailCache.findIndex(cachedProduct => {
      const cachedId = cachedProduct?.id || cachedProduct?.product_id || '';
      return productId && cachedId && String(cachedId) === String(productId);
    });
    if (cachedIndex >= 0) {
      _assistantProductDetailCache[cachedIndex] = product;
      return cachedIndex;
    }
    _assistantProductDetailCache.push(product);
    return _assistantProductDetailCache.length - 1;
  }

  function renderResultCard(product, index) {
    const detailIndex = cacheAssistantDetailProduct(product);
    const productName = formatProductTitle(product.name);
    return `
      <article class="assistant-result-card assistant-product-card" style="animation-delay:${index * 0.06}s"
        role="button" tabindex="0" aria-label="Ver detalhes de ${esc(productName)}"
        ${act('click', 'assistantOpenProductDetail', detailIndex)}
        ${actAll('keydown', [['$enter'], ['assistantOpenProductDetail', detailIndex]])}>
        <div class="assistant-result-image-wrap">${renderProductImg(product)}</div>
        <div class="assistant-result-content">
          <div class="assistant-result-title">${esc(productName)}</div>
          <div class="assistant-result-price">${fmtPrice(product.price)}</div>
        </div>
      </article>`;
  }

  /* ── Build the location widget (clone from home tab) ── */
  function buildAssistantLocationWidget() {
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
      <div class="assistant-location-wrap">
        <div class="delivery-widget assistant-location-widget ${classes}" role="button" tabindex="0" ${act('click', 'openOperationScreen')} aria-label="Selecionar unidade e operação">
          <div class="delivery-widget-tabs">
            <span class="delivery-widget-tab assistant-location-tab assistant-location-tab--mode active">${esc(delivery)}</span>
            <span class="delivery-widget-tab assistant-location-tab assistant-location-tab--brand">${esc(brand)}</span>
            <span class="delivery-widget-tab assistant-location-tab assistant-location-tab--branch">${esc(branch)}</span>
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
  const ASSISTANT_SUGGESTION_HEAD = [
    'O que você recomenda?',
    'Quais são os mais pedidos?'
  ];
  // As últimas saem do cardápio do tenant; estas só entram quando o cardápio
  // ainda não chegou, para a tela nunca abrir com duas sozinhas.
  const ASSISTANT_SUGGESTION_TAIL = [
    'Quero uma sugestão para duas pessoas',
    'Me surpreenda'
  ];

  // A régua rola na horizontal, então o número deixou de ser limite de layout —
  // a lista da API entra inteira até aqui. O teto existe só para uma resposta
  // absurda não virar uma régua de trinta pílulas.
  const ASSISTANT_SUGGESTION_LIMIT = 8;
  // Quantas geramos quando o lojista não configurou nada: duas neutras mais as
  // categorias do cardápio.
  const ASSISTANT_SUGGESTION_DEFAULTS = 4;

  /**
   * A última sugestão sai do CARDÁPIO do próprio tenant, não de uma lista
   * chumbada: "Tem sobremesas?" no Júnior, "Tem temakis?" num japonês. Quem
   * nomeia a categoria é o lojista, então a frase acompanha o vertical de graça
   * — e um app sem cardápio carregado fica com as duas perguntas neutras mais
   * uma genérica, em vez de inventar um segmento.
   *
   * O corte de 18 caracteres é de layout: acima disso o nome estoura a linha do
   * cartão de sugestão a 390px e o texto quebra no meio de uma palavra.
   */
  function assistantCategorySuggestions(limit) {
    if (limit <= 0) return [];
    const categories = (window.PedeAquiRestaurantStore?.get?.()?.categories || [])
      .map(category => String(category?.name || '').trim())
      .filter(name => name && Array.from(name).length <= 18);
    // De trás para a frente: o fim de um cardápio é onde o lojista põe o que
    // complementa o pedido, e é sobre isso que o cliente costuma ter dúvida.
    return categories.slice(-limit).reverse()
      .map(name => `Tem ${name.toLocaleLowerCase('pt-BR')}?`);
  }

  function assistantStarterSuggestions() {
    const store = window.PedeAquiRestaurantStore?.get?.() || {};
    // NOME DE CAMPO DA API, não texto de tela: quem escolheu foi o backend, e
    // renomear aqui só faria o app deixar de ler o que o lojista cadastrou.
    // Trocar o nome exige mudar a API primeiro — ver o cabeçalho do arquivo.
    const configured = store.restaurant?.rapi_suggestions || store.settings?.rapi_suggestions;
    const list = (Array.isArray(configured) ? configured : [])
      .map(item => String(item?.label ?? item ?? '').trim())
      .filter(Boolean);
    if (list.length) return list.slice(0, ASSISTANT_SUGGESTION_LIMIT);
    const openSlots = ASSISTANT_SUGGESTION_DEFAULTS - ASSISTANT_SUGGESTION_HEAD.length;
    const fromMenu = assistantCategorySuggestions(openSlots);
    return ASSISTANT_SUGGESTION_HEAD
      .concat(fromMenu.length ? fromMenu : ASSISTANT_SUGGESTION_TAIL.slice(0, openSlots))
      .slice(0, ASSISTANT_SUGGESTION_DEFAULTS);
  }

  // O texto vem da API ou do nome de uma categoria, então ele NÃO pode ser
  // interpolado dentro de um onclick="...('texto')": um apóstrofo quebraria o JS
  // do atributo. Vai como data-attribute e o clique é tratado por delegação.
  //
  // Sem a seta à direita: o cartão inteiro já é clicável, então ela não dizia
  // nada que a forma do cartão não dissesse, e ainda comia largura do texto.
  function starterSuggestionCards() {
    return assistantStarterSuggestions().map(suggestion => `
      <button class="assistant-starter-card" type="button" data-assistant-suggestion="${esc(suggestion)}">
        <span class="assistant-starter-card-label">${esc(suggestion)}</span>
      </button>`).join('');
  }

  function renderAssistantStarterSuggestions() {
    const container = document.getElementById('assistantStarter');
    if (container) container.innerHTML = starterSuggestionCards();
  }

  /* ── Header ──
     Mesma estrutura das outras telas cheias do app (Pagamento PIX, Unidades e
     Operação, Usar cupom): botão à esquerda, título ao centro, botão à direita.

     O título diz o que a tela É — "Chat" —, e não como ela se chama. Um nome
     próprio aqui só teria dono, e o dono não seria o restaurante. "Chat" é mais
     curto que "Assistente" e qualquer cliente reconhece; o botão da navegação,
     que não tem texto visível, continua com aria-label="Assistente".

     Sem indicador "online": ele imitava presença humana e prometia uma resposta
     imediata que um bot atrás de um LLM não tem como cumprir — quando a resposta
     demorava oito segundos, o ponto verde virava mentira. O que a tela ainda
     precisa dizer sobre falha ela diz onde a falha acontece: na mensagem de erro
     dentro da conversa. */
  function buildAssistantHeader() {
    return `
      <header class="assistant-hdr">
        <button class="assistant-hdr-btn" type="button" ${act('click', 'assistantGoBack')} aria-label="Voltar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>

        <div class="assistant-hdr-copy">
          <h2 class="assistant-hdr-title">
            <span class="assistant-hdr-name" id="assistantHdrName">Chat</span>
          </h2>
        </div>

        <div class="assistant-hdr-actions">
          <button class="assistant-hdr-btn assistant-cart-button" id="assistantCartButton" type="button" ${act('click', 'openModal', 'cartModal')} aria-label="Abrir sacola" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            <span class="assistant-cart-count" id="assistantCartCount">0</span>
          </button>

          <div class="assistant-hdr-menu-wrap">
            <button class="assistant-hdr-btn" id="assistantHdrMenuBtn" type="button" ${act('click', 'assistantToggleHeaderMenu')}
              aria-label="Mais ações" aria-haspopup="true" aria-expanded="false" aria-controls="assistantHdrMenu">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
            </button>
            <div class="assistant-hdr-menu" id="assistantHdrMenu" role="menu" aria-label="Ações da conversa" hidden>
              <button class="assistant-hdr-menu-item" type="button" role="menuitem" ${act('click', 'assistantClearConversation')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="m6 7 .9 11.2A2 2 0 0 0 8.9 20h6.2a2 2 0 0 0 2-1.8L18 7"/><path d="M10 11v5M14 11v5"/></svg>
                <span>Limpar conversa</span>
              </button>
            </div>
          </div>
        </div>
      </header>`;
  }

  /* ── Build the full view HTML ── */
  function buildAssistantView() {
    const locationWidget = buildAssistantLocationWidget();

    return `
    <div class="assistant-page" id="assistantPage">
      ${buildAssistantHeader()}

      ${locationWidget}

      <!-- AI body -->
      <div class="assistant-ai-body" id="assistantAiBody">

        <!-- Abertura em DUAS âncoras. Este bloco se centra sozinho no espaço
             livre (margin-block:auto no CSS); as sugestões abaixo ficam presas
             logo acima do campo de digitação. Antes os três vinham empilhados a
             partir do topo e sobrava um vão morto de ~220px no meio da tela. -->
        <div class="assistant-intro-top">
          <!-- Sem invólucro: o wrapper que existia aqui carregava oito camadas
               de margens do layout antigo e casava por nome com o componente —
               foi ele que pintou a janela quadrada uma vez. -->
          ${markMarkup({ size: 'intro', id: 'assistantIntroMark' })}
          <div class="assistant-ai-question" id="assistantIntroQuestion" data-text="Como posso ajudar hoje?" aria-label="Como posso ajudar hoje?"></div>
          <div class="assistant-ai-subtitle">Me diga o que procura e eu encontro as melhores op&ccedil;&otilde;es do card&aacute;pio.</div>
        </div>

        <!-- A tela não abre vazia: ninguém sabe de cabeça o que perguntar a um
             chat de restaurante. Some na primeira mensagem e só volta quando a
             conversa é limpa — ou seja, numa sessão nova. -->
        <div class="assistant-starter" id="assistantStarter" aria-label="Sugest&otilde;es de pergunta">
          ${starterSuggestionCards()}
        </div>

        <!-- Results area (shown after search) -->
        <div class="assistant-ai-results-wrap" id="assistantAiResultsWrap" style="display:none">
          <div class="assistant-thinking assistant-thinking--dark" id="assistantThinking">
            <div class="assistant-thinking-dots assistant-thinking-dots--dark">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div class="assistant-results-label assistant-results-label--dark" id="assistantResultsLabel">Sugestões para você</div>
          <div class="assistant-results" id="assistantResults"></div>
          <button class="assistant-show-more-btn assistant-show-more-btn--dark" id="assistantShowMoreBtn" ${act('click', 'assistantShowMoreResults')} type="button">
            Ver mais sugestões
          </button>
        </div>

      </div>

      <!-- Bottom dock: input -->
      <div class="assistant-bottom-dock">

        <!-- Input bar -->
        <div class="assistant-ai-input-bar">
          <input class="assistant-ai-input" id="assistantInput" type="text"
            placeholder="Pergunte qualquer coisa..."
            ${act('input', 'assistantUpdateSendButton')}
            ${act('keydown', 'assistantInputKeydown', '$event')}>
          <button class="assistant-ai-send is-inactive" ${act('click', 'assistantSendMessage')} type="button" aria-label="Enviar" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
            </svg>
          </button>
        </div>

      </div>

      <div class="assistant-product-detail" id="assistantProductDetail" role="dialog" aria-modal="true"
        aria-labelledby="assistantProductDetailTitle" hidden ${act('click', 'assistantCloseProductDetail')}>
        <article class="assistant-product-detail-panel" ${act('click', '$stop')}>
          <div class="assistant-product-detail-media">
            <img class="assistant-product-detail-image" id="assistantProductDetailImage" alt="">
            <div class="assistant-product-detail-placeholder" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16v16H4z"/><circle cx="9" cy="9" r="2"/><path d="m4 17 4-4 3 3 3-3 6 6"/>
              </svg>
            </div>
            <span class="assistant-product-detail-handle" aria-hidden="true"></span>
            <button class="assistant-product-detail-close" type="button" ${act('click', 'assistantCloseProductDetail')} aria-label="Fechar detalhes">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <div class="assistant-product-detail-content">
            <div class="assistant-product-detail-copy">
              <h3 class="assistant-product-detail-title" id="assistantProductDetailTitle"></h3>
              <div class="assistant-product-detail-price" id="assistantProductDetailPrice"></div>
              <p class="assistant-product-detail-description" id="assistantProductDetailDescription"></p>
              <!-- Era "Escolha do assistente": a plataforma assinando a sugestão numa
                   tela onde ela não existe para o cliente. -->
              <div class="assistant-product-detail-recommendation">
                <strong>Por que indicamos</strong>
                <span id="assistantProductDetailRecommendation"></span>
              </div>
            </div>
            <button class="assistant-product-detail-question" type="button" ${act('click', 'assistantAddActiveProduct')}>Adicionar à sacola</button>
          </div>
        </article>
      </div>

    </div>

    <div class="assistant-toast" id="assistantToast"></div>
    `;
  }

  /* ── Show toast ── */
  window.assistantOpenProductDetail = function (index) {
    const product = _assistantProductDetailCache[Number(index)];
    const detail = document.getElementById('assistantProductDetail');
    if (!product || !detail) return;

    const title = detail.querySelector('#assistantProductDetailTitle');
    const price = detail.querySelector('#assistantProductDetailPrice');
    const description = detail.querySelector('#assistantProductDetailDescription');
    const recommendation = detail.querySelector('#assistantProductDetailRecommendation');
    const image = detail.querySelector('#assistantProductDetailImage');
    const media = detail.querySelector('.assistant-product-detail-media');
    const imageSrc = product.image_url || product.image_path || '';
    const productName = formatProductTitle(product.name);

    _assistantActiveDetailProduct = product;
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

    if (detail._assistantCloseTimer) clearTimeout(detail._assistantCloseTimer);
    detail.hidden = false;
    document.body.classList.add('assistant-product-detail-open');
    detail.getBoundingClientRect();
    detail.classList.add('is-open');
    setTimeout(() => {
      detail.querySelector('.assistant-product-detail-close')?.focus({ preventScroll: true });
    }, 0);
  };

  window.assistantCloseProductDetail = function () {
    const detail = document.getElementById('assistantProductDetail');
    if (!detail || detail.hidden) return;
    detail.classList.remove('is-open');
    document.body.classList.remove('assistant-product-detail-open');
    detail._assistantCloseTimer = setTimeout(() => {
      detail.hidden = true;
      detail._assistantCloseTimer = null;
    }, 540);
  };

  window.assistantAddActiveProduct = function () {
    const product = _assistantActiveDetailProduct;
    if (!product) return;
    window.assistantCloseProductDetail();
    window.assistantAddProduct(product);
  };

  window.assistantViewProductInMenu = function () {
    const product = _assistantActiveDetailProduct;
    if (!product) return;
    const productId = product.id || product.product_id;
    const menuHasProduct = getAssistantProducts().some(menuProduct => String(menuProduct.id) === String(productId));
    if (!menuHasProduct || typeof window.openProduct !== 'function') {
      showAssistantToast('Produto não disponível no cardápio agora');
      return;
    }

    window.assistantCloseProductDetail();
    window.openProduct(productId);

    if (typeof window.mobNavMenu === 'function') {
      Promise.resolve(window.mobNavMenu())
        .catch(error => console.error('[Assistente] Não foi possível preparar o cardápio atrás do produto:', error));
    }
  };

  function showAssistantToast(msg) {
    const t = document.getElementById('assistantToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('assistant-toast--visible');
    setTimeout(() => t.classList.remove('assistant-toast--visible'), 2400);
  }

  /* ── Show/hide results ── */
  async function assistantSearch(message) {
    const resultsEl = document.getElementById('assistantResults');
    const labelEl = document.getElementById('assistantResultsLabel');
    const showMoreBtn = document.getElementById('assistantShowMoreBtn');
    const aiBody = document.getElementById('assistantAiBody');
    const resultsWrap = document.getElementById('assistantAiResultsWrap');
    const inputEl = document.getElementById('assistantInput');
    if (!resultsEl || _assistantSending) return;

    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) return;
    inputEl?.blur?.();

    _assistantSending = true;
    _assistantAbortController = new AbortController();
    if (_introTypeTimer) {
      cancelAnimationFrame(_introTypeTimer);
      _introTypeTimer = null;
    }

    if (resultsWrap) resultsWrap.style.display = 'block';
    if (aiBody) aiBody.classList.add('assistant-ai-body--searching');
    if (labelEl) labelEl.classList.remove('visible');
    if (showMoreBtn) showMoreBtn.classList.remove('visible');

    appendAssistantUserMessage(cleanMessage);
    setAssistantInputDisabled(true);
    setAssistantGenerating(true);
    setAssistantMarkState('thinking');
    appendAssistantTypingIndicator();

    try {
      const response = await postAssistantChatMessage(cleanMessage, _assistantAbortController.signal);
      console.log('[Assistente] Resumo da resposta:', {
        response_type: response?.response_type,
        products_count: Array.isArray(response?.products) ? response.products.length : 0
      });
      removeAssistantTypingIndicator();
      setAssistantMarkState('answering');
      _assistantResponseTimer = setTimeout(() => {
        _assistantResponseTimer = null;
        if (!_assistantSending) return;
        renderAssistantChatResponse(response, cleanMessage);
        if (!_assistantActiveReveal) finishAssistantGeneration();
      }, 190);
    } catch (error) {
      removeAssistantTypingIndicator();
      if (error?.name === 'AbortError') {
        finishAssistantGeneration();
        return;
      }
      setAssistantMarkState('answering');
      _assistantResponseTimer = setTimeout(() => {
        _assistantResponseTimer = null;
        if (!_assistantSending) return;
        renderAssistantChatResponse({
          response_type: 'error',
          message: error?.message || 'Não consegui responder agora. Tente novamente.'
        }, cleanMessage);
        if (!_assistantActiveReveal) finishAssistantGeneration();
      }, 190);
    }
  }
  function setupAssistantKeyboardViewport() {
    const view = document.getElementById('mobViewAssistant');
    const input = document.getElementById('assistantInput');
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
      view.style.setProperty('--assistant-keyboard-height', `${keyboardHeight}px`);
      view.style.setProperty('--assistant-intro-shift', introShift + 'px');
      view.classList.toggle('assistant-keyboard-open', keyboardHeight > 60);
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
        view.classList.remove('assistant-keyboard-open');
        view.style.removeProperty('--assistant-keyboard-height');
        view.style.removeProperty('--assistant-intro-shift');
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
  function setupAssistantSuggestionClicks() {
    const starter = document.getElementById('assistantStarter');
    if (!starter || starter.dataset.clicksReady === '1') return;
    starter.dataset.clicksReady = '1';
    starter.addEventListener('click', event => {
      const card = event.target.closest?.('[data-assistant-suggestion]');
      const suggestion = card?.dataset?.assistantSuggestion;
      if (suggestion) window.assistantUseSuggestion(suggestion);
    });
  }

  /**
   * Abertura da tela: a pergunta é digitada e as sugestões entram atrás dela.
   *
   * As classes fazem todo o trabalho (ver "ABERTURA" em styles/assistant.css). A
   * versão anterior escrevia doze propriedades inline com !important em cada
   * chip a cada abertura, porque a régua de sugestões morava no dock e brigava
   * com meia dúzia de regras antigas; fora do dock não há com quem brigar.
   */
  function startAssistantIntroAnimation() {
    const questionEl = document.getElementById('assistantIntroQuestion');
    const starterEl = document.getElementById('assistantStarter');
    const aiBody = document.getElementById('assistantAiBody');
    if (!questionEl || !starterEl || aiBody?.classList.contains('assistant-ai-body--searching')) return;

    if (_introTypeTimer) {
      cancelAnimationFrame(_introTypeTimer);
      _introTypeTimer = null;
    }

    const text = questionEl.getAttribute('data-text') || 'Como posso ajudar hoje?';
    questionEl.textContent = '';
    questionEl.classList.add('is-typing');
    starterEl.classList.remove('is-ready');
    setAssistantMarkState('idle');

    // Movimento reduzido: a abertura aparece pronta. Digitar letra a letra é
    // movimento como qualquer outro, e aqui ele ainda ATRASA as sugestões — que
    // só entram quando a frase termina.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      questionEl.classList.remove('is-typing');
      questionEl.textContent = text;
      starterEl.classList.add('is-ready');
      return;
    }

    typeAssistantText(questionEl, text, {
      onFrame: frame => { _introTypeTimer = frame; },
      onComplete: () => {
        _introTypeTimer = null;
        if (document.getElementById('assistantAiBody')?.classList.contains('assistant-ai-body--searching')) return;
        starterEl.classList.add('is-ready');
      }
    });
  }

  window.assistantUpdateSendButton = updateAssistantSendButton;

  window.assistantSendMessage = function () {
    if (_assistantSending) {
      stopAssistantGeneration();
      return;
    }
    const inputEl = document.getElementById('assistantInput');
    const msg = (inputEl?.value || '').trim();
    if (!msg) return;
    if (inputEl) inputEl.value = '';
    assistantSearch(msg);
  };

  const ASSISTANT_COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ASSISTANT_COPIED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/></svg>';

  async function copyAssistantText(text) {
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

  window.assistantCopyResponse = async function (button) {
    const response = button?.closest('.assistant-chat-assistant-message')?.querySelector('.assistant-result-title');
    const text = response?.innerText?.trim();
    if (!button || !text) return;

    try {
      await copyAssistantText(text);
      if (button._assistantCopyTimer) clearTimeout(button._assistantCopyTimer);
      button.classList.remove('is-copied');
      void button.offsetWidth;
      button.innerHTML = ASSISTANT_COPIED_ICON;
      button.classList.add('is-copied');
      button.setAttribute('aria-label', 'Resposta copiada');

      button._assistantCopyTimer = setTimeout(() => {
        button.classList.remove('is-copied');
        button.innerHTML = ASSISTANT_COPY_ICON;
        void button.offsetWidth;
        button.classList.add('is-restoring');
        button.setAttribute('aria-label', 'Copiar resposta');
        setTimeout(() => button.classList.remove('is-restoring'), 280);
        button._assistantCopyTimer = null;
      }, 3000);
    } catch (_) {
      showAssistantToast('Não foi possível copiar a resposta');
    }
  };
  window.assistantRateResponse = async function (button) {
    if (!button) return;
    const actions = button.closest('.assistant-feedback-actions');
    const messageElement = button.closest('.assistant-chat-assistant-message');
    if (!actions) return;

    const wasSelected = button.classList.contains('is-selected');
    actions.querySelectorAll('.assistant-rating-btn').forEach(ratingButton => {
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
    const context = messageElement?._assistantFeedbackContext;
    if (!context || (feedback !== 'like' && feedback !== 'dislike')) return;

    actions.dataset.feedbackSent = '1';

    try {
      await window.PedeAquiApiClient.post('/chat/feedback', {
        restaurant_id: getAssistantRestaurantId(),
        session_id: ensureAssistantSessionId(),
        user_message: context.user_message,
        assistant_message: context.assistant_message,
        response_type: context.response_type,
        selected_product_ids: context.selected_product_ids,
        feedback
      });
    } catch (error) {
      console.error('[Assistente] Erro ao enviar feedback:', error);
    }
  };
  window.assistantUseSuggestion = function (message) {
    if (_assistantSending) return;
    const inputEl = document.getElementById('assistantInput');
    if (inputEl) inputEl.value = '';
    assistantSearch(message);
  };

  window.assistantUseOption = function (index) {
    const option = _assistantOptionCache[Number(index)];
    if (!option) return;
    window.assistantUseSuggestion(option.message);
  };
  window.assistantInputKeydown = function (event) {
    if (event.key === 'Enter') { event.preventDefault(); window.assistantSendMessage(); }
  };

  window.assistantShowMoreResults = function () {
    const resultsEl = document.getElementById('assistantResults');
    const showMoreBtn = document.getElementById('assistantShowMoreBtn');
    if (!resultsEl || !_allResults.length) return;
    resultsEl.innerHTML = `<div class="assistant-product-rail">${_allResults.map((p, i) => renderResultCard(p, i)).join('')}</div>`;
    if (showMoreBtn) showMoreBtn.classList.remove('visible');
  };

  window.assistantAddProduct = function (productJson) {
    try {
      const product = typeof productJson === 'string' ? JSON.parse(productJson) : productJson;
      if (typeof window.openProduct === 'function') {
        window.openProduct(product.id || product);
      } else {
        showAssistantToast('Abra o cardápio para adicionar este item');
      }
    } catch (e) {
      showAssistantToast('Não foi possível adicionar. Tente pelo cardápio.');
    }
  };

  window.assistantViewInMenu = function (categorySlug) {
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

  window.renderAssistantView = function (options = {}) {
    const view = document.getElementById('mobViewAssistant');
    if (!view) return;
    const deferIntro = Boolean(options.deferIntro);
    view.classList.toggle('assistant-intro-deferred', deferIntro);

    if (!_assistantLoaded || !view.querySelector('.assistant-page')) {
      view.innerHTML = buildAssistantView();
      _assistantLoaded = true;
      ensureAssistantSessionId();
    } else {
      // Refresh location widget only
      const locationWrap = view.querySelector('.assistant-location-wrap');
      if (locationWrap) {
        const newWidget = buildAssistantLocationWidget();
        const tmp = document.createElement('div');
        tmp.innerHTML = newWidget;
        locationWrap.replaceWith(tmp.firstElementChild);
      }
    }

    ensureAssistantCartSubscription();
    syncAssistantCartButton();
    setAssistantHeaderMenuOpen(false);
    setupAssistantSuggestionClicks();
    setupAssistantKeyboardViewport();

    // A view é reaproveitada entre visitas: a abertura precisa voltar ao ponto
    // de partida antes do próximo quadro, ou a pergunta reaparece já escrita e
    // as sugestões piscam prontas antes de serem reveladas de novo.
    const introBody = view.querySelector('#assistantAiBody');
    const introQuestion = view.querySelector('#assistantIntroQuestion');
    const introStarter = view.querySelector('#assistantStarter');
    if (!introBody?.classList.contains('assistant-ai-body--searching') && introStarter) {
      if (introQuestion) {
        introQuestion.textContent = '';
        introQuestion.classList.remove('is-typing');
      }
      // O cardápio pode ter chegado depois da primeira montagem — daí as
      // sugestões de categoria só existirem a partir da segunda visita.
      renderAssistantStarterSuggestions();
      introStarter.classList.remove('is-ready');
    }
    const beginIntro = () => {
      view.classList.remove('assistant-intro-deferred');
      startAssistantIntroAnimation();
    };
    if (!deferIntro) {
      setTimeout(beginIntro, 0);
      return;
    }

    const startedAt = performance.now();
    const waitForKeyboardLayout = () => {
      if (view.classList.contains('assistant-keyboard-open') || performance.now() - startedAt > 900) {
        setTimeout(beginIntro, 140);
        return;
      }
      requestAnimationFrame(waitForKeyboardLayout);
    };
    requestAnimationFrame(waitForKeyboardLayout);
  };
  /* ── Header: menu da conversa ── */

  function setAssistantHeaderMenuOpen(open) {
    const menu = document.getElementById('assistantHdrMenu');
    const button = document.getElementById('assistantHdrMenuBtn');
    if (!menu || !button) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-active', open);
    if (open) menu.querySelector('.assistant-hdr-menu-item')?.focus({ preventScroll: true });
  }

  window.assistantToggleHeaderMenu = function () {
    setAssistantHeaderMenuOpen(Boolean(document.getElementById('assistantHdrMenu')?.hidden));
  };

  window.assistantClearConversation = function () {
    setAssistantHeaderMenuOpen(false);
    stopAssistantGeneration();
    // Sessão nova, e não só a tela em branco: o backend guarda a conversa por
    // session_id, então reaproveitar o id faria o assistente responder com a
    // memória do que o cliente acabou de apagar.
    _assistantSessionId = null;
    window.sessionStorage?.removeItem(ASSISTANT_SESSION_STORAGE_KEY);
    ensureAssistantSessionId();
    _assistantOptionCache = [];
    window.assistantReset();
    startAssistantIntroAnimation();
    showAssistantToast('Conversa limpa');
  };

  window.assistantReset = function () {
    _allResults = [];
    _assistantProductDetailCache = [];
    _assistantActiveDetailProduct = null;
    window.assistantCloseProductDetail();
    const inputEl = document.getElementById('assistantInput');
    if (inputEl) inputEl.value = '';
    const resultsEl = document.getElementById('assistantResults');
    if (resultsEl) resultsEl.innerHTML = '';
    const labelEl = document.getElementById('assistantResultsLabel');
    if (labelEl) labelEl.classList.remove('visible');
    const thinkingEl = document.getElementById('assistantThinking');
    if (thinkingEl) thinkingEl.classList.remove('visible');
    const showMoreBtn = document.getElementById('assistantShowMoreBtn');
    if (showMoreBtn) showMoreBtn.classList.remove('visible');
    document.getElementById('assistantStarter')?.classList.remove('is-ready');
    setAssistantMarkState('idle');
    // Reset new AI layout elements
    const resultsWrap = document.getElementById('assistantAiResultsWrap');
    if (resultsWrap) resultsWrap.style.display = 'none';
    const aiBody = document.getElementById('assistantAiBody');
    if (aiBody) aiBody.classList.remove('assistant-ai-body--searching');
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.body.classList.contains('assistant-product-detail-open')) {
      window.assistantCloseProductDetail();
      return;
    }
    if (document.getElementById('assistantHdrMenu')?.hidden === false) {
      setAssistantHeaderMenuOpen(false);
      document.getElementById('assistantHdrMenuBtn')?.focus({ preventScroll: true });
    }
  }, { signal: window.RapidexLifecycle?.signal });

  // Clique fora fecha o menu do cabeçalho. Na captura: o menu precisa sumir
  // mesmo quando o alvo do clique interrompe a propagação — o dispatcher de
  // ações escuta na fase de borbulha, então o que estava embaixo ainda executa.
  document.addEventListener('click', event => {
    if (document.getElementById('assistantHdrMenu')?.hidden !== false) return;
    if (event.target instanceof Element && event.target.closest('.assistant-hdr-menu-wrap')) return;
    setAssistantHeaderMenuOpen(false);
  }, { capture: true, signal: window.RapidexLifecycle?.signal });

  // assistantImagePlaceholder é a única ação deste módulo que NÃO existe em window —
  // ela nasceu já como ação. As demais continuam globais porque restaurant-page.js
  // as chama por nome; o despachante resolve por window como fallback.
  window.RapidexActions?.register({ assistantImagePlaceholder });

})();
