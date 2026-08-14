import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(resolve(root, 'styles', 'assistant.css'), 'utf8');
const JS = readFileSync(resolve(root, 'scripts', 'pages', 'restaurant-assistant.js'), 'utf8');

describe('marca conversacional white-label', () => {
  it('usa somente tokens do restaurante no balao e no desenho interno', () => {
    const markup = JS.match(/function markMarkup[\s\S]*?\n {2}\}/)?.[0] ?? '';

    expect(markup).toContain('class="assistant-mark__bubble"');
    expect(markup).toContain('stop-color="var(--brand-light)"');
    expect(markup).toContain('stop-color="var(--brand-primary)"');
    expect(markup).toContain('stroke="var(--brand-on)"');
    expect(markup, 'o icone ganhou uma cor fixa').not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('combina conversa, cloche e vapor em SVG puro', () => {
    const markup = JS.match(/function markMarkup[\s\S]*?\n {2}\}/)?.[0] ?? '';

    expect(markup).toContain('viewBox="0 0 32 32"');
    expect(markup).toContain('assistant-mark__bubble');
    expect(markup).toContain('assistant-mark__cloche');
    expect(markup.match(/assistant-mark__steam/g)).toHaveLength(4);
    expect(markup).not.toContain('assistant-mark__star');
    expect(markup).not.toMatch(/<img|<canvas|<filter/i);
  });

  it('pensando e respondendo possuem ritmos proprios sem alterar escala', () => {
    const thinking = CSS.match(/@keyframes assistant-mark-thinking\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const responding = CSS.match(/@keyframes assistant-mark-responding\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(CSS).toMatch(/\.assistant-mark\.is-thinking \.assistant-mark__bubble/);
    expect(CSS).toMatch(/\.assistant-mark\.is-responding \.assistant-mark__bubble/);
    expect(thinking).toContain('translateY');
    expect(responding).toContain('translateY');
    expect(`${thinking}${responding}`, 'a animacao redimensiona o layout').not.toMatch(/scale\s*\(/);
  });

  it('movimento reduzido desliga balao e vapor sem esconder o simbolo', () => {
    const reduced = CSS.match(/@media \(prefers-reduced-motion:reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(reduced).toContain('.assistant-mark__bubble');
    expect(reduced).toContain('.assistant-mark__steam');
    expect(reduced).toContain('animation:none!important');
    expect(reduced).toMatch(/opacity:\.82!important/);
  });
});
