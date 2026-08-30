// ============================================================================
//  Quais regras de CSS deste repositorio NUNCA se aplicam a nada.
//
//  POR QUE ISTO EXISTE
//
//  O bundle entrega 525 kB de CSS numa pagina. A suspeita de que boa parte
//  disso e morta e velha, mas suspeita nao apaga linha: apagar seletor por
//  palpite e como apagar codigo por palpite, so que a falha aparece em pixel,
//  meses depois, numa tela que ninguem reabriu.
//
//  Entao a prova aqui tem DUAS metades, e elas respondem perguntas diferentes:
//
//   ESTATICA  - o nome de classe existe em algum lugar fora do CSS? Se a string
//               'foo' nao aparece no HTML nem no JS, nenhum elemento pode
//               receber essa classe: o seletor e morto por CONSTRUCAO, e isso
//               vale tambem para as telas que a captura nao visita.
//
//   RUNTIME   - o seletor casa com algum elemento nas telas abertas de verdade?
//               Mede o quanto do CSS entregue e de fato aplicado, mas NAO prova
//               morte: sao as telas de `SCREENS`, e o app tem mais estados que
//               isso. Eram 14 ate 30/08/2026, e Pix, cartao, Clube com cupom,
//               extrato, politica, chat respondido e as duas telas de erro
//               estavam TODOS fora; hoje sao 45.
//
//  So a metade ESTATICA autoriza apagar. A de runtime e termometro: serve para
//  achar candidato e para dimensionar o desperdicio, nunca para condenar.
//
//  AS TRES ARMADILHAS QUE ESTA FERRAMENTA JA LEVOU
//
//  1. Classe montada em pedacos. `classList.toggle('is-' + name)` e
//     `assistant-mark--' + size` nao aparecem inteiras em lugar nenhum. Um scan
//     ingenuo declara `.is-listening` morta e apaga a tela de voz. Por isso os
//     prefixos dinamicos entram numa lista, e tudo que casa com eles sai da
//     conta como NAO PROVADO — nunca como morto.
//  2. Classe que so o CSS usa. Uma classe aparece no CSS por definicao; se o
//     corpus de busca incluir os .css, toda classe "se prova" sozinha e a
//     ferramenta responde sempre "nada morto". O corpus e o que NAO e CSS.
//  3. Seletor de estado. `.foo:hover` nunca casa num querySelectorAll de tela
//     parada. Estado e pseudo-elemento saem antes do teste de runtime; o que se
//     pergunta e se o ALVO existe.
//
//  USO
//    node tools/css-usage.mjs              # parse + estatico (nao precisa do app)
//    node tools/css-usage.mjs --runtime    # tambem abre as telas (precisa do preview)
// ============================================================================
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'styles');

/* ── 1. Parser ────────────────────────────────────────────────────────────
   Nao ha aninhamento nativo neste repositorio (conferido: zero `&` iniciando
   linha), e as unicas at-rules sao @media e @keyframes. Um parser de chaves
   basta — e um parser de chaves nao tem dependencia para envelhecer. */
