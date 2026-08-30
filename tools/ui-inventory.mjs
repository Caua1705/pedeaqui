// ============================================================================
//  Quantos cabecalhos e quantos botoes DIFERENTES este app tem de verdade.
//
//  POR QUE ISTO EXISTE
//
//  Contar classes no CSS responde a pergunta errada. `.cart-hdr` aparece em
//  seis regras espalhadas por quatro folhas, cada uma com um pedaco do valor
//  final, e nenhuma delas sozinha diz como o cabecalho FICA. Somar as regras da
//  um numero grande e inutil; e o numero que faz alguem "unificar" duas coisas
//  que ja eram iguais e deixar passar duas que nao eram.
//
//  A pergunta certa e sobre o resultado: abertas as telas, quantos conjuntos
//  DISTINTOS de valores computados existem? Dois cabecalhos com o mesmo
//  conjunto sao o mesmo componente escrito duas vezes — juntar os dois nao move
//  um pixel. Dois com conjuntos diferentes sao uma DECISAO de produto, nao de
//  codigo: alguem tem de olhar e dizer qual fica.
//
//  Esta ferramenta so mede e separa os dois casos. Ela nao unifica nada.
//
//  USO
//    npm run build && npm run preview &
//    node tools/ui-inventory.mjs            # tabela no terminal
//    node tools/ui-inventory.mjs --json     # ui-inventory.json com tudo
// ============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENS, prepararTela } from './capture-screens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* As propriedades que definem "que componente e este". Fica de fora tudo que e
   posicao no fluxo (margin, width em %, top/left): dois botoes iguais em telas
   diferentes tem margens diferentes por serem de telas diferentes, e incluir
   isso separaria em grupos distintos duas copias do MESMO botao. */
const FORMA = [
  'display', 'gridTemplateColumns', 'alignItems', 'justifyContent',
  'height', 'minHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'backgroundColor', 'color',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderBottomColor', 'borderTopStyle', 'borderRadius',
  'fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'textTransform',
  'boxShadow'
];

/* Cabecalho de tela: o elemento que segura o titulo e o botao de voltar no topo
   de uma tela cheia. Reconhecido pela classe, porque nao ha um <header> so.
   Botao: o que o usuario toca. Reconhecido pela TAG, nao pela classe — a
   pergunta e sobre o que existe na tela, e uma lista de classes de botao seria
   a mesma lista que se quer descobrir. */
const COLETA = `(() => {
  const forma = FORMA_PLACEHOLDER;
  const ler = (el) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of forma) o[p] = cs[p];
    return o;
  };
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const saida = { cabecalhos: [], botoes: [] };
  for (const el of document.querySelectorAll('*')) {
    const cls = el.getAttribute('class') || '';
    if (/(^|\\s)[\\w-]*(hdr|header)(\\s|$|-)/.test(cls) && !/(title|back|btn|sub|dot|icon|spacer|mascot|status|menu-item)/.test(cls)) {
      saida.cabecalhos.push({ cls, id: el.id || '', visivel: visivel(el), style: ler(el) });
    }
    if (el.tagName === 'BUTTON' || (el.tagName === 'A' && /btn|cta|submit|confirm/i.test(cls))) {
      saida.botoes.push({ cls, id: el.id || '', tag: el.tagName, texto: (el.textContent || '').trim().slice(0, 28), visivel: visivel(el), style: ler(el) });
    }
  }
  return saida;
})()`;

const chave = (s) => FORMA.map(p => s[p]).join('|');

async function main() {
  const browser = await chromium.launch();
  const cabecalhos = new Map();
  const botoes = new Map();
  const registrar = (mapa, tela, item) => {
    const k = chave(item.style);
    const g = mapa.get(k) || { style: item.style, membros: [] };
    g.membros.push({ tela, cls: item.cls, id: item.id, texto: item.texto, visivel: item.visivel });
    mapa.set(k, g);
  };

  for (const screen of SCREENS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await prepararTela(page, screen);
    try {
      await screen.go(page);
      await page.waitForTimeout(600);
      const r = await page.evaluate(COLETA.replace('FORMA_PLACEHOLDER', JSON.stringify(FORMA)));
      r.cabecalhos.forEach(c => registrar(cabecalhos, screen.name, c));
      r.botoes.forEach(b => registrar(botoes, screen.name, b));
      process.stdout.write('  ' + screen.name + ': ' + r.cabecalhos.length + ' cabecalhos, ' + r.botoes.length + ' botoes\n');
    } catch (e) {
      // Tela que nao abre e uma tela a menos na conta, e uma conta com um buraco
      // silencioso vira uma "unificacao segura" que quebra a tela que faltou.
      process.stdout.write('  ' + screen.name + ': FALHOU - ' + e.message + '\n');
      process.exitCode = 1;
    }
    await context.close();
  }
  await browser.close();

  const relatar = (titulo, mapa) => {
    const grupos = [...mapa.values()].sort((a, b) => b.membros.length - a.membros.length);
    const nomes = new Set();
    for (const g of grupos) for (const m of g.membros) nomes.add(m.cls);
    console.log('\n=== ' + titulo + ' ===');
    console.log('classes distintas: ' + nomes.size + ' | FORMAS distintas: ' + grupos.length);
    grupos.forEach((g, i) => {
      const classes = [...new Set(g.membros.map(m => m.cls))];
      console.log('\n[' + (i + 1) + '] ' + g.membros.length + ' ocorrencias, ' + classes.length + ' classe(s)');
      console.log('    ' + g.style.height + ' / pad ' + g.style.paddingTop + ' ' + g.style.paddingRight +
        ' / bg ' + g.style.backgroundColor + ' / raio ' + g.style.borderRadius +
        ' / borda ' + g.style.borderBottomWidth + ' ' + g.style.borderBottomColor +
        ' / ' + g.style.fontSize + ' ' + g.style.fontWeight);
      classes.slice(0, 8).forEach(c => console.log('      . ' + (c || '(sem classe)')));
      if (classes.length > 8) console.log('      ... e mais ' + (classes.length - 8));
    });
    return grupos;
  };

  const gc = relatar('CABECALHOS DE TELA', cabecalhos);
  const gb = relatar('BOTOES', botoes);
  if (process.argv.includes('--json')) {
    writeFileSync(join(ROOT, 'ui-inventory.json'), JSON.stringify({ cabecalhos: gc, botoes: gb }, null, 1));
    console.log('\nescrito: ui-inventory.json');
  }
}

await main();
