import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../../scripts/utils/brand-theme.js';

const { MARK_SPARK_MIN_ALPHA } = window.RapidexTheme;

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles', 'assistant.css'),
  'utf8'
);

// O contraste da ponta pequena é calculado no JS para um piso de opacidade
// específico (MARK_SPARK_MIN_ALPHA) e o CSS repete esse número em dois lugares:
// a opacidade de repouso e o quadro `from` do twinkle. São dois arquivos que
// precisam concordar e que nada obriga a andar juntos — baixar o piso no CSS
// invalidaria em silêncio a cor que o JS escolheu, e a marca voltaria a sumir no
// branco sem que nenhum teste de cor percebesse (eles medem a cor SÓLIDA).
describe('o piso de opacidade da ponta pequena', () => {
  // Fecha na chave em coluna 0: um `?\}` simples pararia no fim do primeiro
  // quadro (`from { ... }`) e o teste leria uma opacidade só.
  const blocoTwinkle = CSS.match(/@keyframes mark-twinkle\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

  it('o quadro `from` do twinkle é exatamente o piso calculado no JS', () => {
    const from = blocoTwinkle.match(/from\s*\{[^}]*opacity:\s*([\d.]+)/)?.[1];
    expect(from, 'não achei a opacidade do quadro `from` em mark-twinkle').toBeTruthy();
    expect(Number(from)).toBe(MARK_SPARK_MIN_ALPHA);
  });

  it('nenhum quadro do twinkle desce abaixo do piso', () => {
    const opacidades = [...blocoTwinkle.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(opacidades.length).toBeGreaterThan(1);
    for (const valor of opacidades) {
      expect(valor, `quadro com opacity ${valor} fura o piso`).toBeGreaterThanOrEqual(
        MARK_SPARK_MIN_ALPHA
      );
    }
  });

  it('a opacidade de repouso e a de movimento reduzido também respeitam o piso', () => {
    const semKeyframes = CSS.replace(/@keyframes[\s\S]*?\n\}/g, '');
    const regras = [...semKeyframes.matchAll(/\.assistant-mark__spark\s*\{[^}]*\}/g)].map(
      (m) => m[0]
    );
    expect(regras.length, 'não achei as regras da ponta pequena').toBeGreaterThan(0);

    const opacidades = regras
      .flatMap((r) => [...r.matchAll(/opacity:\s*([\d.]+)/g)])
      .map((m) => Number(m[1]));
    expect(opacidades.length, 'a ponta pequena perdeu a opacidade própria').toBeGreaterThan(0);
    for (const valor of opacidades) {
      expect(valor, `opacity ${valor} fura o piso`).toBeGreaterThanOrEqual(MARK_SPARK_MIN_ALPHA);
    }
  });

  it('a marca não voltou a derivar cor no CSS', () => {
    // color-mix() não sabe medir luminância: foi exatamente por isso que a
    // derivação saiu da folha e foi para markInkColors().
    // Ancorado no início da linha: `.assistant-mark{` sozinho é o bloco do
    // COMPONENTE. Sem a âncora, o match cai na primeira regra descendente
    // (`#mobViewAssistant .assistant-intro-top .assistant-mark`), que só tem
    // margem e passaria no teste sem provar nada.
    const bloco = CSS.match(/^\.assistant-mark\s*\{[^}]*\}/m)?.[0] ?? '';
    expect(bloco).toBeTruthy();
    expect(bloco, 'a marca voltou a derivar cor no CSS').not.toMatch(/color-mix/);
    for (const tinta of ['--brand-mark-light', '--brand-mark-deep', '--brand-mark-spark']) {
      expect(bloco, `a marca deixou de consumir ${tinta}`).toContain(tinta);
    }
  });
});
