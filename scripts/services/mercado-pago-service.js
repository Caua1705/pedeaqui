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
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const style = {
      color: dark ? '#f5f5f5' : '#3f3d3c',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: '15px',
      fontWeight: '400',
      placeholderColor: dark ? '#77736f' : '#aaa6a3'
    };
    mountedFields = [
      instance.fields.create('cardNumber', { placeholder: '0000 0000 0000 0000', style }).mount(containers.cardNumber),
      instance.fields.create('expirationDate', { placeholder: 'MM/AAAA', style }).mount(containers.expirationDate),
      instance.fields.create('securityCode', { placeholder: 'CVV', style }).mount(containers.securityCode)
    ];
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
