import { describe, it, expect } from 'vitest';

// Publishes window.RapidexTheme (derivação do tema do tenant).
import '../../scripts/utils/brand-theme.js';

const {
  PLATFORM_PRIMARY,
  ON_BRAND_MIN_CONTRAST,
  parseHex,
  normalizeHex,
  hexToHsl,
  contrastRatio,
  onBrandColor,
  deriveBrandPalette,
  brandThemeVariables,
  applyBrandTheme
} = window.RapidexTheme;

const PILOT = '#D95C04'; // Júnior da Picanha
const BLUE = '#1B4FD8'; // segundo tenant simulado
const YELLOW = '#FFD400'; // marca clara — o caso que quebra texto branco

describe('parse e normalização de hex', () => {
  it('aceita #rgb, #rrggbb e sem #', () => {
    expect(normalizeHex('#f60')).toBe('#FF6600');
    expect(normalizeHex('#D95C04')).toBe('#D95C04');
    expect(normalizeHex('1b4fd8')).toBe('#1B4FD8');
  });

  it('cai no fallback da plataforma quando a cor é inválida ou ausente', () => {
    for (const bad of [null, undefined, '', '   ', 'laranja', '#12', '#1234567', 'rgb(1,2,3)', '#GGGGGG', 42, {}]) {
      expect(normalizeHex(bad, PLATFORM_PRIMARY)).toBe(PLATFORM_PRIMARY);
    }
    expect(parseHex('nao-é-cor')).toBeNull();
  });
});

describe('A2 — a paleta inteira sai de UMA cor', () => {
  it('deriva todos os tons sem pedir nada além da primária', () => {
    const palette = deriveBrandPalette(PILOT);
    expect(palette['--brand-primary']).toBe(PILOT);
    for (const token of [
      '--brand-hover', '--brand-active', '--brand-light',
      '--brand-tint', '--brand-surface', '--brand-tint-strong',
      '--brand-border', '--brand-on', '--brand-glow', '--brand-primary-rgb'
    ]) {
      expect(palette[token], token).toBeTruthy();
    }
  });

  it('mantém o matiz da marca em todos os tons derivados', () => {
    const palette = deriveBrandPalette(BLUE);
    const brandHue = hexToHsl(BLUE).h;
    for (const token of ['--brand-hover', '--brand-active', '--brand-tint', '--brand-surface', '--brand-border']) {
      // ±8° cobre o deslocamento intencional da parceira de gradiente e o
      // arredondamento de ida e volta hsl->rgb->hsl.
      expect(Math.abs(hexToHsl(palette[token]).h - brandHue), token).toBeLessThan(8);
    }
  });

  it('hover e ativo são progressivamente mais escuros que a primária', () => {
    const { '--brand-hover': hover, '--brand-active': active } = deriveBrandPalette(PILOT);
    const base = hexToHsl(PILOT).l;
    expect(hexToHsl(hover).l).toBeLessThan(base);
    expect(hexToHsl(active).l).toBeLessThan(hexToHsl(hover).l);
  });

  it('uma marca quase preta clareia no hover em vez de sumir', () => {
    const palette = deriveBrandPalette('#0B0B0B');
    expect(hexToHsl(palette['--brand-hover']).l).toBeGreaterThan(hexToHsl('#0B0B0B').l);
  });

  it('os tons de fundo continuam claros para qualquer marca', () => {
    for (const hex of [PILOT, BLUE, YELLOW, '#000000', '#0B0B0B', '#7A0000']) {
      const palette = deriveBrandPalette(hex);
      expect(hexToHsl(palette['--brand-tint']).l, hex).toBeGreaterThan(88);
      expect(hexToHsl(palette['--brand-surface']).l, hex).toBeGreaterThan(85);
    }
  });

  it('não quebra em nenhum hex de 6 dígitos', () => {
    for (let i = 0; i < 512; i++) {
      const hex = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      const palette = deriveBrandPalette(hex);
      for (const [token, value] of Object.entries(palette)) {
        if (token.endsWith('-rgb')) {
          expect(value, `${hex} ${token}`).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
        } else if (!value.startsWith('rgba(')) {
          expect(value, `${hex} ${token}`).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });
});

describe('A3 — guarda de contraste sobre a cor de marca', () => {
  it('marca escura mantém texto claro; marca clara demais vira tinta escura', () => {
    // O piloto é a prova de que a guarda não muda o visual de hoje.
    expect(onBrandColor(PILOT)).toBe('#FFFFFF');
    expect(onBrandColor(BLUE)).toBe('#FFFFFF');
    // Os casos que quebrariam a tela com branco fixo.
    expect(onBrandColor(YELLOW)).toBe('#1A1A1A');
    expect(onBrandColor('#FFFFFF')).toBe('#1A1A1A');
    expect(onBrandColor('#B9FF66')).toBe('#1A1A1A');
    expect(onBrandColor('#000000')).toBe('#FFFFFF');
  });

  it(`nenhum hex produz rótulo abaixo de ${ON_BRAND_MIN_CONTRAST}:1`, () => {
    // Varredura determinística do cubo sRGB: nenhuma marca cadastrável pode
    // gerar um botão ilegível.
    let worst = { ratio: Infinity, hex: null };
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
          const ratio = contrastRatio(hex, onBrandColor(hex));
          if (ratio < worst.ratio) worst = { ratio, hex };
        }
      }
    }
    expect(worst.ratio, `pior caso em ${worst.hex}`).toBeGreaterThanOrEqual(ON_BRAND_MIN_CONTRAST);
  });

  it('quando o branco reprova, a tinta escolhida é a de maior contraste', () => {
    for (const hex of [YELLOW, '#FFFFFF', '#F5F5F5', '#00FF00', '#B9FF66', '#FFC0CB']) {
      const chosen = onBrandColor(hex);
      const other = chosen === '#FFFFFF' ? '#1A1A1A' : '#FFFFFF';
      expect(contrastRatio(hex, chosen), hex).toBeGreaterThanOrEqual(contrastRatio(hex, other));
    }
  });

  it(`--brand-ink cruza ${ON_BRAND_MIN_CONTRAST}:1 no branco para qualquer hex`, () => {
    // A guarda virada do avesso: a marca como TINTA sobre a superfície clara do
    // app. Sem ela, a seta amarela do cartão de sugestão some no fundo branco.
    let worst = { ratio: Infinity, hex: null };
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
          const ratio = contrastRatio(deriveBrandPalette(hex)['--brand-ink'], '#FFFFFF');
          if (ratio < worst.ratio) worst = { ratio, hex };
        }
      }
    }
    expect(worst.ratio, `pior caso em ${worst.hex}`).toBeGreaterThanOrEqual(ON_BRAND_MIN_CONTRAST);
  });

  it('a tinta guarda o matiz da marca e só escurece quem precisa', () => {
    // Um azul escuro já passa: ele tem de sair daqui EXATAMENTE como entrou, ou
    // a guarda estaria repintando marcas que nunca tiveram problema.
    expect(deriveBrandPalette(BLUE)['--brand-ink']).toBe(BLUE);
    // O amarelo não passa e escurece — mas continua amarelo.
    const yellowInk = deriveBrandPalette(YELLOW)['--brand-ink'];
    expect(yellowInk).not.toBe(YELLOW);
    expect(Math.abs(hexToHsl(yellowInk).h - hexToHsl(YELLOW).h)).toBeLessThan(8);
    expect(hexToHsl(yellowInk).l).toBeLessThan(hexToHsl(YELLOW).l);
  });

  it('a cor do piloto ficou MAIS legível do que o laranja chumbado de hoje', () => {
    // #F36F21 é a cor que o CSS chumbava; #D95C04 é a que o piloto cadastrou.
    expect(contrastRatio(PILOT, '#FFFFFF')).toBeGreaterThan(contrastRatio('#F36F21', '#FFFFFF'));
  });
});

