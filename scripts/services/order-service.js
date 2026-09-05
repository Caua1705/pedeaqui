(function () {
  // Attach the customer's Bearer token when one is available, so the backend
  // can link the order to the logged-in customer via the JWT (no customer_id
  // is ever sent from the frontend).
  function authOptions() {
    const headers = window.PedeAquiCustomerAuth?.authHeaders?.() || {};
    return Object.keys(headers).length ? { headers } : {};
  }

  /**
   * @param {string} restaurantSlug
   * @param {object} payload            ver docs/order-contract.md
   * @param {object} [options]
   * @param {string} [options.idempotencyKey] mesma chave em toda retentativa do
   *        MESMO pedido, para que um retry após timeout não crie duplicata.
   *        O header CONSTA no OpenAPI (parâmetro de `POST
   *        /restaurants/{slug}/orders`, `Vale por 24h`) e o backend o honra:
   *        mesma chave + mesmo corpo devolve a resposta gravada; mesma chave +
   *        corpo diferente é **422**. Quem trata esse 422 é
   *        `isRecycledIdempotencyKey()` em `restaurant-page.js` — leia o
   *        comentário de lá antes de mexer na chave.
   * @param {number} [options.timeout]  ms; criar pedido é mais lento que os
   *        demais endpoints, então usa um limite maior que o padrão de 8s.
   */
  async function createOrder(restaurantSlug, payload, options = {}) {
    const headers = { ...(authOptions().headers || {}) };
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.createOrder(restaurantSlug),
      {
        method: 'POST',
        body: JSON.stringify(payload),
        timeout: Number.isFinite(options.timeout) ? options.timeout : 20000,
        ...(Object.keys(headers).length ? { headers } : {})
      }
    );
  }

  /**
   * GET /restaurants/{slug}/orders/track/{tracking_token} → OrderDetailResponse.
   *
   * Rota PÚBLICA (sem security no OpenAPI): a autorização é o próprio token.
   * É o que substituiu a consulta por telefone, removida da API.
   */
  async function trackOrder(restaurantSlug, trackingToken, options = {}) {
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.trackOrder(restaurantSlug, trackingToken),
      {
        method: 'GET',
        ...(Number.isFinite(options.timeout) ? { timeout: options.timeout } : {}),
        ...(options.signal ? { signal: options.signal } : {})
      }
    );
  }

  /**
   * POST /restaurants/{slug}/orders/{tracking_token}/payment → StartPaymentResponse.
   *
   * Cria a cobrança no gateway. É deliberadamente separada da criação do pedido
   * (o backend não fala com o gateway dentro da transação do pedido). Pix segue
   * sem corpo; cartão recebe `{card: {token, saved_card_id}}`.
   *
   * ⚠️ O TOKEN DO CLIENTE VAI JUNTO, e não é opcional para cartão.
   *
   * O tracking token do path continua sendo a AUTORIZAÇÃO — é o que mantém o
   * Pix de visitante funcionando sem conta. Mas o backend exige, além disso,
   * um cliente AUTENTICADO para cobrar no cartão: o `payer.email` de um pedido
   * de visitante é sintético, e sintético entra na análise antifraude do
   * Mercado Pago e volta recusado. Sem este header, toda cobrança de cartão
   * responde 401 `login_required` — antes de o gateway ser chamado, com CVV
   * certo ou errado, sempre. Era essa a falha silenciosa do checkout de
   * cartão: o pedido nascia e a cobrança morria aqui.
   *
   * Chamar duas vezes é seguro pelo lado do front — o backend devolve a cobrança
   * corrente —, mas ainda assim só chamamos uma vez por pedido.
   */
  async function startOrderPayment(restaurantSlug, trackingToken, options = {}) {
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.startOrderPayment(restaurantSlug, trackingToken),
      {
        method: 'POST',
        ...(options.card ? { body: JSON.stringify({ card: options.card }) } : {}),
        // Criar cobrança passa por um gateway externo: mais lento que uma
        // leitura, mais rápido que criar o pedido.
        timeout: Number.isFinite(options.timeout) ? options.timeout : 15000,
        ...authOptions()
      }
    );
  }

  /**
   * O CLIENTE DESISTINDO DO PRÓPRIO PEDIDO, antes do preparo.
   *
   * Quem autoriza é o `tracking_token` do path, e **não** o Bearer: a rota não
   * declara `security`, e é assim de propósito — pedido de convidado é caso
   * normal, e exigir conta aqui deixaria o convidado sem saída. Por isso este
   * método NÃO manda `authOptions()`: mandar um header que a rota não pede é
   * vazar o token do cliente numa chamada que não precisa dele.
   *
   * O corpo é OPCIONAL e o `reason` dentro dele também. Quando não há motivo,
   * não se manda corpo nenhum — um `{reason: null}` seria a mesma coisa com
   * mais bytes, e `CustomerCancelOrderRequest` não exige campo algum.
   *
   * O 409 é o caso que a tela precisa distinguir: não é erro de rede nem token
   * inválido, é **o pedido já saiu da janela** (entrou em `preparing`, ou já
   * foi cancelado por um clique anterior). Quem chama precisa dizer "o
   * restaurante já começou a preparar" em vez de "tente de novo", e por isso o
   * erro sobe com o `status` intacto — `api-error.js` já o preserva.
   *
   * @param {string} restaurantSlug
   * @param {string} trackingToken
   * @param {{ reason?: string }} [options]
   * @returns {Promise<object>} OrderDetailResponse com o pedido já cancelado
   */
  async function cancelOrder(restaurantSlug, trackingToken, options = {}) {
    const reason = String(options.reason ?? '').trim();
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.cancelOrder(restaurantSlug, trackingToken),
      {
        method: 'POST',
        // `maxLength: 150` é do contrato. Cortar aqui é melhor que levar um 422
        // por causa de um texto colado.
        ...(reason ? { body: JSON.stringify({ reason: reason.slice(0, 150) }) } : {}),
        timeout: 15000
      }
    );
  }

  /**
   * O MESMO cancelamento, pela porta do cliente LOGADO.
   *
   * Publicada pelo backend em 02/09/2026, depois de esta limitação ter sido
   * escrita como pedido: o `tracking_token` só vive no `localStorage` do
   * aparelho que fez o pedido, então quem pedia pelo celular e abria o app no
   * computador via o pedido em `accepted` e não tinha como desistir.
   *
   * Aqui o vínculo sai de `orders.customer_id` e quem autoriza é o Bearer —
   * por isso, ao contrário de `cancelOrder`, esta manda `authOptions()`.
   *
   * As duas convivem de propósito: a do token é a única saída do convidado.
   */
  async function cancelCustomerOrder(orderId, options = {}) {
    const reason = String(options.reason ?? '').trim();
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.cancelCustomerOrder(orderId),
      {
        method: 'POST',
        ...(reason ? { body: JSON.stringify({ reason: reason.slice(0, 150) }) } : {}),
        timeout: 15000,
        ...authOptions()
      }
    );
  }

  async function getCustomerOrders() {
    const result = await window.PedeAquiCustomerAuth?.getCustomerOrders?.();
    return Array.isArray(result) ? result : (result?.orders || result?.items || result?.data || []);
  }

  /** GET /customers/me/orders/{order_id} — caminho do cliente autenticado. */
  async function getCustomerOrder(orderId) {
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.customerOrder(orderId),
      { method: 'GET', ...authOptions() }
    );
  }

  window.PedeAquiOrderService = {
    createOrder,
    trackOrder,
    startOrderPayment,
    cancelOrder,
    cancelCustomerOrder,
    getCustomerOrders,
    getCustomerOrder
  };
})();
