import { test, expect } from '@playwright/test';
import { mockApi, SLUG, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// Fase 5, bloco D. Dois contratos:
//
//   1. o service worker NUNCA guarda nem serve cardápio, preço ou taxa;
//   2. o manifest é do TENANT, com escopo que não invade o vizinho.
//
// O item 1 é o que impede um pedido fechado por um preço que a loja não pratica
// mais. Ele é testado pelo que o cache CONTÉM e pelo que a tela mostra quando a
// API cai — não pela leitura do código do worker.

const PILOT_NAME = 'Júnior da Picanha';

/**
 * Espera o worker CONTROLAR a página, não apenas existir.
 *
 * `registration.active` só diz que ele ativou; enquanto o clients.claim() não
 * completa, as requisições da página não passam por ele. Esperar pelo active e
 * medir o cache logo depois é a receita de um falso verde: cache vazio faz toda
 * asserção "não contém preço" deste arquivo passar sem provar nada.
 */
async function waitForController(page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 20_000
  });
}

/**
 * A SEGUNDA visita — que é a única em que o worker vê a página desde o primeiro
 * byte, e portanto a única em que ele teria chance de servir algo velho.
 */
async function bootControlled(page, url = RESTAURANT_URL) {
  await page.goto(url);
  await waitForController(page);
  await page.reload();
  await esperarAppPronto(page);
}

/** Toda URL guardada em qualquer cache do worker. */
function cachedUrls(page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

const HASHED_ASSET = /\/assets\/.+-[A-Za-z0-9_-]{8}\.(js|css)$/;

/**
 * Espera o cache PARAR de crescer.
 *
 * `cache.put` acontece fora da linha do tempo da navegação: a página já disparou
 * o `load` e o worker ainda está gravando. Uma espera fixa aqui é uma corrida —
 * e, pior, uma corrida que faria as asserções NEGATIVAS deste arquivo passarem
 * com o cache vazio, dando falso verde exatamente no contrato que importa.
 */
async function settledCache(page) {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const urls = await cachedUrls(page);
        const stable = urls.length > 0 && urls.length === previous;
        previous = urls.length;
        return stable;
      },
      { timeout: 15_000, intervals: [300] }
    )
    .toBe(true);
  return cachedUrls(page);
}

test('o worker registra e assume a página', async ({ page }) => {
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await waitForController(page);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration.scope;
  });
  // Escopo na raiz: o worker precisa ver a navegação de qualquer tenant.
  expect(new URL(scope).pathname).toBe('/');
});

test('NADA de cardápio, preço ou taxa entra no cache do worker', async ({ page }) => {
  await mockApi(page);
  await bootControlled(page);
  // Exercita as telas que puxam dado: cardápio, info da loja, entrega.
  await page.evaluate(() => window.setMobNavActive?.('mobViewMenu'));
  await page.evaluate(() => window.openRestaurantInfo?.());

  const urls = await settledCache(page);

  // A garantia estrutural: nada da origem da API é cacheável.
  expect(urls.filter(url => url.includes('api.pederapidex.com'))).toEqual([]);
  // E, por nome, os endpoints que carregam preço.
  const dados = urls.filter(url => /\/menu|\/info|\/delivery|\/coupons|\/orders/.test(url));
  expect(dados, `endpoint de dado no cache:\n${dados.join('\n')}`).toEqual([]);
});

test('o worker também não guarda o manifest nem a si mesmo', async ({ page }) => {
  await mockApi(page);
  await bootControlled(page);

  const urls = await settledCache(page);
  expect(urls.filter(url => /manifest\.webmanifest|\/sw\.js/.test(url))).toEqual([]);
});

test('com o worker no ar, o cardápio continua vindo da rede a cada visita', async ({ page }) => {
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await waitForController(page);

  // Só conta as chamadas DEPOIS que o worker está controlando a página.
  const menuRequests = [];
  page.on('request', request => {
    if (/\/menu(\?|$)/.test(request.url())) menuRequests.push(request.url());
  });

  await page.reload();
  await esperarAppPronto(page);

  expect(menuRequests.length, 'o cardápio foi servido de cache, sem revalidar').toBeGreaterThan(0);
});

