(function () {
  // createCart() foi REMOVIDA. Chamava window.PedeAquiCartState.createCartState,
  // e window.PedeAquiCartState nunca existiu em lugar nenhum do repositório: a
  // função retornava `null` em 100% das chamadas — se alguém a tivesse chamado.
  // Ninguém chamava. O optional chaining é o que a mantinha silenciosa: sem ele
  // seria um TypeError na primeira chamada e teria morrido no mesmo dia.

  // calculateTotals() foi REMOVIDA. Era uma segunda implementação do total, que
  // ninguém chamava e que tinha 5 testes verdes — o app sempre usou cartTotals()
  // em scripts/pages/restaurant-page.js. As duas já divergiam: esta não conhecia
  // cupom, não checava se a estimativa de entrega tinha dado certo, e lia a taxa
  // de serviço com `||` em vez de `??`, ignorando o defaultServiceFee.
  //
  // Uma conta de dinheiro em dois lugares é uma divergência esperando acontecer;
  // com testes só no lado morto, é uma divergência com álibi. O total do
  // carrinho tem UM dono: cartTotals().

  // uid identifica a LINHA do carrinho (para editar/remover), não o produto.
  // Date.now() colidia quando dois itens eram adicionados no mesmo milissegundo
  // — e aí remover um apagava o outro.
  function newCartItemUid() {
    return window.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeCartItem(product, qty = 1, obs = '', extras = {}) {
    return {
      ...product,
      qty: Number(qty || 1),
      obs: String(obs || ''),
      uid: newCartItemUid(),
      ...extras
    };
  }

  window.PedeAquiCartService = {
    normalizeCartItem,
    newCartItemUid
  };
})();
