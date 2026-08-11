import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

// Imagens cuja URL é montada por STRING dentro do JS. O module graph do Vite
// não as enxerga, então elas dependem de uma cópia verbatim configurada à mão
// em vite.config.js — e uma cópia configurada à mão é a que silenciosamente
// deixa de bater com o que o código pede.
//
// Foi exatamente o que aconteceu: `{ src: 'assets/**/*', dest: 'assets' }`
// gravava em /assets/assets/brand/..., o runtime pedia /assets/brand/... e o
// mascote respondia 404 no build. Como o <img> carrega data-act-error="$hide",
// ele se escondia sozinho e nenhuma tela acusava o erro.
//
// Este teste lê o caminho DO PRÓPRIO CÓDIGO-FONTE em vez de repeti-lo aqui: uma
// cópia literal da string voltaria a passar no dia em que o código mudasse e a
// config não. Assim, quem mover o asset sem ajustar o build vê o teste falhar.
function runtimeAssetPaths() {
  const sources = [
    'scripts/pages/restaurant-assistant.js',
    'scripts/pages/restaurant-page.js'
  ];
  const found = new Set();
  for (const file of sources) {
    const code = readFileSync(resolve(repo, file), 'utf8');
    for (const [, path] of code.matchAll(/['"`](assets\/[\w@./-]+\.(?:webp|png|avif|jpg|svg))['"`]/g)) {
      found.add(path);
    }
    // O mascote e os ícones do carrinho montam o srcset por template, então o
    // caminho aparece interpolado (`${stem}@2x.webp`). Reconstrói esses casos.
    for (const [, stem] of code.matchAll(/['"`](assets\/[\w./-]+)@\$\{?/g)) {
      found.add(`${stem}@1x.webp`);
      found.add(`${stem}@2x.webp`);
    }
  }
  return [...found];
}

test('toda imagem que o JS pede por string existe no build', async ({ request }) => {
  const paths = runtimeAssetPaths();

  // Se o scraping não achou nada, o teste virou decoração — falha alto.
  expect(paths.length, 'nenhum caminho de asset encontrado no código-fonte').toBeGreaterThan(0);

  const results = [];
  for (const path of paths) {
    const response = await request.get(`/${path}`);
    results.push({ path, status: response.status(), type: response.headers()['content-type'] });
  }

  const broken = results.filter(r => r.status !== 200);
  expect(broken, `assets 404 no build: ${JSON.stringify(broken, null, 2)}`).toEqual([]);

  // 200 não basta: um SPA fallback devolve 200 com text/html para tudo.
  const notImages = results.filter(r => !String(r.type || '').startsWith('image/'));
  expect(notImages, `respondeu 200 mas não é imagem: ${JSON.stringify(notImages, null, 2)}`).toEqual([]);
});

// O app do consumidor NÃO baixa arte da plataforma. Os arquivos do mascote
// saíram do repositório; se alguma URL com nome de marca voltar a ser pedida por
// esta tela, é porque alguém reintroduziu a plataforma numa superfície
// white-label — e o teste tem que falhar antes de o cliente do restaurante ver.
test('nenhuma arte da plataforma é baixada pelo app do consumidor', async ({ page }) => {
  // Casa NOME DE ARQUIVO de arte da plataforma, não qualquer URL que contenha
  // "rapidex": o host da API é api.pederapidex.com e os modelos de cupom moram
  // num bucket chamado /rapidex/. Nenhum dos dois é arte, e nenhum dos dois é
  // visível — incluí-los aqui só transformaria o teste em ruído.
  const brandRequests = [];
  page.on('request', request => {
    if (/\/[^/?]*(mascot|nav-avatar|rapidex-\d+|rapidex-maskable)[^/?]*\.(png|webp|svg|avif)/i.test(request.url())) {
      brandRequests.push(request.url());
    }
  });

  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));

  await page.waitForFunction(() => Boolean(window.RapidexActions?.registry?.mobNavAssistant));
  await page.evaluate(() => window.RapidexActions.registry.mobNavAssistant());
  await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();

  expect(brandRequests, 'a arte da plataforma voltou ao app do cliente').toEqual([]);
  // E o lugar dela não ficou vazio: a janela desenhada em CSS ocupa a abertura.
  await expect(page.locator('#assistantIntroMark')).toBeVisible();
});

test('as fotos do cardápio pedem miniatura, não a foto inteira', async ({ page }) => {
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));

  // A grade de produtos vive na aba cardápio.
  await page.waitForFunction(() => typeof window.mobNavMenu === 'function');
  await page.evaluate(() => window.mobNavMenu());

  const card = page.locator('.product-card .product-image').first();
  await expect(card).toBeVisible();

  const srcset = await card.getAttribute('srcset');
  expect(srcset, 'a foto de produto perdeu o srcset').toBeTruthy();
  expect(srcset).toContain('/render/image/public/');

  // A caixa tem 110px em CSS: nenhum candidato pode passar de 3x isso, senão
  // voltamos a baixar a foto original para desenhar uma miniatura.
  const widths = [...srcset.matchAll(/width=(\d+)/g)].map(m => Number(m[1]));
  expect(widths.length).toBeGreaterThan(0);
  expect(Math.max(...widths)).toBeLessThanOrEqual(330);
});
