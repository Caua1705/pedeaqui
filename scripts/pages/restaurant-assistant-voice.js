/**
 * Modo voz — a tela.
 *
 * ESTE ARQUIVO NÃO CONVERSA COM NINGUÉM. Ele é só a superfície: a esfera, os
 * cartões, o botão de encerrar e os estados que a conversa faz a tela assumir.
 * Quem abre o microfone, negocia o WebRTC com a OpenAI e chama as rotas /voice
 * do backend é a camada de TRANSPORTE, que se registra aqui por setDriver().
 * Enquanto ela não existir, a tela abre e fica em "Conectando…" — que é a
 * verdade: não há conexão.
 *
 * A separação não é cerimônia. O transporte tem custo por minuto e um contrato
 * de encerramento com cinco passos em ordem; a tela tem layout e acessibilidade.
 * Misturar os dois é como se perde um getTracks().stop() no meio de um ajuste de
 * CSS — e aí o indicador de gravação do navegador fica aceso depois da conversa.
 *
 * VOZ E TEXTO NÃO SE MISTURAM: não existe campo de digitação aqui, e não pode
 * passar a existir. São duas conversas separadas no backend, que não se conhecem
 * — digitar nesta tela falaria com um assistente que não ouviu nada do que foi
 * dito. Ou voz, ou texto.
 *
 * MARCA: o app é white-label. Nada nesta tela nomeia a plataforma; a esfera é
 * desenhada em CSS a partir da cor do restaurante.
 */
