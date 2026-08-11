import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

// A tela de Chat é a ÚNICA superfície escura do app — luz só lê como luz sobre
// fundo escuro, e é por isso que a esfera ganhou o fundo dela. As outras
// quatro abas (Início, Cardápio, Clube, Perfil) continuam claras exatamente
// como estavam: não é tema escuro global, é `body.assistant-dark`, ligado e
// desligado no mesmo lugar que abre e fecha #mobViewAssistant
// (mobNavAssistant / closeMobViews em restaurant-page.js).

const DARK_CLASS = 'assistant-dark';

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedPickupSession(page);
  // Token logado: Clube e Perfil abrem a tela de verdade em vez de cair no
  // login — a superfície real deles é o que este teste precisa inspecionar.
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-fake-token');
  });
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
}

test('só a aba Chat liga o modo escuro — as outras quatro continuam claras', async ({ page }) => {
  await boot(page);

  // Parte clara: Início é o estado inicial do boot.
  await expect(page.locator('body')).not.toHaveClass(new RegExp(DARK_CLASS));

  // Cardápio.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavMenu')());
  await expect(page.locator('body')).not.toHaveClass(new RegExp(DARK_CLASS));

  // Clube.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('body')).not.toHaveClass(new RegExp(DARK_CLASS));

  // Perfil.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await expect(page.locator('body')).not.toHaveClass(new RegExp(DARK_CLASS));

  // Chat: aqui, e só aqui, a classe liga.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(new RegExp(DARK_CLASS));

  // E a superfície realmente pintou escuro — não é só a classe presente.
  const assistantBg = await page.locator('#mobViewAssistant .assistant-page')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  expect(assistantBg).not.toBe('rgb(255, 255, 255)');

  // Voltar para Início desliga a classe de novo.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavHome')());
  await expect(page.locator('body')).not.toHaveClass(new RegExp(DARK_CLASS));
});

for (const [label, action] of [
  ['Cardápio', 'mobNavMenu'],
  ['Clube', 'mobNavClub'],
  ['Perfil', 'mobNavProfile']
]) {
  test(`sair do Chat direto para ${label} também desliga o modo escuro`, async ({ page }) => {
    await boot(page);

    await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
    await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(new RegExp(DARK_CLASS));

    await page.evaluate(name => window.RapidexActions.resolve(name)(), action);
    await expect(page.locator('body'), `${label} ficou com o Chat escuro grudado`)
      .not.toHaveClass(new RegExp(DARK_CLASS));
  });
}

test('as quatro telas claras mantêm o fundo claro de sempre, não o color-mix do Chat', async ({ page }) => {
  await boot(page);

  const screens = [
    { action: null, root: '.restaurant-app-shell, .mobile-home' },
    { action: 'mobNavMenu', root: '.restaurant-app-shell, .mobile-home' },
    { action: 'mobNavClub', root: '#mobViewClub' },
    { action: 'mobNavProfile', root: '#mobViewProfile' }
  ];

  for (const { action, root } of screens) {
    if (action) await page.evaluate(name => window.RapidexActions.resolve(name)(), action);
    const bg = await page.locator(root).first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    // Nenhuma dessas telas usa o color-mix quase preto do Chat: o canal de
    // vermelho de um fundo claro fica bem acima de 100; o do Chat fica perto
    // de 30-50 mesmo com marcas claras, porque a base é #0B0D12.
    const [r] = bg.match(/\d+/g).map(Number);
    expect(r, `${action || 'home'} herdou o fundo escuro do Chat: ${bg}`).toBeGreaterThan(100);
  }
});
