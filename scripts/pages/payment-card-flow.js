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
  }

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
    const save = $('saveCreditCardButton');
    if (save instanceof HTMLButtonElement) {
      save.disabled = true;
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
      });
      fieldsMounted = true;
      const save = $('saveCreditCardButton');
      if (save instanceof HTMLButtonElement) save.disabled = false;
    } catch (error) {
      showFormError(error?.message || 'Não foi possível abrir os campos seguros do cartão.');
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
  }

  function validateForm() {
    const form = $('creditCardForm');
    if (!(form instanceof HTMLFormElement)) return false;
    if (!form.checkValidity()) {
      form.reportValidity();
      showFormError('Preencha todos os dados obrigatórios.');
      return false;
    }
    const cpf = /** @type {HTMLInputElement | null} */ ($('cardholderCpf'));
    if (onlyDigits(cpf?.value).length !== 11) {
      cpf?.focus();
      showFormError('Informe um CPF com 11 dígitos.');
      return false;
    }
    if (!fieldsMounted) {
      showFormError('Aguarde os campos seguros do cartão carregarem.');
      return false;
    }
    return true;
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
      if (!token?.id) throw new Error('O Mercado Pago não devolveu o token do cartão.');
      const card = await window.PedeAquiCustomerCardService.saveCard(restaurantSlug(), token.id);
      savedCards = [card, ...savedCards.filter(item => item.id !== card.id)];
      renderSavedCards();
      window.PedeAquiMercadoPago.unmountCardFields();
      fieldsMounted = false;
      window.PedeAquiRestaurantUi?.closeModalImmediately('creditCardModal');
      window.PedeAquiRestaurantUi?.closeModalImmediately('addCardTypeModal');
      action('selectSavedCardPayment', card);
    } catch (error) {
      showFormError(error?.message || 'Não foi possível salvar o cartão. Tente novamente.');
      setSaving(false);
    }
  }

  function savedCardCvvError(message) {
    const error = $('savedCardCvvError');
    if (!error) return;
    error.textContent = message || '';
    error.hidden = !message;
  }

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
    savedCardCvvError('');
    window.PedeAquiRestaurantUi?.openModal('savedCardCvvModal');
    try {
      const config = paymentConfig || await ensurePaymentConfig();
      await window.PedeAquiMercadoPago.mountSavedCardSecurityCode(config.public_key, 'mpSavedCardSecurityCode');
      fieldsMounted = true;
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
    if (!context || !fieldsMounted) {
      savedCardCvvError('Aguarde o campo de CVV carregar.');
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
