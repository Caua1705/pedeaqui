import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

// As derivadas do Storage precisam chegar com a MESMA proporção do original.
// Pedindo só `width`, o modo padrão (`cover`) usa a altura original como alvo e
// devolve a imagem achatada — 1200x719 virava 168x719. Com object-fit:cover, o
// browser amplia até cobrir a caixa e corta o resto: era o enquadramento
// estragado dos cupons, banners e fotos de produto.
//
// Este teste bate na rede de verdade (as fixtures apontam para o bucket real e
// mockApi só intercepta api.pederapidex.com), que é o único jeito de flagrar
// uma regressão que mora na resposta do Storage e não no nosso CSS.

test.use({ viewport: { width: 390, height: 844 } });

// Quanto a proporção da derivada pode fugir da do original.
const TOLERANCIA = 0.04;

async function boot(page) {
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
}

// Mede, para cada <img> transformada em tela, a proporção do candidato que o
// browser realmente baixou contra a proporção do original apontado no src.
const measure = () =>
  Promise.all(
    [...document.querySelectorAll('img')]
      .filter((img) => img.currentSrc.includes('/render/image/public/') && img.clientWidth > 20)
      .slice(0, 12)
      .map(
        (img) =>
          new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () =>
              resolve({
                nome: img.currentSrc.split('/').pop().split('?')[0],
                derivada: img.naturalWidth / img.naturalHeight,
                original: probe.naturalWidth / probe.naturalHeight,
                fit: getComputedStyle(img).objectFit
              });
            probe.onerror = () => resolve(null);
            probe.src = img.getAttribute('src');
          })
      )
  ).then((rows) => rows.filter(Boolean));

function assertProporcional(rows) {
  expect(rows.length, 'nenhuma imagem transformada em tela — o teste não mediu nada').toBeGreaterThan(0);
  const tortas = rows
    .filter((r) => Math.abs(r.derivada - r.original) > TOLERANCIA)
    .map(
      (r) =>
        `${r.nome}: derivada ${r.derivada.toFixed(3)} vs original ${r.original.toFixed(3)} (fit:${r.fit})`
    );
  expect(tortas, 'derivada com proporção diferente do original').toEqual([]);
}

test('cupons e banners da home mantêm a proporção do original', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(
    () => [...document.querySelectorAll('img')].some((i) => i.currentSrc.includes('/render/image/public/')),
    { timeout: 20000 }
  );
  await page.waitForTimeout(2500);
  assertProporcional(await page.evaluate(measure));
});

test('as fotos do cardápio mantêm a proporção do original', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.mobNavMenu?.());
  await page.waitForFunction(() => document.querySelectorAll('.product-image').length > 0);
  await page.waitForTimeout(2500);

  const rows = await page.evaluate(measure);
  assertProporcional(rows);

  // A foto de produto é quadrada na origem e a caixa é 110x110: com a proporção
  // certa, `cover` não corta nada. Se a derivada voltar achatada, corta muito.
  const quadradas = rows.filter((r) => Math.abs(r.original - 1) < 0.02);
  expect(quadradas.length, 'nenhuma foto quadrada medida').toBeGreaterThan(0);
});
