// ============================================================================
//  Prova de que a tela não mudou, quando o commit diz que só moveu código.
//
//  POR QUE ISTO EXISTE
//
//  Quebrar o restaurant-page.js em módulos é mover funções para fora de um
//  fechamento que elas compartilhavam há anos. A suíte E2E confere COMPORTAMENTO
//  (o que acontece ao clicar), mas ela não olha para a maior parte dos pixels:
//  um espaçamento que muda, uma cor que deixa de herdar, um `display` que vira
//  outro — nada disso quebra um teste, e tudo isso é regressão visual.
//
//  Então a prova é medida, não argumentada: abre-se cada tela, lê-se o valor
//  COMPUTADO de um conjunto de propriedades para TODOS os elementos do
//  documento, e compara-se o antes com o depois. Igual é igual. É o método que
//  a auditoria usou ao mexer na escala tipográfica (b21aa13); aqui ele vira
//  ferramenta em vez de script descartável.
//
//  COMO USAR
//    npm run build && npm run preview &
//    node tools/capture-screens.mjs antes.json
//    ...aplique o refactor, npm run build...
//    node tools/capture-screens.mjs depois.json
//    node tools/capture-screens.mjs --diff antes.json depois.json
//
//  A comparação é por CAMINHO ESTRUTURAL do elemento (tag + índice entre os
//  irmãos de mesma tag), não por índice global: assim um elemento a mais numa
//  lista desloca só o ramo dele, e o relatório aponta o ramo em vez de acusar
//  o documento inteiro.
// ============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { mockApi, RESTAURANT_URL, PRODUCT_H2O, seedPickupSession } from '../tests/e2e/helpers.js';

const BASE = process.env.CAPTURE_BASE_URL || 'http://127.0.0.1:4174';

// As propriedades que descrevem "como isto aparece". Não é a folha inteira de
// propósito: getComputedStyle devolve ~340 nomes, e a maioria (transições,
// grid implícito, contadores) é ruído que muda por motivo legítimo e afogaria
// a diferença que importa.
const PROPS = [
  'display', 'position', 'visibility', 'opacity', 'overflow', 'zIndex',
  'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'whiteSpace',
  'color', 'backgroundColor', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderTopStyle',
  'borderRadius', 'boxShadow', 'transform',
  'flexDirection', 'justifyContent', 'alignItems', 'flexGrow', 'flexShrink',
  'gridTemplateColumns', 'gap'
];

const ready = (page) => page.waitForFunction(
  () => typeof window.openProduct === 'function' && !document.body.classList.contains('app-booting'),
  null,
  { timeout: 30000 }
);

const addToCart = (page) => page.evaluate((id) => {
  window.openProduct(id);
  window.changeQty(1);
  window.changeQty(1);
  window.addToCart();
}, PRODUCT_H2O);

const boot = async (page) => {
  await page.goto(BASE + RESTAURANT_URL);
  await ready(page);
};

/**
 * Dispara uma acao PELO REGISTRO, nao por window.
 *
 * So 11 nomes continuam globais (ver o Object.assign no fim de
 * restaurant-page.js); os outros 160 existem apenas em RapidexActions, que e de
 * onde o markup os chama por data-act-*. Chamar `window.mobNavAssistant()` aqui
 * dava "is not a function" e a tela do assistente saia da captura em silencio —
 * uma tela a menos conferida, sem nada dizendo isso.
 *
 * Por isso esta funcao LANCA quando o nome nao existe: numa ferramenta cujo
 * trabalho e provar que nada mudou, tela que nao abriu tem de ser barulhenta.
 */
const act = (page, name, ...args) => page.evaluate(([acao, argumentos]) => {
  const fn = window.RapidexActions?.resolve?.(acao);
  if (typeof fn !== 'function') throw new Error(`acao desconhecida: ${acao}`);
  return fn(...argumentos);
}, [name, args]);

/**
 * As telas. Cada uma é levada ao estado por AÇÕES do próprio app — nunca por
 * um estado montado à mão, que provaria só que o CSS existe, e não que o
 * caminho que leva até ele continua chegando lá.
 */
