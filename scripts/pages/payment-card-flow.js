(function () {
  /** @typedef {import('../types/api').components['schemas']['PaymentConfigResponse']} PaymentConfigResponse */
  /** @typedef {import('../types/api').components['schemas']['SavedCardResponse']} SavedCardResponse */

  const $ = id => document.getElementById(id);
  /** @type {PaymentConfigResponse | null} */
  let paymentConfig = null;
  /** @type {SavedCardResponse[]} */
  let savedCards = [];
  let fieldsMounted = false;
  /** @type {{card: SavedCardResponse, resolve: (value: string) => void, reject: (reason?: unknown) => void, promise: Promise<string>} | null} */
  let savedCardCvvContext = null;
  const SECURE_FIELD_UI = {
    cardNumber: { host: 'mpCardNumber', error: 'cardNumberError' },
    expirationDate: { host: 'mpExpirationDate', error: 'expirationDateError' },
    securityCode: { host: 'mpSecurityCode', error: 'securityCodeError' }
  };

  function emptySecureFieldState() {
    return { ready: false, changed: false, valid: null, failed: false, causes: [] };
  }

  let secureFieldState = {
    cardNumber: emptySecureFieldState(),
    expirationDate: emptySecureFieldState(),
    securityCode: emptySecureFieldState()
  };
  let savedCvvState = emptySecureFieldState();

  function restaurantSlug() {
    return window.RapidexTenant?.resolveSlug?.() || '';
  }

  function isLogged() {
    return Boolean(window.PedeAquiCustomerAuth?.getToken?.());
  }

  function action(name, ...args) {
    return window.RapidexActions?.resolve(name)?.(...args);
  }

  function brandLabel(value) {
    const brand = String(value || '').toLowerCase();
    return ({
      amex: 'American Express',
      american_express: 'American Express',
      elo: 'Elo',
      hiper: 'Hiper',
      master: 'Mastercard',
      mastercard: 'Mastercard',
      visa: 'Visa'
    })[brand] || (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Cartão');
  }

  function brandClass(value) {
    const brand = String(value || '').toLowerCase();
    if (brand.includes('amex') || brand.includes('american')) return 'pay-brand--amex';
    if (brand.includes('elo')) return 'pay-brand--elo';
    if (brand.includes('hiper')) return 'pay-brand--hiper';
    if (brand.includes('master')) return 'pay-brand--master';
    if (brand.includes('visa')) return 'pay-brand--visa';
    return '';
  }

  function maskedCardNumber(lastFour) {
    return `•••• •••• •••• ${String(lastFour || '').padStart(4, '•')}`;
  }

  function cardKey(cardId) {
    return `credit:${cardId}`;
  }

  function cardState(message, error = false) {
    const state = document.createElement('div');
    state.className = `payment-saved-cards-state${error ? ' payment-saved-cards-state--error' : ''}`;
    state.textContent = message;
    return state;
  }

  /** @param {SavedCardResponse} card */
  function buildCardRow(card) {
    const row = document.createElement('article');
    row.className = 'payment-saved-card';
    row.dataset.cardId = card.id;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'payment-saved-card-select';
    select.dataset.paymentScope = 'online';
    select.dataset.paymentKey = cardKey(card.id);
    select.dataset.paymentValue = brandLabel(card.brand);
    select.setAttribute('data-act-click', JSON.stringify(['selectSavedCard', card.id]));
    select.setAttribute('aria-label', `Usar ${brandLabel(card.brand)} final ${card.last_four_digits}`);
    const selectedKey = $('paymentMethodModal')?.dataset.paymentKey || '';
    select.classList.toggle('active', selectedKey === cardKey(card.id));

    const icon = document.createElement('span');
    icon.className = `payment-brand-icon ${brandClass(card.brand)}`.trim();
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'payment-saved-card-copy';
    const title = document.createElement('strong');
    title.textContent = `${brandLabel(card.brand)} - Crédito`;
    const number = document.createElement('small');
    number.textContent = maskedCardNumber(card.last_four_digits);
    copy.append(title, number);
    select.append(icon, copy);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'payment-saved-card-delete';
    remove.setAttribute('data-act-click', JSON.stringify(['deleteSavedCard', card.id]));
    remove.setAttribute('aria-label', `Remover cartão final ${card.last_four_digits}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>';
    row.append(select, remove);
    return row;
  }

  function renderSavedCards() {
    const container = $('paymentSavedCards');
    if (!container) return;
    container.replaceChildren();
    savedCards.forEach(card => container.appendChild(buildCardRow(card)));
  }

  async function ensurePaymentConfig(force = false) {
    const slug = restaurantSlug();
    paymentConfig = await window.PedeAquiPaymentConfigService.getPaymentConfig(slug, { force });
    return paymentConfig;
  }

  async function refreshPaymentMethods() {
    const cardArea = $('paymentOnlineCards');
    const list = $('paymentSavedCards');
    if (cardArea) cardArea.hidden = true;
    if (list) list.replaceChildren(cardState('Carregando cartões...'));
    try {
      const config = await ensurePaymentConfig();
      if (!window.PedeAquiPaymentConfigService.cardIsAvailable(config)) return;
      if (cardArea) cardArea.hidden = false;
      if (!isLogged()) {
        savedCards = [];
        renderSavedCards();
        return;
      }
      savedCards = await window.PedeAquiCustomerCardService.listCards(restaurantSlug());
      renderSavedCards();
    } catch (error) {
      if (cardArea) cardArea.hidden = false;
      if (list) list.replaceChildren(cardState(error?.message || 'Não foi possível carregar os cartões.', true));
    }
  }

  async function refreshProfilePaymentMethods() {
    const button = document.querySelector('#profSubpagamento .prof-card-coming-soon');
    if (!(button instanceof HTMLButtonElement)) return;
    button.hidden = true;
    try {
      const config = await ensurePaymentConfig();
      button.hidden = !window.PedeAquiPaymentConfigService.cardIsAvailable(config);
    } catch {
      button.hidden = true;
    }
  }

  function showFormError(message) {
    const error = $('creditCardFormError');
    if (!error) return;
    error.textContent = message || '';
    error.hidden = !message;
    error.classList.toggle('show', Boolean(message));
  }

  function setCardFieldError(field, message) {
    const ui = SECURE_FIELD_UI[field] || {
      cardholderName: { host: 'cardholderName', error: 'cardholderNameError' },
      cardholderCpf: { host: 'cardholderCpf', error: 'cardholderCpfError' }
    }[field];
    if (!ui) return;
    const host = $(ui.host);
    const wrapper = host?.closest('.payment-card-field');
    const error = $(ui.error);
    wrapper?.classList.toggle('payment-card-field--error', Boolean(message));
    host?.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) {
      error.textContent = message || '';
      error.classList.toggle('show', Boolean(message));
    }
  }

  function setSecureFieldLoading(field, _loading, failed = false) {
    const host = $(SECURE_FIELD_UI[field]?.host);
    host?.classList.remove('is-loading');
    host?.classList.toggle('has-load-error', Boolean(failed));
    host?.setAttribute('aria-busy', 'false');
  }

  function resetSecureFieldStates() {
    secureFieldState = {
      cardNumber: emptySecureFieldState(),
      expirationDate: emptySecureFieldState(),
      securityCode: emptySecureFieldState()
    };
    Object.keys(SECURE_FIELD_UI).forEach(field => {
      setCardFieldError(field, '');
      setSecureFieldLoading(field, false);
    });
  }

  function secureFieldErrorMessage(field) {
    if (field === 'cardNumber') return 'Número do cartão inválido';
    if (field === 'expirationDate') return 'Informe uma data de validade futura';
    return 'CVV inválido para a bandeira do cartão';
  }

  function secureFieldReady(field) {
    const state = secureFieldState[field];
    if (!state) return;
    state.ready = true;
    state.failed = false;
    setSecureFieldLoading(field, false);
  }

  function secureFieldChanged(field) {
    const state = secureFieldState[field];
    if (!state) return;
    state.changed = true;
    if (state.valid !== false) setCardFieldError(field, '');
  }

  function secureFieldBlurred(field) {
    const state = secureFieldState[field];
    if (!state?.ready) return;
    if (!state.changed) setCardFieldError(field, 'Campo obrigatório');
    else if (state.valid === false) setCardFieldError(field, secureFieldErrorMessage(field));
  }

  function secureFieldValidityChanged(field, event) {
    const state = secureFieldState[field];
    if (!state) return;
    const errors = Array.isArray(event?.errorMessages) ? event.errorMessages : [];
    state.changed = true;
    state.valid = errors.length === 0;
    state.causes = errors.map(item => String(item?.cause || ''));
    setCardFieldError(field, state.valid ? '' : secureFieldErrorMessage(field));
  }

  function secureFieldFailed(field) {
    const state = secureFieldState[field];
    if (!state) return;
    state.failed = true;
    state.ready = false;
    setSecureFieldLoading(field, false, true);
    setCardFieldError(field, 'Não foi possível carregar este campo seguro');
  }

  const secureFieldCallbacks = {
    onReady: secureFieldReady,
    onChange: secureFieldChanged,
    onBlur: secureFieldBlurred,
    onValidityChange: secureFieldValidityChanged,
    onError: secureFieldFailed
  };

  async function openAddCardTypeScreen() {
    if (!isLogged()) {
      action('openLoginScreen', 'cart');
      return;
    }
    try {
      const config = await ensurePaymentConfig();
      if (!window.PedeAquiPaymentConfigService.cardIsAvailable(config)) return;
      window.PedeAquiRestaurantUi?.openModal('addCardTypeModal');
    } catch (error) {
      const list = $('paymentSavedCards');
      if (list) list.replaceChildren(cardState(error?.message || 'Cartão indisponível no momento.', true));
    }
  }

  function closeAddCardTypeScreen() {
    window.PedeAquiRestaurantUi?.closeModalId('addCardTypeModal');
  }

  function resetCreditCardForm() {
    const form = $('creditCardForm');
    if (form instanceof HTMLFormElement) form.reset();
    showFormError('');
    setCardFieldError('cardholderName', '');
    setCardFieldError('cardholderCpf', '');
    resetSecureFieldStates();
    const save = $('saveCreditCardButton');
    if (save instanceof HTMLButtonElement) {
      save.disabled = false;
      save.classList.remove('is-loading');
      save.textContent = 'Salvar';
    }
    fieldsMounted = false;
  }

  async function openCreditCardForm() {
    const config = paymentConfig || await ensurePaymentConfig();
    if (!window.PedeAquiPaymentConfigService.cardIsAvailable(config) || !config.public_key) return;
    resetCreditCardForm();
    window.PedeAquiRestaurantUi?.openModal('creditCardModal');
    try {
      await window.PedeAquiMercadoPago.mountCardFields(config.public_key, {
        cardNumber: 'mpCardNumber',
        expirationDate: 'mpExpirationDate',
        securityCode: 'mpSecurityCode'
      }, secureFieldCallbacks);
      fieldsMounted = true;
      // `mount()` já inseriu os iframes. O evento `ready` não é confiável em
      // todos os WebViews; ele serve como confirmação adicional, não como
      // bloqueio para digitar ou salvar.
      Object.keys(SECURE_FIELD_UI).forEach(secureFieldReady);
    } catch (error) {
      Object.keys(SECURE_FIELD_UI).forEach(secureFieldFailed);
      showFormError(error?.message || 'Não foi possível carregar a segurança do cartão.');
    }
  }

  function backToAddCardType() {
    window.PedeAquiMercadoPago?.unmountCardFields();
    fieldsMounted = false;
    window.PedeAquiRestaurantUi?.closeModalId('creditCardModal');
  }

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function maskCardholderCpf(input) {
    if (!(input instanceof HTMLInputElement)) return;
    const digits = onlyDigits(input.value).slice(0, 11);
    input.value = digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
    validateCardholderInput('cardholderCpf');
  }

  function isValidCpf(digits) {
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
    let sum = 0;
    for (let index = 0; index < 9; index++) sum += Number(digits[index]) * (10 - index);
    let firstDigit = (sum * 10) % 11;
    if (firstDigit === 10) firstDigit = 0;
    if (firstDigit !== Number(digits[9])) return false;
    sum = 0;
    for (let index = 0; index < 10; index++) sum += Number(digits[index]) * (11 - index);
    let secondDigit = (sum * 10) % 11;
    if (secondDigit === 10) secondDigit = 0;
    return secondDigit === Number(digits[10]);
  }

  function validateCardholderInput(field) {
    const input = /** @type {HTMLInputElement | null} */ ($(field));
    if (!input) return false;
    if (!String(input.value || '').trim()) {
      setCardFieldError(field, 'Campo obrigatório');
      return false;
    }
    if (field === 'cardholderCpf' && !isValidCpf(onlyDigits(input.value))) {
      setCardFieldError(field, 'CPF inválido');
      return false;
    }
    setCardFieldError(field, '');
    return true;
  }

  function validateSecureField(field) {
    const state = secureFieldState[field];
    if (!state || state.failed || !state.ready) return false;
    if (!state.changed) {
      setCardFieldError(field, 'Campo obrigatório');
      return false;
    }
    if (state.valid === false) {
      setCardFieldError(field, secureFieldErrorMessage(field));
      return false;
    }
    setCardFieldError(field, '');
    return true;
  }

  function validateForm() {
    const form = $('creditCardForm');
    if (!(form instanceof HTMLFormElement)) return false;
    showFormError('');
    const results = [
      validateSecureField('cardNumber'),
      validateSecureField('expirationDate'),
      validateSecureField('securityCode'),
      validateCardholderInput('cardholderName'),
      validateCardholderInput('cardholderCpf')
    ];
    return fieldsMounted && results.every(Boolean);
  }

  function setSaving(saving) {
    const button = $('saveCreditCardButton');
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = saving;
    button.classList.toggle('is-loading', saving);
    button.textContent = saving ? 'Salvando' : 'Salvar';
  }

  async function saveCreditCard(event) {
    event?.preventDefault?.();
    if (!validateForm()) return;
    setSaving(true);
    showFormError('');
    try {
      const holder = /** @type {HTMLInputElement | null} */ ($('cardholderName'));
      const cpf = /** @type {HTMLInputElement | null} */ ($('cardholderCpf'));
      const token = await window.PedeAquiMercadoPago.createCardToken({
        cardholderName: String(holder?.value || '').trim(),
        identificationType: 'CPF',
        identificationNumber: onlyDigits(cpf?.value)
      });
      // Mercado Pago can return a token for sandbox cards while explicitly
      // reporting that the check digit failed. Never persist that card.
      if (token?.luhn_validation === false) {
        setCardFieldError('cardNumber', secureFieldErrorMessage('cardNumber'));
        setSaving(false);
        return;
      }
      if (!token?.id) {
        const validationError = new Error('Confira os dados do cartão.');
        validationError.name = 'SecureFieldsValidationError';
        throw validationError;
      }
      const card = await window.PedeAquiCustomerCardService.saveCard(restaurantSlug(), token.id);
      savedCards = [card, ...savedCards.filter(item => item.id !== card.id)];
      renderSavedCards();
      window.PedeAquiMercadoPago.unmountCardFields();
      fieldsMounted = false;
      window.PedeAquiRestaurantUi?.closeModalImmediately('creditCardModal');
      window.PedeAquiRestaurantUi?.closeModalImmediately('addCardTypeModal');
      action('selectSavedCardPayment', card);
    } catch (error) {
      if (error?.name === 'SecureFieldsValidationError') {
        const rejectedFields = Object.keys(secureFieldState)
          .filter(field => secureFieldState[field].valid === false);
        // Some Mercado Pago builds resolve `undefined` for a Luhn failure
        // without including cardNumber in the error object or event payload.
        // When no other field reported an error, the unresolved PCI validation
        // is the number itself.
        if (!rejectedFields.length) rejectedFields.push('cardNumber');
        rejectedFields.forEach(field => setCardFieldError(field, secureFieldErrorMessage(field)));
        setSaving(false);
        return;
      }
      const raw = JSON.stringify(error, Object.getOwnPropertyNames(error || {})).toLowerCase();
      if (raw.includes('cardnumber') || raw.includes('luhn')) {
        setCardFieldError('cardNumber', secureFieldErrorMessage('cardNumber'));
      } else if (raw.includes('expiration')) {
        setCardFieldError('expirationDate', secureFieldErrorMessage('expirationDate'));
      } else if (raw.includes('securitycode') || raw.includes('cvv')) {
        setCardFieldError('securityCode', secureFieldErrorMessage('securityCode'));
      } else if (raw.includes('identification') || raw.includes('cpf')) {
        setCardFieldError('cardholderCpf', 'CPF inválido');
      } else {
        showFormError(error?.message || 'Não foi possível salvar o cartão. Tente novamente.');
      }
      setSaving(false);
    }
  }

  function savedCardCvvError(message) {
    const error = $('savedCardCvvError');
    if (!error) return;
    error.textContent = message || '';
    error.hidden = !message;
    error.classList.toggle('show', Boolean(message));
    error.closest('.payment-card-field')?.classList.toggle('payment-card-field--error', Boolean(message));
    $('mpSavedCardSecurityCode')?.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  const savedCvvCallbacks = {
    onReady() {
      savedCvvState.ready = true;
      savedCvvState.failed = false;
      $('mpSavedCardSecurityCode')?.classList.remove('is-loading', 'has-load-error');
      $('mpSavedCardSecurityCode')?.setAttribute('aria-busy', 'false');
    },
    onChange() {
      savedCvvState.changed = true;
      if (savedCvvState.valid !== false) savedCardCvvError('');
    },
    onBlur() {
      if (savedCvvState.ready && !savedCvvState.changed) savedCardCvvError('Campo obrigatório');
    },
    onValidityChange(_field, event) {
      const errors = Array.isArray(event?.errorMessages) ? event.errorMessages : [];
      savedCvvState.changed = true;
      savedCvvState.valid = errors.length === 0;
      savedCardCvvError(savedCvvState.valid ? '' : 'CVV inválido para a bandeira do cartão');
    },
    onError() {
      savedCvvState.failed = true;
      savedCvvState.ready = false;
      $('mpSavedCardSecurityCode')?.classList.remove('is-loading');
      $('mpSavedCardSecurityCode')?.classList.add('has-load-error');
      savedCardCvvError('Não foi possível carregar este campo seguro');
    }
  };

  function closeSavedCardCvv(reject = true) {
    window.PedeAquiMercadoPago?.unmountCardFields();
    fieldsMounted = false;
    window.PedeAquiRestaurantUi?.closeModalId('savedCardCvvModal');
    const context = savedCardCvvContext;
    savedCardCvvContext = null;
    if (reject && context?.reject) context.reject(new Error('Pagamento cancelado.'));
  }

  async function requestSavedCardToken(card) {
    if (!card?.id || !window.PedeAquiMercadoPago?.mountSavedCardSecurityCode) return null;
    if (savedCardCvvContext) return savedCardCvvContext.promise;
    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    savedCardCvvContext = { card, resolve: resolveRequest, reject: rejectRequest, promise };
    const save = $('confirmSavedCardCvvButton');
    if (save instanceof HTMLButtonElement) save.disabled = true;
    savedCvvState = emptySecureFieldState();
    savedCardCvvError('');
    $('mpSavedCardSecurityCode')?.classList.remove('is-loading', 'has-load-error');
    $('mpSavedCardSecurityCode')?.setAttribute('aria-busy', 'false');
    window.PedeAquiRestaurantUi?.openModal('savedCardCvvModal');
    try {
      const config = paymentConfig || await ensurePaymentConfig();
      await window.PedeAquiMercadoPago.mountSavedCardSecurityCode(
        config.public_key,
        'mpSavedCardSecurityCode',
        savedCvvCallbacks
      );
      fieldsMounted = true;
      savedCvvCallbacks.onReady();
      if (save instanceof HTMLButtonElement) save.disabled = false;
    } catch (error) {
      savedCardCvvError(error?.message || 'Não foi possível abrir o campo de CVV.');
      const context = savedCardCvvContext;
      savedCardCvvContext = null;
      window.PedeAquiMercadoPago?.unmountCardFields();
      fieldsMounted = false;
      window.PedeAquiRestaurantUi?.closeModalId('savedCardCvvModal');
      if (context) context.reject(error);
    }
    return promise;
  }

  async function confirmSavedCardCvv(event) {
    event?.preventDefault?.();
    const context = savedCardCvvContext;
    if (!context || !fieldsMounted || !savedCvvState.ready) {
      return;
    }
    if (!savedCvvState.changed) {
      savedCardCvvError('Campo obrigatório');
      return;
    }
    if (savedCvvState.valid === false) {
      savedCardCvvError('CVV inválido para a bandeira do cartão');
      return;
    }
    const save = $('confirmSavedCardCvvButton');
    if (save instanceof HTMLButtonElement) save.disabled = true;
    try {
      const token = await window.PedeAquiMercadoPago.createCardToken({ cardId: context.card.id });
      if (!token?.id) throw new Error('O Mercado Pago não devolveu o token do cartão.');
      savedCardCvvContext = null;
      window.PedeAquiMercadoPago.unmountCardFields();
      fieldsMounted = false;
      window.PedeAquiRestaurantUi?.closeModalImmediately('savedCardCvvModal');
      context.resolve(token.id);
    } catch (error) {
      savedCardCvvError(error?.message || 'Não foi possível confirmar o cartão.');
      if (save instanceof HTMLButtonElement) save.disabled = false;
    }
  }

  function selectSavedCard(cardId) {
    const card = savedCards.find(item => item.id === cardId);
    if (card) action('selectSavedCardPayment', card);
  }

  async function deleteSavedCard(cardId) {
    const row = document.querySelector(`.payment-saved-card[data-card-id="${CSS.escape(cardId)}"]`);
    row?.classList.add('is-removing');
    try {
      await window.PedeAquiCustomerCardService.deleteCard(cardId);
      savedCards = savedCards.filter(card => card.id !== cardId);
      renderSavedCards();
      action('clearSavedCardPayment', cardId);
    } catch (error) {
      row?.classList.remove('is-removing');
      const list = $('paymentSavedCards');
      if (list) list.prepend(cardState(error?.message || 'Não foi possível remover o cartão.', true));
    }
  }

  const ACTIONS = {
    openAddCardTypeScreen,
    closeAddCardTypeScreen,
    openCreditCardForm,
    backToAddCardType,
    maskCardholderCpf,
    validateCardholderInput,
    closeSavedCardCvv,
    confirmSavedCardCvv,
    saveCreditCard,
    selectSavedCard,
    deleteSavedCard
  };
  window.RapidexActions?.register(ACTIONS);
  window.PedeAquiCardFlow = {
    refreshPaymentMethods,
    refreshProfilePaymentMethods,
    openAddCardTypeScreen,
    requestSavedCardToken
  };
})();
