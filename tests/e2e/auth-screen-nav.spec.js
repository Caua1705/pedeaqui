import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL } from './helpers.js';

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
