import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles');

// Comentários são descartados: as notas que explicam POR QUE o prefixo não
// pode voltar citam o nome da propriedade, e não podem disparar o próprio teste.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const cssFiles = () =>
  readdirSync(STYLES)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [f, stripComments(readFileSync(resolve(STYLES, f), 'utf8'))]);

// Escrever `backdrop-filter` seguido do gêmeo `-webkit-backdrop-filter` — a
// ordem convencional — fazia o minificador do build APAGAR a propriedade padrão
// e manter só a prefixada, que o Chrome atual não reconhece mais. O efeito era
// invisível no CSS-fonte e no dev server, e só aparecia no bundle: todos os
// overlays voltavam a herdar o blur(4px) de `.overlay`, desfocando o app
// inteiro enquanto os modais por cima continuavam nítidos.
//
// O esbuild já emite o prefixo sozinho (verificado no bundle: 14 pares
// -webkit-/padrão a partir de 14 declarações padrão no source), então escrever
// o prefixo à mão não acrescenta nada e só reintroduz o bug.
//
// tests/e2e/overlay-blur.spec.js trava o comportamento no bundle; este teste
// trava a causa no source e falha em segundos, sem precisar buildar.
describe('prefixos -webkit- escritos à mão no CSS', () => {
  it('nenhum arquivo declara -webkit-backdrop-filter', () => {
    const offenders = cssFiles()
      .filter(([, css]) => /-webkit-backdrop-filter/.test(css))
      .map(([name, css]) => `${name} (${css.match(/-webkit-backdrop-filter/g).length}x)`);

    expect(offenders).toEqual([]);
  });

  it('toda regra com backdrop-filter usa a propriedade padrão', () => {
    const declared = cssFiles().reduce(
      (n, [, css]) => n + (css.match(/(^|[;{\s])backdrop-filter\s*:/gm) || []).length,
      0
    );
    // Sanidade: se alguém apagar as declarações em vez de corrigi-las, o teste
    // acima passaria vazio sem que o contrato existisse mais.
    expect(declared).toBeGreaterThan(10);
  });
});