export function parseCss(css, file) {
  const rules = [];
  const media = [];
  let i = 0, line = 1, buf = '', bufLine = 1, bufInicio = 0;
  const len = css.length;
  const contar = (s) => { line += (s.match(/\n/g) || []).length; };

  while (i < len) {
    const c = css[i];

    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      contar(css.slice(i, end < 0 ? len : end + 2));
      i = end < 0 ? len : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < len && css[j] !== c) { if (css[j] === '\\') j++; j++; }
      buf += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const prelude = buf.trim();
      buf = '';
      // @keyframes / @font-face: o conteudo nao e seletor de documento, consome
      // o bloco inteiro contando chaves.
      if (/^@(keyframes|-webkit-keyframes|font-face|page|property)/.test(prelude)) {
        let depth = 1, j = i + 1;
        while (j < len && depth) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          else if (css[j] === '\n') line++;
          j++;
        }
        rules.push({ file, line: bufLine, selector: prelude, media: media.slice(), body: '', atRule: true, inicio: bufInicio, fim: j });
        i = j;
        bufLine = line;
        continue;
      }
      if (prelude.startsWith('@')) { media.push(prelude); i++; bufLine = line; continue; }

      const end = css.indexOf('}', i + 1);
      const body = css.slice(i + 1, end < 0 ? len : end);
      rules.push({ file, line: bufLine, selector: prelude, media: media.slice(), body: body.trim(), inicio: bufInicio, fim: (end < 0 ? len : end) + 1 });
      contar(css.slice(i, end < 0 ? len : end));
      i = (end < 0 ? len : end) + 1;
      bufLine = line;
      continue;
    }
    if (c === '}') { media.pop(); i++; buf = ''; bufLine = line; continue; }
    if (c === ';' && buf.trim().startsWith('@')) { buf = ''; i++; bufLine = line; continue; }
    if (c === '\n') line++;
    if (!buf.trim() && !/\s/.test(c)) { bufLine = line; bufInicio = i; }
    buf += c;
    i++;
  }
  return rules;
}

/* ── 2. Tokens de um seletor ───────────────────────────────────────────── */
export function tokensOf(selector) {
  const classes = new Set(), ids = new Set();
  // O conteudo de [attr="..."] sai antes: um ponto dentro da string nao e classe.
  const clean = selector.replace(/\[[^\]]*\]/g, ' ');
  for (const m of clean.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  for (const m of clean.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) ids.add(m[1]);
  return { classes: [...classes], ids: [...ids] };
}

/* Estado e pseudo-elemento saem antes do teste de runtime: a pergunta e se o
   ALVO existe na tela, nao se ele esta em hover agora. */
const ESTADOS = /::?(hover|focus-within|focus-visible|focus|active|visited|target|checked|disabled|enabled|indeterminate|placeholder-shown|placeholder|read-only|before|after|first-line|first-letter|selection|backdrop|marker|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+|-ms-[\w-]+)\b(\([^()]*\))?/g;

export function paraRuntime(sel) {
  const s = sel.replace(ESTADOS, '').replace(/\s+/g, ' ').trim();
  if (!s || /^[>+~]/.test(s) || /[>+~]$/.test(s)) return null;
  return s;
}

/* ── 3. Corpus: tudo que NAO e CSS ───────────────────────────────────────
   A SAIDA DESTA FERRAMENTA TAMBEM FICA DE FORA, e isso nao e detalhe.
   `css-usage.json` guarda todos os seletores analisados; deixa-lo no corpus faz
   a segunda rodada ler os seletores da primeira, achar cada nome de classe la
   dentro e responder "nada morto" — 426 regras mortas viraram 0 exatamente
   assim, e o zero e uma resposta plausivel demais para levantar suspeita.
   E a armadilha 2 do cabecalho outra vez, so que a folha que se prova sozinha e
   o relatorio. Ferramenta que le a propria saida sempre concorda consigo.
   `css-important.json` entrou nesta lista em 30/08/2026: ele fica na mesma raiz
   e tem o SELETOR de cada regra dentro, entao servia de corpus exatamente como
   o `css-usage.json` servia. Nao mudou nenhuma resposta hoje — sobrava 1 regra
   morta com ele e 1 sem ele —, e e por isso que ninguem tinha visto. O buraco
   so aparece no dia em que a proxima regra morta nascer, e nesse dia ele
   responde "viva". */
const IGNORA = /node_modules|[\\/]\.git|[\\/]dist[\\/]|test-results|playwright-report|package-lock|css-usage\.json|css-cores\.json|css-important\.json|ui-inventory\.json|captura.*\.json/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (IGNORA.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|js|mjs|cjs|json|md|ts)$/.test(e.name) && !/[\\/]styles[\\/]/.test(p)) out.push(p);
  }
  return out;
}

/* Classes montadas em pedacos. Quem casa com um destes prefixos NAO entra na
   conta de morto — o scan estatico nao consegue ve-las inteiras.
   Ver o cabecalho, armadilha 1. */
