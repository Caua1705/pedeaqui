// ============================================================================
//  Tela do Perfil: dados do cliente (nome, e-mail, nascimento, telefone) e
//  troca de senha. Contrato mount(ctx) — skill §9. Corpo sem efeito; estado
//  da tela (submitting/loading) mora aqui dentro.
//
//  Regra que veio junto do bloco: 401 em qualquer passo derruba a sessão e
//  leva ao login (redirectCustomerDataToLogin) — a conta é global do Rapidex,
//  e um token morto aqui está morto no app inteiro.
// ============================================================================
(function () {
  let $, onlyDigits, releaseFocusFrom;
  let app, shell;

  let customerDataSubmitting = false;
  let customerDataLoading = false;
  const CUSTOMER_DATA_FIELDS = {
    name: ['profDataNameField', 'profDataNameError'],
    email: ['profDataEmailField', 'profDataEmailError'],
    birth: ['profDataBirthField', 'profDataBirthError'],
    phone: ['profDataPhoneField', 'profDataPhoneError']
  };

  function setCustomerDataFieldError(field, message = '') {
    const [fieldId, errorId] = CUSTOMER_DATA_FIELDS[field] || [];
    $(fieldId)?.classList.toggle('has-error', Boolean(message));
    if ($(errorId)) $(errorId).textContent = message;
  }
  function setCustomerDataStatus(message = '', tone = '') {
    const status = $('profDataStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('success', tone === 'success');
    status.classList.toggle('error', tone === 'error');
  }
  function formatCustomerBirthDate(value) {
    const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }
  function customerBirthDateToIso(value) {
    const digits = onlyDigits(value);
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  function fillCustomerDataForm(data) {
    if ($('profDataName')) $('profDataName').value = data?.name || '';
    if ($('profDataEmail')) $('profDataEmail').value = data?.email || '';
    if ($('profDataBirth')) { $('profDataBirth').value = formatCustomerBirthDate(data?.birth_date); if ($('profDataBirth').value) shell.maskRegBirth($('profDataBirth')); }
    if ($('profDataPhone')) { $('profDataPhone').value = data?.phone || ''; if ($('profDataPhone').value) shell.maskRegPhone($('profDataPhone')); }
  }
  function resetCustomerDataFeedback() {
    Object.keys(CUSTOMER_DATA_FIELDS).forEach(field => setCustomerDataFieldError(field));
    setCustomerDataStatus();
  }
  function redirectCustomerDataToLogin() {
    window.PedeAquiCustomerAuth?.logout?.();
    app.persistCustomer(null);
    releaseFocusFrom($('profDataScreen'));
    $('profDataScreen')?.classList.remove('active');
    $('profDataScreen')?.setAttribute('aria-hidden', 'true');
    $('profDataBackdrop')?.classList.remove('active');
    $('profDataBackdrop')?.setAttribute('aria-hidden', 'true');
    shell.closeProfSub();
    shell.renderHomeLoginPrompt();
    shell.renderProfileView();
    shell.openLoginScreen();
  }
  async function openCustomerDataScreen() {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) { shell.openLoginScreen(); return; }
    const screen = $('profDataScreen');
    const backdrop = $('profDataBackdrop');
    resetCustomerDataFeedback();
    fillCustomerDataForm(app.currentCustomerSnapshot());
    backdrop?.classList.add('active');
    backdrop?.setAttribute('aria-hidden', 'false');
    if (screen) {
      void screen.offsetWidth;
      screen.classList.add('active');
      screen.setAttribute('aria-hidden', 'false');
    }
    if (customerDataLoading) return;
    customerDataLoading = true;
    try {
      const me = await window.PedeAquiCustomerService.getCurrentCustomer();
      if (!me) throw new Error('Não foi possível carregar seus dados');
      app.persistCustomer(me);
      window.PedeAquiCustomerAuth?.setStoredCustomer?.(me);
      fillCustomerDataForm(me);
    } catch (error) {
      if (error?.status === 401) { redirectCustomerDataToLogin(); return; }
      setCustomerDataStatus('Não foi possível carregar seus dados. Tente novamente.', 'error');
    } finally {
      customerDataLoading = false;
    }
  }
  function closeCustomerDataScreen() {
    if (customerDataSubmitting) return;
    releaseFocusFrom($('profDataScreen'));
    $('profDataScreen')?.classList.remove('active');
    $('profDataScreen')?.setAttribute('aria-hidden', 'true');
    $('profDataBackdrop')?.classList.remove('active');
    $('profDataBackdrop')?.setAttribute('aria-hidden', 'true');
    resetCustomerDataFeedback();
  }
  function handleCustomerDataInput(field) { setCustomerDataFieldError(field); setCustomerDataStatus(); }
  function validateCustomerDataForm() {
    const name = ($('profDataName')?.value || '').trim();
    const email = ($('profDataEmail')?.value || '').trim();
    const phone = onlyDigits($('profDataPhone')?.value || '');
    const birth = $('profDataBirth')?.value || '';
    resetCustomerDataFeedback();
    let valid = true;
    if (!name) { setCustomerDataFieldError('name', 'Campo obrigatório'); valid = false; }
    if (!email) { setCustomerDataFieldError('email', 'Campo obrigatório'); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setCustomerDataFieldError('email', 'E-mail inválido'); valid = false; }
    if (!phone) { setCustomerDataFieldError('phone', 'Campo obrigatório'); valid = false; }
    else if (phone.length < 10 || phone.length > 11) { setCustomerDataFieldError('phone', 'Informe o telefone completo'); valid = false; }
    if (!onlyDigits(birth)) { setCustomerDataFieldError('birth', 'Campo obrigatório'); valid = false; }
    else if (!shell.isValidBirthDate(birth)) { setCustomerDataFieldError('birth', 'O formato deve ser DD/MM/AAAA'); valid = false; }
    return valid ? { name, email, phone, birth_date: customerBirthDateToIso(birth) } : null;
  }
  function customerDataApiMessage(error) {
    return shell.apiErrorMessage(error, 'Não foi possível atualizar seus dados');
  }
  async function submitCustomerData(event) {
    event?.preventDefault();
    if (customerDataSubmitting || customerDataLoading) return;
    if (!window.PedeAquiCustomerAuth?.getToken?.()) { redirectCustomerDataToLogin(); return; }
    const payload = validateCustomerDataForm();
    if (!payload) return;
    const submit = $('profDataSubmit');
    customerDataSubmitting = true;
    let updatedSuccessfully = false;
    if (submit) { submit.disabled = true; submit.classList.add('is-loading'); }
    try {
      const response = await window.PedeAquiCustomerService.updateCurrentCustomer(payload);
      const updated = { ...app.currentCustomerSnapshot(), ...payload, ...(response || {}) };
      app.persistCustomer(updated);
      window.PedeAquiCustomerAuth?.setStoredCustomer?.(updated);
      fillCustomerDataForm(updated);
      shell.renderHomeLoginPrompt();
      shell.renderProfileView();
      updatedSuccessfully = true;
    } catch (error) {
      if (error?.status === 401) { redirectCustomerDataToLogin(); return; }
      const message = customerDataApiMessage(error);
      const normalized = message.toLocaleLowerCase('pt-BR');
      const duplicate = error?.status === 409 || /já|ja |already|exist|em uso|in use|duplicad/.test(normalized);
      const emailInUse = duplicate && /email|e-mail/.test(normalized);
      const phoneInUse = duplicate && /phone|telefone|celular/.test(normalized);
      if (emailInUse) { setCustomerDataFieldError('email', 'Este e-mail já está em uso'); setCustomerDataStatus('Este e-mail já está em uso', 'error'); }
      else if (phoneInUse) { setCustomerDataFieldError('phone', 'Este telefone já está em uso'); setCustomerDataStatus('Este telefone já está em uso', 'error'); }
      else if (error?.status === 409) setCustomerDataStatus('Este e-mail ou telefone já está em uso', 'error');
      else setCustomerDataStatus(message, 'error');
    } finally {
      customerDataSubmitting = false;
      if (submit) { submit.disabled = false; submit.classList.remove('is-loading'); }
      if (updatedSuccessfully) closeCustomerDataScreen();
    }
  }
  let customerPasswordSubmitting = false;

  const CUSTOMER_PASSWORD_FIELDS = {
    current: ['profCurrentPasswordField', 'profCurrentPasswordError'],
    new: ['profNewPasswordField', 'profNewPasswordError'],
    confirm: ['profConfirmPasswordField', 'profConfirmPasswordError']
  };

  function setCustomerPasswordFieldError(field, message = '') {
    const [fieldId, errorId] = CUSTOMER_PASSWORD_FIELDS[field] || [];
    const wrapper = $(fieldId);
    const error = $(errorId);
    wrapper?.classList.toggle('has-error', Boolean(message));
    if (error) error.textContent = message;
  }

  function hideCustomerPasswordSummary() {
    const summary = $('profPasswordSummary');
    if (!summary) return;
    summary.classList.remove('show', 'success');
    const text = summary.querySelector('.prof-password-summary-text');
    if (text) text.textContent = '';
  }

  function showCustomerPasswordSummary(message, success = false) {
    const summary = $('profPasswordSummary');
    if (!summary) return;
    const text = summary.querySelector('.prof-password-summary-text');
    if (text) text.textContent = message;
    summary.classList.toggle('success', success);
    summary.classList.add('show');
  }

  function resetCustomerPasswordForm() {
    $('profPasswordForm')?.reset();
    Object.keys(CUSTOMER_PASSWORD_FIELDS).forEach(field => setCustomerPasswordFieldError(field));
    hideCustomerPasswordSummary();
    document.querySelectorAll('#profPasswordScreen .prof-password-input-wrap button').forEach(button => {
      button.innerHTML = shell.EYE_OFF_SVG;
      button.setAttribute('aria-label', 'Mostrar senha');
    });
    ['profCurrentPassword', 'profNewPassword', 'profConfirmPassword'].forEach(id => {
      const input = $(id);
      if (input) input.type = 'password';
    });
  }

  function openCustomerPasswordScreen() {
    if (!window.PedeAquiCustomerAuth?.getToken?.()) {
      shell.openLoginScreen();
      return;
    }
    resetCustomerPasswordForm();
    const screen = $('profPasswordScreen');
    screen?.classList.add('active');
    screen?.setAttribute('aria-hidden', 'false');
  }

  function closeCustomerPasswordScreen() {
    if (customerPasswordSubmitting) return;
    const screen = $('profPasswordScreen');
    releaseFocusFrom(screen);
    screen?.classList.remove('active');
    screen?.setAttribute('aria-hidden', 'true');
    resetCustomerPasswordForm();
  }

  function handleCustomerPasswordInput(field) {
    setCustomerPasswordFieldError(field);
    hideCustomerPasswordSummary();
  }

  function customerPasswordApiMessage(error) {
    const message = shell.apiErrorMessage(error, 'Não foi possível alterar a senha');
    const normalized = String(message).toLocaleLowerCase('pt-BR');
    if (normalized.includes('senha atual') && (normalized.includes('incorret') || normalized.includes('invalid'))) {
      return 'Senha atual incorreta';
    }
    if (normalized.includes('não confer') || normalized.includes('nao confer') || normalized.includes('não coinc') || normalized.includes('nao coinc')) {
      return 'As senhas não conferem';
    }
    return String(message);
  }

  async function submitCustomerPassword(event) {
    event?.preventDefault();
    if (customerPasswordSubmitting) return;
    const currentPassword = $('profCurrentPassword')?.value || '';
    const newPassword = $('profNewPassword')?.value || '';
    const confirmPassword = $('profConfirmPassword')?.value || '';
    Object.keys(CUSTOMER_PASSWORD_FIELDS).forEach(field => setCustomerPasswordFieldError(field));
    hideCustomerPasswordSummary();
    let valid = true;
    if (!currentPassword) {
      setCustomerPasswordFieldError('current', 'Campo obrigatório');
      valid = false;
    }
    if (!newPassword) {
      setCustomerPasswordFieldError('new', 'Campo obrigatório');
      valid = false;
    } else if (newPassword.length < 8) {
      setCustomerPasswordFieldError('new', 'Informe ao menos 8 caracteres');
      valid = false;
    }
    if (!confirmPassword) {
      setCustomerPasswordFieldError('confirm', 'Campo obrigatório');
      valid = false;
    } else if (newPassword !== confirmPassword) {
      setCustomerPasswordFieldError('confirm', 'As senhas não conferem');
      valid = false;
    }
    if (!valid) return;
    const submit = $('profPasswordSubmit');
    customerPasswordSubmitting = true;
    if (submit) {
      submit.disabled = true;
      submit.classList.add('is-loading');
    }
    try {
      await window.PedeAquiCustomerAuth.changeCustomerPassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      });
      const success = $('profPasswordSuccess');
      success?.classList.add('active');
      success?.setAttribute('aria-hidden', 'false');
    } catch (error) {
      if (error?.status === 401 && !String(error?.message || '').toLocaleLowerCase('pt-BR').includes('senha')) {
        await shell.syncCustomerSession();
        return;
      }
      showCustomerPasswordSummary(customerPasswordApiMessage(error));
    } finally {
      customerPasswordSubmitting = false;
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('is-loading');
      }
    }
  }
  function confirmCustomerPasswordSuccess() {
    const success = $('profPasswordSuccess');
    releaseFocusFrom(success);
    success?.classList.remove('active');
    success?.setAttribute('aria-hidden', 'true');
    resetCustomerPasswordForm();
    closeCustomerPasswordScreen();
  }
  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('customer-data-screen: mount(ctx) exige kit, app e shell');
    ({ $, onlyDigits, releaseFocusFrom } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['openLoginScreen', 'syncCustomerSession', 'closeProfSub', 'renderHomeLoginPrompt', 'renderProfileView', 'apiErrorMessage', 'maskRegBirth', 'maskRegPhone', 'isValidBirthDate']) {
      if (typeof shell[nome] !== 'function') throw new Error(`customer-data-screen: shell.${nome} ausente`);
    }
    if (typeof shell.EYE_OFF_SVG !== 'string') throw new Error('customer-data-screen: shell.EYE_OFF_SVG ausente');
    window.RapidexActions.register({
      openCustomerDataScreen,
      closeCustomerDataScreen,
      handleCustomerDataInput,
      submitCustomerData,
      openCustomerPasswordScreen,
      closeCustomerPasswordScreen,
      handleCustomerPasswordInput,
      submitCustomerPassword,
      confirmCustomerPasswordSuccess
    });
  }

  window.PedeAquiCustomerDataScreen = { mount };
})();