describe('A5 — trocar a cor do tenant troca o tema efetivo', () => {
  // Alvo mínimo de DOM: setProperty/getPropertyValue, que é tudo que
  // applyBrandTheme() usa. Evita arrastar jsdom só por isto.
  const fakeElement = () => {
    const store = new Map();
    return {
      store,
      style: {
        setProperty: (name, value) => store.set(name, value),
        getPropertyValue: (name) => store.get(name) ?? ''
      }
    };
  };

  it('o piloto renderiza a SUA cor cadastrada, não a da plataforma', () => {
    const element = fakeElement();
    applyBrandTheme(PILOT, '#111111', element);
    expect(element.style.getPropertyValue('--brand-primary')).toBe(PILOT);
    expect(element.style.getPropertyValue('--brand')).toBe(PILOT);
    expect(element.style.getPropertyValue('--brand-primary')).not.toBe(PLATFORM_PRIMARY);
  });

  it('um segundo tenant azul repinta TODOS os tokens de marca', () => {
    const laranja = fakeElement();
    const azul = fakeElement();
    applyBrandTheme(PILOT, '#111111', laranja);
    applyBrandTheme(BLUE, '#111111', azul);

    const brandTokens = [...laranja.store.keys()].filter(name => name.startsWith('--brand'));
    expect(brandTokens.length).toBeGreaterThan(10);

    // --brand-secondary é a mesma nos dois casos de propósito, e as duas marcas
    // são escuras o bastante para dividirem a mesma tinta de rótulo. Todo o
    // resto TEM que mudar — se não mudar, sobrou cor do piloto na tela do
    // segundo tenant, que é exatamente o bug que trava o cadastro comercial.
    const sharedByDesign = new Set(['--brand-secondary', '--brand-on', '--brand-on-soft']);
    for (const token of brandTokens) {
      if (sharedByDesign.has(token)) continue;
      expect(azul.store.get(token), token).not.toBe(laranja.store.get(token));
    }
  });

  it('todo alias legado do CSS acompanha a troca de cor', () => {
    const azul = brandThemeVariables(BLUE);
    for (const alias of ['--brand', '--brand-accent', '--brand-d', '--m-accent', '--primary-orange', '--op-orange']) {
      expect(azul[alias], alias).not.toBe(PLATFORM_PRIMARY);
    }
    expect(azul['--brand']).toBe(BLUE);
    expect(azul['--primary-orange']).toBe(BLUE);
    expect(azul['--op-orange']).toBe(BLUE);
  });

  it('cor inválida não quebra a tela: cai no tema da plataforma', () => {
    for (const bad of ['não-é-cor', '', null, undefined, '#12345', 'red']) {
      const element = fakeElement();
      expect(() => applyBrandTheme(bad, null, element), String(bad)).not.toThrow();
      expect(element.style.getPropertyValue('--brand-primary'), String(bad)).toBe(PLATFORM_PRIMARY);
      // Mesmo no fallback a guarda de contraste decide a tinta do rótulo —
      // nada de #fff fixo.
      expect(element.style.getPropertyValue('--brand-on')).toBe(onBrandColor(PLATFORM_PRIMARY));
      expect(contrastRatio(PLATFORM_PRIMARY, element.style.getPropertyValue('--brand-on')))
        .toBeGreaterThanOrEqual(ON_BRAND_MIN_CONTRAST);
    }
  });
});
