// ============================================================================
//  Quais `!important` deste CSS nao tem adversario nenhum.
//
//  POR QUE ISTO EXISTE
//
//  Sao 8.772 `!important` nas folhas deste app, 5.039 so em utilities.css.
//  `!important` nao e um estilo de escrita: e uma DECLARACAO DE GUERRA contra
//  outra regra especifica. Onde nao ha a outra regra, ele nao esta ganhando de
//  ninguem — esta so tornando impossivel que a proxima pessoa mude aquele
//  valor sem escrever outro `!important`. Foi assim que se chegou a quatro
//  secoes dizendo "override final" sobre a mesma barra divisoria.
//
//  Tirar por atacado nao serve: alguns estao la porque VENCEM algo, e tirar um
//  desses muda a tela. A pergunta e por declaracao, e tem resposta medida.
//
//  COMO A PERGUNTA E RESPONDIDA
//
//  Abre-se cada tela e monta-se, para CADA elemento, a lista de regras que
//  casam com ele (um `querySelectorAll` por regra, nao um `matches` por par —
//  a diferenca e de minutos para segundos). Entao, para cada propriedade que
//  uma regra declara com `!important`:
//
//    tem ADVERSARIO  se algum elemento que essa regra pinta e alcancado por
//                    outra regra que declara a MESMA propriedade.
//    sem adversario  se, em todos os elementos que ela alcanca, ela e a unica
//                    a falar daquela propriedade.
//
//  E o adversario pode nao estar em folha nenhuma: `mark-contrast.test.js` le o
//  TEXTO da regra e exige `opacity:.82!important`. Por isso ha um terceiro
//  veredito, `vetado-por-teste` — ver o comentario de `linhasDeTeste()`.
//
//  Note que a pergunta nao e "quem ganha". Uma regra que ganharia de qualquer
//  jeito, por especificidade ou por ordem, tambem conta como adversario: ela e
//  a razao pela qual alguem escreveu o `!important`, e tirar o marcador ali
//  muda quem vence. So sai o que nao disputa com ninguem.
//
//  O QUE ESTA MEDIDA NAO ALCANCA, E O QUE SE FAZ A RESPEITO
//
//  As telas da captura, e so elas. Uma regra que nao casou com NADA em tela
//  nenhuma nao produz evidencia — ela e listada como `sem-evidencia` e nao
//  entra na lista de remocao. Nao confunda "nao vi adversario" com "nao ha
//  adversario" para regras que nunca foram medidas.
//
//  Eram 14 telas ate 30/08/2026, e o Pix, o cartao, o Clube com cupom, o
//  extrato, a politica, o chat respondido e as duas telas de erro estavam
//  TODOS fora — 1.628 declaracoes ficavam sem julgamento so por isso. Hoje
//  sao 45 (`SCREENS`, em capture-screens.mjs), e cada tela acrescentada la
//  encolhe esta lista sem que nada aqui precise mudar.
//
//  Pior que isso: uma regra pode alcancar um elemento numa tela capturada SEM
//  adversario e alcancar outro elemento, numa tela que a captura nao abre, ONDE
//  o adversario existe. O runtime diria "sem adversario" para uma disputa que
//  so nao foi aberta na frente dele. Por isso ha um VETO ESTATICO por cima:
//  se qualquer outra regra, em folha nenhuma, declara a mesma familia de
//  propriedade com um seletor que compartilhe ao menos um token, o marcador
//  fica onde esta. O veto e grosseiro de proposito — ele veta demais, e vetar
//  demais custa um `!important` a mais no arquivo, enquanto vetar de menos
//  custa um pixel numa tela que ninguem abriu.
//
//  USO
//    npm run build && npm run preview &
//    node tools/css-important.mjs          # tabela
//    node tools/css-important.mjs --json   # css-important.json
// ============================================================================
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, paraRuntime } from './css-usage.mjs';
import { SCREENS, prepararTela } from './capture-screens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'styles');

