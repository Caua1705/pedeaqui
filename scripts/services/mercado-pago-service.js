(function () {
  const SDK_URL = 'https://sdk.mercadopago.com/js/v2';
  // Os hosts SEM os quais os campos não existem: o SDK faz `fetch` na página
  // dos campos (`secure-fields`, com `api-static` de reserva) antes de apontar
  // o iframe para ela, e tokeniza pela `api`. Um bloqueio de CSP em qualquer um
  // deles é fatal; em `events` ou nos hosts do Mercado Livre, não — por isso a
  // lista é nominal, e não um `*.mercadopago.com`.
  const REQUIRED_FIELD_ORIGINS = [
    'https://secure-fields.mercadopago.com',
    'https://api-static.mercadopago.com',
    'https://api.mercadopago.com'
  ];
  const SDK_LOAD_TIMEOUT_MS = 15_000;
  const FIELDS_READY_TIMEOUT_MS = 15_000;
  let sdkPromise = null;
  /** @type {MercadoPagoInstance | null} */
  let instance = null;
  let instanceKey = '';
  /** @type {MercadoPagoField[]} */
  let mountedFields = [];

  /**
   * Carrega o SDK UMA vez e devolve sempre a mesma promessa.
   *
   * A tag morta é REMOVIDA de propósito. Um <script> que já falhou nunca mais
   * dispara `load`, então reaproveitá-lo deixava a promessa pendente para
   * sempre: depois de uma única falha de rede, toda tentativa seguinte de abrir
   * o cartão morria no relógio dos campos e o erro virava permanente até
   * recarregar a página. Com a tag nova, tentar de novo realmente tenta.
   */
  function loadSdk() {
    if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      document.querySelectorAll('script[data-mercado-pago-sdk]').forEach(node => node.remove());
      const script = document.createElement('script');
      let timeoutId = 0;
      const settle = (settleWith, value) => {
        window.clearTimeout(timeoutId);
        settleWith(value);
      };
      script.addEventListener('load', () => (window.MercadoPago
        ? settle(resolve, window.MercadoPago)
        : settle(reject, new Error('O SDK do Mercado Pago não ficou disponível.'))), { once: true });
      script.addEventListener(
        'error',
        () => settle(reject, new Error('Não foi possível carregar a segurança do cartão.')),
        { once: true }
      );
      // Rede que aceita a conexão e não responde não dispara nem `load` nem
      // `error`. Sem este relógio a tela ficaria carregando para sempre.
      timeoutId = window.setTimeout(
        () => settle(reject, new Error('Não foi possível carregar a segurança do cartão.')),
        SDK_LOAD_TIMEOUT_MS
      );
      script.src = SDK_URL;
      script.async = true;
      script.dataset.mercadoPagoSdk = 'true';
      document.head.appendChild(script);
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });
    return sdkPromise;
  }

  /**
   * Aquece o SDK sem prender ninguém ao resultado.
   *
   * Chamado assim que a tela de pagamento abre — dois toques antes de "Crédito"
   * —, de modo que o download já esteja feito quando o cliente pedir a tela do
   * cartão. A falha aqui é silenciosa de propósito: ninguém está esperando por
   * ela, e quem reporta erro é o ensureSdk() de quem realmente abriu a tela.
   */
  function preloadSdk() {
    return loadSdk().then(() => true, () => false);
  }

  /**
   * O mesmo carregamento, mas PROPAGANDO a falha: é o que a tela do cartão usa
   * para poder pedir a chave pública em paralelo e ainda assim saber que o SDK
   * não veio. Esperar o preloadSdk() aqui custaria duas tentativas seguidas — a
   * dele e a do mount — e portanto o dobro do tempo até o cliente ver o erro.
   */
  function ensureSdk() {
    return loadSdk().then(() => undefined);
  }

  /**
   * O SDK carregado e a instância do vendedor, reaproveitada entre as telas.
   *
   * `advancedFraudPrevention` fica DESLIGADO por causa da CSP. Ligado, o SDK
   * pede `POST /v1/devices/widgets` e injeta a resposta como script INLINE no
   * <head>. Esse corpo carrega o `session_id` daquela chamada — ele muda a cada
   * carregamento da página —, então não existe hash estável para liberar, e o
   * SDK não expõe nenhum ponto para um nonce (a string "nonce" não aparece no
   * bundle). Só `'unsafe-inline'` ou `'strict-dynamic'` o deixariam rodar, e
   * qualquer um dos dois abriria o script-src do site inteiro; o script ainda
   * fala com hosts do Mercado Livre que a política também não tem.
   *
   * O efeito prático de desligar é nenhum hoje: sob a CSP atual o inline já não
   * executava — só sujava o console. O que se perde é o sinal de device
   * fingerprint na análise antifraude do Mercado Pago; a tokenização e a compra
   * seguem funcionando sem ele.
   *
   * `trackingDisabled` é a mesma conta com a analítica: ligada, o SDK bate em
   * `api.mercadolibre.com/tracks` cinco vezes por tela do cartão. Nada disso é
   * do caminho do pagamento — com o host bloqueado os campos montam, aceitam
   * digitação e tokenizam igual —, então a escolha é desligar o beacon em vez
   * de abrir na CSP um domínio que a compra não usa.
   *
   * @param {string} publicKey
   */
  async function ensureInstance(publicKey) {
    const MercadoPago = await loadSdk();
    if (instance && instanceKey === publicKey) return instance;
    instance = new MercadoPago(publicKey, {
      locale: 'pt-BR',
      advancedFraudPrevention: false,
      trackingDisabled: true
    });
    instanceKey = publicKey;
    return instance;
  }

  function unmountCardFields() {
    mountedFields.forEach(field => {
      try { field.unmount?.(); } catch { /* o iframe já pode ter saído do DOM */ }
    });
    mountedFields = [];
  }

  /**
   * Avisa quando a CSP do site bloqueia um host de que os campos dependem.
   *
   * É a única falha que o SDK não tem como reportar. Quando o `fetch` da página
   * dos campos é barrado, o cliente REST dele rejeita SEM VALOR NENHUM, e o
   * próprio `catch` do SDK estoura em `undefined.message` antes de emitir o
   * evento de erro — do lado de cá não chega nem `error`, nem `ready`. Sem este
   * vigia a tela ficaria os 15 s inteiros do relógio para no fim dizer só que
   * "não foi possível iniciar", escondendo que a causa é a política do site.
   */
  function watchBlockedByCsp() {
    /** @type {(reason: Error) => void} */
    let fail = () => {};
    const blocked = new Promise((_, reject) => { fail = reject; });
    const onViolation = event => {
      const uri = String(event.blockedURI || '');
      if (!REQUIRED_FIELD_ORIGINS.some(origin => uri.startsWith(origin))) return;
      fail(new Error('A segurança do site bloqueou os campos do cartão.'));
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return { blocked, stop: () => document.removeEventListener('securitypolicyviolation', onViolation) };
  }

  /**
   * The SDK inserts an iframe before its remote document is ready. A click in
   * that interval focuses the empty iframe and every typed character is lost.
   * Resolve on the SDK event when available, or on the iframe's real load as a
   * fallback for WebViews where `ready` is not emitted.
   *
   * @param {{type: string, container: string}[]} definitions
   */
  function createFieldReadiness(definitions) {
    const resolvers = new Map();
    const resolved = new Set();
    const promises = definitions.map(({ type }) => new Promise(resolve => resolvers.set(type, resolve)));
    const markReady = type => {
      if (resolved.has(type)) return;
      resolved.add(type);
      resolvers.get(type)?.();
    };
    const observers = definitions.map(({ type, container }) => {
      const host = document.getElementById(container);
      if (!host) throw new Error(`Contêiner do campo seguro não encontrado: ${container}`);
      let trackedIframe = null;
      const bindIframe = () => {
        const iframe = host.querySelector('iframe');
        if (!(iframe instanceof HTMLIFrameElement) || iframe === trackedIframe) return;
        trackedIframe = iframe;
        iframe.addEventListener('load', () => {
          requestAnimationFrame(() => requestAnimationFrame(() => markReady(type)));
        });
      };
      const observer = new MutationObserver(bindIframe);
      observer.observe(host, { childList: true, subtree: true });
      bindIframe();
      return observer;
    });
    const csp = watchBlockedByCsp();
    const disconnect = () => {
      csp.stop();
      observers.forEach(observer => observer.disconnect());
    };
    const wait = async () => {
      let timeoutId;
      try {
        await Promise.race([
          Promise.all(promises),
          csp.blocked,
          new Promise((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error('Não foi possível iniciar os campos seguros do cartão.')),
              FIELDS_READY_TIMEOUT_MS
            );
          })
        ]);
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
        disconnect();
      }
    };
    return { markReady, wait, abort: disconnect };
  }

  /**
   * @param {MercadoPagoField} field
   * @param {string} type
   * @param {MercadoPagoFieldCallbacks} [callbacks]
   * @param {(type: string) => void} [markReady]
   */
  function bindFieldEvents(field, type, callbacks = {}, markReady = () => {}) {
    if (typeof field.on !== 'function') return field;
    field.on('ready', event => {
      markReady(type);
      callbacks.onReady?.(type, event);
    });
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
   * Montar o iframe e esperar o `ready` dele são duas coisas separadas — e
   * agora são também dois MOMENTOS separados para quem chama. Esta função
   * resolve assim que os iframes existem no DOM; a prontidão vem depois, na
   * promessa `ready` devolvida. É isso que deixa a tela do cartão aparecer na
   * hora, carregando, em vez de ficar um toque sem resposta até o último
   * iframe responder.
   *
   * Um iframe lento continua montado (e carregando): ele nunca é removido só
   * porque um relógio de parede estourou.
   *
   * @param {string} publicKey
   * @param {{cardNumber: string, expirationDate: string, securityCode: string}} containers
   * @param {MercadoPagoFieldCallbacks} [callbacks]
   */
  async function mountCardFields(publicKey, containers, callbacks = {}) {
    await ensureInstance(publicKey);
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
    const readiness = createFieldReadiness(definitions);
    try {
      const fields = Object.fromEntries(definitions.map(({ type, options }) => [
        type,
        bindFieldEvents(instance.fields.create(type, options), type, callbacks, readiness.markReady)
      ]));
      fields.cardNumber.on?.('binChange', event => {
        updateCardFieldSettings(event?.bin, fields.cardNumber, fields.securityCode).catch(() => {
          // The fields remain usable; tokenization still performs final validation.
        });
      });
      mountedFields = definitions.map(({ type, container }) => fields[type].mount(container));
    } catch (error) {
      readiness.abort();
      unmountCardFields();
      throw error;
    }
    return { ready: readiness.wait() };
  }

  /** Mount only the security code when charging a card already saved by the customer. */
  async function mountSavedCardSecurityCode(publicKey, container, callbacks = {}) {
    await ensureInstance(publicKey);
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
    const readiness = createFieldReadiness([{ type: 'securityCode', container }]);
    const field = bindFieldEvents(instance.fields.create('securityCode', {
      placeholder: 'CVV',
      srLabel: 'CVV do cartão salvo',
      ariaRequired: true,
      style
    }), 'securityCode', callbacks, readiness.markReady);
    try {
      mountedFields = [field.mount(container)];
    } catch (error) {
      readiness.abort();
      unmountCardFields();
      throw error;
    }
    return { ready: readiness.wait() };
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
    preloadSdk,
    ensureSdk,
    mountCardFields,
    mountSavedCardSecurityCode,
    createCardToken,
    unmountCardFields
  };
})();
