// ============================================================================
//  Dinheiro em texto. UM formatador.
//
//  Havia quatro, em quatro arquivos, todos escrevendo a mesma coisa:
//
//    restaurant-page.js      fmt()             45 chamadas
//    restaurant-club.js      fmtClubCurrency()  6
//    restaurant-assistant.js fmtPrice()         3
//    cashback-statement.js   money()            2
//
//  Os três primeiros eram equivalentes até no resultado — `Number(v)
//  .toLocaleString('pt-BR', opts)` e `new Intl.NumberFormat('pt-BR', opts)
//  .format(Number(v))` são o mesmo caminho na especificação. O quarto tinha
//  duas diferenças de verdade, e as duas sobreviveram aqui: aceita a moeda
//  como parâmetro (o extrato de cashback lê `currency` da API em vez de
//  presumir BRL) e não decide sinal — quem quiser o valor absoluto pede.
//
//  O NOME NÃO É NOVO. `restaurant-page.js` já abria com
//
//      const fmt = window.PedeAquiCurrency?.formatCurrency || (...fallback...)
//
//  e `window.PedeAquiCurrency` nunca existiu em lugar nenhum do repositório.
//  O `||` engolia a ausência, o fallback rodava em 100% das chamadas e ninguém
//  reparou — é o mesmo modo de falha dos campos de API que o app procurava e
//  que nunca existiram (ver a regra 2 do CLAUDE.md). O módulo que faltava é
//  este. Por isso os chamadores agora leem `window.PedeAquiCurrency
//  .formatCurrency(...)` SEM `?.` e SEM `||`: se este arquivo sair da ordem de
//  carga, a tela quebra na primeira renderização em vez de calar e divergir.
// ============================================================================
(function () {
  const cache = new Map();

  function formatter(currency) {
    const code = String(currency || 'BRL').toUpperCase();
    let instance = cache.get(code);
    if (!instance) {
      instance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code });
      cache.set(code, instance);
    }
    return instance;
  }

  /**
   * `formatCurrency(7.05)` -> "R$ 7,05".
   *
   * Valor não numérico vira 0, e não "R$ NaN": este formatador vive na ponta
   * da renderização, onde um campo ausente da API é uma possibilidade real e
   * "R$ NaN" na tela é pior que um zero.
   *
   * Isto NÃO faz conta. Quem soma dinheiro é cartTotals(), e só ele.
   */
  function formatCurrency(value, currency) {
    const number = Number(value);
    return formatter(currency).format(Number.isFinite(number) ? number : 0);
  }

  window.PedeAquiCurrency = { formatCurrency };
})();
