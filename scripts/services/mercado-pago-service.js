(function () {
  const SDK_URL = 'https://sdk.mercadopago.com/js/v2';
  let sdkPromise = null;
  /** @type {MercadoPagoInstance | null} */
  let instance = null;
  let instanceKey = '';
  /** @type {MercadoPagoField[]} */
  let mountedFields = [];

  function loadSdk() {
    if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const found = document.querySelector('script[data-mercado-pago-sdk]');
      const existing = found instanceof HTMLScriptElement ? found : null;
      const script = existing || document.createElement('script');
      const onLoad = () => window.MercadoPago
        ? resolve(window.MercadoPago)
        : reject(new Error('O SDK do Mercado Pago não ficou disponível.'));
      const onError = () => reject(new Error('Não foi possível carregar a segurança do cartão.'));
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      if (!existing) {
        script.src = SDK_URL;
        script.async = true;
        script.dataset.mercadoPagoSdk = 'true';
        document.head.appendChild(script);
      }
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });
    return sdkPromise;
  }

  function unmountCardFields() {
    mountedFields.forEach(field => {
      try { field.unmount?.(); } catch { /* o iframe já pode ter saído do DOM */ }
    });
    mountedFields = [];
  }

  /**
   * @param {MercadoPagoField} field
   * @param {string} type
   * @param {MercadoPagoFieldCallbacks} [callbacks]
   */
  function bindFieldEvents(field, type, callbacks = {}) {
    if (typeof field.on !== 'function') return field;
    field.on('ready', event => callbacks.onReady?.(type, event));
    field.on('change', event => callbacks.onChange?.(type, event));
    field.on('blur', event => callbacks.onBlur?.(type, event));
    field.on('validityChange', event => callbacks.onValidityChange?.(type, event));
    field.on('error', event => callbacks.onError?.(type, event));
    return field;
  }

  /** Apply the card brand rules returned for the BIN without ever reading PAN/CVV. */
  async function updateCardFieldSettings(bin, cardNumberField, securityCodeField) {
    if (!bin || typeof instance?.getPaymentMethods !== 'function') return;
    const response = await instance.getPaymentMethods({ bin });
    const settings = response?.results?.[0]?.settings?.[0];
    if (!settings) return;
    if (settings.card_number) {
      cardNumberField.update?.({
        settings: { ...settings.card_number, validation: 'standard' }
      });
    }
    if (settings.security_code) securityCodeField.update?.({ settings: settings.security_code });
  }

  /**
   * Mounting an iframe and waiting for its `ready` event are deliberately two
   * separate things. A slow iframe must stay mounted (and keep loading); it must
   * never be removed merely because a wall-clock timeout elapsed.
   *
   * @param {string} publicKey
   * @param {{cardNumber: string, expirationDate: string, securityCode: string}} containers
   * @param {MercadoPagoFieldCallbacks} [callbacks]
   */
  async function mountCardFields(publicKey, containers, callbacks = {}) {
    const MercadoPago = await loadSdk();
    if (!instance || instanceKey !== publicKey) {
      instance = new MercadoPago(publicKey, { locale: 'pt-BR', advancedFraudPrevention: true });
      instanceKey = publicKey;
    }
    unmountCardFields();
    const style = {
      color: '#3f3d3c',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '15px',
      fontWeight: '400',
      height: '100%',
      padding: '0',
      width: '100%',
      placeholderColor: '#aaa6a3'
    };
    const definitions = [
      {
        type: /** @type {const} */ ('cardNumber'),
        container: containers.cardNumber,
        options: { placeholder: '0000 0000 0000 0000', srLabel: 'Número do cartão', ariaRequired: true, enableLuhnValidation: true, style }
      },
      {
        type: /** @type {const} */ ('expirationDate'),
        container: containers.expirationDate,
        options: { placeholder: 'MM/AA', mode: 'short', srLabel: 'Data de validade', ariaRequired: true, style }
      },
      {
        type: /** @type {const} */ ('securityCode'),
        container: containers.securityCode,
        options: { placeholder: 'CVV', srLabel: 'Código de segurança', ariaRequired: true, style }
      }
    ];
    try {
      const fields = Object.fromEntries(definitions.map(({ type, options }) => [
        type,
        bindFieldEvents(instance.fields.create(type, options), type, callbacks)
      ]));
      fields.cardNumber.on?.('binChange', event => {
        updateCardFieldSettings(event?.bin, fields.cardNumber, fields.securityCode).catch(() => {
          // The fields remain usable; tokenization still performs final validation.
        });
      });
      mountedFields = definitions.map(({ type, container }) => fields[type].mount(container));
    } catch (error) {
      unmountCardFields();
      throw error;
    }
  }

  /** Mount only the security code when charging a card already saved by the customer. */
  async function mountSavedCardSecurityCode(publicKey, container, callbacks = {}) {
    const MercadoPago = await loadSdk();
    if (!instance || instanceKey !== publicKey) {
      instance = new MercadoPago(publicKey, { locale: 'pt-BR', advancedFraudPrevention: true });
      instanceKey = publicKey;
    }
    unmountCardFields();
    const style = {
      color: '#3f3d3c',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '15px',
      fontWeight: '400',
      height: '100%',
      padding: '0',
      width: '100%',
      placeholderColor: '#aaa6a3'
    };
    const field = bindFieldEvents(instance.fields.create('securityCode', {
      placeholder: 'CVV',
      srLabel: 'CVV do cartão salvo',
      ariaRequired: true,
      style
    }), 'securityCode', callbacks);
    try {
      mountedFields = [field.mount(container)];
    } catch (error) {
      unmountCardFields();
      throw error;
    }
  }

  /**
   * @param {{cardId?: string, cardholderName?: string, identificationType?: string, identificationNumber?: string}} data
   */
  function createCardToken(data) {
    if (!instance) return Promise.reject(new Error('Os campos seguros ainda não foram carregados.'));
    return instance.fields.createCardToken(data);
  }

  window.PedeAquiMercadoPago = {
    SDK_URL,
    mountCardFields,
    mountSavedCardSecurityCode,
    createCardToken,
    unmountCardFields
  };
})();