export const PREFIXOS_DINAMICOS = ['is-', 'assistant-mark--'];

export function analisar() {
  const arquivos = readdirSync(STYLES).filter(f => f.endsWith('.css')).sort();
  const rules = [];
  for (const f of arquivos) rules.push(...parseCss(readFileSync(join(STYLES, f), 'utf8'), f));

  const corpus = walk(ROOT);
  /* O CORPUS TEM DUAS METADES, E ELAS PROVAM COISAS DIFERENTES.
     Ate 30/08/2026 era um saco so, e uma classe que aparecia APENAS num spec
     se provava viva. Nao e a mesma prova: um spec pode nomear uma classe
     justamente para afirmar que ela NAO EXISTE — e era literalmente o caso de
     `.prod-card` (`pwa.spec.js` exigia `toHaveCount(0)`) e de
     `.assistant-hdr-dot` (`assistant-header.spec.js`, idem). Doze regras em
     duas folhas pintavam um cartao de produto que o app parou de desenhar, e
     a ferramenta respondia "viva" com a prova ao contrario na mao.
     A morte passa a ser julgada SO pelo app — o que poe classe em elemento:
     os dois .html e scripts/. `tests/` e `tools/` FALAM sobre o CSS, nao o
     produzem, e por isso saem do corpus que julga.

     E `tools/` precisou sair pelo mesmo motivo que a saida da ferramenta ja
     tinha saido: escrever o nome da classe no COMENTARIO deste arquivo, para
     explicar o caso, fez o proprio arquivo entrar no corpus e a classe se
     provar viva outra vez. A ferramenta que le a si mesma sempre concorda
     consigo — dessa vez pela documentacao, e nao pelo relatorio.

     O que so aparece em teste ou ferramenta sai numa lista propria, para
     conferencia humana — nunca apagado direto, porque uma classe montada em
     runtime tambem pode aparecer so no spec que a exercita. */
  const foraDoApp = (caminho) => /(^|[\\/])(tests|tools)[\\/]/.test(caminho);
  const textoApp = corpus.filter(c => !foraDoApp(c)).map(c => readFileSync(c, 'utf8')).join('\n');
  const textoForaDoApp = corpus.filter(foraDoApp).map(c => readFileSync(c, 'utf8')).join('\n');

  const cache = new Map(), cacheTeste = new Map();
  const existe = (tok) => {
    if (!cache.has(tok)) cache.set(tok, textoApp.includes(tok));
    return cache.get(tok);
  };
  const existeEmTeste = (tok) => {
    if (!cacheTeste.has(tok)) cacheTeste.set(tok, textoForaDoApp.includes(tok));
    return cacheTeste.get(tok);
  };

  for (const r of rules) {
    r.tokens = tokensOf(r.selector);
    // A virgula e um OU: a regra so morre se TODOS os seletores dela morrerem.
    const partes = r.selector.split(',').map(s => s.trim()).filter(Boolean);
    r.partes = partes.map(p => {
      const t = tokensOf(p);
      return {
        sel: p,
        faltando: [...t.classes, ...t.ids].filter(tok => !existe(tok)),
        dinamica: t.classes.some(c => PREFIXOS_DINAMICOS.some(px => c.startsWith(px))),
        semToken: t.classes.length + t.ids.length === 0
      };
    });
    r.mortaEstatica = !r.atRule && partes.length > 0 &&
      r.partes.every(p => p.faltando.length > 0 && !p.dinamica);
    // Morta para o app, mas com o nome citado em algum spec: nao apague sem
    // abrir o spec. Pode ser um teste que AFIRMA a ausencia (e ai a regra e
    // lixo com prova) ou um teste que exercita classe montada em runtime.
    r.soPorTeste = r.mortaEstatica && r.partes.some(p => p.faltando.some(existeEmTeste));
  }
  return { rules, corpus };
}

