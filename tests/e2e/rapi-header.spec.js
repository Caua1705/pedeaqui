import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O } from './helpers.js';

// A tela do Rapi era a ÚNICA do app sem cabeçalho: não havia como voltar sem a
// barra de navegação e não havia como reiniciar a conversa de jeito nenhum.
//
// O que estes testes travam é o que a tela ganhou de contrato, não a estética:
// a anatomia é a MESMA das outras telas cheias (medida contra elas, não contra
// números mágicos), o menu abre e fecha como menu, e "limpar conversa" começa
// uma sessão nova em vez de só apagar a tela — sem isso o backend continuaria
// respondendo com a memória da conversa que o cliente acabou de apagar.

const CHAT_ANSWER = {
  response_type: 'products',
  message: 'Boa! Separei uma opção gelada.',
  products: [{
    id: PRODUCT_H2O,
    name: 'Água H2O',
    price: 7.05,
    recommendation_reason: 'Combina com o que você pediu.'
  }]
};

async function openRapi(page, { chat } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  if (chat !== false) {
    await page.route('**/chat', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHAT_ANSWER)
    }));
  }
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('mobNavRapi')());
  await expect(page.locator('#mobViewRapi .rapi-hdr')).toBeVisible();
}

/** Caixa e raio de um elemento, do jeito que o usuário vê. */
const boxOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    radius: style.borderRadius,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight
  };
}, selector);

test('o cabeçalho do Rapi tem a mesma anatomia das outras telas cheias', async ({ page }) => {
  await openRapi(page);

  const rapiHeader = await boxOf(page, '#mobViewRapi .rapi-hdr');
  const rapiButton = await boxOf(page, '#mobViewRapi .rapi-hdr-btn');
  const rapiTitle = await boxOf(page, '#mobViewRapi .rapi-hdr-title');

  // A referência é a tela vizinha DE VERDADE, medida no mesmo navegador: um
  // número copiado para cá continuaria passando no dia em que as outras telas
  // mudassem — que é justamente quando este teste precisa falhar.
  await page.evaluate(() => window.RapidexActions.resolve('openOperationScreen')());
  await expect(page.locator('#operationModal .cart-hdr')).toBeVisible();
  const otherHeader = await boxOf(page, '#operationModal .cart-hdr');
  const otherButton = await boxOf(page, '#operationModal .cart-hdr-back');
  const otherTitle = await boxOf(page, '#operationModal .cart-hdr-title');

  expect(rapiHeader.height, 'altura do cabeçalho').toBe(otherHeader.height);
  expect(rapiButton.width, 'largura do botão').toBe(otherButton.width);
  expect(rapiButton.height, 'altura do botão').toBe(otherButton.height);
  expect(rapiButton.radius, 'raio do botão').toBe(otherButton.radius);
  expect(rapiTitle.fontSize, 'corpo do título').toBe(otherTitle.fontSize);
  expect(rapiTitle.fontWeight, 'peso do título').toBe(otherTitle.fontWeight);
});

test('o título traz o mascote e o status, e o mascote realmente pinta', async ({ page }) => {
  await openRapi(page);

  await expect(page.locator('#mobViewRapi .rapi-hdr-title')).toHaveText(/Rapi/);
  await expect(page.locator('#rapiHdrStatus')).toHaveText(/online/);

  const mascot = page.locator('#mobViewRapi .rapi-hdr-mascot');
  await expect(mascot).toBeVisible();
  // naturalWidth > 0 é a única prova de que o byte chegou e decodificou; sem
  // ela, data-act-error="$hide" some com a imagem e ninguém percebe.
  expect(await mascot.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);

  // O ponto é semântico (--state-success), nunca a cor da marca: um tenant
  // vermelho não pode ter "online" em vermelho.
  const dot = await page.locator('#mobViewRapi .rapi-hdr-dot').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    success: getComputedStyle(document.documentElement).getPropertyValue('--state-success').trim(),
    brand: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()
  }));
  expect(dot.background).not.toBe(dot.brand);
  expect(dot.success).toBeTruthy();
});