/*
 * O ADVERSARIO PODE NAO ESTAR NO CSS — ELE PODE SER UM TESTE.
 *
 * `tests/unit/mark-contrast.test.js` le o TEXTO da folha e exige
 * `/opacity:.82!important/` dentro do bloco de movimento reduzido: sob
 * `prefers-reduced-motion` o vapor da marca tem de parar num valor fixo, e a
 * animacao que o move declara `opacity` com marcador. Nenhuma varredura de
 * folha acha esse adversario — ele nao esta em folha nenhuma.
 *
 * O custo de nao ver isso foi medido: em 30/08/2026 esta declaracao entrou na
 * lista de `sem-adversario`, o marcador saiu, e quem barrou foi o `npm run
 * test` — depois do commit, porque a saida dos tres portoes rapidos tinha sido
 * engolida pelo shell na hora de rodar. A regra ate tinha um comentario ao lado
 * dizendo `o !important fica`, e o script de remocao nao le comentario.
 *
 * Entao o veto passa a ser da ferramenta: se algum arquivo em tests/ cita a
 * propriedade e `!important` na MESMA LINHA, a declaracao nao entra na lista.
 * E grosseiro de proposito, pela mesma razao do outro veto: vetar demais custa
 * um marcador que fica, vetar de menos custa a tela — ou, aqui, um teste
 * vermelho depois do commit.
 */
function linhasDeTeste() {
  const out = [];
  const varrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, e.name);
      if (e.isDirectory()) varrer(caminho);
      else if (/\.(js|mjs|cjs|ts)$/.test(e.name)) out.push(...readFileSync(caminho, 'utf8').split(/\r?\n/));
    }
  };
  varrer(join(ROOT, 'tests'));
  return out.filter(l => l.includes('!important'));
}
const LINHAS_DE_TESTE = linhasDeTeste();
const afirmadoPorTeste = (prop) => LINHAS_DE_TESTE.some(l => l.includes(prop));

/**
 * As propriedades declaradas num corpo de regra, com o marcador de cada uma.
 *
 * OS COMENTARIOS SAEM PRIMEIRO, e nao e detalhe de higiene. Sem esta linha, o
 * comentario que precede uma declaracao gruda no nome dela:
 *
 *   /* Zera o gap e devolve o espaco as colunas. *\/
 *   gap:0!important;
 *
 * vinha como a propriedade `"...as colunas. *\/\n  gap"`. Um nome assim nao
 * casa com familia nenhuma, entao a busca por adversario nao encontra o
 * `gap:0 36px!important` que estava do outro lado, a declaracao e dada como
 * livre, o marcador sai — e a barra de baixo do app abre 36px entre os itens,
 * com os botoes passando de 74,8px para 46px. A captura acusou em 14 telas.
 *
 * Neste repositorio a declaracao COMENTADA e a regra, nao a excecao: os
 * comentarios sao historico de defeito e ficam colados no que explicam. Uma
 * ferramenta que le CSS aqui tem de tirar comentario antes de tudo.
 */
export function declaracoes(body) {
  body = body.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  // Divide por `;` fora de parenteses: `font:700 12px/17px var(--x, y)` tem
  // virgula e parenteses dentro, e um split ingenuo parte no lugar errado.
  let nivel = 0, atual = '';
  for (const c of body) {
    if (c === '(') nivel++;
    else if (c === ')') nivel--;
    if (c === ';' && nivel === 0) { out.push(atual); atual = ''; continue; }
    atual += c;
  }
  out.push(atual);
  const decls = [];
  for (const bruto of out) {
    const t = bruto.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i < 1) continue;
    const prop = t.slice(0, i).trim().toLowerCase();
    if (!prop || prop.startsWith('--')) continue;
    decls.push({ prop, important: /!\s*important\s*$/i.test(t) });
  }
  return decls;
}

/* Duas propriedades de nomes diferentes disputam o mesmo pixel o tempo todo, e
   comparar o nome escrito deixa passar a disputa. `border:0` contra
   `border-bottom-color:#eee`; `gap:0` contra `column-gap:36px`; `width:46px`
   contra `flex:1`. Por isso o agrupamento e GROSSO — cada grupo e "coisas que
   podem decidir o mesmo valor computado".
   Foi um grupo fino demais que passou o primeiro erro: `gap` e `column-gap`
   estavam em familias diferentes, o `gap:0!important` da barra de baixo saiu
   por "nao ter adversario", e a captura acusou `gap: 0px -> 0px 36px` com os
   botoes da barra mudando de 74,8px para 46px atras. Errar para o lado de
   agrupar demais custa um `!important` que fica; errar para o outro custa a
   tela. */
