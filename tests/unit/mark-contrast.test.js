import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(resolve(root, 'styles', 'assistant.css'), 'utf8');
const JS = readFileSync(resolve(root, 'scripts', 'pages', 'restaurant-assistant.js'), 'utf8');

const markup = () => JS.match(/function markMarkup[\s\S]*?\n {2}\}/)?.[0] ?? '';

// TODOS os blocos deste seletor, juntos. Um seletor só é dono das declarações
// dele quando se lê o arquivo inteiro: `.assistant-mark__orb` aparece duas
// vezes — na regra de FORMA que ele divide com o halo e na regra de PINTURA que
// é só dele. Ler só a primeira devolvia a forma e afirmava sobre a cor que não
// estava ali; foi assim que a primeira versão deste teste falhou.
const regra = (seletor) => {
  const escapado = seletor.replace(/[.]/g, '\\.');
  return (CSS.match(new RegExp(`\\n${escapado}\\{[\\s\\S]*?\\n\\}`, 'g')) ?? []).join('\n');
};

// A marca do assistente era um balão de conversa com uma CLOCHE dentro. Em
// 54px, um domo com a linha embaixo e dois riscos de vapor em cima lia como
// SINO — notificação, não assistente. Virou a esfera do modo voz, na medida da
// marca. Estes testes guardam as três coisas que a troca não pode perder: a cor
// é do lojista, o ritmo diz o estado, e quem pediu movimento reduzido não vê
// movimento nenhum.
describe('marca conversacional white-label', () => {
  it('o markup nao carrega cor nenhuma: o desenho inteiro mora no CSS', () => {
    const m = markup();

    expect(m).toContain('assistant-mark__orb');
    expect(m).toContain('assistant-mark__halo');
    // Sem <defs>, então sem id global de gradiente — era a única razão de o
    // arquivo manter um contador de instância para a marca.
    expect(m, 'o desenho voltou para dentro do markup').not.toMatch(/<svg|<img|<canvas|<filter/i);
    expect(m, 'o icone ganhou uma cor fixa').not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(m, 'cor no markup: ela pertence ao CSS, onde o tema alcança')
      .not.toMatch(/rgba?\(|stop-color|var\(--brand/);
  });

  it('a esfera se pinta com as tintas ja medidas contra o branco', () => {
    const orb = regra('.assistant-mark__orb');

    // Esfera, não quadrado com cantos: as duas camadas dividem a mesma regra de
    // forma, e é ela que faz o desenho ser redondo.
    expect(CSS, 'a esfera deixou de ser redonda').toMatch(
      /\.assistant-mark__halo,\n\.assistant-mark__orb\{[\s\S]*?border-radius:50%/
    );
    // As duas paradas são markInkColors (brand-theme.js): a primária escurecida
    // até 3:1 contra o branco desta tela, e ela mesma um degrau de luminosidade
    // abaixo. A segunda tonalidade é DERIVADA da primeira, nunca escrita.
    expect(orb).toContain('var(--brand-mark-light)');
    expect(orb).toContain('var(--brand-mark-deep)');
    expect(orb, 'a marca voltou à primária crua, sem guarda de contraste')
      .not.toMatch(/linear-gradient\([^)]*var\(--brand-(primary|light)\)/);
    expect(orb, 'a esfera ganhou uma cor fixa').not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(regra('.assistant-mark__halo'), 'o halo ganhou uma cor fixa')
      .not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('os tres ritmos existem, sao distintos, e o mais lento e o de pensar', () => {
    const dur = (seletor) => {
      const bloco = regra(seletor);
      return Number(bloco.match(/animation-duration:([\d.]+)s/)?.[1] ?? NaN);
    };
    const parado = Number(
      regra('.assistant-mark__orb').match(/animation:assistant-mark-idle ([\d.]+)s/)?.[1] ?? NaN
    );
    const pensando = dur('.assistant-mark.is-thinking .assistant-mark__orb');
    const respondendo = dur('.assistant-mark.is-responding .assistant-mark__orb');

    expect(Number.isFinite(parado) && Number.isFinite(pensando) && Number.isFinite(respondendo),
      'sonda cega: um dos tres ritmos deixou de casar e o teste passaria por vacuidade')
      .toBe(true);
    // Parado é o mais lento de todos (quase estático); entre os dois ativos,
    // pensar é o lento e responder é o rápido — "estou procurando" contra
    // "estou te respondendo agora".
    expect(parado).toBeGreaterThan(pensando);
    expect(pensando).toBeGreaterThan(respondendo);
  });

  it('nenhum ritmo mexe na CAIXA da marca, so no corpo dela', () => {
    const quadros = CSS.match(/@keyframes assistant-mark-[a-z]+\{[\s\S]*?\n\}/g) ?? [];

    expect(quadros.length, 'sonda cega: nenhum @keyframes da marca casou').toBeGreaterThanOrEqual(3);
    for (const q of quadros) {
      // scale É permitido, ao contrário do desenho antigo: lá quem escalava era
      // o <svg>, que ocupa a caixa. Aqui quem escala é um filho absoluto dentro
      // de uma caixa de tamanho fixo, então a esfera cresce sem empurrar o
      // título nem a linha de digitação. O que continua proibido é mexer em
      // propriedade que reflui.
      expect(q, `o ritmo ${q.slice(0, 40)} redimensiona o layout`)
        .not.toMatch(/(width|height|margin|padding|font-size|inset|top|left)\s*:/);
    }
    expect(regra('.assistant-mark'), 'a caixa da marca animou; quem anima é o corpo')
      .not.toMatch(/animation/);
  });

  it('movimento reduzido para a esfera de verdade, e o marcador diz por que', () => {
    const reduced = CSS.match(
      /@media \(prefers-reduced-motion:reduce\)\{\n {2}\.assistant-mark__orb,[\s\S]*?\n\}\n/
    )?.[0] ?? '';

    expect(reduced, 'sonda cega: o bloco de movimento reduzido da marca sumiu').toBeTruthy();
    expect(reduced).toContain('.assistant-mark__orb');
    expect(reduced).toContain('.assistant-mark__halo');
    // O !important não é decoração: os ritmos são ligados por
    // `.assistant-mark.is-thinking .assistant-mark__orb` (0,2,1) e media query
    // não acrescenta especificidade. Sem o marcador, (0,1,0) perde para o
    // estado e a esfera continua pulsando para quem pediu que ela parasse.
    expect(reduced).toContain('animation:none!important');
  });
});