test('API fora do ar não faz o worker servir cardápio velho', async ({ page }) => {
  // 1ª visita: sucesso. É aqui que um worker mal escrito guardaria o cardápio.
  await mockApi(page);
  await bootControlled(page);
  await expect(page.locator('.mob-rest-name').first()).toHaveText(PILOT_NAME);

  // 2ª visita com a API morta. O app tem que falhar À VISTA.
  await page.route('**/api.pederapidex.com/**', route => route.abort('failed'));
  await page.reload();

  await expect(page.locator('body')).toHaveClass(/app-error/, { timeout: 15_000 });
  // Nenhum produto do cardápio anterior sobreviveu na tela.
  await expect(page.locator('.prod-card')).toHaveCount(0);
});

test('o casco e os assets hasheados SÃO cacheados — o worker precisa servir para algo', async ({
  page
}) => {
  await mockApi(page);
  await bootControlled(page);

  const urls = await settledCache(page);
  expect(urls.some(url => HASHED_ASSET.test(url))).toBe(true);
});

test('o manifest é o do tenant, servido sob o diretório dele', async ({ page }) => {
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  // Assim que a marca chega da API, o href vira um blob com nome e cor do
  // restaurante. Antes disso, é a URL estática por tenant.
  await expect
    .poll(() => page.getAttribute('link[rel="manifest"]', 'href'), { timeout: 10_000 })
    .toMatch(/^blob:/);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    return (await fetch(href)).json();
  });

  expect(manifest.short_name).toBe(PILOT_NAME);
  expect(new URL(manifest.scope).pathname).toBe(`/${SLUG}/`);
  expect(new URL(manifest.start_url).pathname).toBe(`/${SLUG}/`);
  expect(manifest.id).toBe(manifest.start_url);
});

test('a URL estática do manifest do tenant existe de verdade (rewrite)', async ({ page, request }) => {
  await mockApi(page);
  await page.goto(RESTAURANT_URL);

  // O href ANTES de a API responder: a camada estática, que é o que vale se o
  // JS falhar ou o blob for barrado.
  const href = await page.evaluate(() => window.RapidexPWA.staticManifestUrl('junior-da-picanha', 'path'));
  expect(href).toBe(`/${SLUG}/manifest.webmanifest`);

  // Se esta rota der 404, o app instalado abre numa tela de erro.
  const response = await request.get(href);
  expect(response.status(), `${href} não resolve — falta o rewrite`).toBe(200);

  const manifest = await response.json();
  // Relativos: é o que faz UM arquivo servir N tenants.
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
});

test('o diretório do tenant resolve e boota o restaurante certo', async ({ page }) => {
  await mockApi(page);
  // O start_url do app instalado. Sem o rewrite da barra final, isto é 404.
  await page.goto(`/${SLUG}/`);

  await expect(page.locator('body')).not.toHaveClass(/app-error/);
  await expect(page.locator('.mob-rest-name').first()).toHaveText(PILOT_NAME);
});

test('a landing NÃO tem manifest: o escopo "/" dela engoliria todo restaurante', async ({
  page
}) => {
  await page.goto('/index.html');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

// ============================================================================
//  O ano do rodape da landing acompanha o relogio.
//
//  Ate 02/09/2026 o rodape dizia "© 2025" — errado desde 1º de janeiro, na
//  landing, para todo visitante. Um ano escrito a mao apodrece em silencio:
//  nada quebra, nenhum teste cai, e quem percebe e quem esta avaliando a
//  empresa.
//
//  ESTE TESTE NAO E UMA BOMBA-RELOGIO, e a diferenca importa. Ele nao tem ano
//  embutido: compara o ano da PAGINA com o ano de quem esta rodando, e os dois
//  andam juntos. E o mesmo padrao de  no helpers — derivar do
//  relogio em vez de cravar um literal que um dia fica para tras.
// ============================================================================
test('o rodape da landing mostra o ano corrente, e nao um ano cravado', async ({ page }) => {
  await page.goto('/index.html');
  const anoAgora = String(new Date().getFullYear());
  await expect(page.locator('#landingCopyYear')).toHaveText(anoAgora);
  await expect(page.locator('.landing-footer')).toContainText(`© ${anoAgora} Rapidex`);
});
