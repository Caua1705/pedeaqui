(function () {
  /** @typedef {import('../types/api').components['schemas']['SavedCardResponse']} SavedCardResponse */

  function authOptions() {
    const headers = window.PedeAquiCustomerAuth?.authHeaders?.() || {};
    return Object.keys(headers).length ? { headers } : {};
  }

  /** @param {string} restaurantSlug @returns {Promise<SavedCardResponse[]>} */
  async function listCards(restaurantSlug) {
    const result = await window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.customerCards(restaurantSlug),
      { method: 'GET', ...authOptions() }
    );
    return Array.isArray(result) ? /** @type {SavedCardResponse[]} */ (result) : [];
  }

  /**
   * O único dado do cartão que cruza esta fronteira é o token de uso único.
   * PAN, validade e CVV vivem nos iframes do Mercado Pago e não são argumentos
   * deste serviço por desenho.
   * @param {string} restaurantSlug
   * @param {string} token
   * @returns {Promise<SavedCardResponse>}
   */
  async function saveCard(restaurantSlug, token) {
    const result = await window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.customerCards(restaurantSlug).split('?')[0],
      {
        method: 'POST',
        body: JSON.stringify({ restaurant_slug: restaurantSlug, token }),
        timeout: 20000,
        ...authOptions()
      }
    );
    return /** @type {SavedCardResponse} */ (result);
  }

  /** @param {string} cardId */
  function deleteCard(cardId) {
    return window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.customerCard(cardId),
      { method: 'DELETE', timeout: 20000, ...authOptions() }
    );
  }

  window.PedeAquiCustomerCardService = { listCards, saveCard, deleteCard };
})();
