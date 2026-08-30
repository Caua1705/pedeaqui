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
//  Note que a pergunta nao e "quem ganha". Uma regra que ganharia de qualquer
//  jeito, por especificidade ou por ordem, tambem conta como adversario: ela e
//  a razao pela qual alguem escreveu o `!important`, e tirar o marcador ali
//  muda quem vence. So sai o que nao disputa com ninguem.
//
//  O QUE ESTA MEDIDA NAO ALCANCA
//
//  As 14 telas da captura. Um elemento que so existe no Pix, no cartao ou numa
//  tela de erro nao aparece aqui, e uma regra que nao casou com NADA em tela
//  nenhuma nao produz evidencia — ela e listada como `sem-evidencia` e nao
//  entra na lista de remocao. Nao confunda "nao vi adversario" com "nao ha
//  adversario" para regras que nunca foram medidas.
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
import { SCREENS } from './capture-screens.mjs';
import { mockApi, seedPickupSession } from '../tests/e2e/helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'styles');

/** As propriedades declaradas num corpo de regra, com o marcador de cada uma. */
export function declaracoes(body) {
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

/* `border` e `border-bottom` e `border-bottom-color` disputam o mesmo pixel.
   Comparar so o nome escrito faria `border:0!important` parecer sem adversario
   ao lado de um `border-bottom-color:#eee` — e tirar o marcador mudaria a
   borda. A comparacao e feita pela FAMILIA. */
const FAMILIA = (prop) => {
  const p = prop.replace(/^-(webkit|moz|ms)-/, '');
  if (/^border/.test(p)) return 'border';
  if (/^(margin|padding|inset|top|right|bottom|left)/.test(p)) return p.replace(/-(top|right|bottom|left|block|inline)(-\w+)?$/, '');
  if (/^(background|font|flex|grid|transition|animation|overflow|outline|gap|place|list-style|text-decoration|mask)/.test(p)) return p.split('-')[0];
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
    await mockApi(page);
    await seedPickupSession(page);
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

  const saida = [];
  let semAdversario = 0, comAdversario = 0, sem = 0;
  for (const r of rules) {
    const props = [];
    for (const d of r.decls) {
      if (!d.important) continue;
      const fam = FAMILIA(d.prop);
      if (!r.alvo || semEvidencia.has(r.alvo)) { props.push({ prop: d.prop, veredito: 'sem-evidencia' }); sem++; continue; }
      if (disputadas.has(r.alvo + '|' + fam)) { props.push({ prop: d.prop, veredito: 'tem-adversario' }); comAdversario++; }
      else { props.push({ prop: d.prop, veredito: 'sem-adversario' }); semAdversario++; }
    }
    saida.push({ file: r.file, line: r.line, selector: r.selector, inicio: r.inicio, fim: r.fim, props });
  }
  console.log('\ndeclaracoes com !important:');
  console.log('  tem adversario (o marcador decide algo): ' + comAdversario);
  console.log('  SEM adversario (o marcador nao decide):  ' + semAdversario);
  console.log('  sem evidencia (regra nao vista em tela): ' + sem);

  const por = new Map();
  for (const r of saida) {
    const a = por.get(r.file) || { semAdv: 0, comAdv: 0, sem: 0 };
    for (const p of r.props) {
      if (p.veredito === 'sem-adversario') a.semAdv++;
      else if (p.veredito === 'tem-adversario') a.comAdv++;
      else a.sem++;
    }
    por.set(r.file, a);
  }
  console.log('\narquivo'.padEnd(23) + 'sem adv'.padStart(9) + 'com adv'.padStart(9) + 'sem evid'.padStart(10));
  for (const [f, a] of [...por].sort((x, y) => y[1].semAdv - x[1].semAdv)) {
    console.log(f.padEnd(22) + String(a.semAdv).padStart(9) + String(a.comAdv).padStart(9) + String(a.sem).padStart(10));
  }
  if (process.argv.includes('--json')) {
    writeFileSync(join(ROOT, 'css-important.json'), JSON.stringify(saida, null, 1));
    console.log('\nescrito: css-important.json');
  }
}

await main();
