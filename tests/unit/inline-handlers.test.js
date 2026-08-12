import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Comentários saem: as notas que explicam POR QUE o handler inline não pode
// voltar citam `onclick` e disparariam o próprio teste.
const stripJsComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const jsSources = () =>
  walk(resolve(ROOT, 'scripts'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [relative(ROOT, f), stripJsComments(readFileSync(f, 'utf8'))]);

const htmlSources = () =>
  ['index.html', 'restaurant.html', 'public/privacidade/index.html'].map((f) => [
    f,
    stripHtmlComments(readFileSync(resolve(ROOT, f), 'utf8'))
  ]);

// A CSP de produção (vercel.json) roda `script-src 'self'` — sem 'unsafe-inline'
// e sem 'unsafe-hashes'. Sob ela um handler em atributo (onclick="...") NÃO é
// compilado: o controle fica morto na tela e o navegador ainda emite um
// relatório de violação. Por isso o app inteiro migrou para delegação via
// data-act-* (ver scripts/utils/actions.js), que resolve a função pelo NOME num
// registro — sem eval, sem new Function.
//
// O grep no HTML pegava os 269 atributos originais, mas não pega o caso que
// sobreviveu: `element.setAttribute('onclick', ...)` em código que monta markup
// em RUNTIME. E o e2e sob CSP (tests/e2e/csp.spec.js) só enxerga as telas que
// consegue abrir — a tela do Clube não é uma delas, e foi exatamente lá que um
// onclick inline ficou parado sem ninguém notar.
//
// Este teste fecha os dois furos no SOURCE: falha em segundos, sem build e sem
// depender de navegar até a tela onde o markup nasce.
describe('handlers inline (bloqueados pela CSP)', () => {
  it('nenhum script chama setAttribute com um evento on*', () => {
    const offenders = jsSources().flatMap(([name, source]) =>
      (source.match(/setAttribute\s*\(\s*(['"`])on\w+\1/g) || []).map(
        (hit) => `${name}: ${hit}`
      )
    );

    expect(offenders).toEqual([]);
  });

  it('nenhum HTML declara um atributo on*', () => {
    const offenders = htmlSources().flatMap(([name, html]) =>
      (html.match(/\son(?:click|error|load|focus|blur|change|input|submit|keydown|keyup|mouse\w+)\s*=/gi) || []).map(
        (hit) => `${name}: ${hit.trim()}`
      )
    );

    expect(offenders).toEqual([]);
  });

  it('a delegação por data-act-* continua sendo o caminho usado', () => {
    // Sanidade: se alguém trocar a delegação por outra coisa, os testes acima
    // passariam vazios sem que o contrato existisse mais. O grosso mora no
    // markup estático; o JS entra com os helpers act()/actAll() e os poucos
    // data-act-* escritos por extenso.
    const total = [...htmlSources(), ...jsSources()].reduce(
      (n, [, source]) => n + (source.match(/data-act-/g) || []).length,
      0
    );
    expect(total).toBeGreaterThan(100);
  });
});
