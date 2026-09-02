import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

// O app inteiro apareceu desfocado em produção enquanto os modais por cima
// ficavam nítidos. A causa não estava no JS: o minificador de CSS do build
// apagava `backdrop-filter:none!important` sempre que a regra vinha seguida do
// gêmeo `-webkit-backdrop-filter` (ver styles/README-backdrop-filter). Sobrava
// só a variante prefixada, que o Chrome atual nem reconhece — então TODOS os
// overlays herdavam o blur(4px) de `.overlay`, inclusive os 14 que o CSS-fonte
// desliga de propósito.
//
// Estes testes rodam contra o BUNDLE (playwright.config.js sobe `vite build`),
// que é o único lugar onde o bug existe: no CSS-fonte a regra está correta.
// Um teste de unidade ou qualquer asserção sobre styles/*.css passaria.

const MOBILE = { width: 390, height: 844 };

// Um elemento conta como "tela cheia" quando cobre praticamente todo o
// viewport: é esse o caso em que um filtro vira uma camada sobre o app todo.
const FULLSCREEN_RATIO = 0.9;

/**
 * Varre o DOM e devolve todo elemento que (a) está realmente sendo pintado,
 * (b) cobre o viewport inteiro e (c) tem filter ou backdrop-filter ativo.
 *
 * `checkVisibility` já resolve display:none, visibility:hidden e opacity:0 —
 * inclusive herdados —, que é exatamente a diferença entre um overlay inerte e
 * um overlay preso.
 */
const collectFullscreenFilters = ({ ratio }) =>
  [...document.querySelectorAll('*')]
    .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id: el.id || null,
        cls: el.className?.toString?.().slice(0, 60) || '',
        filter: cs.filter,
        backdrop: cs.backdropFilter,
        background: cs.backgroundColor,
        coversViewport:
          r.width >= innerWidth * ratio && r.height >= innerHeight * ratio
      };
    })
    .filter(
      (e) =>
        e.coversViewport &&
        ((e.filter && e.filter !== 'none') || (e.backdrop && e.backdrop !== 'none'))
    );

const describeHits = (hits) =>
  hits.map((h) => `#${h.id || '(sem id)'} .${h.cls} → filter:${h.filter} backdrop:${h.backdrop}`);

async function boot(page) {
  await page.setViewportSize(MOBILE);
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
}

test('depois do boot nenhuma camada de tela cheia filtra o app', async ({ page }) => {
  await boot(page);

  const hits = await page.evaluate(collectFullscreenFilters, { ratio: FULLSCREEN_RATIO });
  expect(describeHits(hits), 'blur preso logo após o boot').toEqual([]);
});

test('um overlay só pode desfocar o app se também pintar um scrim visível', async ({ page }) => {
  await boot(page);

  // Uma camada de tela cheia transparente COM backdrop-filter é sempre um bug:
  // ela é invisível e mesmo assim embaça tudo atrás. O blur só se justifica
  // acompanhado do fundo escuro do modal — aí ele é parte do scrim, e some
  // junto com ele quando o modal fecha.
  const offenders = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.overlay')) {
      el.classList.add('active');
      const cs = getComputedStyle(el);
      const backdrop = cs.backdropFilter;
      const bg = cs.backgroundColor;
      // alpha do background: rgba(...) com 4º componente, ou 1 quando opaco.
      const m = bg.match(/^rgba?\(([^)]+)\)$/);
      const parts = m ? m[1].split(',').map((v) => parseFloat(v)) : [];
      const alpha = parts.length === 4 ? parts[3] : parts.length === 3 ? 1 : 0;
      if (backdrop && backdrop !== 'none' && alpha < 0.05) {
        out.push(`#${el.id} → backdrop:${backdrop} sobre fundo ${bg}`);
      }
      el.classList.remove('active');
    }
    return out;
  });

  expect(offenders, 'overlay transparente que mesmo assim desfoca o app').toEqual([]);
});

test('fechar cada overlay não deixa filtro preso na tela', async ({ page }) => {
  await boot(page);

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.overlay')].map((el) => el.id).filter(Boolean)
  );
  expect(ids.length).toBeGreaterThan(5);

  for (const id of ids) {
    const opened = await page.evaluate((modalId) => {
      const ui = window.PedeAquiRestaurantUi;
      if (!ui?.openModal) return false;
      ui.openModal(modalId);
      return document.getElementById(modalId)?.classList.contains('active') === true;
    }, id);
    if (!opened) continue;

    await page.evaluate((modalId) => window.PedeAquiRestaurantUi.closeModalId(modalId), id);
    // closeModalId agenda a liberação do scroll em até 560ms (restaurant-ui.js:220).
    // Aqui havia `waitForTimeout(700)` — 140ms de folga sobre um temporizador do
    // APP, que é o tipo de aposta que a máquina ocupada ganha. A afirmação COM
    // retentativa é a espera por condição: na máquina livre ela fecha na
    // primeira leitura, na ocupada ela espera o quanto precisar. O teto de 2s é
    // explícito para que um blur de fato preso falhe rápido, e não custe o
    // orçamento do teste vezes o número de modais.
    await expect
      .poll(async () => describeHits(await page.evaluate(collectFullscreenFilters, { ratio: FULLSCREEN_RATIO })),
        { timeout: 2000, message: `blur preso depois de fechar #${id}` })
      .toEqual([]);
  }
});