/* ── 4. Cores ──────────────────────────────────────────────────────────────
   Para comparar o que a folha ESCREVE com o que a tela PINTA, os dois lados
   precisam falar a mesma lingua. O browser normaliza tudo para `rgb(a, b, c)`,
   entao a normalizacao acontece do lado do CSS: #abc vira #aabbcc vira
   rgb(170,187,204). O que nao normaliza (gradiente, cor com alfa em notacao
   moderna) fica de fora da conta e e contado a parte — melhor uma conta menor
   e honesta do que uma maior com chute dentro. */
const NOMEADAS = { white: '#ffffff', black: '#000000', red: '#ff0000', transparent: 'transparent', currentcolor: 'currentcolor', inherit: 'inherit' };

export function normalizarCor(valor) {
  let v = String(valor).trim().toLowerCase();
  if (NOMEADAS[v]) v = NOMEADAS[v];
  if (v === 'transparent') return 'rgba(0, 0, 0, 0)';
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  if (/^#[0-9a-f]{6}$/.test(v)) {
    const n = parseInt(v.slice(1), 16);
    return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
  }
  if (/^#[0-9a-f]{8}$/.test(v)) {
    const n = parseInt(v.slice(1, 7), 16), a = parseInt(v.slice(7), 16) / 255;
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + Number(a.toFixed(2)) + ')';
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.%]+))?\s*\)$/);
  if (rgb) {
    const [, r, g, b, a] = rgb;
    if (a === undefined || a === '1' || a === '100%') return 'rgb(' + +r + ', ' + +g + ', ' + +b + ')';
    const alfa = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return 'rgba(' + +r + ', ' + +g + ', ' + +b + ', ' + (alfa === 0 ? 0 : Number(alfa.toFixed(2))) + ')';
  }
  return null;   // hsl, gradiente, color-mix: fora da conta, e contado a parte
}

/** Todo literal de cor escrito nas folhas, com onde ele aparece. */
export function coresDasFolhas() {
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  const mapa = new Map();
  for (const f of readdirSync(STYLES).filter(x => x.endsWith('.css'))) {
    const texto = readFileSync(join(STYLES, f), 'utf8');
    for (const bruto of texto.match(re) || []) {
      const norm = normalizarCor(bruto);
      const chave = norm || bruto.toLowerCase();
      const e = mapa.get(chave) || { norm, ocorrencias: 0, arquivos: new Set(), exemplo: bruto };
      e.ocorrencias++; e.arquivos.add(f);
      mapa.set(chave, e);
    }
  }
  return mapa;
}

/* ── 5. Runtime ────────────────────────────────────────────────────────── */

/* Toda propriedade computada que pode conter cor. A lista curta da captura
   (color/backgroundColor/borderTopColor) responderia "esta cor nunca aparece"
   para uma cor que pinta a borda ESQUERDA de alguma coisa — a conta tem de
   olhar por onde a cor pode sair, nao por onde e comodo olhar. */
const PROPS_COR = [
  'color', 'backgroundColor', 'backgroundImage',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'outlineColor', 'boxShadow', 'textShadow', 'textDecorationColor',
  'caretColor', 'columnRuleColor', 'fill', 'stroke', 'webkitTextFillColor',
  'webkitTextStrokeColor', 'accentColor'
];

async function runtime(rules) {
  const { chromium } = await import('@playwright/test');
  const { SCREENS, prepararTela } = await import('./capture-screens.mjs');

  const alvos = [...new Set(rules.map(r => paraRuntime(r.selector)).filter(Boolean))];
  const casou = new Set();
  const pintadas = new Set();
  const browser = await chromium.launch();
  for (const screen of SCREENS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await prepararTela(page, screen);
    try {
      await screen.go(page);
      await page.waitForTimeout(500);
      const achados = await page.evaluate((lista) => lista.filter((s) => {
        try { return document.querySelector(s) !== null; } catch { return false; }
      }), alvos);
      achados.forEach(s => casou.add(s));
      const cores = await page.evaluate((props) => {
        const vistas = new Set();
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          for (const p of props) {
            const v = cs[p];
            if (!v) continue;
            // gradiente e sombra trazem varias cores dentro de uma string
            for (const m of String(v).match(/rgba?\([^)]*\)/g) || []) vistas.add(m);
          }
        }
        return [...vistas];
      }, PROPS_COR);
      cores.forEach(c => pintadas.add(c));
      process.stdout.write('  ' + screen.name + ': ' + achados.length + ' seletores casam, ' + cores.length + ' cores na tela\n');
    } catch (e) {
      process.stdout.write('  ' + screen.name + ': FALHOU - ' + e.message + '\n');
    }
    await context.close();
  }
  await browser.close();
  for (const r of rules) {
    const alvo = paraRuntime(r.selector);
    r.casouRuntime = alvo ? casou.has(alvo) : null;
  }
  return pintadas;
}

