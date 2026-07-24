// Derivação do tema do tenant — FONTE ÚNICA.
//
// O lojista cadastra UMA cor (primary_color) e, opcionalmente, uma secundária.
// Todo o resto — hover, estado ativo, tom claro de fundo, borda, cor do texto
// sobre a marca — é DERIVADO aqui, em runtime. Nada disso vai para o banco:
// pedir seis cores ao lojista é como se perde o cadastro do segundo restaurante.
//
// As funções são puras e recebem/devolvem strings, então dá para testá-las sem
// browser (tests/unit/brand-theme.test.js). Quem escreve no DOM é applyBrandTheme().
(function () {
  // Cor da PLATAFORMA. Só entra quando a API não mandou cor, ou mandou lixo.
  const PLATFORM_PRIMARY = '#F36F21';
  const PLATFORM_SECONDARY = '#111111';

  // Tinta escura usada como texto sobre marcas claras (amarelo, bege, lima).
  // Não é preto puro: preto sobre amarelo saturado vibra demais.
  const INK = '#1A1A1A';
  const PAPER = '#FFFFFF';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value) => Math.round(value * 100) / 100;

  // Aceita #rgb e #rrggbb (com ou sem #). Qualquer outra coisa devolve null —
  // o chamador decide o fallback, este módulo nunca inventa uma cor.
  function parseHex(value) {
    const raw = String(value ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      const [r, g, b] = raw.split('');
      return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
    }
    if (/^[0-9a-f]{6}$/i.test(raw)) {
      return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16)
      };
    }
    return null;
  }

  function normalizeHex(value, fallback = PLATFORM_PRIMARY) {
    const rgb = parseHex(value);
    return rgb ? rgbToHex(rgb) : fallback;
  }

  const toHexPair = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const rgbToHex = ({ r, g, b }) => `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`.toUpperCase();

  function rgbToHsl({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const l = (max + min) / 2;
    if (delta === 0) return { h: 0, s: 0, l: l * 100 };
    const s = delta / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h: round(h), s: round(s * 100), l: round(l * 100) };
  }

  function hslToRgb({ h, s, l }) {
    const sn = clamp(s, 0, 100) / 100;
    const ln = clamp(l, 0, 100) / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] =
      hp < 1 ? [c, x, 0] :
      hp < 2 ? [x, c, 0] :
      hp < 3 ? [0, c, x] :
      hp < 4 ? [0, x, c] :
      hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = ln - c / 2;
    return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
  }

  const hexToHsl = (hex) => rgbToHsl(parseHex(hex));
  const hslToHex = (hsl) => rgbToHex(hslToRgb(hsl));

  // Luminância relativa WCAG 2.1.
  function relativeLuminance(rgb) {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  function contrastRatio(hexA, hexB) {
    const a = relativeLuminance(parseHex(hexA));
    const b = relativeLuminance(parseHex(hexB));
    const [light, dark] = a >= b ? [a, b] : [b, a];
    return round((light + 0.05) / (dark + 0.05));
  }

  // Piso de legibilidade do rótulo sobre a marca. 3:1 é o mínimo AA para texto
  // grande/negrito e para componentes de interface — que é o que vive sobre a
  // cor de marca aqui (rótulo de botão, chip, aba ativa), nunca texto corrido.
  const ON_BRAND_MIN_CONTRAST = 3;

  // A3 — guarda de contraste. A cor do texto/ícone sobre a marca NUNCA é fixa.
  //
  // A regra não é "pegue o maior contraste": isso jogaria tinta escura em cima
  // de qualquer laranja médio e mudaria a cara de toda marca saturada. A regra
  // é: o branco é o padrão da plataforma e permanece ENQUANTO for legível; se a
  // marca for clara demais para sustentá-lo (amarelo, lima, bege), a tinta
  // escura entra. É o que impede o botão "branco no amarelo".
  function onBrandColor(primaryHex) {
    const onPaper = contrastRatio(primaryHex, PAPER);
    if (onPaper >= ON_BRAND_MIN_CONTRAST) return PAPER;
    // Branco reprovou. Só troca se a tinta escura for de fato melhor — para uma
    // marca cinza-médio nenhuma das duas é ótima, e aí vale a mais contrastada.
    return contrastRatio(primaryHex, INK) > onPaper ? INK : PAPER;
  }

  // Escurecer é o gesto natural de hover/press, MAS uma marca já quase preta não
  // tem para onde escurecer — nesse caso o estado se marca clareando.
  function stateShift(hsl, amount) {
    const goesLighter = hsl.l < 24;
    return clamp(goesLighter ? hsl.l + amount * 1.25 : hsl.l - amount, 4, 96);
  }

  /**
   * Deriva a paleta inteira a partir de UMA cor.
   *
   * Os tons de fundo (tint/surface/border) fixam a luminosidade e carregam só
   * matiz e saturação da marca. É o que torna a derivação robusta a qualquer
   * hex: um wash de fundo continua sendo um wash claro tanto para um vermelho
   * escuro quanto para um amarelo, em vez de virar um bloco chapado.
   */
  function deriveBrandPalette(primaryInput, secondaryInput) {
    const primary = normalizeHex(primaryInput, PLATFORM_PRIMARY);
    const secondary = normalizeHex(secondaryInput, PLATFORM_SECONDARY);
    const hsl = hexToHsl(primary);
    const rgb = parseHex(primary);
    // Saturação teto nos tons claros: um wash com 100% de saturação fica ácido.
    const softS = Math.min(hsl.s, 85);
    const on = onBrandColor(primary);

    return {
      '--brand-primary': primary,
      // Componentes cruas para rgba(var(--brand-primary-rgb), .12) no CSS —
      // suporta alpha sem depender de color-mix.
      '--brand-primary-rgb': `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`,
      '--brand-hover': hslToHex({ ...hsl, l: stateShift(hsl, 8) }),
      '--brand-active': hslToHex({ ...hsl, l: stateShift(hsl, 16) }),
      // Parceira de gradiente: um passo mais clara e levemente mais quente.
      '--brand-light': hslToHex({ h: hsl.h + 6, s: softS, l: clamp(hsl.l + 11, 24, 92) }),
      '--brand-tint': hslToHex({ h: hsl.h, s: softS, l: 96 }),
      '--brand-surface': hslToHex({ h: hsl.h, s: softS, l: 93 }),
      '--brand-tint-strong': hslToHex({ h: hsl.h, s: softS, l: 90 }),
      '--brand-border': hslToHex({ h: hsl.h, s: Math.min(hsl.s, 70), l: 78 }),
      '--brand-on': on,
      // Texto secundário sobre a marca (subtítulo dentro de um bloco chapado).
      '--brand-on-soft': on === PAPER ? 'rgba(255,255,255,.78)' : 'rgba(26,26,26,.66)',
      '--brand-glow': `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, .28)`,
      '--brand-secondary': secondary
    };
  }

  // Nomes que o CSS legado já consumia. Ficam como alias da paleta derivada —
  // remover os call-sites um a um em 700 KB de CSS seria churn sem ganho.
  function legacyAliases(palette) {
    return {
      '--brand': palette['--brand-primary'],
      '--brand-accent': palette['--brand-primary'],
      // Era "brand-dark". applyTheme() apontava --brand-d para a cor SECUNDÁRIA,
      // o que pintava de preto o gradiente dos cupons; agora é o tom escuro real.
      '--brand-d': palette['--brand-active'],
      '--m-accent': palette['--brand-primary'],
      '--m-accent-light': palette['--brand-tint'],
      '--m-red': palette['--brand-primary'],
      '--primary-orange': palette['--brand-primary'],
      '--op-orange': palette['--brand-primary'],
      '--op-orange-soft': palette['--brand-tint-strong'],
      '--op-orange-tint': palette['--brand-tint']
    };
  }

  function brandThemeVariables(primaryInput, secondaryInput) {
    const palette = deriveBrandPalette(primaryInput, secondaryInput);
    return { ...palette, ...legacyAliases(palette) };
  }

  /**
   * Escreve o tema no elemento (documentElement por padrão).
   * Devolve o mapa aplicado — os testes conferem o que foi escrito.
   */
  function applyBrandTheme(primaryInput, secondaryInput, target) {
    const variables = brandThemeVariables(primaryInput, secondaryInput);
    const element = target || document.documentElement;
    for (const [name, value] of Object.entries(variables)) {
      element.style.setProperty(name, value);
    }
    return variables;
  }

  window.RapidexTheme = {
    PLATFORM_PRIMARY,
    PLATFORM_SECONDARY,
    ON_BRAND_MIN_CONTRAST,
    parseHex,
    normalizeHex,
    rgbToHex,
    hexToHsl,
    hslToHex,
    relativeLuminance,
    contrastRatio,
    onBrandColor,
    deriveBrandPalette,
    brandThemeVariables,
    applyBrandTheme
  };
})();
