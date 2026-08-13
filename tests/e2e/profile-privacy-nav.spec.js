import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

async function openPrivacyFromProfile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await expect(page.locator('#mobViewProfile')).toHaveClass(/active/);
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Política de privacidade' }).click();
  await expect(page.locator('#privacyPolicyScreen')).toHaveClass(/active/);
}

test('política aberta pelo Perfil mantém a navbar visível', async ({ page }) => {
  await openPrivacyFromProfile(page);

  const nav = page.locator('#mobBottomNav');
  await expect(nav).toBeVisible();
  await expect(nav).toHaveCSS('pointer-events', 'auto');
  await expect(nav).toHaveCSS('z-index', '300');
  await expect(page.locator('#mobNavProfile')).toHaveClass(/active/);
});

test('navbar fecha a política antes de trocar de aba', async ({ page }) => {
  await openPrivacyFromProfile(page);

  await page.locator('#mobNavHome').click();

  await expect(page.locator('#privacyPolicyScreen')).not.toHaveClass(/active/);
  await expect(page.locator('body')).not.toHaveClass(/policy-from-profile/);
  await expect(page.locator('#mobNavHome')).toHaveClass(/active/);
  await expect(page.locator('#mobViewProfile')).not.toHaveClass(/active/);
});
