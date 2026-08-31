import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O, esperarAppPronto } from './helpers.js';

// A tela do assistente era a ÚNICA do app sem cabeçalho: não havia como voltar
// sem a barra de navegação e não havia como reiniciar a conversa de jeito nenhum.
//
// O que estes testes travam é o que a tela ganhou de contrato, não a estética:
// a anatomia é a MESMA das outras telas cheias (medida contra elas, não contra
// números mágicos), a identidade do cabeçalho é a do RESTAURANTE — o app é
// white-label e o cliente não conhece a plataforma —, o menu abre e fecha como
// menu, e "limpar conversa" começa uma sessão nova em vez de só apagar a tela,
// sem o que o backend continuaria respondendo com a memória do que o cliente
// acabou de apagar.

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

// A logo do fixture aponta para um CDN de verdade. Ela não aparece mais nesta
// tela, mas aparece atrás dela (topo da loja), e deixar a requisição sair faz o
// teste depender da rede para nada.
async function openAssistant(page, { chat } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/*logo*', route => route.abort());
  if (chat !== false) {
    await page.route('**/chat', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHAT_ANSWER)
    }));
  }
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();
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

test('o cabeçalho tem a mesma anatomia das outras telas cheias', async ({ page }) => {
  await openAssistant(page);

  const assistantHeader = await boxOf(page, '#mobViewAssistant .assistant-hdr');
  const assistantButton = await boxOf(page, '#mobViewAssistant .assistant-hdr-btn');
  const assistantTitle = await boxOf(page, '#mobViewAssistant .assistant-hdr-title');

  // A referência é a tela vizinha DE VERDADE, medida no mesmo navegador: um
  // número copiado para cá continuaria passando no dia em que as outras telas
  // mudassem — que é justamente quando este teste precisa falhar.
  await page.evaluate(() => window.RapidexActions.resolve('openOperationScreen')());
  await expect(page.locator('#operationModal .cart-hdr')).toBeVisible();
  const otherHeader = await boxOf(page, '#operationModal .cart-hdr');
  const otherButton = await boxOf(page, '#operationModal .cart-hdr-back');
  const otherTitle = await boxOf(page, '#operationModal .cart-hdr-title');

  expect(assistantHeader.height, 'altura do cabeçalho').toBe(otherHeader.height);
  expect(assistantButton.width, 'largura do botão').toBe(otherButton.width);
  expect(assistantButton.height, 'altura do botão').toBe(otherButton.height);
  expect(assistantButton.radius, 'raio do botão').toBe(otherButton.radius);
  expect(assistantTitle.fontSize, 'corpo do título').toBe(otherTitle.fontSize);
  expect(assistantTitle.fontWeight, 'peso do título').toBe(otherTitle.fontWeight);
});

test('o título diz o que a tela É, sem nomear o assistente', async ({ page }) => {
  await openAssistant(page);

  // "Chat" e nada mais: palavra curta, que qualquer cliente reconhece, e que
  // não é nome de produto. Um nome próprio aqui teria dono, e o dono não seria
  // o restaurante. E não sobrou avatar nenhum ao lado do título.
  await expect(page.locator('#assistantHdrName')).toHaveText('Chat');
  await expect(page.locator('#mobViewAssistant .assistant-hdr-title img')).toHaveCount(0);
});

test('o indicador "online" não existe mais', async ({ page }) => {
  await openAssistant(page, { chat: false });
  // Ele imitava presença humana e prometia resposta imediata; com a API fora do
  // ar o cliente lia "online" enquanto esperava um erro. Não pode voltar nem
  // quando a chamada falha, que era exatamente quando ele mudava de cor.
  await page.route('**/chat', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));

  await expect(page.locator('#assistantHdrStatus')).toHaveCount(0);
  await expect(page.locator('#mobViewAssistant .assistant-hdr-dot')).toHaveCount(0);

  await page.locator('#assistantInput').fill('Oi');
  await page.locator('.assistant-ai-send').click();

  // A falha é dita onde ela acontece: dentro da conversa, e não por um ponto
  // que muda de cor a 300px do erro.
  await expect(page.locator('.assistant-chat-assistant-message').last()).not.toBeEmpty();
  await expect(page.locator('#assistantHdrStatus')).toHaveCount(0);
});

test('o botão da esquerda sai da tela do assistente', async ({ page }) => {
  await openAssistant(page);

  await page.locator('#mobViewAssistant .assistant-hdr-btn[aria-label="Voltar"]').click();

  await expect(page.locator('#mobViewAssistant')).not.toHaveClass(/active/);
});

test('limpar conversa apaga a tela E começa uma sessão nova no backend', async ({ page }) => {
  const sessions = [];
  await openAssistant(page, { chat: false });
  await page.route('**/chat', route => {
    sessions.push(JSON.parse(route.request().postData() || '{}').session_id);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHAT_ANSWER)
    });
  });

  await page.locator('#assistantInput').fill('Quero algo gelado');
  await page.locator('.assistant-ai-send').click();
  await expect(page.locator('.assistant-product-card')).toBeVisible();

  await page.locator('#assistantHdrMenuBtn').click();
  await expect(page.locator('#assistantHdrMenu')).toBeVisible();
  await page.locator('#assistantHdrMenu .assistant-hdr-menu-item').click();

  // A tela volta à abertura: sem respostas e com a intro de novo.
  await expect(page.locator('.assistant-product-card')).toHaveCount(0);
  await expect(page.locator('#assistantAiResultsWrap')).toBeHidden();
  await expect(page.locator('#mobViewAssistant .assistant-ai-body')).not.toHaveClass(/assistant-ai-body--searching/);
  await expect(page.locator('#assistantHdrMenu')).toBeHidden();

  // E o backend recebe outro session_id: é isso que faz o assistente esquecer.
  await page.locator('#assistantInput').fill('E agora?');
  await page.locator('.assistant-ai-send').click();
  await expect(page.locator('.assistant-product-card')).toBeVisible();

  expect(sessions).toHaveLength(2);
  expect(sessions[0], 'session_id não foi enviado').toBeTruthy();
  expect(sessions[1], 'a conversa limpa reusou a sessão antiga').not.toBe(sessions[0]);
});

test('o menu fecha ao clicar fora e com Escape', async ({ page }) => {
  await openAssistant(page);
  const menu = page.locator('#assistantHdrMenu');
  const button = page.locator('#assistantHdrMenuBtn');

  await button.click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  await page.locator('#assistantIntroQuestion').click();
  await expect(menu).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await button.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('a sacola vive no cabeçalho e não empurra o título do centro', async ({ page }) => {
  await openAssistant(page);
  const cart = page.locator('#assistantCartButton');
  const title = page.locator('#mobViewAssistant .assistant-hdr-title');

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
  await expect(page.locator('#assistantCartCount')).toHaveText('1');

  const centeredAfter = await title.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return Math.round(rect.left + rect.width / 2 - window.innerWidth / 2);
  });
  expect(Math.abs(centeredBefore), 'o título não nasceu centralizado').toBeLessThanOrEqual(1);
  expect(centeredAfter, 'a sacola empurrou o título').toBe(centeredBefore);
});