const GRUPOS = [
  [/^border/, 'border'],
  [/^(gap|column-gap|row-gap|grid-gap|grid-column-gap|grid-row-gap)$/, 'gap'],
  // tamanho e distribuicao no flex/grid decidem o mesmo retangulo
  [/^(width|height|min-width|min-height|max-width|max-height|flex|flex-basis|flex-grow|flex-shrink|aspect-ratio|box-sizing)/, 'caixa'],
  [/^(margin|padding)/, 'espaco'],
  [/^(top|right|bottom|left|inset|position|transform|translate)/, 'posicao'],
  [/^(font|line-height|letter-spacing|word-spacing|text-transform|white-space|text-align|text-indent)/, 'texto'],
  [/^(background|box-shadow|opacity|filter|backdrop-filter)/, 'pintura'],
  [/^(display|visibility|overflow|z-index|float|clear)/, 'fluxo'],
  [/^(grid|place|justify|align|order|direction)/, 'arranjo'],
  [/^(transition|animation|will-change)/, 'movimento'],
  [/^(color|-webkit-text-fill-color|-webkit-text-stroke)/, 'tinta']
];

const FAMILIA = (prop) => {
  const p = prop.replace(/^-(webkit|moz|ms)-/, '');
  for (const [re, nome] of GRUPOS) if (re.test(p)) return nome;
  return p;
};

