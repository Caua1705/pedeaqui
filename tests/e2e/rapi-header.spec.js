import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O } from './helpers.js';

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

// A logo do fixture aponta para um CDN de verdade. Sem este stub, o cabeçalho
// depende da rede para pintar e o teste passa a falhar por motivo errado.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function openRapi(page, { chat, logo = true } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/*logo*', route => logo
    ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
    : route.abort());
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

test('o título é a marca do RESTAURANTE, não a da plataforma', async ({ page }) => {
  await openRapi(page);

  await expect(page.locator('#rapiHdrName')).toHaveText('Júnior da Picanha');

  // A logo vem do cadastro do lojista — a mesma URL que o resto do app usa,
  // não uma cópia digitada aqui.
  const logo = page.locator('#mobViewRapi .rapi-hdr-logo img');
  await expect(logo).toBeVisible();
  const expected = await page.evaluate(() =>
    window.PedeAquiRestaurantStore.get().restaurant.logo_url);
  expect(expected, 'o fixture perdeu a logo').toBeTruthy();
  expect(await logo.getAttribute('src')).toBe(expected);
});

test('sem logo carregável, o cabeçalho cai nas iniciais do restaurante', async ({ page }) => {
  // A logo vive num CDN de terceiro: se ela não pintar, o título não pode ficar
  // com um quadrado quebrado no lugar da marca da loja.
  await openRapi(page, { logo: false });

  await expect(page.locator('#mobViewRapi .rapi-hdr-logo')).toHaveText('JP');
  await expect(page.locator('#rapiHdrName')).toHaveText('Júnior da Picanha');
});

test('o indicador "online" não existe mais', async ({ page }) => {
  await openRapi(page, { chat: false });
  // Ele imitava presença humana e prometia resposta imediata; com a API fora do
  // ar o cliente lia "online" enquanto esperava um erro. Não pode voltar nem
  // quando a chamada falha, que era exatamente quando ele mudava de cor.
  await page.route('**/chat', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));

  await expect(page.locator('#rapiHdrStatus')).toHaveCount(0);
  await expect(page.locator('#mobViewRapi .rapi-hdr-dot')).toHaveCount(0);

  await page.locator('#rapiInput').fill('Oi');
  await page.locator('.rapi-ai-send').click();

  // A falha é dita onde ela acontece: dentro da conversa, e não por um ponto
  // que muda de cor a 300px do erro.
  await expect(page.locator('.rapi-chat-assistant-message').last()).not.toBeEmpty();
  await expect(page.locator('#rapiHdrStatus')).toHaveCount(0);
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