export const SCREENS = [
  { name: 'home', go: boot },

  {
    name: 'cardapio',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavMenu');
      await page.waitForFunction(() => document.body.classList.contains('menu-tab'));
    }
  },
  {
    name: 'produto',
    async go(page) {
      await boot(page);
      await page.evaluate((id) => window.openProduct(id), PRODUCT_H2O);
      await page.waitForSelector('#productModal.active');
    }
  },
  {
    name: 'sacola',
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await page.waitForSelector('#cartModal.active');
    }
  },
  {
    name: 'formas-de-pagamento',
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await page.waitForSelector('#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await page.waitForSelector('#paymentMethodModal.active');
    }
  },
  {
    name: 'endereco-escolha',
    async go(page) {
      await boot(page);
      await act(page, 'openAddressChoice');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'endereco-picker',
    async go(page) {
      await boot(page);
      await act(page, 'openAddrPicker');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'endereco-busca',
    async go(page) {
      await boot(page);
      await act(page, 'openAddrSearch');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'login',
    async go(page) {
      await boot(page);
      await act(page, 'openLoginScreen');
      await page.waitForSelector('#loginModal.active');
    }
  },
  {
    name: 'cadastro',
    async go(page) {
      await boot(page);
      await act(page, 'openRegisterScreen');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'clube',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavClub');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'perfil',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'assistente',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'operacao',
    async go(page) {
      await boot(page);
      await act(page, 'openOperationScreen');
      await page.waitForTimeout(500);
    }
  }
];

/**
 * Duas fontes de RUIDO que a primeira rodada da ferramenta encontrou sozinha —
 * capturei duas vezes o MESMO codigo e deu diferenca em duas telas:
 *
 *   assistente: os dois <path> de vapor da marca tem animacao CSS em curso, e
 *   `opacity` lida no meio dela vale um numero diferente a cada captura
 *   (0,791926 contra 0,884243).
 *
 *   endereco-busca: o campo de busca recebe foco, e o fundo dele muda com
 *   :focus — entao o valor dependia de o foco ter chegado ou nao. Esta segunda
 *   voltou depois (o foco e agendado dentro de um `.finally()` de rede, e nem
 *   sempre chegava antes do blur): a correcao esta em `estabilizar()`.
 *
 * Uma ferramenta que acusa diferenca sem que nada tenha mudado e pior que
 * nenhuma: em duas semanas todo mundo ignora a saida dela. Entao, antes de ler:
 * anima e transicao desligadas (o que congela cada elemento no estado FINAL,
 * que e o que interessa), e o foco tirado de qualquer campo.
 */
async function estabilizar(page) {
  // PRIMEIRA CAMADA, e a que resolve: apagar `transition` e `animation` das
  // REGRAS, pelo CSSOM, em vez de tentar sobrepo-las com outra regra.
  //
  // A tentativa anterior era um `*{transition:none!important}` injetado, e ela
  // perde por especificidade: o app declara transicao com `!important` sob
  // classe e sob id (`.addr-search-field{transition:border-color .15s!important}`,
  // `#mobViewAssistant .assistant-ai-input-bar{...!important}`), e `!important`
  // contra `!important` quem decide e a especificidade — 0,0,1,0 ganha de
  // 0,0,0,0. Apagando a declaracao da propria regra nao ha disputa: nao existe
  // mais transicao nenhuma para correr, e todo valor lido e o estado FINAL.
  //
  // Sem isto, o ruido aparecia como cor a um passo do destino:
  // `borderTopColor: rgb(204,204,204) -> rgb(205,206,207)` no mesmo codigo.
  await page.evaluate(() => {
    const limpar = (regras) => {
      for (const regra of regras) {
        if (regra.style) { regra.style.removeProperty('transition'); regra.style.removeProperty('animation'); }
        if (regra.cssRules) limpar(regra.cssRules);   // @media
      }
    };
    for (const folha of document.styleSheets) {
      try { limpar(folha.cssRules); } catch { /* folha de outra origem: nao ha o que congelar nela */ }
    }
  });

  // Cinto e suspensorio: pega `style="transition:..."` inline e as animacoes
  // declaradas em regras que por algum motivo o laco acima nao alcance.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}'
  });

  // Deixa o layout assentar depois de tudo isso.
  await page.waitForTimeout(400);
}

/**
 * Lê o documento inteiro. Este corpo roda dentro do browser.
 *
 * O BLUR MORA AQUI, e nao em estabilizar(), de proposito.
 *
 * O foco desta suite nao chega junto com a tela: em
 * `restaurant-address-flow.js:716` ele e agendado num `setTimeout(200)`
 * pendurado no `.finally()` de uma promessa de REDE. A hora em que ele pousa
 * depende de o mock responder, entao um blur dado num `page.evaluate()` e a
 * leitura dada em OUTRO deixam uma fresta entre os dois turnos por onde esse
 * foco atrasado entra — e `.addr-search-field:focus-within` troca a borda e o
 * fundo. Era 1 elemento diferente em `endereco-busca` comparando a MESMA build
 * consigo mesma, intermitente. E o custo disso nao e o falso alarme de hoje: e
 * a rodada de amanha, em que alguem ve "1 elemento diferente" e assume que e o
 * de sempre.
 *
 * Desfocar e ler no MESMO turno fecha a fresta: JS de pagina e uma thread so,
 * nenhum timer roda no meio desta funcao. E como estabilizar() ja apagou as
 * transicoes das regras, o blur vale na hora, sem estado intermediario.
 */
function readDocument(props) {
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && typeof ativo.blur === 'function') ativo.blur();

  const path = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) { parts.unshift(node.tagName.toLowerCase()); break; }
      const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      parts.unshift(node.tagName.toLowerCase() + (sameTag.length > 1 ? '[' + sameTag.indexOf(node) + ']' : ''));
    }
    return parts.join('>');
  };
  return Array.from(document.querySelectorAll('*')).map((el) => {
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of props) style[p] = cs[p];
    return {
      path: path(el),
      id: el.id || '',
      // A classe entra porque uma classe a mais que não muda nada hoje muda
      // tudo no dia em que alguém escrever a regra dela.
      cls: el.getAttribute('class') || '',
      style
    };
  });
}

