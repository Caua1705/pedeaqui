(function () {
  /**
   * Fecha um modal pela porta que o resto do app usa: o closeModalId decorado
   * de restaurant-page.js, publicado em window. O fallback nao e enfeite — este
   * arquivo carrega DEPOIS de restaurant-page.js, mas se a ordem mudar, fechar
   * pela mecanica crua ainda fecha, e nao deixa o cliente presto num modal.
   */
  const closeAppModal = (id) => (
    typeof window.closeModalId === 'function'
      ? window.closeModalId(id)
      : window.PedeAquiRestaurantUi?.closeModalId(id)
  );

  /** @typedef {import('../types/api').components['schemas']['PaymentConfigResponse']} PaymentConfigResponse */
  /** @typedef {import('../types/api').components['schemas']['SavedCardResponse']} SavedCardResponse */

  const $ = id => document.getElementById(id);
  /** @type {PaymentConfigResponse | null} */
  let paymentConfig = null;
  /** @type {SavedCardResponse[]} */
  let savedCards = [];
  let fieldsMounted = false;
  let fieldsMounting = false;
  // Agora que a tela abre ANTES de os campos existirem, dá para sair dela no
  // meio do carregamento. Este contador invalida a abertura em curso para que
  // ela não monte iframes numa tela que já foi fechada.
  let cardFormSequence = 0;
  /** @type {{card: SavedCardResponse, resolve: (value: string) => void, reject: (reason?: unknown) => void, promise: Promise<string>} | null} */
  let savedCardCvvContext = null;
  const SECURE_FIELD_UI = {
    cardNumber: { host: 'mpCardNumber', error: 'cardNumberError' },
    expirationDate: { host: 'mpExpirationDate', error: 'expirationDateError' },
    securityCode: { host: 'mpSecurityCode', error: 'securityCodeError' }
  };

  /**
   * `showErrors` é QUANDO o aviso pode aparecer, e é o que separa os dois casos:
   *
   *   VAZIO   -> só reclama no Salvar. Passar por um campo sem preencher é um
   *              gesto normal (o cliente pode estar só indo para o próximo);
   *              acusar ali é ranzinza.
   *   ERRADO  -> reclama ao SAIR do campo. Errar um dígito do cartão é coisa
   *              que se quer saber ali, não três campos depois.
   *
   * Nos dois casos, digitar qualquer coisa desarma na hora: enquanto a pessoa
   * mexe no campo ela não está errando — está corrigindo.
   */
  function emptySecureFieldState() {
    return { ready: false, changed: false, valid: null, failed: false, causes: [], showErrors: false };
  }

  let secureFieldState = {
    cardNumber: emptySecureFieldState(),
    expirationDate: emptySecureFieldState(),
    securityCode: emptySecureFieldState()
  };
  let savedCvvState = emptySecureFieldState();
  // Mesma regra dos campos seguros, para nome e CPF: o aviso de cada um só
  // pode aparecer depois de o campo entrar aqui.
  const cardholderErrorsArmed = new Set();

  function restaurantSlug() {
    return window.RapidexTenant?.resolveSlug?.() || '';
  }

  function isLogged() {
    return Boolean(window.PedeAquiCustomerAuth?.getToken?.());
  }

  function action(name, ...args) {
    return window.RapidexActions?.resolve(name)?.(...args);
  }

  // Uma implementacao so, em services/card-format.js: esta tabela existia aqui
  // e, identica, em restaurant-page.js — e as duas telas mostram a bandeira do
  // MESMO cartao, a um toque uma da outra.
  const brandLabel = (value) => window.PedeAquiCardFormat.cardBrandLabel(value);

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

  /**
   * @param {object} [options]
   * @param {boolean} [options.branchAcceptsOnlineCard] se ESTA filial habilitou
   *   `credit_card` no grupo `online` de /info. Quem sabe isso é o checkout
   *   (`branchAcceptsOnlineCard()` em restaurant-page.js), que é quem lê /info.
   *
   * O padrão é `false` — falha FECHADA de propósito. Mostrar o cartão numa
   * filial que só o aceita na maquininha é o bug que esta gate existe para
   * impedir: o pedido nasceria `payment_flow: "delivery"`, sem cobrança
   * nenhuma, com o cliente achando que pagou. Esconder um cartão que caberia
   * custa um toque; mostrar um que não cabe custa o pedido.
   */
  async function refreshPaymentMethods({ branchAcceptsOnlineCard = false } = {}) {
    const cardArea = $('paymentOnlineCards');
    const list = $('paymentSavedCards');
    if (cardArea) cardArea.hidden = true;
    if (list) list.replaceChildren(cardState('Carregando cartões...'));
    try {
      // A credencial do gateway é do RESTAURANTE; o `credit_card` online é da
      // FILIAL. As duas precisam valer, e é a segunda que faltava.
      if (!branchAcceptsOnlineCard) return;
      const config = await ensurePaymentConfig();
      if (!window.PedeAquiPaymentConfigService.cardIsAvailable(config)) return;
      // Cartão está disponível nesta loja: começa o download do SDK AGORA,
      // dois toques antes de "Crédito". É o que tira a rede do caminho do
      // clique — antes o SDK só era baixado depois do toque.
      window.PedeAquiMercadoPago?.preloadSdk?.();
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

  /**
   * Enquanto o iframe não chega o campo mostra CARREGANDO, não erro.
   *
   * Antes esta função só sabia apagar o `is-loading` — a classe nunca era
   * posta, e nem existia regra de CSS para ela. O único estado visível durante
   * a espera era `has-load-error` ("Campo indisponível"), ou seja: o cliente
   * lia falha enquanto a coisa ainda estava carregando normalmente.
   */
  function setSecureFieldLoading(field, loading, failed = false) {
    const host = $(SECURE_FIELD_UI[field]?.host);
    if (!host) return;
    const busy = Boolean(loading) && !failed;
    host.classList.toggle('is-loading', busy);
    host.classList.toggle('has-load-error', Boolean(failed));
    host.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function resetSecureFieldStates(loading = false) {
    secureFieldState = {
      cardNumber: emptySecureFieldState(),
      expirationDate: emptySecureFieldState(),
      securityCode: emptySecureFieldState()
    };
    Object.keys(SECURE_FIELD_UI).forEach(field => {
      setCardFieldError(field, '');
      setSecureFieldLoading(field, loading);
    });
  }

  function secureFieldErrorMessage(field) {
    if (field === 'cardNumber') return 'Número do cartão inválido';
    if (field === 'expirationDate') return 'Informe uma data de validade futura';
    return 'CVV inválido para a bandeira do cartão';
  }

  /** A mensagem que ESTE campo mereceria agora, independente de poder aparecer. */
  function secureFieldErrorFor(field) {
    const state = secureFieldState[field];
    if (!state) return '';
    if (!state.changed) return 'Campo obrigatório';
    if (state.valid === false) return secureFieldErrorMessage(field);
    return '';
  }

  function renderSecureFieldError(field) {
    const state = secureFieldState[field];
    // Campo que nem carregou já mostra o aviso de falha de carregamento; a
    // validação não tem o que dizer por cima disso.
    if (!state || state.failed) return;
    setCardFieldError(field, state.showErrors ? secureFieldErrorFor(field) : '');
  }

  function secureFieldReady(field) {
    const state = secureFieldState[field];
    if (!state) return;
    state.ready = true;
    state.failed = false;
    setSecureFieldLoading(field, false);
  }

  /** Digitou: o aviso sai na hora e só volta ao sair do campo ou no Salvar. */
  function secureFieldChanged(field) {
    const state = secureFieldState[field];
    if (!state) return;
    state.changed = true;
    state.showErrors = false;
    renderSecureFieldError(field);
  }

  /** Saiu do campo: acusa CONTEÚDO errado. Campo vazio fica para o Salvar. */
  function secureFieldBlurred(field) {
    const state = secureFieldState[field];
    if (!state?.ready || !state.changed) return;
    state.showErrors = true;
    renderSecureFieldError(field);
  }

  /**
   * Só ANOTA a validade e repinta o que já estiver visível. Armar o aviso aqui
   * faria "Número do cartão inválido" piscar no segundo dígito digitado, o que
   * é exatamente o oposto do que o cliente pediu.
   */
  function secureFieldValidityChanged(field, event) {
    const state = secureFieldState[field];
    if (!state) return;
    const errors = Array.isArray(event?.errorMessages) ? event.errorMessages : [];
    state.changed = true;
    state.valid = errors.length === 0;
    state.causes = errors.map(item => String(item?.cause || ''));
    renderSecureFieldError(field);
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
      window.PedeAquiMercadoPago?.preloadSdk?.();
      window.PedeAquiRestaurantUi?.openModal('addCardTypeModal');
    } catch (error) {
      const list = $('paymentSavedCards');
      if (list) list.replaceChildren(cardState(error?.message || 'Cartão indisponível no momento.', true));
    }
  }

  function closeAddCardTypeScreen() {
    closeAppModal('addCardTypeModal');
  }

  function resetCreditCardForm({ loading = false } = {}) {
    const form = $('creditCardForm');
    if (form instanceof HTMLFormElement) form.reset();
    showFormError('');
    cardholderErrorsArmed.clear();
    setCardFieldError('cardholderName', '');
    setCardFieldError('cardholderCpf', '');
    resetSecureFieldStates(loading);
    const save = $('saveCreditCardButton');
    if (save instanceof HTMLButtonElement) {
      // Salvar só depois que os campos seguros existem: sem isso o botão
      // convida a enviar um formulário que ainda não tem como ser tokenizado.
      save.disabled = loading;
      save.classList.remove('is-loading');
      save.textContent = 'Salvar';
    }
    fieldsMounted = false;
  }

  /**
   * A tela abre PRIMEIRO, em estado de carregamento.
   *
   * Antes ela só aparecia depois de: buscar a chave pública, baixar o SDK,
   * instanciar o MercadoPago e os TRÊS iframes terminarem de carregar — tudo
   * em série. Do lado do cliente isso era um toque em "Crédito" sem resposta
   * nenhuma por segundos, e um erro no fim quando algum passo demorava demais.
   *
   * Agora o toque abre a tela na hora; a chave e o SDK são buscados em
   * paralelo (não dependem um do outro); e os campos só saem de "carregando"
   * quando os iframes ficam prontos — ou viram erro se realmente falharem.
   */
  async function openCreditCardForm() {
    if (fieldsMounting) return;
    fieldsMounting = true;
    const sequence = ++cardFormSequence;
    const abandoned = () => sequence !== cardFormSequence;
    resetCreditCardForm({ loading: true });
    window.PedeAquiRestaurantUi?.openModal('creditCardModal');
    try {
      const [config] = await Promise.all([
        paymentConfig || ensurePaymentConfig(),
        window.PedeAquiMercadoPago.ensureSdk()
      ]);
      if (abandoned()) return;
      if (!window.PedeAquiPaymentConfigService.cardIsAvailable(config) || !config.public_key) {
        closeAppModal('creditCardModal');
        return;
      }
      const { ready } = await window.PedeAquiMercadoPago.mountCardFields(config.public_key, {
        cardNumber: 'mpCardNumber',
        expirationDate: 'mpExpirationDate',
        securityCode: 'mpSecurityCode'
      }, secureFieldCallbacks);
      // Saiu da tela enquanto os iframes eram criados: eles não podem ficar
      // para trás, senão o próximo cadastro reaproveitaria campos órfãos.
      if (abandoned()) {
        window.PedeAquiMercadoPago.unmountCardFields();
        return;
      }
      fieldsMounted = true;
      // Os iframes já estão no DOM, mas digitar antes de o documento remoto
      // carregar perde as teclas — por isso o campo continua bloqueado até aqui.
      await ready;
      if (abandoned()) return;
      // O evento `ready` não é confiável em todo WebView; ele serve como
      // confirmação adicional, não como único caminho para liberar o campo.
      Object.keys(SECURE_FIELD_UI).forEach(secureFieldReady);
      const save = $('saveCreditCardButton');
      if (save instanceof HTMLButtonElement) save.disabled = false;
    } catch (error) {
      if (abandoned()) return;
      Object.keys(SECURE_FIELD_UI).forEach(secureFieldFailed);
      showFormError(error?.message || 'Não foi possível carregar a segurança do cartão.');
    } finally {
      fieldsMounting = false;
    }
  }

  function backToAddCardType() {
    cardFormSequence += 1;
    window.PedeAquiMercadoPago?.unmountCardFields();
    fieldsMounted = false;
    closeAppModal('creditCardModal');
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

  // Digitos verificadores do CPF: implementacao unica em
  // scripts/utils/validators.js. Havia uma copia aqui e outra identica em
  // payment-card-flow.js — mesmo algoritmo, nomes de variavel diferentes.
  const isValidCpf = (digits) => window.PedeAquiValidators.isValidCpf(digits);


  /** A mensagem que ESTE input mereceria agora, independente de poder aparecer. */
  function cardholderErrorFor(field) {
    const input = /** @type {HTMLInputElement | null} */ ($(field));
    if (!input) return '';
    const value = String(input.value || '').trim();
    if (!value) return 'Campo obrigatório';
    if (field === 'cardholderCpf' && !isValidCpf(onlyDigits(value))) return 'CPF inválido';
    return '';
  }

  function renderCardholderError(field) {
    setCardFieldError(field, cardholderErrorsArmed.has(field) ? cardholderErrorFor(field) : '');
  }

  /** Digitou: o aviso sai na hora e só volta ao sair do campo ou no Salvar. */
  function handleCardholderInput(field) {
    cardholderErrorsArmed.delete(field);
    renderCardholderError(field);
  }

  /**
   * Saiu do campo: acusa CPF inválido, mas nunca campo vazio — sair de um campo
   * em branco é só o cliente passando por ele.
   */
  function handleCardholderBlur(field) {
    const input = /** @type {HTMLInputElement | null} */ ($(field));
    if (!input || !String(input.value || '').trim()) return;
    cardholderErrorsArmed.add(field);
    renderCardholderError(field);
  }

  /** O Salvar é o momento em que TUDO pode reclamar, inclusive o campo vazio. */
  function validateCardholderInput(field) {
    if (!$(field)) return false;
    cardholderErrorsArmed.add(field);
    renderCardholderError(field);
    return !cardholderErrorFor(field);
  }

  /** O Salvar é o momento em que TUDO pode reclamar, inclusive o campo vazio. */
  function validateSecureField(field) {
    const state = secureFieldState[field];
    if (!state || state.failed || !state.ready) return false;
    state.showErrors = true;
    renderSecureFieldError(field);
    return !secureFieldErrorFor(field);
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

  /**
   * Trilha da confirmação do CVV do cartão salvo.
   *
   * Existe porque esta tela tinha como falhar sem dizer nada: o `Continuar`
   * saía por um `return` mudo quando o campo não estava pronto, e o resultado
   * no console era ausência — nenhum erro, nenhuma chamada a `card_tokens`,
   * nada para investigar. Cada etapa se anuncia com o estado que a governa, de
   * modo que o console diga em qual delas o fluxo parou.
   */
  function cvvTrace(step, detail = {}) {
    console.log(`[PedeAqui][CartaoSalvo] ${step}`, {
      temContexto: Boolean(savedCardCvvContext),
      camposMontados: fieldsMounted,
      campoPronto: savedCvvState.ready,
      campoFalhou: savedCvvState.failed,
      digitou: savedCvvState.changed,
      valido: savedCvvState.valid,
      ...detail
    });
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

  function savedCvvErrorFor() {
    if (!savedCvvState.changed) return 'Campo obrigatório';
    if (savedCvvState.valid === false) return 'CVV inválido para a bandeira do cartão';
    return '';
  }

  function renderSavedCvvError() {
    if (savedCvvState.failed) return;
    savedCardCvvError(savedCvvState.showErrors ? savedCvvErrorFor() : '');
  }

  const savedCvvCallbacks = {
    onReady() {
      savedCvvState.ready = true;
      savedCvvState.failed = false;
      $('mpSavedCardSecurityCode')?.classList.remove('is-loading', 'has-load-error');
      $('mpSavedCardSecurityCode')?.setAttribute('aria-busy', 'false');
    },
    // As mesmas duas regras da tela de cadastro, para as duas telas não
    // discordarem sobre quando reclamar: digitar apaga o aviso; sair do campo
    // acusa CVV errado; campo vazio fica para o Continuar.
    onChange() {
      savedCvvState.changed = true;
      savedCvvState.showErrors = false;
      renderSavedCvvError();
    },
    onBlur() {
      if (!savedCvvState.ready || !savedCvvState.changed) return;
      savedCvvState.showErrors = true;
      renderSavedCvvError();
    },
    onValidityChange(_field, event) {
      const errors = Array.isArray(event?.errorMessages) ? event.errorMessages : [];
      savedCvvState.changed = true;
      savedCvvState.valid = errors.length === 0;
      renderSavedCvvError();
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
    closeAppModal('savedCardCvvModal');
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
    // Mesmo negócio da tela de cadastro: abre já, carregando, e a chave e o
    // SDK vão em paralelo em vez de um esperar o outro.
    $('mpSavedCardSecurityCode')?.classList.remove('has-load-error');
    $('mpSavedCardSecurityCode')?.classList.add('is-loading');
    $('mpSavedCardSecurityCode')?.setAttribute('aria-busy', 'true');
    window.PedeAquiRestaurantUi?.openModal('savedCardCvvModal');
    try {
      cvvTrace('A/E abrindo tela de CVV: buscando chave pública e SDK');
      const [config] = await Promise.all([
        paymentConfig || ensurePaymentConfig(),
        window.PedeAquiMercadoPago.ensureSdk()
      ]);
      cvvTrace('B/E chave e SDK prontos', { temChavePublica: Boolean(config?.public_key) });
      // Fechar a tela zera o contexto: a partir daí esta abertura é passado.
      if (savedCardCvvContext?.promise !== promise) return promise;
      const { ready } = await window.PedeAquiMercadoPago.mountSavedCardSecurityCode(
        config.public_key,
        'mpSavedCardSecurityCode',
        savedCvvCallbacks
      );
      if (savedCardCvvContext?.promise !== promise) {
        window.PedeAquiMercadoPago.unmountCardFields();
        return promise;
      }
      fieldsMounted = true;
      cvvTrace('C/E iframe do CVV criado, esperando ficar pronto');
      await ready;
      if (savedCardCvvContext?.promise !== promise) return promise;
      savedCvvCallbacks.onReady();
      cvvTrace('D/E campo de CVV pronto, Continuar liberado');
      if (save instanceof HTMLButtonElement) save.disabled = false;
    } catch (error) {
      cvvTrace('E/E PAROU: falha ao abrir o campo de CVV', { erro: error?.message || String(error) });
      if (savedCardCvvContext?.promise !== promise) return promise;
      savedCardCvvError(error?.message || 'Não foi possível abrir o campo de CVV.');
      const context = savedCardCvvContext;
      savedCardCvvContext = null;
      window.PedeAquiMercadoPago?.unmountCardFields();
      fieldsMounted = false;
      closeAppModal('savedCardCvvModal');
      if (context) context.reject(error);
    }
    return promise;
  }

  async function confirmSavedCardCvv(event) {
    event?.preventDefault?.();
    cvvTrace('1/5 Continuar pressionado');
    const context = savedCardCvvContext;
    if (!context || !fieldsMounted || !savedCvvState.ready) {
      // Era aqui que o fluxo morria calado. O botão só chega habilitado depois
      // do campo ficar pronto, então cair neste ramo significa que o campo
      // seguro não montou (ou foi desmontado por baixo da tela) — e o cliente
      // precisa ver isso, não um botão que não faz nada.
      cvvTrace('1/5 PAROU: campo seguro indisponível');
      savedCardCvvError(savedCvvState.failed
        ? 'Não foi possível carregar este campo seguro'
        : 'O campo de CVV ainda não está pronto. Feche e tente de novo.');
      return;
    }
    savedCvvState.showErrors = true;
    renderSavedCvvError();
    const validation = savedCvvErrorFor();
    if (validation) {
      cvvTrace('2/5 PAROU: CVV não passou na validação local', { motivo: validation });
      // `renderSavedCvvError` se cala quando o campo falhou ao carregar; sem
      // isto, a recusa por validação também sairia muda nesse estado.
      if (savedCvvState.failed) savedCardCvvError(validation);
      return;
    }
    cvvTrace('2/5 CVV validado localmente');
    const save = $('confirmSavedCardCvvButton');
    if (save instanceof HTMLButtonElement) save.disabled = true;
    try {
      // `provider_card_id`, NUNCA `id`. São dois ids diferentes: `id` é o UUID
      // desta plataforma (o que volta em `card.saved_card_id`) e `card_id` é o
      // id do cartão dentro da conta do Mercado Pago do lojista. Mandar o UUID
      // aqui é o que fazia a tokenização responder
      // 400 {"message":"invalid card_id","cause":[{"code":"E201"}]} — e a tela
      // dizer "Não foi possível confirmar o cartão" sem nunca dizer por quê.
      const providerCardId = String(context.card.provider_card_id || '').trim();
      cvvTrace('3/5 card_id do gateway lido', { temProviderCardId: Boolean(providerCardId) });
      if (!providerCardId) {
        // Cadastrar de novo não resolveria: o campo vem do backend, não do
        // cartão. Então a orientação é a única que funciona agora.
        throw new Error('Não foi possível confirmar este cartão. Escolha outra forma de pagamento.');
      }
      cvvTrace('4/5 chamando createCardToken no Mercado Pago');
      const token = await window.PedeAquiMercadoPago.createCardToken({ cardId: providerCardId });
      cvvTrace('5/5 token recebido', { temToken: Boolean(token?.id) });
      if (!token?.id) throw new Error('O Mercado Pago não devolveu o token do cartão.');
      savedCardCvvContext = null;
      window.PedeAquiMercadoPago.unmountCardFields();
      fieldsMounted = false;
      window.PedeAquiRestaurantUi?.closeModalImmediately('savedCardCvvModal');
      context.resolve(token.id);
    } catch (error) {
      cvvTrace('PAROU: erro na confirmação', { erro: error?.message || String(error) });
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
    handleCardholderInput,
    handleCardholderBlur,
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