/* ── 5. Relatorio ──────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('css-usage.mjs')) {
  const { rules, corpus } = analisar();
  const comRuntime = process.argv.includes('--runtime');
  const pintadas = comRuntime ? await runtime(rules) : null;
  const TELAS = comRuntime ? (await import('./capture-screens.mjs')).SCREENS.length : 0;

  const vivas = rules.filter(r => !r.atRule);
  console.log('');
  console.log('corpus (arquivos nao-CSS lidos): ' + corpus.length);
  console.log('regras: ' + vivas.length + ' | inalcancaveis por construcao: ' + vivas.filter(r => r.mortaEstatica).length);
  const porTeste = vivas.filter(r => r.soPorTeste);
  if (porTeste.length) {
    console.log('  destas, ' + porTeste.length + ' tem o nome citado SO em tests/ ou tools/ (abra o arquivo antes de apagar):');
    for (const r of porTeste) console.log('    ' + r.file + ':' + r.line + '  ' + r.selector.replace(/\s+/g, ' ').slice(0, 90));
  }
  if (comRuntime) {
    console.log('regras que casam em alguma das ' + TELAS + ' telas: ' + vivas.filter(r => r.casouRuntime).length);
    const cores = coresDasFolhas();
    const normalizaveis = [...cores].filter(([, e]) => e.norm);
    const nuncaNaTela = normalizaveis.filter(([k]) => !pintadas.has(k));
    console.log('');
    console.log('cores escritas nas folhas: ' + cores.size + ' (normalizaveis para rgb: ' + normalizaveis.length + ')');
    console.log('  nunca pintadas nas ' + TELAS + ' telas: ' + nuncaNaTela.length);
    writeFileSync(join(ROOT, 'css-cores.json'), JSON.stringify({
      pintadas: [...pintadas].sort(),
      nuncaNaTela: nuncaNaTela
        .map(([k, e]) => ({ cor: k, exemplo: e.exemplo, ocorrencias: e.ocorrencias, arquivos: [...e.arquivos] }))
        .sort((a, b) => b.ocorrencias - a.ocorrencias)
    }, null, 1));
  }
  console.log('');
  const por = new Map();
  for (const r of vivas) {
    const a = por.get(r.file) || { total: 0, mortas: 0, casou: 0, bytes: 0, bytesMortos: 0 };
    a.total++;
    a.bytes += r.selector.length + r.body.length + 3;
    if (r.mortaEstatica) { a.mortas++; a.bytesMortos += r.selector.length + r.body.length + 3; }
    if (r.casouRuntime) a.casou++;
    por.set(r.file, a);
  }
  console.log('arquivo'.padEnd(22) + 'regras'.padStart(8) + 'mortas'.padStart(8) + 'casam'.padStart(8) + 'bytes mortos'.padStart(14));
  for (const [f, a] of [...por].sort((x, y) => y[1].bytesMortos - x[1].bytesMortos)) {
    console.log(f.padEnd(22) + String(a.total).padStart(8) + String(a.mortas).padStart(8) +
      String(a.casou).padStart(8) + String(a.bytesMortos).padStart(14));
  }
  writeFileSync(join(ROOT, 'css-usage.json'), JSON.stringify(rules, null, 1));
  console.log('\nescrito: css-usage.json');
}