async function capture(out) {
  const browser = await chromium.launch();
  const result = {};
  for (const screen of SCREENS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await mockApi(page);
    await seedPickupSession(page);
    try {
      await screen.go(page);
      // Deixa a animação de entrada terminar: transform a meio caminho não é
      // um estado, é um instante, e comparar instantes dá diferença todo dia.
      await page.waitForTimeout(900);
      await estabilizar(page);
      result[screen.name] = await page.evaluate(readDocument, PROPS);
      process.stdout.write('  ' + screen.name + ': ' + result[screen.name].length + ' elementos\n');
    } catch (error) {
      result[screen.name] = { erro: String((error && error.message) || error) };
      process.stdout.write('  ' + screen.name + ': FALHOU - ' + error.message + '\n');
    }
    await context.close();
  }
  await browser.close();
  writeFileSync(out, JSON.stringify(result, null, 1));
  console.log('\nescrito: ' + out);
}

function diff(a, b) {
  const A = JSON.parse(readFileSync(a, 'utf8'));
  const B = JSON.parse(readFileSync(b, 'utf8'));
  let problemas = 0;
  for (const name of Object.keys(A)) {
    const before = A[name];
    const after = B[name];
    if (!Array.isArray(before) || !Array.isArray(after)) {
      console.log(name + ': uma das capturas falhou - ' + JSON.stringify((before && before.erro) || (after && after.erro)));
      problemas++;
      continue;
    }
    /*
     * A CHAVE E `caminho|id`, E A CLASSE E COMPARADA A PARTE.
     *
     * Ela ja foi `caminho|id|classe`, e a ideia era boa: uma classe a mais que
     * nao muda nada hoje muda tudo no dia em que alguem escrever a regra dela.
     * So que, com a classe DENTRO da chave, trocar uma classe de nome faz o
     * elemento sumir de um lado e nascer do outro — e a comparacao de estilo
     * dele, que e o que a ferramenta existe para fazer, nunca acontece. Num
     * commit que introduz classes de componente, isso e exatamente o elemento
     * que se precisa conferir, e era o unico que escapava.
     *
     * Agora a classe continua sendo relatada (linha `classe:`), mas separada da
     * conta de estilo: da para ler "17 elementos trocaram de classe, 0 mudaram
     * de valor computado", que e a frase que um commit de componentizacao
     * precisa dizer. Uma mudanca de classe nao conta como problema; uma
     * mudanca de VALOR conta.
     */
    const index = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.path + '|' + r.id, r);
      return m;
    };
    const mb = index(before);
    const ma = index(after);
    let mudou = 0, classesTrocadas = 0;
    const exemplos = [];
    for (const [key, antes] of mb) {
      const depois = ma.get(key);
      if (!depois) {
        mudou++;
        if (exemplos.length < 6) exemplos.push('sumiu  ' + key + ' [' + antes.cls + ']');
        continue;
      }
      if (antes.cls !== depois.cls) {
        classesTrocadas++;
        if (exemplos.length < 6) exemplos.push('classe: ' + key + '\n         "' + antes.cls + '" -> "' + depois.cls + '"');
      }
      for (const p of PROPS) {
        if (antes.style[p] !== depois.style[p]) {
          mudou++;
          if (exemplos.length < 6) exemplos.push(key + '\n         ' + p + ': ' + antes.style[p] + ' -> ' + depois.style[p]);
          break;
        }
      }
    }
    for (const [key, depois] of ma) {
      if (!mb.has(key)) {
        mudou++;
        if (exemplos.length < 6) exemplos.push('novo   ' + key + ' [' + depois.cls + ']');
      }
    }
    const sufixo = classesTrocadas ? ' (' + classesTrocadas + ' com classe trocada)' : '';
    if (mudou) {
      problemas++;
      console.log(name + ': ' + mudou + ' elementos diferentes (de ' + before.length + ')' + sufixo);
      exemplos.forEach(e => console.log('    ' + e));
    } else {
      console.log(name + ': identico (' + before.length + ' elementos)' + sufixo);
      if (classesTrocadas) exemplos.forEach(e => console.log('    ' + e));
    }
  }
  console.log(problemas ? '\n' + problemas + ' tela(s) com diferenca.' : '\nNenhuma diferenca.');
  process.exit(problemas ? 1 : 0);
}

// SCREENS e exportado, entao este arquivo tambem e IMPORTADO (por
// tools/css-usage.mjs, que reusa a lista de telas). Sem esta guarda, importar
// a lista dispararia uma captura inteira de 14 telas como efeito colateral.
if (process.argv[1] && process.argv[1].endsWith('capture-screens.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === '--diff') diff(args[1], args[2]);
  else await capture(args[0] || 'captura.json');
}
