import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, INFO, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  A tela de INFORMAÇÕES do restaurante.
//
//  `tests/fixtures/info.json` é cópia fiel da produção — e é por isso que estes
//  testes valem: o piloto tem 10 formas de pagamento na entrega e NÃO tem
//  e-mail (`branch.email: null`).
// ============================================================================

async function abrirInformacoes(page) {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openRestaurantInfo')());
  await expect(page.locator('#infoModal')).toHaveClass(/active/);
  await page.waitForFunction(
    () => !/Carregando/.test(document.getElementById('storeInfoPayment')?.textContent || 'Carregando')
  );
}

// A ABA PAGAMENTO TINHA ALTURA FIXA, e a lista de formas de pagamento é DA
// LOJA. `#infoModal[data-store-info-tab="payment"] .store-payment-card` vinha
// com `height:301px;min-height:301px`, um número calibrado para uma lista só.
// Medido com o fixture de produção: o conteúdo é 321px, então as duas últimas
// bandeiras do Débito caíam PARA FORA do cartão branco, em cima do cinza da
// página. Uma loja com menos formas ganhava o defeito ao contrário: uma faixa
// branca vazia.
//
// Num app white-label, altura fixa sobre dado do lojista é sempre isto.
test('o cartão de Pagamento cresce com a lista da loja, em vez de vazar', async ({ page }) => {
  await abrirInformacoes(page);
  await page.locator('.store-info-tabs button[data-store-tab="payment"]').click();

  const caixa = await page.locator('#storeInfoPayment').evaluate(el => ({
    altura: Math.round(el.getBoundingClientRect().height),
    conteudo: el.scrollHeight
  }));

  expect(
    caixa.altura,
    `o conteúdo (${caixa.conteudo}px) não cabe no cartão (${caixa.altura}px) e vaza para o fundo cinza`
  ).toBeGreaterThanOrEqual(caixa.conteudo);
});

// Um `<i class="pay-brand">` sem arte de bandeira é um retângulo branco vazio
// de 30x20 ao lado do rótulo — foi o que apareceu ao lado de "PIX". A arte
// existe para cinco bandeiras de cartão; PIX, dinheiro e vale não têm nenhuma,
// e o backend continua livre para mandar uma sexta bandeira amanhã.
test('forma de pagamento sem arte de bandeira não desenha um retângulo vazio', async ({ page }) => {
  await abrirInformacoes(page);
  await page.locator('.store-info-tabs button[data-store-tab="payment"]').click();

  const pix = page.locator('#storeInfoPayment .store-payment-grid span', { hasText: 'PIX' }).first();
  await expect(pix).toBeVisible();
  await expect(pix.locator('.pay-brand'), 'PIX não tem arte de bandeira').toHaveCount(0);

  // E onde a arte EXISTE ela continua desenhada — senão este teste teria
  // apagado as bandeiras todas e passado.
  const visa = page.locator('#storeInfoPayment .store-payment-grid span', { hasText: 'Visa' }).first();
  await expect(visa.locator('.pay-brand.pay-brand--visa')).toHaveCount(1);
});

// A LISTA DE BANDEIRAS VEM DO BACKEND, e este teste é a prova — não o código
// lido. É a mesma pergunta que tirou os seis chips escritos à mão de
// #profSubinfo (§12.6 da skill): markup de UM tenant no HTML compartilhado.
test('as bandeiras exibidas são as que /info mandou, e nada além delas', async ({ page }) => {
  await abrirInformacoes(page);
  await page.locator('.store-info-tabs button[data-store-tab="payment"]').click();

  const naTela = await page
    .locator('#storeInfoPayment .store-payment-grid span')
    .evaluateAll(els => els.map(el => el.textContent.trim()));

  const doContrato = new Set(
    [...(INFO.payment_methods.online || []), ...(INFO.payment_methods.delivery || [])]
      .map(m => m.label)
  );

  expect(naTela.length).toBeGreaterThan(0);
  const inventadas = naTela.filter(rotulo => !doContrato.has(rotulo));
  expect(inventadas, `rótulo que /info não mandou: ${inventadas.join(', ')}`).toEqual([]);
});

// "E-mail não informado" é anunciar a ausência. A loja do fixture (produção)
// não tem e-mail, e o cliente lia isso nas duas superfícies.
test('sem e-mail, a linha inteira some — no modal e no Perfil', async ({ page }) => {
  expect(INFO.branch.email, 'o fixture precisa ser o de uma loja SEM e-mail').toBeFalsy();

  await abrirInformacoes(page);
  // No modal o markup e estatico, entao a linha e ESCONDIDA — e o `[hidden]`
  // sozinho perderia para o `display:inline-flex!important` que um seletor com
  // ID lhe da (§12.14 da skill). Este `toBeHidden` e o que prova que a folha
  // ganhou o `[hidden]{display:none}` de companhia.
  await expect(page.locator('#infoModal .store-info-email')).toBeHidden();
  await expect(page.locator('#infoModal')).not.toContainText('E-mail não informado');

  await page.evaluate(() => window.RapidexActions.resolve('closeModalId')?.('infoModal'));
  await page.locator('#mobNavProfile').click();
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('info'));
  await expect(page.locator('#profSubinfo')).toHaveClass(/active/);
  await expect(page.locator('#profSubinfo')).not.toContainText('E-mail não informado');
  // A linha inteira, não só o texto: um rótulo "E-mail" sozinho é a mesma
  // ausência anunciada, com menos palavras.
  await expect(page.locator('#profSubinfo .prof-info-row-label', { hasText: /^E-mail$/ })).toHaveCount(0);
});
