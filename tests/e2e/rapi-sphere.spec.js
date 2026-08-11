import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O } from './helpers.js';

// A esfera que substituiu o mascote no app do consumidor.
//
// O que estes testes travam é o CONTRATO, não o desenho: a esfera sai da cor
// cadastrada pelo lojista (e só dela), tem os três estados que a tela usa, para
// sem sumir sob prefers-reduced-motion, e a abertura não volta a ser uma tela
// vazia. Nada aqui mede pixel de gradiente — o gradiente pode mudar.

const CHAT_ANSWER = {
  response_type: 'products',
  message: 'Boa! Separei uma opção gelada.',
  products: [{ id: PRODUCT_H2O, name: 'Água H2O', price: 7.05 }]
};

async function openAssistant(page, { chatDelay = 0, viewport } = {}) {
  await page.setViewportSize(viewport || { width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/chat', async route => {
    if (chatDelay) await new Promise(resolve => setTimeout(resolve, chatDelay));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHAT_ANSWER)
    });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('mobNavRapi')());
  await expect(page.locator('#mobViewRapi .rapi-hdr')).toBeVisible();
}

/** Espera a abertura terminar de se revelar (pergunta digitada + sugestões). */
async function waitForIntro(page) {
  await expect(page.locator('#rapiStarter')).toHaveClass(/is-ready/);
}

test('a esfera é pintada com a cor do restaurante, sem cor fixa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const painted = () => page.locator('#rapiIntroSphere .rapi-sphere-body')
    .evaluate(el => getComputedStyle(el).backgroundImage);

  const withPlatformOrange = await painted();
  // O tema inteiro sai de UMA cor; trocar essa cor tem que repintar a esfera.
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#2A2D7C'));
  const withIndigo = await painted();

  expect(withPlatformOrange).toContain('rgb(');
  expect(withIndigo, 'a esfera não acompanhou a cor do tenant').not.toBe(withPlatformOrange);
  // E o azul aparece de fato na pintura — não é só uma variável que mudou.
  expect(withIndigo).toMatch(/rgb\(\s*4[0-9],\s*4[0-9],\s*12[0-9]\s*\)/);
});

test('é CSS, não vídeo nem imagem', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const media = await page.locator('#rapiIntroSphere').evaluate(el => ({
    tags: [...el.querySelectorAll('*')].map(child => child.tagName),
    url: getComputedStyle(el.querySelector('.rapi-sphere-body')).backgroundImage
  }));

  expect(media.tags).not.toContain('IMG');
  expect(media.tags).not.toContain('VIDEO');
  expect(media.tags).not.toContain('CANVAS');
  expect(media.url, 'a esfera passou a depender de um arquivo').not.toContain('url(');
});

test('os três estados mudam o ritmo da animação', async ({ page }) => {
  await openAssistant(page, { chatDelay: 2500 });
  await waitForIntro(page);

  const sphere = page.locator('#rapiIntroSphere');
  const duration = () => sphere.locator('.rapi-sphere-body')
    .evaluate(el => parseFloat(getComputedStyle(el).animationDuration));

  await expect(sphere).toHaveAttribute('data-state', 'idle');
  const idle = await duration();

  await page.locator('.rapi-starter-card').first().click();
  await expect(sphere).toHaveAttribute('data-state', 'thinking');
  const thinking = await duration();

  // Pensando é mais rápido que parado — é isso que o estado significa.
  expect(thinking, 'pensando não acelerou').toBeLessThan(idle);

  // Respondendo volta ao ritmo calmo.
  await expect(sphere).toHaveAttribute('data-state', 'answering', { timeout: 15000 });
  expect(await duration()).toBe(idle);
});

test('sob movimento reduzido ela para, e não some', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAssistant(page);
  await waitForIntro(page);

  const state = await page.locator('#rapiIntroSphere').evaluate(el => {
    const rect = el.getBoundingClientRect();
    const layer = name => {
      const style = getComputedStyle(el.querySelector(name));
      return { animation: style.animationName, opacity: Number(style.opacity) };
    };
    return {
      width: Math.round(rect.width),
      visibility: getComputedStyle(el).visibility,
      body: layer('.rapi-sphere-body'),
      halo: layer('.rapi-sphere-halo')
    };
  });

  expect(state.body.animation, 'a esfera continuou animando').toBe('none');
  expect(state.halo.animation).toBe('none');
  // Parada, mas inteira: some seria trocar a animação por um buraco na tela.
  expect(state.width).toBeGreaterThan(40);
  expect(state.visibility).toBe('visible');
  expect(state.body.opacity).toBe(1);
  expect(state.halo.opacity).toBeGreaterThan(0);
});

