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
const SCREENS = [
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
 *   :focus — entao o valor dependia de o foco ter chegado ou nao.
 *
 * Uma ferramenta que acusa diferenca sem que nada tenha mudado e pior que
 * nenhuma: em duas semanas todo mundo ignora a saida dela. Entao, antes de ler:
 * anima e transicao desligadas (o que congela cada elemento no estado FINAL,
 * que e o que interessa), e o foco tirado de qualquer campo.
 */
async function estabilizar(page) {
  // ORDEM IMPORTA: desfocar PRIMEIRO. Tirar o foco dispara a transicao de
  // border-color de volta, e ler no meio dela dava 231 onde a outra captura
  // lia 232 — a ultima diferenca de ruido que sobrou nesta ferramenta.
  await page.evaluate(() => {
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && typeof ativo.blur === 'function') ativo.blur();
  });

  // Best-effort. NAO vence tudo: o app declara transicoes com `!important` sob
  // seletores de especificidade alta (ex.: `#mobViewAssistant
  // .assistant-ai-input-bar{transition:...!important}`), e um `*` com
  // `!important` perde para eles. Serve para o resto — inclusive as animacoes
  // de vapor da marca do assistente, que sao o ruido mais barulhento.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}'
  });

  // A garantia de verdade e esta espera: a transicao mais longa do app e de
  // 200ms, entao 400 cobre com folga o que o estilo injetado nao alcanca.
  await page.waitForTimeout(400);
}

/** Lê o documento inteiro. Este corpo roda dentro do browser. */
function readDocument(props) {
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
    const index = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.path + '|' + r.id + '|' + r.cls, r.style);
      return m;
    };
    const mb = index(before);
    const ma = index(after);
    let mudou = 0;
    const exemplos = [];
    for (const [key, styleBefore] of mb) {
      const styleAfter = ma.get(key);
      if (!styleAfter) {
        mudou++;
        if (exemplos.length < 6) exemplos.push('sumiu  ' + key);
        continue;
      }
      for (const p of PROPS) {
        if (styleBefore[p] !== styleAfter[p]) {
          mudou++;
          if (exemplos.length < 6) exemplos.push(key + '\n         ' + p + ': ' + styleBefore[p] + ' -> ' + styleAfter[p]);
          break;
        }
      }
    }
    for (const key of ma.keys()) {
      if (!mb.has(key)) {
        mudou++;
        if (exemplos.length < 6) exemplos.push('novo   ' + key);
      }
    }
    if (mudou) {
      problemas++;
      console.log(name + ': ' + mudou + ' elementos diferentes (de ' + before.length + ')');
      exemplos.forEach(e => console.log('    ' + e));
    } else {
      console.log(name + ': identico (' + before.length + ' elementos)');
    }
  }
  console.log(problemas ? '\n' + problemas + ' tela(s) com diferenca.' : '\nNenhuma diferenca.');
  process.exit(problemas ? 1 : 0);
}

const args = process.argv.slice(2);
if (args[0] === '--diff') diff(args[1], args[2]);
else await capture(args[0] || 'captura.json');
