// ============================================================================
//  tracking_token — a ÚNICA chave de um visitante para o próprio pedido.
//
//  A API removeu a consulta pública por telefone. O que sobrou:
//
//    visitante  -> GET /restaurants/<slug>/orders/track/<tracking_token>
//    logado     -> GET /customers/me/orders/<order_id>   (autoriza pelo Bearer)
//
//  Ou seja: perder o token é perder o acesso ao pedido para quem não tem conta.
//  Por isso ele é gravado ANTES de qualquer renderização de confirmação, no
//  mesmo instante em que a resposta de POST /orders chega.
//
//  Guardado por restaurante (rapidex.orderTracking.<slug>) porque o token só
//  vale na rota daquele slug. A lista é curta e tem prazo: um token de semanas
//  atrás não serve para nada e não há motivo para carregar o rastro de compra
//  do cliente por mais tempo do que o pedido leva para acabar.
//
//  Escrever aqui NUNCA pode derrubar a confirmação: o pedido já existe no
//  servidor: toda falha de storage (cota, modo privativo) é engolida.
// ============================================================================
(function () {
  const store = () => window.RapidexStorage;
  const PREFIX = () => store()?.PREFIXES?.orderTracking || 'rapidex.orderTracking.';

  // Um pedido some do dispositivo depois de 7 dias. Tempo de sobra para o ciclo
  // inteiro (pagar, preparar, entregar) e curto o bastante para o token não
  // virar um resíduo permanente.
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // Teto de pedidos por loja. Sem ele, um cliente frequente acumula tokens até
  // estourar a cota do localStorage e derrubar o carrinho junto.
  const MAX_ENTRIES = 10;

  const keyFor = slug => PREFIX() + String(slug || '');

  const text = value => {
    const raw = String(value ?? '').trim();
    return raw || null;
  };

  function readRaw(slug) {
    try {
      const parsed = JSON.parse(localStorage.getItem(keyFor(slug)) || 'null');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeRaw(slug, entries) {
    try {
      if (!entries.length) localStorage.removeItem(keyFor(slug));
      else localStorage.setItem(keyFor(slug), JSON.stringify(entries));
      return true;
    } catch {
      return false; // cota estourada / modo privativo: o fluxo em memória segue
    }
  }

  /** Entradas vivas do slug, mais recente primeiro. Poda as vencidas na leitura. */
  function list(slug) {
    const now = Date.now();
    const fresh = readRaw(slug).filter(entry => {
      if (!entry?.tracking_token) return false;
      const savedAt = Number(entry.saved_at);
      return Number.isFinite(savedAt) && now - savedAt <= TTL_MS;
    });
    return fresh.sort((a, b) => Number(b.saved_at) - Number(a.saved_at)).slice(0, MAX_ENTRIES);
  }

  /**
   * Grava o que a resposta de criação trouxe. Devolve a entrada gravada, ou
   * null quando a resposta veio sem tracking_token — que é o caso em que o
   * visitante ficaria sem nenhuma forma de alcançar o pedido, e por isso o
   * chamador precisa conseguir distinguir.
   */
  function remember(slug, order) {
    const trackingToken = text(order?.tracking_token);
    if (!trackingToken) return null;

    const entry = {
      tracking_token: trackingToken,
      order_id: text(order?.id),
      order_number: order?.order_number ?? null,
      status: text(order?.status),
      payment_flow: text(order?.payment_flow),
      payment_status: text(order?.payment_status),
      payment_method: text(order?.payment_method),
      total: Number.isFinite(Number(order?.total)) ? Number(order.total) : null,
      saved_at: Date.now()
    };

    // Mesmo token duas vezes (retentativa idempotente) atualiza a entrada em vez
    // de duplicá-la.
    const others = list(slug).filter(item => item.tracking_token !== trackingToken);
    writeRaw(slug, [entry, ...others].slice(0, MAX_ENTRIES));
    return entry;
  }

  function find(slug, trackingToken) {
    const token = text(trackingToken);
    return token ? list(slug).find(entry => entry.tracking_token === token) || null : null;
  }

  /** Pedido mais recente feito neste dispositivo para o slug. */
  function latest(slug) {
    return list(slug)[0] || null;
  }

  /**
   * Atualiza os campos voláteis de uma entrada (o polling descobre que o
   * pagamento virou pago; o status do pedido anda). `saved_at` NÃO é renovado:
   * o prazo conta do pedido, não da última consulta.
   */
  function update(slug, trackingToken, patch = {}) {
    const token = text(trackingToken);
    if (!token) return null;
    const entries = list(slug);
    const index = entries.findIndex(entry => entry.tracking_token === token);
    if (index === -1) return null;

    const merged = {
      ...entries[index],
      ...('status' in patch ? { status: text(patch.status) } : {}),
      ...('payment_status' in patch ? { payment_status: text(patch.payment_status) } : {}),
      ...('payment_flow' in patch ? { payment_flow: text(patch.payment_flow) } : {}),
      ...('payment_method' in patch ? { payment_method: text(patch.payment_method) } : {})
    };
    entries[index] = merged;
    writeRaw(slug, entries);
    return merged;
  }

  function forget(slug, trackingToken) {
    const token = text(trackingToken);
    if (!token) return;
    writeRaw(slug, list(slug).filter(entry => entry.tracking_token !== token));
  }

  function clear(slug) {
    writeRaw(slug, []);
  }

  window.RapidexOrderTracking = { list, remember, find, latest, update, forget, clear, TTL_MS, MAX_ENTRIES };
})();