(function () {
  'use strict';

  /* ── Estado ── */
  // 'connecting' | 'listening' | 'speaking'
  let _state = 'connecting';
  let _open = false;
  let _muted = false;
  let _driver = null;
  let _ending = false;

  const STATE_COPY = {
    connecting: { title: 'Conectando…', hint: 'Autorizando o microfone.' },
    listening: { title: 'Estou ouvindo', hint: 'Fale como falaria no balcão.' },
    speaking: { title: 'Respondendo…', hint: 'Pode interromper quando quiser.' }
  };
  // Mudo cobre o texto de estado enquanto durar. Ficar em "Estou ouvindo" com o
  // microfone cortado é a única mentira que esta tela poderia contar.
  const MUTED_COPY = {
    title: 'Microfone desligado',
    hint: 'Ninguém está ouvindo. A conversa continua aberta.'
  };

  const $ = id => document.getElementById(id);

  /* ── Markup ──
     Injetado sob demanda dentro da .assistant-page. Não vive no
     buildAssistantView() de propósito: a tela de voz é um subsistema à parte e
     não tem por que existir no DOM de quem só usa o chat.

     Fica ABAIXO da folha de detalhe do produto na pilha (z-index 240 contra
     260), então tocar num cartão daqui abre a mesma folha do chat, por cima. */
  function panelMarkup() {
    return `
      <section class="assistant-voice" id="assistantVoice" tabindex="-1" hidden
        aria-label="Atendimento por voz">

        <!-- Os dois vãos elásticos. Sem cartões os dois crescem igual e a esfera
             fica no meio da tela; quando os cartões chegam o de cima encolhe a
             zero e a esfera SOBE, abrindo a faixa embaixo dela. É um flex-grow
             que transita, então o movimento é o da esfera subindo — e não uma
             faixa de branco parada no meio, que lia como tela quebrada. -->
        <div class="assistant-voice-gap assistant-voice-gap--top" aria-hidden="true"></div>

        <div class="assistant-voice-stage">
          <!-- A esfera é decorativa: quem comunica o estado para leitor de tela é
               o texto abaixo dela, que está num aria-live. -->
          <div class="assistant-voice-orb" id="assistantVoiceOrb" aria-hidden="true">
            <span class="assistant-voice-orb__halo"></span>
            <span class="assistant-voice-orb__ring"></span>
            <span class="assistant-voice-orb__body"></span>
          </div>

          <div class="assistant-voice-copy">
            <p class="assistant-voice-title" id="assistantVoiceTitle" role="status" aria-live="polite"></p>
            <p class="assistant-voice-hint" id="assistantVoiceHint"></p>
          </div>
        </div>

        <!-- A faixa de cartões. Os cartões são os MESMOS do chat: quem os monta é
             restaurant-assistant.js, para o toque cair no mesmo cache de detalhe. -->
        <div class="assistant-voice-rail assistant-product-rail" id="assistantVoiceRail"
          aria-label="Produtos encontrados" hidden></div>

        <div class="assistant-voice-gap assistant-voice-gap--bottom" aria-hidden="true"></div>

        <div class="assistant-voice-controls">
          <button class="assistant-voice-mute" id="assistantVoiceMute" type="button"
            data-act-click="assistantVoiceToggleMute" aria-pressed="false" aria-label="Silenciar meu microfone">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>
            </svg>
            <span class="assistant-voice-mute__slash" aria-hidden="true"></span>
          </button>

          <!-- O único jeito de sair, e por isso ele é o maior elemento tocável da
               tela. Neutro escuro em vez da cor do restaurante: ele precisa ser
               igualmente óbvio num tenant de marca clara, e não pode competir com
               a esfera, que é onde a cor do lojista vive nesta tela. -->
          <button class="assistant-voice-end" id="assistantVoiceEnd" type="button"
            data-act-click='["assistantVoiceEnd","o cliente clicou em Parar"]'>
            <span class="assistant-voice-end__icon" aria-hidden="true"></span>
            Encerrar conversa
          </button>
        </div>

        <div class="assistant-voice-alert" id="assistantVoiceAlert" role="alert" hidden>
          <div class="assistant-voice-alert__box">
            <svg class="assistant-voice-alert__mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.4h.01"/>
            </svg>
            <p class="assistant-voice-alert__text" id="assistantVoiceAlertText"></p>
            <button class="assistant-voice-alert__btn" type="button"
              data-act-click='["assistantVoiceEnd","a conversa não pôde começar"]'>Voltar ao chat</button>
          </div>
        </div>

        <!-- A voz do assistente sai por aqui. Mudo é do MICROFONE, não daqui:
             silenciar este elemento faria o cliente pagar por uma resposta que
             ninguém ouve. -->
        <audio id="assistantVoiceAudio" autoplay playsinline></audio>
      </section>`;
  }

  function ensurePanel() {
    const existing = $('assistantVoice');
    if (existing?.isConnected) return existing;
    // A view do assistente é remontada inteira em algumas navegações; quando
    // isso acontece o painel some junto e precisa ser recriado.
    const page = document.querySelector('#mobViewAssistant .assistant-page');
    if (!page) return null;
    const detail = page.querySelector('.assistant-product-detail');
    const holder = document.createElement('div');
    holder.innerHTML = panelMarkup();
    const panel = holder.firstElementChild;
    if (detail) page.insertBefore(panel, detail);
    else page.appendChild(panel);
    return panel;
  }

  /* ── Estados da tela ── */
  function setState(state, copy = {}) {
    const panel = $('assistantVoice');
    if (!panel) return;
    _state = STATE_COPY[state] ? state : 'connecting';
    for (const name of Object.keys(STATE_COPY)) {
      panel.classList.toggle(`is-${name}`, name === _state);
    }
    paintCopy(copy);
  }

  function paintCopy(copy = {}) {
    const text = _muted ? MUTED_COPY : STATE_COPY[_state];
    const title = $('assistantVoiceTitle');
    const hint = $('assistantVoiceHint');
    if (title) title.textContent = (!_muted && copy.title) || text.title;
    if (hint) hint.textContent = (!_muted && copy.hint !== undefined) ? copy.hint : text.hint;
  }

  /**
   * Nível de áudio, de 0 a 1 — é isto que faz a esfera reagir à fala.
   *
   * Só escreve uma custom property; quem anima é o CSS, com transform. Mexer em
   * width/height aqui forçaria layout a cada quadro do analisador de áudio.
   */
  function setLevel(level) {
    const orb = $('assistantVoiceOrb');
    if (!orb) return;
    const value = Number(level);
    orb.style.setProperty('--voice-level',
      String(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))));
  }

  /* ── Cartões ── */
  function showProducts(products) {
    const rail = $('assistantVoiceRail');
    if (!rail) return;
    const list = Array.isArray(products) ? products : [];
    if (!list.length) {
      clearProducts();
      return;
    }
    // O cartão vem do CHAT, e o preço dele vem do banco. Nunca monte cartão a
    // partir do que o modelo falou: é justamente essa separação que impede o
    // assistente de dizer um preço e a tela mostrar outro.
    rail.innerHTML = window.RapidexAssistantChat?.productRailMarkup?.(list) || '';
    rail.hidden = false;
    rail.scrollLeft = 0;
  }

  function clearProducts() {
    const rail = $('assistantVoiceRail');
    if (!rail) return;
    rail.innerHTML = '';
    rail.hidden = true;
  }

  /* ── Falha com nome ──
     Cota estourada e restaurante sem voz habilitada são as duas que o cliente
     precisa LER. Falhar calado aqui é pior do que em qualquer outra tela: o
     botão simplesmente não faria nada e a pessoa apertaria de novo. */
  function fail(message) {
    const panel = ensurePanel();
    if (!panel) return;
    if (!_open) openPanel();
    const alert = $('assistantVoiceAlert');
    const text = $('assistantVoiceAlertText');
    if (text) text.textContent = message || 'Não consegui abrir o atendimento por voz agora.';
    if (alert) alert.hidden = false;
    panel.classList.add('has-alert');
    setLevel(0);
    alert?.querySelector('.assistant-voice-alert__btn')?.focus({ preventScroll: true });
  }

  function hideAlert() {
    const alert = $('assistantVoiceAlert');
    if (alert) alert.hidden = true;
    $('assistantVoice')?.classList.remove('has-alert');
  }

  /* ── Mudo (opcional, mas barato) ──
     Corta o MICROFONE, não o alto-falante: silenciar a saída deixaria a sessão
     correndo e faturando enquanto o assistente fala para ninguém. */
  function setMuted(muted) {
    _muted = Boolean(muted);
    const button = $('assistantVoiceMute');
    if (button) {
      button.classList.toggle('is-muted', _muted);
      button.setAttribute('aria-pressed', String(_muted));
      button.setAttribute('aria-label', _muted ? 'Reativar meu microfone' : 'Silenciar meu microfone');
    }
    $('assistantVoice')?.classList.toggle('is-muted', _muted);
    paintCopy();
    if (_muted) setLevel(0);
    try {
      _driver?.setMuted?.(_muted);
    } catch (error) {
      console.error('[Voz] Falha ao alternar o microfone:', error);
    }
  }

  /* ── Abrir ── */
  function openPanel() {
    const panel = ensurePanel();
    if (!panel || _open) return panel;
    _open = true;
    _ending = false;

    // Uma resposta de texto em curso não pode continuar chegando por trás da
    // tela de voz: são conversas diferentes.
    window.RapidexAssistantChat?.stopGeneration?.();
    $('assistantInput')?.blur();

    hideAlert();
    clearProducts();
    setState('connecting');
    setLevel(0);
    _muted = false;
    setMuted(false);

    document.body.classList.add('assistant-voice-open');
    panel.hidden = false;
    panel.getBoundingClientRect();
    panel.classList.add('is-open');
    // No painel, e não no botão de encerrar: foco programático no botão acende o
    // anel de foco e sugere que ele é o próximo passo, quando é o último.
    panel.focus({ preventScroll: true });
    return panel;
  }

  /**
   * O botão de ondas do chat chamou.
   *
   * A emissão da credencial exige token de cliente, então visitante não tem como
   * abrir voz — vai para o login em vez de bater num 401 depois de já ter aberto
   * a tela e pedido o microfone.
   */
  function request() {
    if (!window.PedeAquiCustomerAuth?.isLoggedIn?.()) {
      window.RapidexActions?.resolve('openLoginScreen')?.('assistant');
      return;
    }
    if (_open) return;
    openPanel();

    if (!_driver?.start) {
      // FASE 2: a camada de transporte se registra por setDriver() e assume daqui.
      console.warn('[Voz] Nenhum transporte registrado: a tela abre, mas não há conexão.');
      return;
    }
    try {
      _driver.start(api);
    } catch (error) {
      console.error('[Voz] O transporte não conseguiu iniciar:', error);
      fail('Não consegui abrir o atendimento por voz agora. Tente de novo em instantes.');
    }
  }

  /**
   * O CAMINHO ÚNICO de encerramento.
   *
   * Toda saída passa por aqui — botão, Esc, aba escondida, janela sem foco, teto
   * de duração, inatividade, erro. É o que garante que o microfone sempre pare:
   * o transporte fecha o canal, fecha a conexão, chama
   * getTracks().forEach(t => t.stop()) e só então avisa o backend. Uma segunda
   * porta de saída é exatamente como o indicador de gravação fica aceso depois
   * de a conversa acabar.
   */
  function end(motivo) {
    if (!_open || _ending) return;
    _ending = true;
    const reason = String(motivo || 'encerramento sem motivo declarado').slice(0, 200);

    // O transporte primeiro: parar o microfone não pode depender de a animação
    // de saída terminar.
    try {
      _driver?.stop?.(reason);
    } catch (error) {
      console.error('[Voz] Falha ao encerrar o transporte:', error);
    }

    const panel = $('assistantVoice');
    _open = false;
    _muted = false;
    setLevel(0);
    document.body.classList.remove('assistant-voice-open');
    if (!panel) {
      _ending = false;
      return;
    }
    panel.classList.remove('is-open');
    clearTimeout(panel._voiceCloseTimer);
    panel._voiceCloseTimer = setTimeout(() => {
      panel.hidden = true;
      hideAlert();
      clearProducts();
      _ending = false;
    }, 260);
    $('assistantInput')?.focus?.({ preventScroll: true });
  }

  /* ── Ações do markup ── */
  window.assistantVoiceEnd = motivo => end(motivo);
  window.assistantVoiceToggleMute = () => setMuted(!_muted);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !_open) return;
    if (document.body.classList.contains('assistant-product-detail-open')) return;
    end('o cliente saiu com Esc');
  }, { signal: window.RapidexLifecycle?.signal });

  /* ── A superfície que o transporte usa ── */
  const api = {
    request,
    end,
    fail,
    setState,
    setLevel,
    showProducts,
    clearProducts,
    setMuted,
    isOpen: () => _open,
    isMuted: () => _muted,
    state: () => _state,
    audioElement: () => $('assistantVoiceAudio'),
    /** Registra a camada de transporte: { start(api), stop(motivo), setMuted(bool) }. */
    setDriver(driver) { _driver = driver || null; }
  };

  window.RapidexAssistantVoice = api;
  window.RapidexActions?.register({
    assistantVoiceEnd: window.assistantVoiceEnd,
    assistantVoiceToggleMute: window.assistantVoiceToggleMute
  });
})();