test('o slot central do menu mostra a esfera parada, maior e acima da barra', async ({ page }) => {
  await openAssistant(page);

  const navSphere = page.locator('#mobNavQr .rapi-sphere--nav');
  await expect(navSphere).toBeVisible();
  await expect(navSphere).toHaveAttribute('data-state', 'static');
  await expect(navSphere.locator('.rapi-sphere-body'))
    .toHaveCSS('animation-name', 'none');

  const geometry = await page.evaluate(() => {
    const box = sel => {
      const rect = document.querySelector(sel).getBoundingClientRect();
      return { top: rect.top, width: rect.width, height: rect.height };
    };
    return {
      center: box('#mobNavQr .menu-mobile-center'),
      neighbour: box('#mobNavHome'),
      bar: box('#mobBottomNav')
    };
  });

  expect(geometry.center.width, 'o slot central não é maior que os vizinhos')
    .toBeGreaterThan(geometry.neighbour.width * 0.6);
  expect(geometry.center.height).toBeGreaterThan(geometry.neighbour.height * 0.9);
  // Sobe acima da barra, como o slot central do Take a Juice.
  expect(geometry.center.top, 'o círculo não subiu acima da barra')
    .toBeLessThan(geometry.bar.top);
});

test('a abertura oferece sugestões clicáveis montadas com o cardápio do tenant', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const cards = page.locator('.rapi-starter-card:visible');
  const count = await cards.count();
  expect(count, 'a tela voltou a abrir sem sugestões').toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(4);

  // Pelo menos uma pergunta nasce do cardápio DESTE restaurante: uma lista
  // 100% fixa não sobreviveria ao primeiro tenant de outro vertical.
  const labels = await cards.allInnerTexts();
  const categories = await page.evaluate(() =>
    (window.PedeAquiRestaurantStore.get().categories || []).map(category => category.name.toLowerCase()));
  expect(categories.length, 'o fixture perdeu as categorias').toBeGreaterThan(0);
  expect(
    labels.some(label => categories.some(category => label.toLowerCase().includes(category))),
    `nenhuma sugestão veio do cardápio: ${JSON.stringify(labels)}`
  ).toBe(true);

  // E tocar numa sugestão envia a pergunta.
  const chosen = (await cards.first().innerText()).trim();
  const [request] = await Promise.all([
    page.waitForRequest(req => req.url().includes('/chat') && req.method() === 'POST'),
    cards.first().click()
  ]);
  expect(JSON.parse(request.postData()).message).toBe(chosen);
  await expect(page.locator('.rapi-chat-user-message')).toContainText(chosen);
});

test('carregando: esqueleto no lugar da resposta, não meia tela em branco', async ({ page }) => {
  await openAssistant(page, { chatDelay: 3000 });
  await waitForIntro(page);
  await page.locator('.rapi-starter-card').first().click();

  const skeleton = page.locator('#rapiTypingMessage');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.rapi-sphere--mini')).toHaveAttribute('data-state', 'thinking');
  await expect(skeleton.locator('.rapi-skeleton-line')).toHaveCount(3);
  await expect(skeleton.locator('.rapi-skeleton-card')).toHaveCount(3);

  // O esqueleto ocupa o lugar EXATO do que está vindo: o cartão fantasma tem a
  // largura do cartão de produto real que vai substituí-lo.
  const ghostWidth = await skeleton.locator('.rapi-skeleton-card').first()
    .evaluate(el => Math.round(el.getBoundingClientRect().width));

  await expect(page.locator('.rapi-product-card').first()).toBeVisible({ timeout: 15000 });
  const realWidth = await page.locator('.rapi-product-card').first()
    .evaluate(el => Math.round(el.getBoundingClientRect().width));

  expect(Math.abs(ghostWidth - realWidth), 'o esqueleto não tem a medida do cartão real')
    .toBeLessThanOrEqual(2);
  await expect(skeleton).toHaveCount(0);
});

test('nada nesta tela nomeia a plataforma', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // Varre o que o cliente LÊ, incluindo rótulos de acessibilidade — a marca
  // saía por aí também ("Escolha do Rapi", aria-label="Rapi").
  const leaked = await page.evaluate(() => {
    const screen = document.getElementById('mobViewRapi');
    const nav = document.getElementById('mobBottomNav');
    const texts = [];
    for (const root of [screen, nav]) {
      texts.push(root.innerText || '');
      for (const el of root.querySelectorAll('[aria-label],[alt],[title],[placeholder]')) {
        texts.push(el.getAttribute('aria-label'), el.getAttribute('alt'),
          el.getAttribute('title'), el.getAttribute('placeholder'));
      }
    }
    return texts.filter(Boolean).filter(text => /\brapi(dex)?\b/i.test(text));
  });

  expect(leaked, 'a marca da plataforma voltou ao app do consumidor').toEqual([]);
});
