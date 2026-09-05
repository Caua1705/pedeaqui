import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O AVISO DE LOGIN DA VOZ EXISTIA E NUNCA FOI VISTO.
//
//  Quem não tem conta aperta o botão de voz esperando falar e leva um muro. O
//  app já tinha a resposta certa — `#assistantVoiceLoginHint`, o botão em
//  cinza e o `aria-label` "Entre para usar a voz" — e ela nascia DEBAIXO da
//  barra de baixo:
//
//    dock  y=768, altura 0 (`bottom:76px`)
//    barra de digitação  y=696..754 (absoluta, `top:-72px`)
//    aviso  y=774..789  (em FLUXO, na origem do dock)
//    .mob-bottom-nav  y=759..844
//
//  `display:flex`, retângulo de 382×15, e `document.elementFromPoint()` no
//  centro dele devolvendo `mobNavAssistantTab`. Um `toBeVisible()` do
//  Playwright PASSA nesse estado — é a §12.14 pelo avesso: o DOM diz uma coisa
//  e o olho vê outra.
//
//  POR ISSO A AFIRMAÇÃO É GEOMÉTRICA, e não `toBeVisible()`: o fato do cliente
//  é "o aviso está na tela", e a única forma de dizê-lo é que o retângulo dele
//  não encosta no da barra. É a §13.4 — afirme o observável, não o mecanismo.
//
//  A LARGURA É PARTE DO TESTE (§14.2): o dock inteiro é de celular.
// ============================================================================

const CELULAR = { width: 390, height: 844 };

async function abrirAssistente(page, { logado = false } = {}) {
  await page.setViewportSize(CELULAR);
  if (logado) await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'e2e-voz-token'));
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#assistantStarter')).toHaveClass(/is-ready/);
}

/** Os dois retângulos que decidem se o aviso foi visto. */
const geometria = (page) => page.evaluate(() => {
  const hint = document.getElementById('assistantVoiceLoginHint');
  const nav = document.querySelector('.mob-bottom-nav');
  return {
    aviso: hint && !hint.hidden ? hint.getBoundingClientRect().toJSON() : null,
    barra: nav ? nav.getBoundingClientRect().toJSON() : null,
    rotulo: document.querySelector('.assistant-ai-send')?.getAttribute('aria-label') || ''
  };
});

test('visitante ve o aviso ANTES do toque, e ele nao fica debaixo da barra de baixo', async ({ page }) => {
  await abrirAssistente(page);
  const { aviso, barra, rotulo } = await geometria(page);

  expect(aviso, 'o aviso não foi renderizado para quem não tem conta').not.toBeNull();
  expect(barra, 'a sonda não achou a barra de baixo — ela mudou de classe?').not.toBeNull();
  expect(aviso.height, 'o aviso não tem altura').toBeGreaterThan(0);
  // O FATO: o aviso termina ACIMA de onde a barra começa. Com o CSS antigo
  // esta linha lê `789 <= 759` e reprova.
  expect(aviso.bottom, `o aviso (${aviso.top}..${aviso.bottom}) está debaixo da barra (${barra.top}..${barra.bottom})`)
    .toBeLessThanOrEqual(barra.top);

  // E o botão diz a mesma coisa para quem navega por leitor de tela.
  expect(rotulo).toBe('Entre para usar a voz');
  await expect(page.locator('.assistant-ai-send')).toHaveClass(/is-login-required/);
});

test('quem tem conta nao ve aviso nenhum, e o botao promete a voz', async ({ page }) => {
  // O contra-exemplo: sem ele, a correção poderia ser "mostrar sempre", que é
  // ruído para a maioria de quem usa a tela.
  await abrirAssistente(page, { logado: true });
  await expect(page.locator('#assistantVoiceLoginHint')).toBeHidden();
  await expect(page.locator('.assistant-ai-send')).not.toHaveClass(/is-login-required/);
  expect((await geometria(page)).rotulo).toBe('Conversar por voz');
});

test('digitar troca o aviso pelo enviar: ele e sobre a VOZ, nao sobre a tela', async ({ page }) => {
  await abrirAssistente(page);
  await expect(page.locator('#assistantVoiceLoginHint')).toBeVisible();
  // Texto no campo = o botão vira "Enviar", e mandar texto NÃO exige conta.
  // Um aviso que ficasse aí mentiria sobre o que a tela aceita.
  await page.locator('#assistantInput').fill('tem água gelada?');
  await expect(page.locator('#assistantVoiceLoginHint')).toBeHidden();
  expect((await geometria(page)).rotulo).toBe('Enviar');
});
