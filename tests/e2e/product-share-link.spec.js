import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O, SLUG, MENU, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O ENDEREÇO DE UM PRATO, E O CARTÃO QUE O ANUNCIA.
//
//  Até aqui o app tinha UMA url por loja: abrir um produto não mudava a barra
//  de endereço, e o `og:image` continuava sendo a logo. Quem quisesse mandar um
//  prato para alguém mandava a home.
//
//  As duas metades são testadas juntas de propósito, porque uma sem a outra é
//  pior que nenhuma: só o cartão é a foto do prato abrindo a home; só a url é
//  um link que abre o prato e se anuncia com a logo.
//
//  O QUE ESTE ARQUIVO NÃO PODE PROVAR: que o preview do WhatsApp mostre a foto.
//  O crawler dele não executa JavaScript e o app é estático (nenhuma função em
//  `vercel.json`), então o cartão escrito aqui alcança quem EXECUTA — o
//  navegador embutido do Instagram e do WhatsApp ao ABRIR o link, o Web Share
//  da aba, extensões. Está escrito assim em `tenant-identity.js`.
// ============================================================================

const meta = (page, chave) => page.evaluate((k) => {
  const atributo = k.startsWith('og:') ? 'property' : 'name';
  return document.querySelector(`meta[${atributo}="${k}"]`)?.getAttribute('content') || '';
}, chave);

const PRODUTO = MENU.products.find(p => String(p.id) === String(PRODUCT_H2O));

async function abrirLoja(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
}

test('abrir um produto troca a url E o cartao de compartilhamento', async ({ page }) => {
  await abrirLoja(page);

  // A LOJA, antes: logo no og:image e o cartão pequeno.
  const logoDaLoja = await meta(page, 'og:image');
  expect(logoDaLoja, 'a loja não tinha og:image — a sonda perdeu o alvo').not.toBe('');
  expect(await meta(page, 'twitter:card')).toBe('summary');

  await page.evaluate(id => window.openProduct(id), PRODUCT_H2O);
  await expect(page.locator('#productModal')).toHaveClass(/active/);

  // A URL. É `replaceState`, não navegação: a página é a mesma.
  expect(new URL(page.url()).pathname).toBe(`/${SLUG}/produto/${PRODUCT_H2O}`);

  // O CARTÃO. A foto do produto no lugar da logo, e o cartão GRANDE — o
  // `summary` quadrado serve a uma logo e desperdiça uma fotografia.
  const fotoDoProduto = await meta(page, 'og:image');
  expect(fotoDoProduto).not.toBe(logoDaLoja);
  expect(fotoDoProduto).toContain(PRODUTO.image_url.split('/').pop());
  expect(await meta(page, 'twitter:card')).toBe('summary_large_image');
  expect(await meta(page, 'og:type')).toBe('product');
  expect(await meta(page, 'og:title')).toContain(PRODUTO.name);
  // O `og:url` é a url DO PRODUTO: um cartão que mostra um prato e abre a home
  // é pior que um cartão genérico.
  expect(await meta(page, 'og:url')).toContain(`/produto/${PRODUCT_H2O}`);
  // E o preço entra na descrição — é o que separa este cartão de um genérico.
  expect(await meta(page, 'og:description')).toContain('7,05');
});

test('fechar o produto devolve a url e o cartao da LOJA', async ({ page }) => {
  await abrirLoja(page);
  const logoDaLoja = await meta(page, 'og:image');
  const tituloDaLoja = await meta(page, 'og:title');

  await page.evaluate(id => window.openProduct(id), PRODUCT_H2O);
  await expect(page.locator('#productModal')).toHaveClass(/active/);
  expect(await meta(page, 'og:image')).not.toBe(logoDaLoja);

  await page.locator('#productModal .modal-close').click();
  await expect(page.locator('#productModal')).not.toHaveClass(/active/);

  // Sem esta volta, a loja ficaria anunciando para sempre o último prato que
  // alguém abriu — e o endereço apontaria para ele.
  expect(new URL(page.url()).pathname).toBe(`/${SLUG}`);
  expect(await meta(page, 'og:image')).toBe(logoDaLoja);
  expect(await meta(page, 'og:title')).toBe(tituloDaLoja);
  expect(await meta(page, 'twitter:card')).toBe('summary');
  expect(await meta(page, 'og:type')).toBe('website');
});

test('entrar POR um link de produto abre aquele produto', async ({ page }) => {
  // A metade que funciona para todo mundo, crawler ou não: o link ABRE o prato.
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(`${RESTAURANT_URL}&produto=${PRODUCT_H2O}`);
  await esperarAppPronto(page);

  await expect(page.locator('#productModal')).toHaveClass(/active/);
  await expect(page.locator('#pmName')).toHaveText(PRODUTO.name);
  // A grafia `?produto=` some da barra: quem abre o produto reescreve para
  // `/{slug}/produto/{id}`, e deixar as duas competindo daria dois endereços
  // para o mesmo lugar em histórico, compartilhamento e cache.
  expect(page.url()).not.toContain('produto=');
  expect(new URL(page.url()).pathname).toBe(`/${SLUG}/produto/${PRODUCT_H2O}`);
});

test('link com id que nao existe no cardapio abre a LOJA, sem travar o boot', async ({ page }) => {
  // Link velho, produto que saiu do cardápio, ou link de outra filial. O
  // destino certo é a loja — e o boot não pode morrer por causa disso.
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(`${RESTAURANT_URL}&produto=nao-existe-mais`);
  await esperarAppPronto(page);

  await expect(page.locator('#productModal')).not.toHaveClass(/active/);
  await expect(page.locator('body')).toHaveClass(/home-tab/);
  // O cartão continua o da loja: nada de produto foi escrito.
  expect(await meta(page, 'og:type')).toBe('website');
});
