// ============================================================================
//  O rótulo da bandeira de um cartão. UMA implementação.
//
//  Havia duas, e eram cópias exatas — mesma tabela, mesmo fallback, nomes
//  diferentes: `brandLabel()` em `pages/payment-card-flow.js` (a lista de
//  cartões salvos, dentro da tela do cartão) e `savedCardBrandLabel()` em
//  `pages/restaurant-page.js` (o rótulo que vai para a linha de pagamento da
//  sacola quando o cliente escolhe um cartão salvo).
//
//  Cópia exata é o estado ANTES do problema, não a ausência dele. As duas
//  telas mostram a bandeira do MESMO cartão, uma depois da outra: quem toca
//  "Crédito" vê a lista, escolhe, e o rótulo escolhido aparece na sacola. No
//  dia em que a API passar a mandar `hipercard` e alguém acrescentar a linha
//  numa das tabelas, a lista dirá "Hipercard" e a sacola dirá "Hipercard"
//  errado — ou o contrário — e as duas telas estarão a um toque de distância
//  uma da outra. Foi assim que o rótulo do cupom divergiu (ver
//  `services/coupon-format.js`), e lá as duas telas eram mais distantes.
//
//  A tabela e o fallback são os que as duas versões já tinham, sem escolha a
//  fazer: bandeira desconhecida vira o próprio nome com a inicial maiúscula, e
//  bandeira ausente vira "Cartão". Não há divergência para resolver aqui — é o
//  caso fácil, e o momento certo de resolvê-lo é agora, enquanto ele é fácil.
// ============================================================================
(function () {
  const ROTULOS = {
    amex: 'American Express',
    american_express: 'American Express',
    elo: 'Elo',
    hiper: 'Hiper',
    master: 'Mastercard',
    mastercard: 'Mastercard',
    visa: 'Visa'
  };

  /**
   * @param {string | null | undefined} value bandeira crua, como vem em
   *   `SavedCardResponse.brand`
   * @returns {string} rótulo para a tela
   */
  function cardBrandLabel(value) {
    const brand = String(value || '').toLowerCase();
    return ROTULOS[brand] || (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Cartão');
  }

  window.PedeAquiCardFormat = { cardBrandLabel };
})();
