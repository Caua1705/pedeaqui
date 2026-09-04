import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, esperarAppPronto, RESTAURANT_URL, ORDERS } from './helpers.js';

// ============================================================================
//  NENHUMA IMAGEM DO STORAGE PODE SER PEDIDA NO TAMANHO ORIGINAL.
//
//  O Supabase serve derivadas em `/render/image/public/` com `?width=`, e o
//  front tem o montador para isso desde sempre (`utils/image-cdn.js`). O que
//  faltava era ALCANCE: os dois helpers moravam em `restaurant-page.js` e só
//  chegavam às telas que recebem `shell`. Medido em 05/09/2026, METADE dos
//  sítios pedia o original — o logo do cabeçalho, o do login, o das
//  Informações, o da Ajuda, o do Pix, os dois do detalhe do pedido, a arte do
//  cupom no Clube e as duas fotos do assistente.
//
//  Um logo de catálogo desenhado num círculo de 45px, em toda visita, é a
//  conta de egress do plano inteiro — e é INVISÍVEL: a tela fica perfeita, o
//  teste passa, e o custo só aparece na fatura.
//
//  ESTE TESTE INTERCEPTA O STORAGE e responde um pixel local. Isso não é só
//  higiene de rede: a suíte inteira baixa as imagens do bucket de PRODUÇÃO
//  hoje (`mockApi()` só intercepta `api.pederapidex.com`), e cada contexto do
//  Playwright nasce com cache vazio. Aqui, pelo menos, nada escapa.
//
//  O QUE ELE NÃO ALCANÇA, e é preciso dizer: a arte do cupom no Clube e as
//  duas fotos do assistente. As três exigem uma conversa ou uma lista que este
//  roteiro não monta; elas estão cobertas por leitura, não por medida. Se
//  alguém montar o caminho, acrescente aqui.
// ============================================================================

// PNG de 1x1 que DECODIFICA — o webp curto que estava aqui deixava
// `naturalWidth` em zero com `complete` true (ver helpers.js).
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function bootarEspionando(page) {
  const pedidos = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  // DEPOIS do mockApi: no page.route a última registrada vence, e esta precisa
  // ver as imagens antes de qualquer outra coisa (§4 da skill).
  await page.route(/https:\/\/[^/]+\.supabase\.co\//, route => {
    pedidos.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'e2e-token-login'));
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  return pedidos;
}

const semLargura = (pedidos) => pedidos.filter(url => !url.includes('width='));

test('nenhuma imagem do Storage é pedida em tamanho original', async ({ page }) => {
  const pedidos = await bootarEspionando(page);
  await page.waitForTimeout(800);

  // As telas que desenham o logo, uma a uma: cabeçalho (Home), Informações da
  // loja, folha de login e o detalhe do pedido no Perfil. Os quatro pediam o
  // original, cada um com um lado diferente — 45, 95, 150 e 40.
  await page.evaluate(() => window.openModal('infoModal'));
  await expect(page.locator('#infoModal')).toHaveClass(/active/);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.RapidexActions.resolve('closeModalId')?.('infoModal'));

  await page.evaluate(() => window.openLoginScreen('profile'));
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.RapidexActions.resolve('closeLoginScreen')?.());

  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('pedidos'));
  await page.evaluate(id => window.RapidexActions.resolve('openProfOrderDetails')(id), ORDERS[0].id);
  await page.waitForTimeout(1200);

  // SONDA CONTRA VACUIDADE: se o roteiro parar de desenhar imagem (um seletor
  // que mudou, uma tela que não abre), a lista fica vazia, o filtro fica vazio
  // junto e o teste passa sem ter olhado para nada.
  expect(pedidos.length, 'o roteiro não desenhou imagem nenhuma').toBeGreaterThan(8);

  const originais = semLargura(pedidos);
  expect(
    originais,
    `imagem(ns) pedida(s) em tamanho ORIGINAL:\n  ${originais.map(u => u.split('/storage/v1')[1]).join('\n  ')}`
  ).toEqual([]);
});

test('o logo pede o lado de CADA caixa, e não um tamanho só', async ({ page }) => {
  // A mesma URL em quatro lugares com quatro lados diferentes. Um número só
  // para os quatro seria pedir 150px para um círculo de 45 — o desperdício de
  // antes com outro nome — ou 45 para um de 150, que é uma marca borrada.
  const pedidos = await bootarEspionando(page);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.openModal('infoModal'));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.RapidexActions.resolve('closeModalId')?.('infoModal'));
  await page.evaluate(() => window.openLoginScreen('profile'));
  await page.waitForTimeout(600);

  const larguras = new Set(
    pedidos
      .filter(url => url.includes('/brand/logo.webp'))
      .map(url => Number(new URL(url).searchParams.get('width')))
  );
  // 45 (cabeçalho), 95 (Informações) e 150 (folha de login).
  expect([...larguras].sort((a, b) => a - b)).toEqual(expect.arrayContaining([45, 95, 150]));
});
