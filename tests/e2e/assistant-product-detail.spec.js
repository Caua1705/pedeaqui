import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O } from './helpers.js';

test('detalhe recomendado pelo Rapi anima ao abrir e ao voltar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/chat', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      response_type: 'products',
      products: [{
        id: PRODUCT_H2O,
        name: 'Água H2O',
        description: 'Produto recomendado pelo Rapi.',
        price: 7.05,
        recommendation_reason: 'Combina com o que você pediu.'
      }]
    })
  }));
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());

  await page.locator('#assistantInput').fill('Me recomenda um prato');
  await page.locator('.assistant-ai-send').click();
  await expect(page.locator('.assistant-product-card')).toBeVisible();

  const detail = page.locator('#assistantProductDetail');
  const panel = detail.locator('.assistant-product-detail-panel');
  await page.locator('.assistant-product-card').click();
  await expect(detail).toHaveClass(/is-open/);
  await expect.poll(() => panel.evaluate(element =>
    element.getAnimations().some(animation => animation.transitionProperty === 'transform')
  )).toBe(true);

  await detail.locator('.assistant-product-detail-close').click();
  await expect(detail).not.toHaveClass(/is-open/);
  await expect(detail).not.toHaveAttribute('hidden', '');
  await expect.poll(() => panel.evaluate(element =>
    element.getAnimations().some(animation => animation.transitionProperty === 'transform')
  )).toBe(true);

  await page.waitForTimeout(120);
  expect(await detail.evaluate(element => getComputedStyle(element).display)).toBe('flex');
  await expect(detail).toHaveAttribute('hidden', '', { timeout: 1_000 });
});
