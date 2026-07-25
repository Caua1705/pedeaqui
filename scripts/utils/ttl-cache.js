// Cache em memória com PRAZO e TETO — a base dos caches de serviço.
//
// Os dois caches do app eram `new Map()` cru, e cada um tinha uma metade do
// problema:
//
//   delivery-service     tinha TTL (7 min), NÃO tinha teto. Cada endereço e
//                        cada tipo de entrega vira uma chave; entradas vencidas
//                        continuavam ocupando a Map porque nada as remove — o
//                        TTL só era conferido na leitura da própria chave.
//   restaurant-info      NÃO tinha nem TTL nem teto. Uma vez buscado, o payload
//                        valia a sessão inteira. E ele carrega horário de
//                        funcionamento, FORMAS DE PAGAMENTO e o dia da semana
//                        calculado no servidor: o lojista desliga o Pix e o
//                        cliente continua vendo Pix até fechar a aba; passa da
//                        meia-noite e a tabela de horários segue marcando o dia
//                        anterior como "hoje".
//
// Prazo e teto andam juntos de propósito. Só TTL não limita o tamanho (chave
// vencida que ninguém relê fica para sempre); só teto não impede servir dado
// velho. Aqui a leitura confere o prazo e a escrita varre o que venceu antes de
// aplicar o teto — então o despejo por tamanho só descarta entrada VÁLIDA
// quando realmente não há mais lixo para tirar.
//
// A ordem de inserção da Map é a ordem de uso: um acerto de leitura reinsere a
// chave no fim, então a primeira da fila é sempre a menos usada recentemente.
(function () {
  function createTtlCache({ ttlMs, maxEntries, now = () => Date.now() } = {}) {
    if (!(ttlMs > 0)) throw new Error('createTtlCache: ttlMs precisa ser positivo.');
    if (!(maxEntries > 0)) throw new Error('createTtlCache: maxEntries precisa ser positivo.');

    const entries = new Map();

    const expired = (entry, at) => at - entry.storedAt >= ttlMs;

    function prune(at = now()) {
      for (const [key, entry] of entries) {
        if (expired(entry, at)) entries.delete(key);
      }
    }

    /** A entrada com o carimbo de quando entrou, ou null se ausente/vencida. */
    function getEntry(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      const at = now();
      if (expired(entry, at)) {
        entries.delete(key);
        return null;
      }
      // Releitura = uso recente: vai para o fim da fila de despejo.
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    }

    function get(key) {
      return getEntry(key)?.value;
    }

    function set(key, value) {
      const at = now();
      // Reinsercao: apaga antes para o item ir para o FIM, e não continuar na
      // posição antiga da fila com um carimbo novo.
      entries.delete(key);
      prune(at);
      entries.set(key, { value, storedAt: at });
      // Vence o teto descartando o mais antigo em uso. Só chega aqui se o
      // prune não achou nada vencido, ou seja: só dado vivo é sacrificado.
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      return value;
    }

    return {
      get,
      getEntry,
      set,
      has: (key) => getEntry(key) !== null,
      delete: (key) => entries.delete(key),
      clear: () => entries.clear(),
      prune,
      ttlMs,
      maxEntries,
      // `size` conta o que está GUARDADO, incluindo o que já venceu e ainda não
      // foi varrido. Os testes usam para provar que o teto vale de verdade.
      get size() {
        return entries.size;
      },
      keys: () => Array.from(entries.keys())
    };
  }

  window.RapidexTtlCache = { createTtlCache };
})();
