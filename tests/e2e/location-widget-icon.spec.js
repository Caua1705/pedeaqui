import { test, expect } from '@playwright/test';
import { mockApi, BRANCH_MATRIZ, RESTAURANT_URL, SLUG } from './helpers.js';

test('o pin do endereco selecionado preserva a cor do white label', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(
    ({ slug, branchId }) => {
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({
          order_type: 'delivery',
          branch_id: branchId,
          branch_label: 'Matriz',
          confirmed: true,
          address: {
            street: 'Rua Eduardo Garcia',
            number: '1019',
            neighborhood: 'Aldeota',
            city: 'Fortaleza',
            state: 'CE'
          }
        })
      );
    },
    { slug: SLUG, branchId: BRANCH_MATRIZ }
  );
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));

  await expect(page.locator('.home-sticky-header .address-strip')).toHaveClass(/has-address/);

  const colors = await page.evaluate(() => {
    const widget = document.querySelector('.home-sticky-header .delivery-widget');
    const path = widget.querySelector('.address-card-icon path');
    const circle = widget.querySelector('.address-card-icon circle');
    const probe = document.createElement('span');
    probe.style.color = 'var(--brand-primary)';
    document.body.appendChild(probe);
    const brand = getComputedStyle(probe).color;
    probe.remove();
    return {
      brand,
      pathFill: getComputedStyle(path).fill,
      pathStroke: getComputedStyle(path).stroke,
      circleFill: getComputedStyle(circle).fill,
      circleStroke: getComputedStyle(circle).stroke
    };
  });

  expect(colors.pathFill).toBe(colors.brand);
  expect(colors.pathStroke).toBe(colors.brand);
  expect(colors.circleFill).toBe('rgb(255, 255, 255)');
  expect(colors.circleStroke).toBe(colors.brand);
});
