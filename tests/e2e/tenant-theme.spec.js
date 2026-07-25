import { test, expect } from '@playwright/test';
import { mockApi, MENU, SLUG } from './helpers.js';

// Fase 4, bloco A: a trava do white-label.
//
// Antes desta fase o tema NÃO chegava na interface — ~250 cores de marca
// chumbadas no CSS (86 delas sob !important) venciam as custom properties que
// applyTheme() escrevia. Na prática, qualquer restaurante novo nascia
// parcialmente laranja do Júnior da Picanha, o que travava comercialmente o
// cadastro do segundo restaurante.
//
// Estes testes falham se essa regressão voltar.

const PILOT_PRIMARY = 'rgb(217, 92, 4)'; // #D95C04, o que o piloto cadastrou
const BLUE = '#1B4FD8';

// Superfícies que o lojista reconhece como "a minha marca na tela" — uma de
// cada área citada no escopo da fase.
const BRAND_SURFACES = [
  ['CTA da home', 'button.home-order-cta', 'backgroundColor'],
  ['botão da sacola', '#cartStickyBtn', 'backgroundColor'],
  ['CTA do carrinho', 'button.cart-cta-btn', 'backgroundColor'],
  ['botão primário', 'button.btn-primary', 'backgroundColor'],
  ['ícone da aba ativa', '.mob-nav-item.active .nav-icon svg', 'color'],
  ['aba do carrinho ativa', 'button.cart-tab.active', 'color'],
  ['preço do produto', 'div.pm-price', 'color'],
  ['controle de quantidade', 'button.qty-btn', 'color'],
  ['chip de benefício', 'button.cart-benefit-action', 'color'],
  ['cupom', 'button.coupon-detail-use', 'backgroundColor'],
  ['perfil', 'button.profile-login-btn', 'backgroundColor'],
  ['ação secundária do login', 'button.login-secondary', 'color']
];

/** Boota o app com a cor de marca pedida e devolve a página pronta. */
async function bootWithPrimary(page, primaryColor) {
  await mockApi(page);
  if (primaryColor) {
    const menu = JSON.parse(JSON.stringify(MENU));
    menu.restaurant.primary_color = primaryColor;
    // Registrada DEPOIS de mockApi: o Playwright consulta a rota mais recente
    // primeiro, então é esta que responde /menu.
    await page.route('**/api.pederapidex.com/**', async (route) => {
      if (/\/menu(\?|$)/.test(route.request().url())) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(menu)
        });
      }
      return route.fallback();
    });
  }
  await page.goto(`/restaurant.html?slug=${SLUG}`);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  return page;
}

const brandPrimary = (page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim());

/** Cor efetiva de cada superfície de marca. */
async function surfaceColors(page) {
  return page.evaluate((surfaces) => {
    const out = {};
    for (const [label, selector, prop] of surfaces) {
      const el = document.querySelector(selector);
      out[label] = el ? getComputedStyle(el)[prop] : null;
    }
    return out;
  }, BRAND_SURFACES);
}

test('o piloto renderiza a cor que cadastrou, não a cor chumbada no CSS', async ({ page }) => {
  await bootWithPrimary(page, null);

  expect(await brandPrimary(page)).toBe('#D95C04');

  const colors = await surfaceColors(page);
  for (const [label] of BRAND_SURFACES) {
    expect(colors[label], `${label} não renderizou`).not.toBeNull();
    expect(colors[label], label).toBe(PILOT_PRIMARY);
  }
});

test('trocar a cor do tenant repinta a interface inteira', async ({ page }) => {
  await bootWithPrimary(page, BLUE);

  expect(await brandPrimary(page)).toBe(BLUE);

  const colors = await surfaceColors(page);
  for (const [label] of BRAND_SURFACES) {
    expect(colors[label], `${label} não renderizou`).not.toBeNull();
    // A prova: nenhuma superfície de marca ficou com a cor do piloto.
    expect(colors[label], `${label} continuou com a cor do piloto`).not.toBe(PILOT_PRIMARY);
    expect(colors[label], label).toBe('rgb(27, 79, 216)');
  }
});

test('nenhuma cor de marca chumbada sobrevive num tenant azul', async ({ page }) => {
  await bootWithPrimary(page, BLUE);

  // O que continua legitimamente laranja/amarelo num tenant azul, e por quê.
  // Qualquer coisa FORA desta lista é cor de marca chumbada voltando.
  const ALLOWED = [
    '.pay-brand', // bandeiras de cartão (Visa, Master, Elo): marca de terceiro
    '.g-yellow', // "powered by Google" do autocomplete de endereço
    '.coupon-art', // número do desconto, acento amarelo fixo do cupom
    '.highlight-banner' // superfície bege neutra do banner sem imagem
  ];

  const leaks = await page.evaluate((allowed) => {
    const hue = (value) => {
      const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      if (!m) return null;
      const [r, g, b, a] = [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] === undefined ? 1 : +m[4]];
      if (a < 0.06) return null;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const l = (max + min) / 2;
      if (!d) return null;
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
    };
    const isOrange = (value) => {
      const c = hue(value);
      return !!c && c.h >= 8 && c.h <= 50 && c.s >= 25 && c.l <= 97;
    };
    const describe = (el) => el.tagName.toLowerCase() +
      (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '');

    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (allowed.some(sel => el.closest(sel))) continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'fill', 'stroke']) {
        if (isOrange(cs[prop])) out.push(`${describe(el)} { ${prop}: ${cs[prop]} }`);
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        for (const m of cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) {
          if (isOrange(m[0])) out.push(`${describe(el)} { background-image: ${m[0]} }`);
        }
      }
    }
    return [...new Set(out)];
  }, ALLOWED);

  expect(leaks, `cor de marca chumbada encontrada:\n${leaks.join('\n')}`).toEqual([]);
});

test('a tinta do rótulo sobre a marca é calculada, não fixa em branco', async ({ page }) => {
  // Marca clara: com #fff fixo o rótulo do botão seria ilegível.
  await bootWithPrimary(page, '#FFD400');

  const { onBrand, ctaColor } = await page.evaluate(() => ({
    onBrand: getComputedStyle(document.documentElement).getPropertyValue('--brand-on').trim(),
    ctaColor: getComputedStyle(document.querySelector('button.home-order-cta')).color
  }));

  expect(onBrand).toBe('#1A1A1A');
  expect(ctaColor).toBe('rgb(26, 26, 26)');
});
