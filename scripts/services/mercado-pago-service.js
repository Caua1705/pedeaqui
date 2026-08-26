(function () {
  const SDK_URL = 'https://sdk.mercadopago.com/js/v2';
  let sdkPromise = null;
  /** @type {MercadoPagoInstance | null} */
  let instance = null;
  let instanceKey = '';
  /** @type {MercadoPagoField[]} */
  let mountedFields = [];

  const FIELD_READY_TIMEOUT_MS = 15_000;

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
   * @param {string} publicKey
   * @param {{cardNumber: string, expirationDate: string, securityCode: string}} containers
   */
  async function mountCardFields(publicKey, containers) {
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
        options: { placeholder: '0000 0000 0000 0000', srLabel: 'Número do cartão', ariaRequired: true, style }
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
    const ready = definitions.map(({ type, container, options }) => {
      const field = instance.fields.create(type, options);
      const initialized = new Promise(resolve => {
        if (typeof field.on !== 'function') {
          resolve(undefined);
          return;
        }
        field.on('ready', () => resolve(undefined));
      });
      mountedFields.push(field.mount(container));
      return initialized;
    });
    let timeoutId;
    try {
      await Promise.race([
        Promise.all(ready),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error('Os campos seguros demoraram para carregar. Tente novamente.'));
          }, FIELD_READY_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      unmountCardFields();
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  /**
   * @param {{cardholderName: string, identificationType: string, identificationNumber: string}} data
   */
  function createCardToken(data) {
    if (!instance) return Promise.reject(new Error('Os campos seguros ainda não foram carregados.'));
    return instance.fields.createCardToken(data);
  }

  window.PedeAquiMercadoPago = {
    SDK_URL,
    mountCardFields,
    createCardToken,
    unmountCardFields
  };
})();
