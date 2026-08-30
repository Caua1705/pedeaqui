// ============================================================================
//  Entrar, cadastrar, verificar codigo e recuperar senha.
//
//  Saiu de scripts/pages/restaurant-page.js na auditoria de 29/08/2026 — 1.132
//  linhas, 118 funcoes. Terceiro e ultimo corte desta fase.
//
//  E o maior dos tres em numero de funcoes e o que mais devolve ao markup: 42
//  das 171 acoes do app estavam aqui. Mesmo assim tem so 7 portas de volta para
//  o restaurant-page — as telas de autenticacao conversam entre si, nao com o
//  resto do app.
//
//  A CONTA DO CLIENTE E DO RAPIDEX, NAO DO RESTAURANTE. `customers.phone` e
//  unico na tabela inteira do backend, entao token, perfil, enderecos e pedidos
//  sao globais; so carrinho e contexto de operacao sao por slug. Nada neste
//  arquivo deve passar a namespaciar sessao por restaurante.
//
//  O CODIGO NAO FOI REESCRITO. Corpos verbatim; so a costura e nova, e ela
//  tocou CINCO linhas de codigo — as que leem ou escrevem estado de la.
//
//  --- A costura ---
//
//  31 nomes estaveis vem por valor em init(). Cinco mudam de valor e continuam
//  sendo do restaurant-page, entao chegam por `S`, lido a cada acesso:
//
//    so leitura        customer
//    leitura E escrita selectedCoupon, selectedCouponPreview, couponPreviewKey,
//                      loginReturnNavId
//
//  Os quatro de escrita nao sao detalhe. Quando alguem entra na conta a partir
//  de um cupom, e ESTE arquivo que limpa o cupom em leitura e a pre-visualizacao
//  pendente. Escrever numa copia deixaria o restaurant-page achando que ainda ha
//  um cupom aplicado — e o `coupon_id` iria no POST /orders. E o defeito do
//  cupom que grudava, por outro caminho, e num cupom de uso unico ele o queima.
//
//  --- O markup ---
//
//  As 42 acoes se registram aqui, em RapidexActions, que MESCLA. Nenhum
//  `data-act-*` do HTML mudou.
// ============================================================================
(function () {
  // Preenchidos por init(); ver o cabecalho.
  let $,
    apiErrorMessage,
    appState,
    closeCouponDetail,
    closeModalId,
    closeProfSub,
    clubController,
    currentScrollY,
    esc,
    loadCashbackForHome,
    lockBodyScroll,
    mobNavAssistant,
    mobNavClub,
    onTeardown,
    onlyDigits,
    openModal,
    openModalImmediately,
    persistCustomer,
    renderHomeLoginPrompt,
    renderProfileView,
    renderSharedCashbackState,
    requestDeliveryEstimate,
    setBottomNavSuppressedForAuth,
    showHomeTab,
    syncAuthScreenOpenClass,
    syncCartLocationState,
    synchronizeCustomerAddresses,
    unlockBodyScrollIfClear,
    updateCartUI;

  /** O estado que continua sendo do restaurant-page.js. Ver o cabecalho. */
  const S = {};
  const ESTADO_SO_LEITURA = ['customer'];
  const ESTADO_COM_ESCRITA = ['selectedCoupon', 'selectedCouponPreview', 'couponPreviewKey', 'loginReturnNavId'];

  let _loginOrigin = 'profile';

  function openLoginScreen(origin = 'profile') {
    _loginOrigin = origin;
    S.loginReturnNavId = document.body.classList.contains('menu-tab') && ['profile', 'club'].includes(origin)
      ? 'mobNavMenu'
      : null;
    document.body.classList.remove('menu-login-open');
    $('loginModal')?.classList.toggle('from-add-address', origin === 'address');
    $('loginModal')?.classList.toggle('from-coupon', origin === 'coupon');
    $('loginModal')?.classList.toggle('from-bottom-nav', ['profile', 'club'].includes(origin));
    const voiceReason = $('loginVoiceReason');
    if (voiceReason) voiceReason.hidden = origin !== 'assistant-voice';
    openModal('loginModal');
  }

  function mockLogin(mode) {
    persistCustomer({ name: mode === 'signup' ? 'Cliente Rapidex' : 'Cliente identificado', phone: '' });
    appState.profileLoaded = false;
    closeModalId('loginModal');
    renderProfileView();
  }

  /* ---------- Register screen ("Cadastre-se") ---------- */

  // Auth screens opened from the guest sheet must inherit Home's soft lock.
  // Promoting it to position:fixed moves the sticky header while returning.
  function lockAuthScreenScroll() {
    const preserveScrolledHome = document.body.classList.contains('home-tab')
      && document.body.classList.contains('soft-scroll-locked');
    lockBodyScroll(currentScrollY(), preserveScrolledHome ? 'soft' : 'fixed');
  }

  function openRegisterScreen() {
    closeModalId('loginModal');
    $('registerScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    $('registerForm')?.scrollTo?.(0, 0);
    clearAllRegErrors();
  }

  function closeRegisterScreen() {
    $('registerScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    // Return to the login sheet the user came from.
    openModalImmediately('loginModal');
  }

  function applyRegMask(el, template, maxDigits) {
    const digits = onlyDigits(el.value).slice(0, maxDigits);
    if (!digits) {
      el.value = '';
      return;
    }

    let index = 0;
    const out = template.replace(/_/g, () => digits[index++] || '_');
    el.value = out;

    const slots = [];
    for (let i = 0; i < template.length; i++) {
      if (template[i] === '_') slots.push(i);
    }
    const cursor = digits.length < slots.length ? slots[digits.length] : out.length;
    requestAnimationFrame(() => {
      try { el.setSelectionRange(cursor, cursor); } catch { /* campo fora do DOM */ }
    });
  }

  function maskRegPhone(el) {
    applyRegMask(el, '(__) _ ____-____', 11);
  }

  function maskRegCpf(el) {
    applyRegMask(el, '___.___.___-__', 11);
  }

  function maskRegBirth(el) {
    applyRegMask(el, '__/__/____', 8);
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

  // Digitos verificadores do CPF: implementacao unica em
  // scripts/utils/validators.js. Havia uma copia aqui e outra identica em
  // payment-card-flow.js — mesmo algoritmo, nomes de variavel diferentes.
  const isValidCpf = (digits) => window.PedeAquiValidators.isValidCpf(digits);


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

    const raw = apiErrorMessage(error, '');
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
      const res = await window.PedeAquiCustomerService.registerCustomer(reg);
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
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    startVfyTimer();
    setTimeout(() => vfyDigits()[0]?.focus(), 60);
  }

  function closeVerifyScreen() {
    stopVfyTimer();
    $('verifyScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
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
  // A contagem já para ao fechar a tela de verificação; isto cobre o caso em
  // que a página some com ela ainda aberta.
  // (o `onTeardown(stopVfyTimer)` que estava AQUI foi para init() — ver o
  // comentario la embaixo. Rodando neste ponto, ele chamava `onTeardown` antes
  // de init() o preencher.)
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
        // VerifyEmailCodeResponse é {message, verified} — e NADA mais. Este
        // bloco lia oito nomes que nunca existiram (res.customer, res.user,
        // res.access_token...) e nunca lia `verified`: um 200 com
        // verified:false — o backend dizendo "código errado" — fechava a tela
        // como sucesso. Mesma lição do cupom: 200 não é sucesso, o veredito
        // mora no corpo.
        if (res?.verified === false) {
          $('verifyScreen')?.classList.add('vfy-error');
          showVfyMsg(res?.message || 'O código de verificação é inválido ou expirou!', 'error');
          return;
        }
        stopVfyTimer();
        // Não vem token: verificação não loga. A conta local do fluxo de
        // cadastro é o que o cliente digitou (verifyCtx.customer).
        const localCustomer = verifyCtx.customer || { email: verifyCtx.email };
        if (localCustomer?.name || verifyCtx.source === 'register') applyLocalCustomer(localCustomer);
        $('verifyScreen')?.classList.remove('active');
        goToInitialScreenAfterAuth();
      }
    } catch {
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
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    setTimeout(() => $('resetNewPw')?.focus(), 60);
  }
  function closeResetPasswordScreen() {
    $('resetPasswordScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
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
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    $('loginForm')?.scrollTo?.(0, 0);
    clearAllLoginErrors();
  }

  function closeSigninScreen() {
    $('loginScreen')?.classList.remove('active');
    $('loginModal')?.classList.remove('signin-open');
    syncAuthScreenOpenClass();
    unlockBodyScrollIfClear();
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
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    setTimeout(() => $('forgotEmail')?.focus(), 60);
  }

  function closeForgotPasswordScreen() {
    $('forgotPasswordScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
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
    lockAuthScreenScroll();
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
      const detail = apiErrorMessage(error, '').toLowerCase();
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
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    setTimeout(() => recDigits()[0]?.focus(), 60);
  }

  function closeRecoverCodeScreen() {
    $('recoverCodeScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
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
    } catch {
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
    } catch {
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
    persistCustomer({
      id: apiCustomer?.id || null,
      name: apiCustomer?.name || '',
      phone: apiCustomer?.phone || '',
      email: apiCustomer?.email || ''
    });
    syncCartLocationState();
    loadCashbackForHome();
  }

  function applyLocalCustomer(apiCustomer) {
    persistCustomer({
      id: apiCustomer?.id || null,
      name: apiCustomer?.name || '',
      phone: apiCustomer?.phone || '',
      email: apiCustomer?.email || ''
    });
    window.PedeAquiCustomerAuth?.setStoredCustomer?.(apiCustomer);
    appState.profileLoaded = false;
  }

  function goToInitialScreenAfterAuth() {
    if (resumeAssistantVoiceAfterAuth()) return;
    document.querySelectorAll('.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.vfy-screen.active').forEach(el => {
      el.classList.remove('active');
    });
    $('loginModal')?.classList.remove('signin-open');
    closeProfSub();
    renderHomeLoginPrompt();
    renderProfileView();
    showHomeTab();
    window.scrollTo(0, 0);
    setBottomNavSuppressedForAuth(false);
    unlockBodyScrollIfClear();
  }

  function resumeAssistantVoiceAfterAuth() {
    if (_loginOrigin !== 'assistant-voice' || !window.PedeAquiCustomerAuth?.isLoggedIn?.()) return false;
    _loginOrigin = 'profile';
    document.querySelectorAll('.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.vfy-screen.active').forEach(el => {
      el.classList.remove('active');
    });
    $('loginModal')?.classList.remove('signin-open');
    if ($('loginVoiceReason')) $('loginVoiceReason').hidden = true;
    closeProfSub();
    renderHomeLoginPrompt();
    renderProfileView();
    updateCartUI();
    setBottomNavSuppressedForAuth(false);
    unlockBodyScrollIfClear();

    Promise.resolve(mobNavAssistant()).then(() => {
      requestAnimationFrame(() => window.RapidexAssistantVoice?.request?.());
    }).catch(error => console.error('[Assistente] Não foi possível retomar a voz após o login.', error));
    return true;
  }

  function finishLoginNavigation() {
    $('loginScreen')?.classList.remove('active');
    $('loginModal')?.classList.remove('signin-open');
    setBottomNavSuppressedForAuth(false);
    renderHomeLoginPrompt();
    updateCartUI();
    if (resumeAssistantVoiceAfterAuth()) return;
    if (_loginOrigin === 'coupon') {
      closeModalId('loginModal');
      closeCouponDetail();
      S.selectedCoupon = null;
      S.selectedCouponPreview = null;
      S.couponPreviewKey = '';
      updateCartUI();
      clubController.invalidateCoupons();
      if ($('mobViewClub')?.classList.contains('active')) clubController.renderClubView({ force: true });
      return;
    }
    if (_loginOrigin === 'club') {
      closeModalId('loginModal');
      clubController.invalidateCoupons();
      mobNavClub();
      return;
    }
    closeModalId('loginModal');
    renderProfileView();
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
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    const rawLogin = ($('loginEmail').value || '').trim();
    const login = isEmailValue(rawLogin) ? rawLogin : onlyDigits(rawLogin);
    try {
      const res = await window.PedeAquiCustomerService.loginCustomer({ login, password: $('loginPassword').value || '' });
      // Unverified customer → route them to e-mail verification (not re-register).
      if (res?.requires_email_verification) {
        openVerifyScreen({ email: res.email || (isEmailValue(rawLogin) ? rawLogin : ''), source: 'login' });
        return;
      }
      if (res?.access_token) {
        applyLoggedSession(res.access_token, res.customer);
        await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true });
        finishLoginNavigation();
      } else {
        showLgnSummary('Dados de login incorretos. Verifique suas informações.');
      }
    } catch {
      showLgnSummary('Dados de login incorretos. Verifique suas informações.');
    } finally {
      _loginSubmitting = false;
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    }
  }

  // Sync the logged customer against /customers/me; clear session on 401.
  async function syncCustomerSession() {
    const auth = window.PedeAquiCustomerAuth;
    if (!auth?.isLoggedIn()) return;
    const stored = auth.getStoredCustomer();
    if (stored && !S.customer) {
      persistCustomer({ id: stored.id || null, name: stored.name || '', phone: stored.phone || '', email: stored.email || '', birth_date: stored.birth_date || '' });
    }
    try {
      const me = await window.PedeAquiCustomerService.getCurrentCustomer();
      if (me) {
        persistCustomer({ id: me.id || null, name: me.name || '', phone: me.phone || '', email: me.email || '', birth_date: me.birth_date || '' });
        auth.setStoredCustomer(me);
        renderHomeLoginPrompt();
        renderProfileView();
        loadCashbackForHome();
        await synchronizeCustomerAddresses({ importLocal: true });
        requestDeliveryEstimate();
      }
    } catch (error) {
      if (error?.status === 401) {
        auth.logout();
        persistCustomer(null);
        appState.customerOrders = null;
        appState.customerAddresses = null;
        appState.profileLoaded = false;
        // persistCustomer(null) e auth.logout() já limparam a sessão: uma chave só.
        renderHomeLoginPrompt();
        renderProfileView();
        requestDeliveryEstimate();
        renderSharedCashbackState();
      } else {
        console.error('[PedeAqui] Falha ao sincronizar sessão ou endereços', error);
      }
    }
  }

  // As 42 acoes que o markup destas telas chama por data-act-*.
  const ACOES_DO_MODULO = {
    closeForgotNotFound,
    closeForgotPasswordScreen,
    closeRecoverCodeScreen,
    closeRegisterScreen,
    closeResetPasswordScreen,
    closeSigninScreen,
    closeVerifyScreen,
    handleForgotEmailInput,
    handleLoginFieldBlur,
    handleLoginFieldInput,
    handleRecInput,
    handleRecKeydown,
    handleRecPaste,
    handleRegFieldBlur,
    handleRegFieldInput,
    handleRegPrivacyInput,
    handleResetPwInput,
    handleVfyInput,
    handleVfyKeydown,
    handleVfyPaste,
    loginForgotPassword,
    maskRegBirth,
    maskRegCpf,
    maskRegPhone,
    mockLogin,
    openForgotNotFound,
    openForgotPasswordScreen,
    openLoginScreen,
    openRecoverCodeScreen,
    openRegisterScreen,
    openResetPasswordScreen,
    openSigninScreen,
    resendRecoverCode,
    resendVfyCode,
    submitForgotPassword,
    submitLogin,
    submitRecoverCode,
    submitRegister,
    submitResetPassword,
    submitVerify,
    syncCustomerSession,
    toggleRegPassword
  };

  /**
   * Chamado UMA vez, por restaurant-page.js, no ponto onde este bloco morava.
   *
   * Os acessores sao conferidos um a um: faltando um, este modulo leria
   * `undefined` onde havia a conta do cliente, e a tela de login se comportaria
   * como se ninguem estivesse logado — em silencio. Melhor estourar no boot.
   */
  function init(deps) {
    for (const nome of ESTADO_SO_LEITURA) {
      if (typeof deps?.estado?.[nome]?.get !== 'function') {
        throw new Error(`PedeAquiAuthFlow.init: falta o getter de ${nome}`);
      }
      Object.defineProperty(S, nome, { get: deps.estado[nome].get, configurable: true });
    }
    for (const nome of ESTADO_COM_ESCRITA) {
      const acessor = deps?.estado?.[nome];
      if (typeof acessor?.get !== 'function' || typeof acessor?.set !== 'function') {
        throw new Error(`PedeAquiAuthFlow.init: ${nome} precisa de getter E setter`);
      }
      Object.defineProperty(S, nome, { get: acessor.get, set: acessor.set, configurable: true });
    }
    ({
      $,
      apiErrorMessage,
      appState,
      closeCouponDetail,
      closeModalId,
      closeProfSub,
      clubController,
      currentScrollY,
      esc,
      loadCashbackForHome,
      lockBodyScroll,
      mobNavAssistant,
      mobNavClub,
      onTeardown,
      onlyDigits,
      openModal,
      openModalImmediately,
      persistCustomer,
      renderHomeLoginPrompt,
      renderProfileView,
      renderSharedCashbackState,
      requestDeliveryEstimate,
      setBottomNavSuppressedForAuth,
      showHomeTab,
      syncAuthScreenOpenClass,
      syncCartLocationState,
      synchronizeCustomerAddresses,
      unlockBodyScrollIfClear,
      updateCartUI
    } = deps);
    window.RapidexActions.register(ACOES_DO_MODULO);
    // ISTO PRECISA ESTAR AQUI, e nao no corpo do modulo.
    //
    // Dentro do fechamento do restaurant-page.js esta linha rodava depois de
    // tudo estar definido. Fora dele, o corpo do modulo executa quando o
    // arquivo e importado — ANTES de init() — e `onTeardown` ainda vale
    // undefined. O app inteiro morria no boot com "p is not a function", com
    // lint, typecheck e unitarios verdes: nenhum deles executa o bundle.
    onTeardown(stopVfyTimer);
  }

  window.PedeAquiAuthFlow = {
    init,
    // As portas que o restaurant-page.js ainda chama pelo nome.
    EYE_OFF_SVG,
    isValidBirthDate,
    lockAuthScreenScroll,
    maskRegBirth,
    maskRegPhone,
    openLoginScreen,
    syncCustomerSession
  };
})();
