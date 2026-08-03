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
   *        ATENÇÃO: o header ainda não consta no OpenAPI da API — enquanto o
   *        backend não honrar, a proteção é só client-side.
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
   * Cria a cobrança no gateway. Também é autorizada pelo tracking token, e é
   * deliberadamente separada da criação do pedido (o backend não fala com o
   * gateway dentro da transação do pedido). Sem corpo: o método de pagamento já
   * foi gravado no pedido.
   *
   * Chamar duas vezes é seguro pelo lado do front — o backend devolve a cobrança
   * corrente —, mas ainda assim só chamamos uma vez por pedido.
   */
  async function startOrderPayment(restaurantSlug, trackingToken, options = {}) {
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.startOrderPayment(restaurantSlug, trackingToken),
      {
        method: 'POST',
        // Criar cobrança passa por um gateway externo: mais lento que uma
        // leitura, mais rápido que criar o pedido.
        timeout: Number.isFinite(options.timeout) ? options.timeout : 15000
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
    getCustomerOrders,
    getCustomerOrder
  };
})();
