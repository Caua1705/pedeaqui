import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

// Fase 5, bloco C3. O app registrava observers, intervalos e listeners em
// document/window no boot e nunca desligava nada. Aqui se prova que:
//
//   1. o carrossel para quando a aba sai de vista, e volta quando ela retorna;
//   2. o teardown desliga observers, intervalos e listeners de uma vez;
//   3. o teardown NÃO roda quando a página vai para o bfcache — desligar ali
//      devolveria ao usuário uma página morta.

async function boot(page) {
  await mockApi(page);
  // Sem o contexto de operacao confirmado o app abre o modal de retirada por
  // cima de tudo, e a aba do cardapio nunca chega a ser exibida.
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
}

/**
 * Finge a troca de visibilidade.
 *
 * O Playwright não expõe "esconder a aba", e o que precisa ser testado é a
 * REAÇÃO do app ao evento, não a implementação do browser. `document.hidden` e
 * `visibilityState` são getters do protótipo, então dá para sobrescrevê-los na
 * instância e disparar o evento real.
 */
async function setVisibility(page, state) {
  await page.evaluate(visibility => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => visibility === 'hidden'
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** Conta os intervalos vivos, interceptando setInterval/clearInterval no boot. */
async function trackIntervals(page) {
  await page.addInitScript(() => {
    window.__intervals = new Set();
    const setNative = window.setInterval;
    const clearNative = window.clearInterval;
    window.setInterval = (...args) => {
      const id = setNative(...args);
      window.__intervals.add(id);
      return id;
    };
    window.clearInterval = id => {
      window.__intervals.delete(id);
      return clearNative(id);
    };
  });
}

const liveIntervals = page => page.evaluate(() => window.__intervals.size);

test('o registro de desligamento não está vazio — há o que desligar', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.RapidexLifecycle.pending)).toBeGreaterThan(0);
});

test('aba oculta para o carrossel; aba visível o retoma', async ({ page }) => {
  await trackIntervals(page);
  await boot(page);
  // Garante que o carrossel existe e está girando antes de medir a pausa.
  await page.evaluate(() => window.RapidexActions.resolve('setHeroBanner')(0));
  await expect.poll(() => liveIntervals(page)).toBeGreaterThan(0);

  await setVisibility(page, 'hidden');
  await expect.poll(() => liveIntervals(page), { timeout: 5_000 }).toBe(0);

  await setVisibility(page, 'visible');
  await expect.poll(() => liveIntervals(page), { timeout: 5_000 }).toBeGreaterThan(0);
});

test('o carrossel não anda enquanto a aba está oculta', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.RapidexActions.resolve('setHeroBanner')(0));

  const transform = () =>
    page.evaluate(() => document.getElementById('restaurantHeroTrack')?.style.transform || '');
  await setVisibility(page, 'hidden');
  const before = await transform();
  // Bem mais do que o intervalo do autoplay.
  await page.waitForTimeout(6_000);

  expect(await transform(), 'o banner andou com a aba escondida').toBe(before);
});

test('o teardown desliga intervalos, observers e listeners de uma vez', async ({ page }) => {
  await trackIntervals(page);
  await boot(page);
  await page.evaluate(() => window.RapidexActions.resolve('setHeroBanner')(0));
  await expect.poll(() => liveIntervals(page)).toBeGreaterThan(0);

  await page.evaluate(() => window.RapidexLifecycle.teardown());

  expect(await liveIntervals(page), 'sobrou intervalo depois do teardown').toBe(0);
  expect(await page.evaluate(() => window.RapidexLifecycle.pending)).toBe(0);
  expect(await page.evaluate(() => window.RapidexLifecycle.signal.aborted)).toBe(true);
});

test('depois do teardown, o listener de scroll não reage mais', async ({ page }) => {
  await boot(page);
  // O handler de menu-scrolled é um dos que carregam o signal.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavMenu')());
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator('body')).toHaveClass(/menu-scrolled/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('body')).not.toHaveClass(/menu-scrolled/);

  await page.evaluate(() => window.RapidexLifecycle.teardown());
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(300);

  await expect(
    page.locator('body'),
    'o listener continuou vivo depois do abort'
  ).not.toHaveClass(/menu-scrolled/);
});

test('pagehide para bfcache NÃO desliga a página', async ({ page }) => {
  await trackIntervals(page);
  await boot(page);
  await page.evaluate(() => window.RapidexActions.resolve('setHeroBanner')(0));
  await expect.poll(() => liveIntervals(page)).toBeGreaterThan(0);

  // persisted: true = a página vai para o cache de retorno e pode voltar
  // inteira. Desligar aqui devolveria ao usuário uma página morta.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });

  expect(await page.evaluate(() => window.RapidexLifecycle.signal.aborted)).toBe(false);
  expect(await page.evaluate(() => window.RapidexLifecycle.pending)).toBeGreaterThan(0);
});

test('pagehide de saída real desliga tudo', async ({ page }) => {
  await trackIntervals(page);
  await boot(page);
  await page.evaluate(() => window.RapidexActions.resolve('setHeroBanner')(0));

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });

  expect(await page.evaluate(() => window.RapidexLifecycle.signal.aborted)).toBe(true);
  expect(await liveIntervals(page)).toBe(0);
});
