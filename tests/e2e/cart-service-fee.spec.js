import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, addH2OToCart, RESTAURANT_URL } from './helpers.js';

// ============================================================================
//  A taxa de serviço APARECE na seção Valores da sacola.
//
//  Ela sempre entrou no total (cartTotals soma svc), mas a LINHA estava
//  escondida por CSS (restaurant.css: `.cps-row:has(.fee-info-btn)
//  {display:none!important}`). Num pedido de R$ 0,01 o cliente via Subtotal
//  R$ 0,01 e Total R$ 1,00 — R$ 0,99 sem linha nenhuma explicando — e não
//  fechava a conta. Mostrar de onde o total vem não é cortesia: é o que
//  permite ao cliente conferir a soma que ele vai pagar.
// ============================================================================

test('a linha "Taxa de serviço" aparece na sacola, com o valor que entra no total', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3); // 3 × 7,05 = 21,15 + 0,99 = 22,14
  await page.evaluate(() => window.openModal('cartModal'));

  const feeRow = page.locator('#csSvcFeeRow');
  await expect(feeRow).toBeVisible();
  await expect(feeRow).toContainText('Taxa de serviço');
  await expect(page.locator('#csSvcFeeBtn')).toHaveText('R$ 0,99');
  // E a conta fecha na tela: subtotal + taxa = total.
  await expect(page.locator('#csSub')).toHaveText('R$ 21,15');
  await expect(page.locator('#csTotal')).toContainText('22,14');
});

test('restaurante sem taxa de serviço não ganha uma linha de R$ 0,00', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  // O /menu com a taxa desligada: settings é a fonte (service_fee_enabled).
  await page.route(/\/menu(\?|$)/, async (route) => {
    const { MENU, menuForBranch } = await import('./helpers.js');
    const body = menuForBranch(new URL(route.request().url()).searchParams.get('branch_id'));
    body.settings = { ...body.settings, service_fee_enabled: false, service_fee_amount: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));

  await expect(page.locator('#csTotal')).toContainText('21,15');
  await expect(page.locator('#csSvcFeeRow')).toBeHidden();
});
