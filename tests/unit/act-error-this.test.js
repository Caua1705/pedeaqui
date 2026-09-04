import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

// ============================================================================
//  TODO `data-act-error` TEM DE PASSAR `$this`.
//
//  A forma curta (`data-act-error="nome"`) chama `fn.apply(elemento)` **sem
//  argumento nenhum** (`utils/actions.js`): o elemento chega em `this`, não no
//  primeiro parâmetro. Uma função escrita como `fn(img)` recebe `undefined`,
//  sai pelo `?.` ou pelo early-return, e NÃO FAZ NADA — sem erro, sem log, sem
//  sintoma na tela.
//
//  Dois handlers deste app viveram assim desde que nasceram, e ninguém soube:
//
//    couponArtImageFailed   a arte quebrada do cupom nunca foi removida
//    assistantImagePlaceholder   o placeholder do assistente nunca entrou
//
//  Os dois só apareceram em 05/09/2026 porque o recuo de imagem novo nasceu com
//  o MESMO erro e um E2E o cobrou.
//
//  ## POR QUE A REGRA É SÓ PARA `error`, e não para todo `data-act-`
//
//  A varredura da rodada olhou os 122 nomes usados na forma curta e achou 8 que
//  declaram parâmetro. Os 8 estão CERTOS: são trampolins com rest param
//  (`addToCart(...args)`), opções com default (`closePixSheet(id, {animate =
//  true} = {})`) e handlers de clique que perguntam `if (event && event.target
//  !== event.currentTarget)` — onde `undefined` significa "não veio do
//  backdrop", que é o comportamento certo para um botão.
//
//  A diferença de `error` é que o elemento é o OBJETO INTEIRO do handler: um
//  clique acha o alvo pelo DOM ou pelo estado, mas "esta imagem falhou" não tem
//  outro jeito de dizer QUAL. Por isso a regra vale aqui e seria ruído nos
//  outros — um teste que reprovasse os 8 legítimos seria desligado em duas
//  semanas.
//
//  E um teste estático NÃO consegue distinguir "guardado e correto" de
//  "guardado e morto": `couponArtImageFailed` usava `image?.closest(...)`, que
//  parece defensivo e era a própria mortalha. Só a forma da CHAMADA denuncia.
// ============================================================================

const RAIZ = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function arquivos(dir, exts, saida = []) {
  for (const nome of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'test-results', 'playwright-report', 'scratchpad'].includes(nome)) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, exts, saida);
    else if (exts.includes(extname(nome))) saida.push(p);
  }
  return saida;
}

/** Tira comentário PRESERVANDO as quebras: linha relatada errada faz consertar o sítio errado. */
const semComentarios = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (bloco) => bloco.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));

function sitiosDeErro() {
  const fontes = [
    ...arquivos(join(RAIZ, 'scripts'), ['.js']),
    ...readdirSync(RAIZ).filter((f) => f.endsWith('.html')).map((f) => join(RAIZ, f))
  ];
  const todos = [];
  for (const arquivo of fontes) {
    const linhas = semComentarios(readFileSync(arquivo, 'utf8')).split('\n');
    linhas.forEach((linha, i) => {
      // markup literal: data-act-error='...'
      for (const m of linha.matchAll(/data-act-error=(['"])(.*?)\1/g)) {
        todos.push({ onde: `${relative(RAIZ, arquivo)}:${i + 1}`, valor: m[2].trim() });
      }
      // helper do kit: act('error', 'nome' [, ...args])
      for (const m of linha.matchAll(/\bact\(\s*['"]error['"]\s*,\s*(.*?)\)/g)) {
        todos.push({ onde: `${relative(RAIZ, arquivo)}:${i + 1}`, valor: `act:${m[1]}` });
      }
    });
  }
  return todos;
}

describe('data-act-error: o elemento não chega sozinho', () => {
  const sitios = sitiosDeErro();

  // SONDA CONTRA VACUIDADE. Se a varredura parar de casar (mudou o helper, o
  // atributo, a pasta), a lista fica vazia, o filtro fica vazio junto e o teste
  // passa por VACUIDADE — a pior forma de passar.
  it('a varredura ainda encontra os sítios de `error`', () => {
    expect(sitios.length, 'a varredura de data-act-error parou de casar').toBeGreaterThanOrEqual(5);
  });

  // As PSEUDO-AÇÕES (`$hide`, `$stop`, `$prevent`…) ficam de fora, e não por
  // conveniência: elas não passam pelo registro. `runPseudo()` recebe o
  // elemento como PARÂMETRO direto (`case '$hide': element.style.display =
  // 'none'`), então a forma curta é a forma certa para elas — pedir `$this`
  // ali seria pedir um argumento que ninguém lê.
  const ehPseudo = (valor) => /^(?:act:)?\s*['"]?\$/.test(valor);

  it('todo `data-act-error` passa `$this`', () => {
    const semThis = sitios.filter((s) => !ehPseudo(s.valor) && !s.valor.includes('$this'));
    expect(
      semThis.map((s) => `${s.onde}  ->  ${s.valor}`),
      'sítio(s) de `error` na forma curta: o handler vai receber `undefined` e não fazer nada'
    ).toEqual([]);
  });
});
