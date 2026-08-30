import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

// ============================================================================
//  A validação do código de e-mail lida pelo campo de VEREDITO, não pelo HTTP.
//
//  VerifyEmailCodeResponse é {message, verified} — e nada mais: não vem token
//  nem customer. O submitVerify lia oito nomes que nunca existiram
//  (res.customer, res.user, res.access_token, res.token...) e NUNCA lia
//  `verified`. Consequência: um 200 com verified:false — o código errado, dito
//  pelo backend — fechava a tela e seguia como sucesso. A mesma lição do cupom
//  ("200 não é sucesso": o veredito mora no corpo).
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

async function chegarNaVerificacao(page, verifyResponse) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  // LoginResponse do contrato: conta existe mas o e-mail não foi verificado.
  await page.route('**/auth/login', route => route.fulfill(json({
    access_token: null,
    customer: null,
    email: 'cliente.e2e@exemplo.com',
    message: 'Verifique seu e-mail',
    requires_email_verification: true,
    token_type: null
  })));
  await page.route('**/auth/verify-email-code', route => route.fulfill(json(verifyResponse)));
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openSigninScreen')());
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
  await page.locator('#loginEmail').fill('cliente.e2e@exemplo.com');
  await page.locator('#loginPassword').fill('senha-forte-123');
  await page.locator('#loginSubmitBtn').click();
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);
  // Digitar pelo teclado, como um usuário: o handler de cada dígito move o
  // foco para o próximo, e um fill() por campo disputa com esse foco.
  await page.locator('.vfy-digit').first().click();
  await page.keyboard.type('123456');
  await expect(page.locator('#vfySubmitBtn')).toBeEnabled();
  await page.locator('#vfySubmitBtn').click();
}

test('200 com verified:false é recusa: a tela fica e diz que o código não vale', async ({ page }) => {
  await chegarNaVerificacao(page, { message: 'Código inválido ou expirado.', verified: false });
  await expect(page.locator('#vfyMsg')).toContainText(/inválido ou expir/i);
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);
});

test('verified:true segue o caminho de sempre: a tela fecha e o app volta ao início', async ({ page }) => {
  await chegarNaVerificacao(page, { message: 'E-mail verificado.', verified: true });
  await expect(page.locator('#verifyScreen')).not.toHaveClass(/active/);
});
