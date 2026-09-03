// ============================================================================
//  O ENTREGADOR — a porta única para as cinco rotas de /courier.
//
//  DUAS CREDENCIAIS, NÃO UMA. O `link_token` vem no caminho da URL
//  (/entregador/<token>) e o código de 6 dígitos vai no header
//  `X-Courier-Code`, em TODA requisição — é o que o contrato diz, na descrição
//  do próprio parâmetro. O link sozinho não abre nada: ele é mandado por
//  WhatsApp ou QR e pode ser reencaminhado, então o código é o que separa
//  "recebi o link" de "sou o entregador".
//
//  No OpenAPI o header está como `required: false`. Isso é a forma do
//  parâmetro, não permissão para omiti-lo: as cinco rotas respondem 401, e a
//  descrição diz "vai em toda requisicao". Este arquivo sempre o envia, e
//  trata 401 como "código errado", não como erro de rede.
//
//  NADA DE DINHEIRO É CALCULADO AQUI. `amount_to_collect` e `courier_fee` vêm
//  prontos do backend, como `total_after_coupon` na sacola do cliente. O
//  entregador cobra na porta; um centavo inventado aqui é dinheiro trocado na
//  mão de alguém.
// ============================================================================
(function () {
  const routes = () => window.API_ROUTES;
  const client = () => window.PedeAquiApiClient;

  let linkToken = '';
  let courierCode = '';

  /** O token vem da URL; o código, do que o entregador digitou. */
  function configure({ token, code } = {}) {
    if (token !== undefined) linkToken = String(token || '');
    if (code !== undefined) courierCode = String(code || '');
  }

  function currentToken() {
    return linkToken;
  }

  function hasCode() {
    return Boolean(courierCode);
  }

  function headers() {
    // Header sempre presente, mesmo vazio: assim o backend responde 401 (que a
    // tela sabe tratar) em vez de 422 por parâmetro ausente.
    return { 'X-Courier-Code': courierCode };
  }

  function request(path, options = {}) {
    return client().request(path, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) }
    });
  }

  /**
   * 401 = código errado. 404 = link inválido ou revogado.
   *
   * A distinção importa na tela: no primeiro caso pede o código de novo, no
   * segundo não adianta digitar nada — o link morreu e só o painel resolve.
   */
  function classifyError(error) {
    if (error?.status === 401) return 'codigo-invalido';
    if (error?.status === 404) return 'link-invalido';
    if (error?.isTimeout || error?.isNetworkError) return 'sem-rede';
    return 'desconhecido';
  }

  function getMe() {
    return request(routes().courierMe(linkToken), { method: 'GET' });
  }

  /** Lista de CourierOrderResponse. */
  async function getOrders() {
    const data = await request(routes().courierOrders(linkToken), { method: 'GET' });
    // O contrato declara `array` cru, sem envelope. Um `null` ou um objeto aqui
    // viraria `.map is not a function` na tela; a lista vazia é a resposta certa
    // para "nenhum pedido agora" e não pode virar erro.
    return Array.isArray(data) ? data : [];
  }

  /**
   * SAIR PARA ENTREGA — é LOTE, e 200 NÃO É SUCESSO.
   *
   * A resposta é `CourierStatusBatchResponse`: um `items[]` com `ok` POR
   * PEDIDO e um `error` (`not_found` | `wrong_status`) quando ok=false. Um
   * pedido pode falhar sozinho dentro de uma resposta 200 — ler só o status
   * HTTP faria a tela dizer que saiu tudo enquanto um pedido ficou para trás.
   * É o mesmo defeito do cupom que respondia 200 com `valid: false`.
   *
   * Devolve os itens separados, já lidos pelo veredito de cada um.
   */
  async function leaveForDelivery(orderIds) {
    const ids = (orderIds || []).map(String).filter(Boolean);
    if (!ids.length) return { aceitos: [], recusados: [] };
    const data = await request(routes().courierOrdersOutForDelivery(linkToken), {
      method: 'POST',
      body: JSON.stringify({ order_ids: ids })
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    return {
      aceitos: items.filter(item => item?.ok === true),
      // `ok` ausente conta como recusa: o contrato o declara `required`, e
      // tratar "não sei" como sucesso é o erro que o classificador do cartão
      // já ensinou a não cometer.
      recusados: items.filter(item => item?.ok !== true)
    };
  }

  /**
   * ENTREGUE — um pedido por vez, e o 409 tem significado próprio.
   *
   * 409 = o pedido não está no estado que permite entregar (já entregue, ou
   * nunca saiu). Não é falha de rede nem código errado: é a lista da tela
   * estando velha, e a resposta certa é recarregar.
   */
  function markDelivered(orderId) {
    return request(routes().courierOrderDelivered(linkToken, orderId), { method: 'POST' });
  }

  function getHistory({ startDate, endDate } = {}) {
    return request(routes().courierHistory(linkToken, { startDate, endDate }), { method: 'GET' });
  }

  window.RapidexCourierService = {
    configure,
    currentToken,
    hasCode,
    classifyError,
    getMe,
    getOrders,
    leaveForDelivery,
    markDelivered,
    getHistory
  };
})();
