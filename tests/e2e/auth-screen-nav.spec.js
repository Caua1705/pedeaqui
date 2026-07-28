import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

// Fase 5, bloco C2. A barra inferior some quando uma tela de autenticação abre.
//
// Quem faz isso no caminho normal são as próprias funções de abrir/fechar, que
// chamam setBottomNavSuppressedForAuth direto. O MutationObserver é a REDE DE
// SEGURANÇA para quem mexe na classe por fora — e é justamente ele que o C2
// estreitou, de "todo o subtree do body" para as seis telas.
//
// Sem o teste do caminho do observer, encolher o escopo poderia deixar de vigiar
// a tela certa e ninguém notaria: o caminho normal continuaria verde.

const AUTH_SCREENS = [
  'registerScreen',
  'loginScreen',
  'verifyScreen',
  'resetPasswordScreen',
  'forgotPasswordScreen',
  'recoverCodeScreen'
];

async function boot(page) {
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));

  // As telas de auth são chamadas pelo REGISTRO de ações, não por window: a
  // fase B2 tirou 141 nomes do escopo global de propósito, e o teste não é
  // motivo para devolvê-los.
  await page.evaluate(() => {
    window.act = name => window.RapidexActions.resolve(name)();
  });
}

test('abrir a tela de login pelo caminho normal suprime a barra inferior', async ({ page }) => {
  await boot(page);
  await expect(page.locator('body')).not.toHaveClass(/auth-screen-open/);

  await page.evaluate(() => window.act('openSigninScreen'));
  await expect(page.locator('body')).toHaveClass(/auth-screen-open/);

  await page.evaluate(() => window.act('closeSigninScreen'));
  await expect(page.locator('body')).not.toHaveClass(/auth-screen-open/);
});

test('a barra volta ao DOM quando a tela de auth fecha', async ({ page }) => {
  await boot(page);

  await page.evaluate(() => window.act('openSigninScreen'));
  await expect(page.locator('#mobBottomNav')).toHaveCount(0);

  await page.evaluate(() => window.act('closeSigninScreen'));
  await expect(page.locator('#mobBottomNav')).toHaveCount(1);
});

// O contrato do C2: cada uma das seis telas continua vigiada. A classe é posta
// SEM passar por nenhuma função do app — só o observer pode reagir.
for (const id of AUTH_SCREENS) {
  test(`o observer ainda vê #${id} quando a classe muda por fora`, async ({ page }) => {
    await boot(page);

    await page.evaluate(screenId => document.getElementById(screenId).classList.add('active'), id);
    await expect(page.locator('body')).toHaveClass(/auth-screen-open/);

    await page.evaluate(screenId => document.getElementById(screenId).classList.remove('active'), id);
    await expect(page.locator('body')).not.toHaveClass(/auth-screen-open/);
  });
}

// A outra metade do C2: mudança de classe FORA das telas de auth não pode mais
// acordar o observer. Se este teste falhar com `auth-screen-open`, o escopo
// voltou a ser o body inteiro.
test('churn de classe no resto da página não liga a supressão', async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    for (const element of document.querySelectorAll('.mob-view, .prod-card, .cat-chip')) {
      element.classList.add('rapidex-churn-teste');
      element.classList.remove('rapidex-churn-teste');
    }
  });

  await expect(page.locator('body')).not.toHaveClass(/auth-screen-open/);
  await expect(page.locator('#mobBottomNav')).toHaveCount(1);
});

test('saudação da Home fica inerte quando o cliente está conectado', async ({ page }) => {
  await seedPickupSession(page);
  await boot(page);
  await page.evaluate(() => window.act('closeOperationScreen'));

  const greeting = page.locator('#homeLoginPrompt');
  await expect(greeting).toHaveText(/Olá, E2E/);
  await expect(greeting).toBeDisabled();
  await page.locator('.mob-rest-name').click();
  await greeting.evaluate(button => button.click());

  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
  await expect(page.locator('#mobViewProfile')).not.toHaveClass(/active/);
  await expect(page.locator('body')).toHaveClass(/home-tab/);
});

