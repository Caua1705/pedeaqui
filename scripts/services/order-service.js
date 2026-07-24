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

  async function getOrder(restaurantSlug, orderNumber, phone) {
    return window.PedeAquiApiClient.get(window.PedeAquiApiRoutes.getOrder(restaurantSlug, orderNumber, phone || ''));
  }

  async function getCustomerOrders() {
    const result = await window.PedeAquiCustomerAuth?.getCustomerOrders?.();
    return Array.isArray(result) ? result : (result?.orders || result?.items || result?.data || []);
  }

  window.PedeAquiOrderService = { createOrder, getOrder, getCustomerOrders };
})();
