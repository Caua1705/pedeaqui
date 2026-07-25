// Despacho de eventos por delegação — substitui os handlers inline on*=.
//
// POR QUÊ: 269 atributos on*= no app obrigavam a CSP a liberar
// script-src 'unsafe-inline', e 'unsafe-inline' é justamente o que transforma
// um escape esquecido em execução de script. Como a conta do cliente é GLOBAL
// do Rapidex e todos os tenants dividem a mesma origem, um furo alcançaria a
// sessão de clientes de qualquer restaurante.
//
// COMO: o markup declara a intenção num data-attribute; um único listener por
// tipo de evento resolve o alvo mais próximo e chama a função pelo NOME, vinda
// de um registro. Nada é compilado a partir de string — sem eval, sem
// new Function — então script-src 'self' se sustenta.
//
// GRAMÁTICA de data-act-<evento>:
//   "fechaModal"                              -> fechaModal()
//   '["closeModalId","cartModal"]'            -> closeModalId('cartModal')
//   '[["maskRegPhone","$this"],["handleRegFieldInput","regPhone"]]'
//                                             -> as duas chamadas, na ordem
//
// Tokens de argumento: "$this" (o elemento) e "$event" (o evento).
// Pseudo-ações (não passam pelo registro):
//   $stop     -> event.stopPropagation()
//   $prevent  -> event.preventDefault()
//   $select   -> this.select()          (era onfocus="this.select()")
//   $hide     -> some o próprio elemento
//   $enter    -> só continua a sequência se a tecla for Enter ou Espaço
(function () {
  const registry = Object.create(null);

  // Eventos que borbulham: um listener no document resolve todos.
  const BUBBLING = ['click', 'input', 'change', 'submit', 'keydown', 'keyup', 'paste'];
  // Estes NÃO borbulham; só chegam ao document na fase de captura.
  const CAPTURING = ['focus', 'blur', 'error'];

  function register(actions) {
    for (const [name, fn] of Object.entries(actions || {})) {
      if (typeof fn === 'function') registry[name] = fn;
    }
    return registry;
  }

  // O registro é a fonte preferencial. window continua como fallback porque
  // partes do app (e os testes E2E) ainda chamam essas funções por window.
  function resolve(name) {
    const fn = registry[name] || window[name];
    return typeof fn === 'function' ? fn : null;
  }

  function parseSpec(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return [];
    // Forma curta: só o nome da função.
    if (!value.startsWith('[')) return [[value]];
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      console.warn('[Rapidex] data-act inválido (JSON):', value);
      return [];
    }
    if (!Array.isArray(parsed) || !parsed.length) return [];
    // ["fn","arg"] é uma chamada; [["fn"],["fn2"]] é uma sequência.
    return Array.isArray(parsed[0]) ? parsed : [parsed];
  }

  function bindArg(arg, element, event) {
    if (arg === '$this') return element;
    if (arg === '$event') return event;
    return arg;
  }

  // Devolve false para abortar o resto da sequência.
  function runPseudo(name, element, event) {
    switch (name) {
      case '$stop': event.stopPropagation(); return true;
      case '$prevent': event.preventDefault(); return true;
      case '$select': element.select?.(); return true;
      case '$hide': element.style.display = 'none'; return true;
      case '$enter':
        if (event.key !== 'Enter' && event.key !== ' ') return false;
        event.preventDefault();
        return true;
      default: return null; // não é pseudo-ação
    }
  }

  function runSpec(spec, element, event) {
    for (const step of spec) {
      const [name, ...args] = step;
      const pseudo = runPseudo(name, element, event);
      if (pseudo === false) return; // guard reprovou: aborta a sequência
      if (pseudo === true) continue;

      const fn = resolve(name);
      if (!fn) {
        console.warn('[Rapidex] ação não registrada:', name);
        continue;
      }
      try {
        fn.apply(element, args.map(arg => bindArg(arg, element, event)));
      } catch (error) {
        // Um handler que explode não pode derrubar os outros da sequência nem
        // o listener do document (que serve a tela inteira).
        console.error('[Rapidex] ação falhou:', name, error);
      }
    }
  }

  function handleEvent(type, event) {
    const attribute = `data-act-${type}`;
    // closest() a partir do alvo: é o que dá o comportamento de delegação —
    // o handler continua valendo para markup criado depois do boot.
    const start = event.target instanceof Element ? event.target : null;
    const element = start?.closest(`[${attribute}]`);
    if (!element) return;
    runSpec(parseSpec(element.getAttribute(attribute)), element, event);
  }

  function install(root = document) {
    for (const type of BUBBLING) {
      root.addEventListener(type, event => handleEvent(type, event));
    }
    for (const type of CAPTURING) {
      root.addEventListener(type, event => handleEvent(type, event), true);
    }
  }

  window.RapidexActions = { register, resolve, install, parseSpec, registry };

  install();
})();
