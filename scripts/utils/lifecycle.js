// Ciclo de vida da página — um lugar só para desligar o que fica ligado.
//
// O app registra observers, intervalos e listeners em `document` e `window` no
// boot e nunca desliga nada. Enquanto a aba existe isso é invisível; o custo
// aparece nas bordas:
//
//   - aba em segundo plano: o autoplay do hero continua escrevendo no DOM e
//     forçando recálculo de estilo numa página que ninguém está vendo;
//   - saída da página: intervalos e observers seguem vivos até o documento ser
//     descartado, segurando por closure o DOM que deveria ter ido embora.
//
// Duas ferramentas, de propósito separadas:
//
//   signal      — um AbortSignal para passar a addEventListener. Um único
//                 abort() remove TODOS os listeners registrados com ele, sem
//                 precisar guardar referência de cada função.
//   onTeardown  — para o que não é listener (clearInterval, disconnect).
//
// BFCACHE. O teardown só roda em `pagehide` com `persisted === false`, isto é,
// quando a página está sendo mesmo descartada. Com `persisted === true` ela vai
// para o cache de retorno e pode ser restaurada intacta — desligar ali deixaria
// o usuário voltando para uma página morta, que é um bug pior do que o gasto
// que este arquivo evita.
(function () {
  const disposers = new Set();
  const controller = new AbortController();
  let done = false;

  /** Registra algo a desligar. Devolve uma função que cancela o registro. */
  function onTeardown(dispose) {
    if (typeof dispose !== 'function') return () => {};
    if (done) {
      dispose();
      return () => {};
    }
    disposers.add(dispose);
    return () => disposers.delete(dispose);
  }

  function teardown() {
    if (done) return;
    done = true;
    // O abort primeiro: sem ele, um listener poderia disparar no meio do
    // desligamento e reagendar justamente o que acabou de ser desligado.
    controller.abort();
    for (const dispose of disposers) {
      // Um disposer que estoura não pode impedir os outros de rodar.
      try {
        dispose();
      } catch (error) {
        console.warn('[Rapidex] Falha ao desligar um recurso da página.', error);
      }
    }
    disposers.clear();
  }

  /**
   * Chama `onHidden` quando a aba deixa de estar visível e `onVisible` quando
   * volta. Já nasce amarrado ao signal, então some junto no teardown.
   *
   * `visibilitychange` sozinho não basta: em mobile a aba costuma ir embora por
   * `pagehide` sem nunca passar por hidden, e aí o que estava rodando nunca
   * pararia.
   */
  function onVisibility({ onHidden, onVisible } = {}) {
    const react = () => {
      if (document.visibilityState === 'hidden') onHidden?.();
      else onVisible?.();
    };
    document.addEventListener('visibilitychange', react, { signal: controller.signal });
    window.addEventListener('pagehide', () => onHidden?.(), { signal: controller.signal });
    window.addEventListener('pageshow', react, { signal: controller.signal });
    return react;
  }

  window.RapidexLifecycle = {
    // Passe para addEventListener: { signal: RapidexLifecycle.signal }.
    signal: controller.signal,
    onTeardown,
    onVisibility,
    teardown,
    // Só para os testes conferirem que o registro não ficou vazio.
    get pending() {
      return disposers.size;
    }
  };

  if (typeof window.addEventListener !== 'function') return;

  window.addEventListener('pagehide', event => {
    if (!event.persisted) teardown();
  });
})();