async function main() {
  const arquivos = readdirSync(STYLES).filter(f => f.endsWith('.css')).sort();
  const rules = [];
  for (const f of arquivos) {
    for (const r of parseCss(readFileSync(join(STYLES, f), 'utf8'), f)) {
      if (r.atRule || !r.body.trim()) continue;
      const decls = declaracoes(r.body);
      if (!decls.some(d => d.important)) continue;
      r.decls = decls;
      r.alvo = paraRuntime(r.selector);
      r.familias = new Set(decls.filter(d => d.important).map(d => FAMILIA(d.prop)));
      rules.push(r);
    }
  }
  // Todas as regras, inclusive sem !important: qualquer uma serve de adversario.
  const todas = [];
  for (const f of arquivos) {
    for (const r of parseCss(readFileSync(join(STYLES, f), 'utf8'), f)) {
      if (r.atRule || !r.body.trim()) continue;
      const alvo = paraRuntime(r.selector);
      if (!alvo) continue;
      todas.push({ id: todas.length, alvo, familias: new Set(declaracoes(r.body).map(d => FAMILIA(d.prop))) });
    }
  }
  for (const r of rules) r.id = todas.findIndex(t => t.alvo === r.alvo && t.familias.size);

  console.log('regras com !important: ' + rules.length + ' | regras totais: ' + todas.length);

  // { alvoDaRegra -> Set(familia) } vistos em disputa
  const disputadas = new Map();      // "alvo|familia" -> true
  const semEvidencia = new Set(todas.map(t => t.alvo));

  const browser = await chromium.launch();
  for (const screen of SCREENS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await prepararTela(page, screen);
    try {
      await screen.go(page);
      await page.waitForTimeout(500);
      const carga = todas.map(t => [t.alvo, [...t.familias]]);
      const achado = await page.evaluate((lista) => {
        // elemento -> conjunto de indices de regra que o alcancam
        const porElemento = new Map();
        lista.forEach(([sel], i) => {
          let els;
          try { els = document.querySelectorAll(sel); } catch { return; }
          for (const el of els) {
            let s = porElemento.get(el);
            if (!s) { s = []; porElemento.set(el, s); }
            s.push(i);
          }
        });
        // Para cada elemento, quais familias sao declaradas por MAIS DE UMA regra
        const emDisputa = new Set();
        const vistos = new Set();
        for (const indices of porElemento.values()) {
          const contagem = new Map();
          for (const i of indices) for (const fam of lista[i][1]) contagem.set(fam, (contagem.get(fam) || 0) + 1);
          for (const i of indices) {
            vistos.add(i);
            for (const fam of lista[i][1]) if (contagem.get(fam) > 1) emDisputa.add(i + '|' + fam);
          }
        }
        return { emDisputa: [...emDisputa], vistos: [...vistos] };
      }, carga);
      for (const chave of achado.emDisputa) {
        const [i, fam] = chave.split('|');
        disputadas.set(todas[+i].alvo + '|' + fam, true);
      }
      for (const i of achado.vistos) semEvidencia.delete(todas[i].alvo);
      process.stdout.write('  ' + screen.name + ': ' + achado.vistos.length + ' regras alcancam algo\n');
    } catch (e) {
      process.stdout.write('  ' + screen.name + ': FALHOU - ' + e.message + '\n');
      process.exitCode = 1;
    }
    await context.close();
  }
  await browser.close();

  /* ── VETO ESTATICO ────────────────────────────────────────────────────────
     O runtime ve as telas de `SCREENS`, e o app tem mais estados que isso. Uma regra pode
     alcancar um elemento numa tela capturada SEM adversario e alcancar outro
     elemento, no Pix ou na tela de erro, ONDE o adversario existe — e ai o
     runtime diz "sem adversario" para uma disputa que so nao foi aberta na
     frente dele.
     Entao, alem da evidencia de tela, exige-se que nenhuma OUTRA regra, em
     folha nenhuma, declare a mesma familia de propriedade com um seletor que
     compartilhe pelo menos um token (classe ou id) com esta. E grosseiro de
     proposito: ele veta demais, e vetar demais custa um `!important` que
     continua onde esta — enquanto vetar de menos custa um pixel que muda numa
     tela que ninguem abriu. */
  const porToken = new Map();
  for (const f of arquivos) {
    for (const r of parseCss(readFileSync(join(STYLES, f), 'utf8'), f)) {
      if (r.atRule || !r.body.trim()) continue;
      const fams = new Set(declaracoes(r.body).map(d => FAMILIA(d.prop)));
      const toks = [...(r.selector.replace(/\[[^\]]*\]/g, ' ').matchAll(/[.#](-?[_a-zA-Z][\w-]*)/g))].map(m => m[1]);
      for (const t of new Set(toks)) {
        if (!porToken.has(t)) porToken.set(t, new Map());
        const m = porToken.get(t);
        for (const fam of fams) {
          if (!m.has(fam)) m.set(fam, []);
          m.get(fam).push(f + ':' + r.line);
        }
      }
    }
  }
  const vetado = (r, fam) => {
    const toks = new Set([...(r.selector.replace(/\[[^\]]*\]/g, ' ').matchAll(/[.#](-?[_a-zA-Z][\w-]*)/g))].map(m => m[1]));
    const eu = r.file + ':' + r.line;
    for (const t of toks) {
      const donos = porToken.get(t)?.get(fam);
      if (donos && donos.some(d => d !== eu)) return true;
    }
    return false;
  };

  const saida = [];
  let semAdversario = 0, comAdversario = 0, sem = 0, porVeto = 0, porTeste = 0;
  for (const r of rules) {
    const props = [];
    for (const d of r.decls) {
      if (!d.important) continue;
      const fam = FAMILIA(d.prop);
      if (!r.alvo || semEvidencia.has(r.alvo)) { props.push({ prop: d.prop, veredito: 'sem-evidencia' }); sem++; continue; }
      if (disputadas.has(r.alvo + '|' + fam)) { props.push({ prop: d.prop, veredito: 'tem-adversario' }); comAdversario++; continue; }
      if (afirmadoPorTeste(d.prop)) { props.push({ prop: d.prop, veredito: 'vetado-por-teste' }); porTeste++; continue; }
      if (vetado(r, fam)) { props.push({ prop: d.prop, veredito: 'vetado-estatico' }); porVeto++; continue; }
      props.push({ prop: d.prop, veredito: 'sem-adversario' }); semAdversario++;
    }
    saida.push({ file: r.file, line: r.line, selector: r.selector, inicio: r.inicio, fim: r.fim, props });
  }
  console.log('\ndeclaracoes com !important:');
  console.log('  tem adversario (o marcador decide algo): ' + comAdversario);
  console.log('  vetado pelo criterio estatico:           ' + porVeto);
  console.log('  vetado por um TESTE que exige o texto:   ' + porTeste);
  console.log('  SEM adversario (o marcador nao decide):  ' + semAdversario);
  console.log('  sem evidencia (regra nao vista em tela): ' + sem);

  const por = new Map();
  for (const r of saida) {
    const a = por.get(r.file) || { semAdv: 0, comAdv: 0, sem: 0 };
    for (const p of r.props) {
      if (p.veredito === 'sem-adversario') a.semAdv++;
      else if (p.veredito === 'sem-evidencia') a.sem++;
      else a.comAdv++;
    }
    por.set(r.file, a);
  }
  console.log('\narquivo'.padEnd(23) + 'sem adv'.padStart(9) + 'com/veto'.padStart(10) + 'sem evid'.padStart(10));
  for (const [f, a] of [...por].sort((x, y) => y[1].semAdv - x[1].semAdv)) {
    console.log(f.padEnd(22) + String(a.semAdv).padStart(9) + String(a.comAdv).padStart(10) + String(a.sem).padStart(10));
  }
  if (process.argv.includes('--json')) {
    writeFileSync(join(ROOT, 'css-important.json'), JSON.stringify(saida, null, 1));
    console.log('\nescrito: css-important.json');
  }
}

await main();