for (const [label, navId] of [['Perfil', 'mobNavProfile'], ['Clube', 'mobNavOrders']]) {
  test(`${label} deslogado preserva o cabeçalho da Home durante a abertura do login`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => window.act('closeOperationScreen'));

    await expect.poll(() => page.evaluate(() => {
      window.scrollTo({ top: 500, behavior: 'auto' });
      return window.scrollY;
    })).toBeGreaterThan(100);

    const header = page.locator('#homeStickyHeader');
    const widget = header.locator('.delivery-widget');
    const identity = header.locator('#mobIdentity');
    const loginPrompt = header.locator('#homeLoginPrompt');
    const before = await header.boundingBox();

    await expect(header).toBeVisible();
    await expect(widget).toBeVisible();
    await expect(identity).toBeVisible();
    await expect(loginPrompt).toBeVisible();
    await expect(loginPrompt).toHaveText('Entre ou cadastre-se');
    expect(before?.y).toBe(0);

    await page.locator(`#${navId}`).click();
    await expect(page.locator('#loginModal')).toHaveClass(/active/);
    await expect(page.locator('#loginModal')).toHaveClass(/from-bottom-nav/);
    await expect(page.locator('body')).toHaveClass(/home-tab/);
    await expect(page.locator('#mobNavHome')).toHaveClass(/active/);
    await expect(page.locator(`#${navId}`)).not.toHaveClass(/active/);
    await expect(page.locator('#mobViewProfile')).not.toHaveClass(/active/);
    await expect(page.locator('#mobViewClub')).not.toHaveClass(/active/);
    await expect.poll(() => page.locator('#loginModal').evaluate(modal =>
      getComputedStyle(modal).backgroundColor
    )).toBe('rgba(0, 0, 0, 0)');
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).overflowY
    )).toBe('visible');

    const after = await header.boundingBox();
    await expect(header).toBeVisible();
    await expect(widget).toBeVisible();
    await expect(identity).toBeVisible();
    await expect(loginPrompt).toBeVisible();
    expect(Math.abs((after?.y || 0) - (before?.y || 0))).toBeLessThanOrEqual(1);

    await page.locator('#loginModal .login-secondary').click();
    await expect(page.locator('#loginScreen')).toHaveClass(/active/);
    await page.locator('#loginScreen .lgn-back').click();
    await expect(page.locator('#loginScreen')).not.toHaveClass(/active/);
    await expect(page.locator('#loginModal')).toHaveClass(/active/);

    const afterSigninBack = await header.boundingBox();
    expect(await page.evaluate(() => document.body.style.position)).toBe('');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('visible');
    expect(Math.abs((afterSigninBack?.y || 0) - (before?.y || 0))).toBeLessThanOrEqual(1);

    await page.locator('#loginModal .login-close').click();
    await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
    await expect(page.locator('body')).toHaveClass(/soft-scroll-locked/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('visible');
    const whileClosing = await header.boundingBox();
    expect(Math.abs((whileClosing?.y || 0) - (before?.y || 0))).toBeLessThanOrEqual(1);

    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    await expect(header).toBeVisible();
    await expect(loginPrompt).toHaveText('Entre ou cadastre-se');
  });
}

const AUTH_RETURN_PATHS = [
  ['Cadastro', async page => {
    await page.locator('#loginModal .cart-cta-btn').click();
    await expect(page.locator('#registerScreen')).toHaveClass(/active/);
    await page.locator('#registerScreen .reg-back').click();
  }],
  ['Esqueci a senha', async page => {
    await page.locator('#loginModal .login-secondary').click();
    await page.locator('#loginScreen .lgn-forgot').click();
    await expect(page.locator('#forgotPasswordScreen')).toHaveClass(/active/);
    await page.locator('#forgotPasswordScreen .vfy-back').click();
  }]
];

for (const [label, navigateAndReturn] of AUTH_RETURN_PATHS) {
  test(`${label}: retorno ao login preserva a Home rolada`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => window.act('closeOperationScreen'));
    await expect.poll(() => page.evaluate(() => {
      window.scrollTo({ top: 500, behavior: 'auto' });
      return window.scrollY;
    })).toBeGreaterThan(100);

    const header = page.locator('#homeStickyHeader');
    const before = await header.boundingBox();
    await page.locator('#mobNavProfile').click();
    await navigateAndReturn(page);

    await expect(page.locator('#loginModal')).toHaveClass(/active/);
    expect(await page.evaluate(() => document.body.style.position)).toBe('');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('visible');
    const after = await header.boundingBox();
    expect(Math.abs((after?.y || 0) - (before?.y || 0))).toBeLessThanOrEqual(1);
    await expect(page.locator('#homeLoginPrompt')).toHaveText('Entre ou cadastre-se');
  });
}