test('o botão da esquerda sai da tela do Rapi', async ({ page }) => {
  await openRapi(page);

  await page.locator('#mobViewRapi .rapi-hdr-btn[aria-label="Voltar"]').click();

  await expect(page.locator('#mobViewRapi')).not.toHaveClass(/active/);
});

test('limpar conversa apaga a tela E começa uma sessão nova no backend', async ({ page }) => {
  const sessions = [];
  await openRapi(page, { chat: false });
  await page.route('**/chat', route => {
    sessions.push(JSON.parse(route.request().postData() || '{}').session_id);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHAT_ANSWER)
    });
  });

  await page.locator('#rapiInput').fill('Quero algo gelado');
  await page.locator('.rapi-ai-send').click();
  await expect(page.locator('.rapi-product-card')).toBeVisible();

  await page.locator('#rapiHdrMenuBtn').click();
  await expect(page.locator('#rapiHdrMenu')).toBeVisible();
  await page.locator('#rapiHdrMenu .rapi-hdr-menu-item').click();

  // A tela volta à abertura: sem respostas e com a intro de novo.
  await expect(page.locator('.rapi-product-card')).toHaveCount(0);
  await expect(page.locator('#rapiAiResultsWrap')).toBeHidden();
  await expect(page.locator('#mobViewRapi .rapi-ai-body')).not.toHaveClass(/rapi-ai-body--searching/);
  await expect(page.locator('#rapiHdrMenu')).toBeHidden();

  // E o backend recebe outro session_id: é isso que faz o Rapi esquecer.
  await page.locator('#rapiInput').fill('E agora?');
  await page.locator('.rapi-ai-send').click();
  await expect(page.locator('.rapi-product-card')).toBeVisible();

  expect(sessions).toHaveLength(2);
  expect(sessions[0], 'session_id não foi enviado').toBeTruthy();
  expect(sessions[1], 'a conversa limpa reusou a sessão antiga').not.toBe(sessions[0]);
});

test('o menu fecha ao clicar fora e com Escape', async ({ page }) => {
  await openRapi(page);
  const menu = page.locator('#rapiHdrMenu');
  const button = page.locator('#rapiHdrMenuBtn');

  await button.click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  await page.locator('#rapiIntroQuestion').click();
  await expect(menu).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await button.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('o status vira offline quando o Rapi não responde', async ({ page }) => {
  await openRapi(page, { chat: false });
  await page.route('**/chat', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'boom' })
  }));

  await expect(page.locator('#rapiHdrStatus')).toHaveText(/online/);

  await page.locator('#rapiInput').fill('Oi');
  await page.locator('.rapi-ai-send').click();

  // O ponto verde fixo seria enfeite: ele precisa acompanhar a última chamada.
  await expect(page.locator('#rapiHdrStatus')).toHaveText(/offline/);
  await expect(page.locator('#rapiHdrStatus')).toHaveAttribute('data-state', 'offline');
});

test('a sacola vive no cabeçalho e não empurra o título do centro', async ({ page }) => {
  await openRapi(page);
  const cart = page.locator('#rapiCartButton');
  const title = page.locator('#mobViewRapi .rapi-hdr-title');

  await expect(cart).toBeHidden();
  const centeredBefore = await title.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return Math.round(rect.left + rect.width / 2 - window.innerWidth / 2);
  });

  await page.evaluate((productId) => {
    window.openProduct(productId);
    window.addToCart();
  }, PRODUCT_H2O);

  await expect(cart).toBeVisible();
  await expect(page.locator('#rapiCartCount')).toHaveText('1');

  const centeredAfter = await title.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return Math.round(rect.left + rect.width / 2 - window.innerWidth / 2);
  });
  expect(Math.abs(centeredBefore), 'o título não nasceu centralizado').toBeLessThanOrEqual(1);
  expect(centeredAfter, 'a sacola empurrou o título').toBe(centeredBefore);
});
