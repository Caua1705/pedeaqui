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

  /**
   * A ORIGEM CARIMBADA NA FOLHA DE LOGIN — e por que ela precisa ser
   * reaplicável.
   *
   * Estas classes não são decoração: `from-coupon` leva o #loginModal para
   * `z-index:280` (utilities.css) e o deixa por cima do #couponDetailOverlay,
   * que é 260; `from-add-address` o leva para 240; e `from-coupon` /
   * `from-bottom-nav` zeram o scrim (assistant.css) para o painel branco
   * entrar sem empilhar um segundo preto. Sem elas o modal cai no `.overlay`
   * cru: z-index 200 e scrim de 42%.
   *
   * Elas se perdiam ao ir para o "Cadastre-se", e é isso que este bloco
   * separado conserta — ver `closeRegisterScreen()`.
   */
  function applyLoginOrigin(origin = 'profile') {
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
  }

  function openLoginScreen(origin = 'profile') {
    // Rearma a cada abertura: o par de nonce vale 10 minutos (ver
    // armGoogleSignIn). Sem await — a folha não espera pelo Google para abrir.
    armGoogleSignIn();
    applyLoginOrigin(origin);
    openModal('loginModal');
  }

  /**
   * VOLTAR PARA A FOLHA DE LOGIN — a porta única das telas que entram por cima
   * dela.
   *
   * QUATRO telas fecham o #loginModal para abrir por cima ("Cadastre-se",
   * "Esqueci a senha", o código de verificação e a redefinição de senha), e as
   * quatro voltavam reabrindo o modal CRU. O `closeModalId('loginModal')` da
   * ida é o decorado do restaurant-page, que chama `resetMenuLoginState()` e
   * apaga a origem — certo para "fechou o login", errado para "entrou um nível
   * mais fundo".
   *
   * Sem a origem o modal cai no `.overlay` cru (z-index 200, scrim de 42%). Pelo
   * caminho do cupom isso o punha ATRÁS do #couponDetailOverlay (260), e a
   * pessoa via a tela do cupom em vez do login — o "voltar que pula um nível".
   * Nas outras portas o sintoma era mais quieto: um scrim preto onde não havia,
   * e o `loginReturnNavId` zerado, que é quem devolve a aba do cardápio.
   *
   * Um sítio só, porque o defeito era o MESMO nos quatro e consertar um a um é
   * como ele volta pelo irmão.
   */
  function reopenLoginSheet({ imediato = false } = {}) {
    applyLoginOrigin(_loginOrigin);
    if (imediato) openModalImmediately('loginModal');
    else openModal('loginModal');
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
    // O VOLTAR DO CADASTRO PULAVA UM NIVEL, e o defeito nao estava aqui: estava
    // no `closeModalId('loginModal')` de `openRegisterScreen()`.
    //
    // Aquele closeModalId e o DECORADO do restaurant-page, e ele chama
    // `resetMenuLoginState()`, que APAGA `from-add-address` / `from-coupon` /
    // `from-bottom-nav` e zera `loginReturnNavId`. Isso esta certo para "a
    // pessoa FECHOU o login e foi embora" e errado para "a pessoa entrou um
    // nivel mais fundo": ir ao cadastro nao e sair do login.
    //
    // O que isso produzia, medido a 414x896 pelo caminho do cupom: ao voltar do
    // cadastro o #loginModal reabria como `.overlay active` cru — z-index 200
    // em vez dos 280 de `from-coupon` — e o #couponDetailOverlay, que e 260 e
    // continua aberto atras, passava a cobri-lo. O login REABRIA, mas embaixo:
    // o cliente via a tela de usar cupom e concluia que o voltar tinha pulado
    // um nivel. Pelo Perfil o mesmo apagamento acontecia e ninguem via, porque
    // ali nao ha nada em cima — so o scrim de 42% que nao devia estar la.
    //
    // `_loginOrigin` sobrevive (e estado do modulo), entao a origem e
    // REAPLICADA em vez de adivinhada — e por uma porta so, que as outras tres
    // telas de auth tambem usam (ver `reopenLoginSheet`).
    reopenLoginSheet({ imediato: true });
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
    // `regCpf` SAIU em 03/09/2026 — ver o comentário no restaurant.html. A API
    // não recebe CPF no cadastro desde 12/08/2026, e o front exigia um
    // documento que o servidor descartava. `isValidCpf` continua vivo em
    // utils/validators.js: quem o usa é o titular do CARTÃO, onde o gateway
    // exige o documento de verdade.
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

    // O 422 DO FASTAPI: `detail` é um array de { loc, msg, type }.
    //
    // `item.msg` é o texto do PYDANTIC, em inglês — "value is not a valid
    // email address", "String should have at least 8 characters" — e ele ia
    // CRU para debaixo do campo, para um cliente preenchendo um cadastro em
    // português. Mesma família do `ineligibility_reason` do cupom: valor do
    // backend que não foi escrito para o cliente ler chegando à tela.
    //
    // Quem traduz é services/validation-message.js, por tabela NOMINAL de
    // (campo, `type`) — `type` é vocabulário fechado do pydantic, enquanto
    // `msg` é prosa e muda de versão. Tipo desconhecido devolve '' e cai na
    // frase genérica daqui, nunca no texto cru.
    if (Array.isArray(data?.detail)) {
      const map = { name: 'regFullName', email: 'regEmail', phone: 'regPhone', birth_date: 'regBirth', password: 'regPassword' };
      const traducao = window.PedeAquiValidationMessage;
      data.detail.forEach(item => {
        const field = traducao.fieldOfError(item);
        const frase = traducao.fieldErrorMessage(item) || 'Valor inválido';
        if (field === 'privacy_accepted') {
          showRegError('regPrivacyErr', frase);
          handled = true;
          return;
        }
        if (map[field] && showRegFieldApiError(map[field], frase)) handled = true;
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
      const email = res?.email || reg.email;
      restore();
      // A SENHA VIAJA ATÉ A VERIFICAÇÃO, e só até lá. `RegisterCustomerResponse`
      // não traz `access_token` (o contrato é `customer_id, email, message,
      // requires_email_verification`), então a sessão de quem acabou de se
      // cadastrar tem de ser pedida por nós, com as credenciais que a pessoa
      // acabou de digitar. Ela fica NUMA VARIÁVEL, nunca em storage, e é
      // apagada assim que serve (ver `entrarAposCadastro`).
      openVerifyScreen({
        email,
        source: 'register',
        customer: { name: reg.name, email: reg.email, phone: reg.phone },
        senha: reg.password
      });
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
      customer: ctx?.customer || null,
      // O ticket do caso (b) do Google. Ele acompanha o código no
      // /auth/verify-email-code e é o que faz aquela rota LIGAR a identidade em
      // vez de só marcar o e-mail como verificado. Vazio no fluxo de cadastro.
      googleLinkTicket: ctx?.googleLinkTicket || '',
      // Só o fluxo de cadastro a manda. Em memória, nunca em storage, e zerada
      // em `entrarAposCadastro()` assim que o login acontece (ou falha).
      senha: ctx?.senha || ''
    };
    const isReset = verifyCtx.source === 'reset';
    const isGoogleLink = verifyCtx.source === 'google-link';
    const titleText = isReset ? 'Recuperar senha' : (isGoogleLink ? 'Confirmar seu e-mail' : 'Validação de e-mail');
    if ($('vfyHeaderTitle')) $('vfyHeaderTitle').textContent = titleText;
    if ($('vfyText')) {
      $('vfyText').innerHTML = `Nós enviamos um código de 6 dígitos para <strong>${esc(maskEmail(verifyCtx.email))}</strong>. O código expira em alguns minutos, insira o código abaixo:`;
    }
    if (isGoogleLink && $('vfyText')) {
      $('vfyText').innerHTML = `Este e-mail já tem uma conta aqui. Enviamos um código de 6 dígitos para <strong>${esc(maskEmail(verifyCtx.email))}</strong> — ele é o que autoriza ligar o Google a ela.`;
    }
    showVfyMsg('');
    clearVfyInputs();
    $('registerScreen')?.classList.remove('active');
    $('loginScreen')?.classList.remove('active');
    $('googleSignupScreen')?.classList.remove('active');
    closeModalId('loginModal');
    $('verifyScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
    // NÃO HÁ ROTA DE REENVIO PARA O CÓDIGO DO GOOGLE, e o contrato é explícito:
    // `/auth/resend-email-code` desiste em silêncio quando o e-mail já está
    // verificado, que é o caso da maioria das contas existentes — justamente as
    // que caem aqui. Para outro código, o caminho é tocar no botão do Google de
    // novo, que traz um ticket novo junto. Um botão "Reenviar" que não reenvia
    // é pior que nenhum: ele promete e não cumpre, sem dizer por quê.
    // ESCOPADO NO #verifyScreen: `.vfy-resend-row` existe DUAS vezes no HTML
    // (a tela de código do cadastro e a da recuperação de senha). Um
    // `querySelector` global pega a primeira e acerta por acidente — no dia em
    // que a ordem do markup mudar, esta linha esconde a linha da OUTRA tela.
    const linhaReenvio = document.querySelector('#verifyScreen .vfy-resend-row');
    if (linhaReenvio) linhaReenvio.hidden = isGoogleLink;
    if (isGoogleLink) stopVfyTimer();
    else startVfyTimer();
    setTimeout(() => vfyDigits()[0]?.focus(), 60);
  }

  function closeVerifyScreen() {
    stopVfyTimer();
    $('verifyScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    // Return to a sensible previous screen.
    if (verifyCtx.source === 'register') $('registerScreen')?.classList.add('active');
    else reopenLoginSheet();
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
        const res = await window.PedeAquiCustomerAuth.verifyEmailCode({
          email: verifyCtx.email,
          code,
          google_link_ticket: verifyCtx.googleLinkTicket
        });
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
        // COM TICKET, A MESMA ROTA DEVOLVE SESSÃO. É a diferença do caso (b):
        // o código certo ligou a identidade ao cliente que já existia, e vêm
        // `access_token`, `token_type`, `customer` e `linked_provider`. Sem
        // ticket a resposta continua sendo `{verified, message}` e o login
        // continua sendo o passo seguinte — os dois ramos abaixo são isso.
        if (verifyCtx.googleLinkTicket && res?.access_token) {
          applyLoggedSession(res.access_token, res.customer);
          await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true });
          $('verifyScreen')?.classList.remove('active');
          finishLoginNavigation();
          return;
        }
        // CADASTRAR LOGA — e até 05/09/2026 não logava.
        //
        // A rota não devolve sessão sem ticket do Google, então quem se
        // cadastrava saía com um cliente LOCAL: nome na tela, nenhum token. Pelo
        // Pix isso passava despercebido (o visitante paga, e o `tracking_token`
        // é a porta dele para o pedido, §6); pelo CARTÃO não, porque cartão
        // salvo pertence a uma conta e a cobrança exige Bearer do cliente. Duas
        // regras de conta em dois caminhos de pagamento, e nenhuma escrita.
        //
        // A sessão é pedida com as credenciais que a pessoa ACABOU de digitar,
        // pela mesma rota do login normal. Não é atalho: é o login que ela
        // faria em seguida, feito por ela.
        const entrou = await entrarAposCadastro();
        if (!entrou) {
          // DEGRADA PARA O COMPORTAMENTO ANTIGO em vez de barrar. A conta EXISTE
          // e o e-mail está verificado: prender a pessoa numa tela de erro por
          // causa do login seria pior que deixá-la seguir como seguia ontem — e
          // pelo Pix ela paga do mesmo jeito.
          const localCustomer = verifyCtx.customer || { email: verifyCtx.email };
          if (localCustomer?.name || verifyCtx.source === 'register') applyLocalCustomer(localCustomer);
        }
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

  /* ---------- Entrar com Google ---------- */

  // ==========================================================================
  //  TRÊS DESFECHOS, UMA RESPOSTA — e o campo `status` é quem decide.
  //
  //    authenticated               entra igual ao login por e-mail.
  //    link_confirmation_required  o `sub` é novo e o e-mail JÁ TEM conta aqui.
  //                                NINGUÉM foi logado e NADA foi ligado: saiu um
  //                                código por e-mail e veio um `link_ticket`.
  //                                A sessão sai de /auth/verify-email-code.
  //    profile_required            o e-mail não tem conta. Faltam telefone e
  //                                data de nascimento, que o Google não manda.
  //
  //  POR QUE O CASO (b) NÃO É "JUNTAR CONTAS POR E-MAIL". O ticket sozinho não
  //  liga nada — quem autoriza é o CÓDIGO, que só chega na caixa de entrada.
  //  Sem essa prova a mais, quem tivesse se cadastrado antes com o endereço de
  //  outra pessoa receberia a conta dela pronta ao entrar com o Google.
  //
  //  E é a MESMA tela de código do cadastro, com o mesmo markup: o que muda é o
  //  `source`, e é ele que manda o ticket junto e sabe ler a sessão que volta.
  //  Uma segunda tela de seis dígitos seria a segunda cópia da mesma coisa.
  // ==========================================================================

  let _googleArmando = false;
  let _googleCtx = { signup_ticket: '', email: '', name: '' };

  function showGoogleError(msg) {
    const el = $('loginGoogleError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /**
   * Arma o botão do Google na folha de login.
   *
   * Chamada a CADA abertura da folha, de propósito: o par de nonce vale 10
   * minutos, e uma folha aberta atrás de uma aba passa disso sem esforço. A
   * rota do nonce não autentica, não toca no banco e não diz nada sobre
   * ninguém — rearmar é um sorteio e uma assinatura.
   *
   * Sem client id no ambiente, o bloco inteiro fica `hidden` e nada é pedido.
   */
  async function armGoogleSignIn({ limparErro = true } = {}) {
    const bloco = $('loginGoogleBlock');
    const alvo = $('googleSignInButton');
    const gid = window.PedeAquiGoogleIdentity;
    if (!bloco || !alvo) return false;
    if (!gid?.isEnabled()) { bloco.hidden = true; return false; }
    if (_googleArmando) return false;
    _googleArmando = true;
    // `limparErro: false` para quem REARMA depois de uma falha. Limpar aqui
    // apagava a frase que a falha acabara de escrever, e o cliente voltava para
    // uma folha sem uma palavra sobre o que tinha acontecido — o pior desfecho
    // possível para um erro que EXIGE um segundo toque no botão.
    if (limparErro) showGoogleError('');
    try {
      const ok = await gid.armarBotao(alvo, {
        onCredential: handleGoogleCredential,
        onError: erro => {
          // O botão SOME quando o Google não pôde ser armado. Deixá-lo na tela
          // sem funcionar é a mesma armadilha do client id ausente.
          bloco.hidden = true;
          console.error('[PedeAqui] Não foi possível preparar o Entrar com Google.', erro);
        }
      });
      bloco.hidden = !ok;
      return ok;
    } finally {
      _googleArmando = false;
    }
  }

  async function handleGoogleCredential({ id_token, nonce_token }) {
    showGoogleError('');
    try {
      const res = await window.PedeAquiCustomerAuth.signInWithGoogle({ id_token, nonce_token });
      if (res?.status === 'authenticated') {
        // `access_token` ausente num `authenticated` não é caso do contrato; se
        // acontecer, entrar sem token deixaria a tela LOGADA e a API 401 em
        // tudo. Cair na mensagem é a resposta segura.
        if (!res?.access_token) {
          showGoogleError('Não foi possível entrar com o Google. Tente de novo.');
          return;
        }
        applyLoggedSession(res.access_token, res.customer);
        await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true });
        finishLoginNavigation();
        return;
      }
      if (res?.status === 'link_confirmation_required') {
        openVerifyScreen({
          email: res.email || '',
          source: 'google-link',
          googleLinkTicket: res.link_ticket || ''
        });
        return;
      }
      if (res?.status === 'profile_required') {
        openGoogleSignupScreen({
          signup_ticket: res.signup_ticket || '',
          email: res.email || '',
          name: res.name || ''
        });
        return;
      }
      showGoogleError(res?.message || 'Não foi possível entrar com o Google.');
    } catch (error) {
      // O 400 daqui costuma ser o par de nonce vencido, e a única saída é pedir
      // outro par — não há o que consertar do lado do app. Rearmar deixa a
      // pessoa tocar de novo em vez de fechar e reabrir a folha.
      await armGoogleSignIn({ limparErro: false });
      showGoogleError(apiErrorMessage(error, 'Não foi possível entrar com o Google. Toque no botão de novo.'));
    }
  }

  /* ---------- Completar o cadastro do Google (profile_required) ---------- */

  // Os dois campos que o Google não manda e `customers` exige. O telefone não
  // aceita enfeite: para cliente logado o pedido copia `customers.phone` no
  // snapshot, e é esse número que o ENTREGADOR liga.
  const GSU_FIELDS = [
    { id: 'gsuName', err: 'gsuNameErr', validate(v) {
      if (!(v || '').trim()) return 'Campo obrigatório';
      return '';
    } },
    { id: 'gsuPhone', err: 'gsuPhoneErr', validate(v) {
      const d = onlyDigits(v);
      if (!d) return 'Campo obrigatório';
      if (d.length < 10 || d.length > 11) return 'Informe o telefone completo';
      return '';
    } },
    { id: 'gsuBirth', err: 'gsuBirthErr', validate(v) {
      if (!onlyDigits(v)) return 'Campo obrigatório';
      if (!isValidBirthDate(v)) return 'O formato deve ser DD/MM/AAAA';
      return '';
    } }
  ];
  const gsuTouched = new Set();
  let _gsuSubmitting = false;

  const gsuDef = id => GSU_FIELDS.find(f => f.id === id);

  function setGsuFieldError(def, msg) {
    $(def.id)?.closest('.reg-field')?.classList.add('reg-field--error');
    showRegError(def.err, msg);
  }
  function clearGsuFieldError(def) {
    $(def.id)?.closest('.reg-field')?.classList.remove('reg-field--error');
    hideRegError(def.err);
  }
  function showGsuSummary(message) {
    const box = $('gsuSummary');
    if (!box) return;
    const texto = box.querySelector('span:last-child');
    if (texto && message) texto.textContent = message;
    box.classList.add('show');
  }
  function hideGsuSummary() {
    $('gsuSummary')?.classList.remove('show');
  }
  function validateGsuField(id) {
    const def = gsuDef(id);
    if (!def || !gsuTouched.has(id)) return;
    const msg = def.validate($(id)?.value);
    if (msg) setGsuFieldError(def, msg);
    else clearGsuFieldError(def);
  }
  function handleGsuFieldInput(id) {
    gsuTouched.add(id);
    validateGsuField(id);
    hideGsuSummary();
  }
  function handleGsuFieldBlur(id) {
    gsuTouched.add(id);
    validateGsuField(id);
  }
  function handleGsuPrivacyInput() {
    if ($('gsuPrivacy')?.checked) hideRegError('gsuPrivacyErr');
    hideGsuSummary();
  }

  function openGoogleSignupScreen(ctx) {
    _googleCtx = {
      signup_ticket: ctx?.signup_ticket || '',
      email: ctx?.email || '',
      name: ctx?.name || ''
    };
    gsuTouched.clear();
    GSU_FIELDS.forEach(clearGsuFieldError);
    hideRegError('gsuPrivacyErr');
    hideGsuSummary();
    // O nome do Google pode ser o PRÓPRIO E-MAIL quando o perfil não tem nome —
    // o contrato avisa. Preencher o campo com um e-mail e chamá-lo de "nome" é
    // pior que deixá-lo vazio: a pessoa aceita sem ler e fica com isso na conta.
    const nome = _googleCtx.name && _googleCtx.name !== _googleCtx.email ? _googleCtx.name : '';
    if ($('gsuName')) $('gsuName').value = nome;
    if ($('gsuPhone')) $('gsuPhone').value = '';
    if ($('gsuBirth')) $('gsuBirth').value = '';
    if ($('gsuPromo')) $('gsuPromo').checked = false;
    if ($('gsuPrivacy')) $('gsuPrivacy').checked = false;
    if ($('gsuIntro')) {
      $('gsuIntro').innerHTML = `Seu e-mail <strong>${esc(_googleCtx.email)}</strong> já está confirmado pelo Google. Falta só o que ele não informa.`;
    }
    closeModalId('loginModal');
    $('loginScreen')?.classList.remove('active');
    $('registerScreen')?.classList.remove('active');
    $('googleSignupScreen')?.classList.add('active');
    setBottomNavSuppressedForAuth(true);
    lockAuthScreenScroll();
  }

  function closeGoogleSignupScreen() {
    $('googleSignupScreen')?.classList.remove('active');
    syncAuthScreenOpenClass();
    // Sair daqui NÃO deixa conta pela metade: nada foi criado ainda, o
    // `signup_ticket` vence sozinho e tocar no botão de novo recomeça do lugar
    // certo. Por isso a volta é para a folha de login, não para o cadastro.
    _googleCtx = { signup_ticket: '', email: '', name: '' };
    reopenLoginSheet();
  }

  function buildGoogleSignupPayload() {
    const birth = onlyDigits($('gsuBirth').value); // DDMMYYYY
    const payload = {
      signup_ticket: _googleCtx.signup_ticket,
      phone: onlyDigits($('gsuPhone').value),
      birth_date: `${birth.slice(4, 8)}-${birth.slice(2, 4)}-${birth.slice(0, 2)}`,
      privacy_accepted: Boolean($('gsuPrivacy')?.checked),
      marketing_opt_in: Boolean($('gsuPromo')?.checked)
    };
    // `name` é opcional: sem ele, fica o do Google. Mandar string vazia seria
    // APAGAR o nome que o Google deu.
    const nome = ($('gsuName')?.value || '').trim();
    if (nome) payload.name = nome;
    return payload;
  }

  async function submitGoogleSignup(event) {
    if (event) event.preventDefault();
    let primeiroInvalido = null;
    GSU_FIELDS.forEach(def => {
      const input = $(def.id);
      if (!input) return;
      gsuTouched.add(def.id);
      const msg = def.validate(input.value);
      if (msg) {
        setGsuFieldError(def, msg);
        if (!primeiroInvalido) primeiroInvalido = input;
      } else {
        clearGsuFieldError(def);
      }
    });
    if (!$('gsuPrivacy')?.checked) {
      showRegError('gsuPrivacyErr', 'É necessário aceitar a política de privacidade');
      if (!primeiroInvalido) primeiroInvalido = $('gsuPrivacy');
    }
    if (primeiroInvalido) {
      showGsuSummary('Preencha todos os campos');
      (primeiroInvalido.closest('.reg-field') || primeiroInvalido).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (_gsuSubmitting) return;
    _gsuSubmitting = true;
    const btn = $('gsuSubmitBtn');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    try {
      const res = await window.PedeAquiCustomerAuth.completeGoogleSignup(buildGoogleSignupPayload());
      if (!res?.access_token) {
        showGsuSummary(res?.message || 'Não foi possível concluir o cadastro.');
        return;
      }
      applyLoggedSession(res.access_token, res.customer);
      await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true });
      $('googleSignupScreen')?.classList.remove('active');
      finishLoginNavigation();
    } catch (error) {
      // 409 AQUI SIGNIFICA RECOMEÇAR, e não "tente outros dados": entre as duas
      // telas ou o `sub` foi ligado em outra aba, ou alguém criou conta com esse
      // e-mail. Chamar /auth/google de novo cai sozinho no caso certo.
      if (error?.status === 409) {
        $('googleSignupScreen')?.classList.remove('active');
        _googleCtx = { signup_ticket: '', email: '', name: '' };
        reopenLoginSheet();
        await armGoogleSignIn({ limparErro: false });
        showGoogleError('Sua conta mudou enquanto você preenchia. Toque em "Entrar com Google" de novo.');
        return;
      }
      showGsuSummary(apiErrorMessage(error, 'Não foi possível concluir o cadastro.'));
    } finally {
      _gsuSubmitting = false;
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
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
    reopenLoginSheet();
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
    reopenLoginSheet();
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

  // ==========================================================================
  //  A SESSÃO DE QUEM ACABOU DE SE CADASTRAR.
  //
  //  Devolve `true` quando entrou. O chamador só cai para o cliente LOCAL
  //  quando isto devolve `false` — degradar é melhor que barrar, porque a conta
  //  já existe e o e-mail já está verificado.
  //
  //  A SENHA É ZERADA NO `finally`, sempre. Ela existe em memória entre o
  //  cadastro e a verificação porque `RegisterCustomerResponse` não traz
  //  `access_token`, e some no instante em que serve — nem no sucesso nem no
  //  erro ela sobrevive à função. Nunca vai para storage.
  //
  //  `requires_email_verification` de volta aqui seria o backend dizendo que o
  //  código não valeu, o que contradiz o `verified` que acabamos de ler. Nesse
  //  caso não insistimos: devolve `false` e a pessoa segue como cliente local.
  // ==========================================================================
  async function entrarAposCadastro() {
    const email = verifyCtx.email;
    const senha = verifyCtx.senha;
    if (verifyCtx.source !== 'register' || !email || !senha) return false;
    try {
      const res = await window.PedeAquiCustomerService.loginCustomer({ login: email, password: senha });
      if (res?.requires_email_verification || !res?.access_token) return false;
      applyLoggedSession(res.access_token, res.customer);
      // Os endereços que a pessoa cadastrou ANTES de ter conta sobem junto —
      // é o mesmo passo do login normal, e sem ele quem montou o endereço no
      // checkout e só depois criou a conta perderia o endereço da conta.
      await synchronizeCustomerAddresses({ importLocal: true, notifyErrors: false });
      return true;
    } catch {
      return false;
    } finally {
      verifyCtx.senha = '';
    }
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
    closeGoogleSignupScreen,
    handleGsuFieldBlur,
    handleGsuFieldInput,
    handleGsuPrivacyInput,
    submitGoogleSignup,
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
