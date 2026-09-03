import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, addH2OToCart, ORDERS, MENU, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  COR DE ESTADO NÃO É COR DE MARCA.
//
//  A regra do white-label (§7 da skill) diz que cor chumbada é bug. Ela tem uma
//  exceção que precisa estar escrita, senão vira o defeito ao contrário: o que
//  o estado comunica — negado, concluído, apagar — não pode andar junto da
//  marca, porque aí a informação some. O X de "Recusado" e o check de
//  "Finalizado" saíam os dois em `var(--brand-light)`: a mesma cor, e a única
//  diferença entre "seu pedido foi recusado" e "seu pedido ficou pronto" era o
//  desenho de 12px dentro do círculo.
//
//  Num tenant azul isso fica pior ainda: dois círculos azuis, um deles dando
//  má notícia.
//
//  A suíte roda num tenant AZUL de propósito. Se a cor do estado seguisse a
//  marca, estes testes leriam azul — e é isso que eles proíbem.
// ============================================================================

const AZUL = '#1B4FD8';
const AZUL_RGB = 'rgb(27, 79, 216)';

const PEDIDOS = [
  { ...ORDERS[0], id: 'order-recusado', order_number: 9001, status: 'rejected' },
  { ...ORDERS[0], id: 'order-finalizado', order_number: 9002, status: 'completed' },
  { ...ORDERS[0], id: 'order-andamento', order_number: 9003, status: 'preparing' }
];

/** Componentes de "rgb(r, g, b)". */
const canais = (css) => css.match(/\d+/g).map(Number);

async function bootarAzul(page, { congelarAnimacoes = true } = {}) {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  const menu = JSON.parse(JSON.stringify(MENU));
  menu.restaurant.primary_color = AZUL;
  // Registrada DEPOIS de mockApi: no Playwright a última rota vence.
  await page.route('**/api.pederapidex.com/**', async (route) => {
    const url = route.request().url();
    if (/\/menu(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(menu) });
    }
    if (/\/customers\/me\/orders(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PEDIDOS) });
    }
    return route.fallback();
  });
  await seedPickupSession(page);
  await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'e2e-state-colors'));
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  // Congelar e o padrao (a cor lida tem de ser a final, nao um quadro do meio),
  // MAS o teste da barra de progresso afirma sobre o `animation-name` — e com
  // `animation:none` ele le `none` e o teste passaria a reprovar o app correto.
  if (congelarAnimacoes) {
    await page.addStyleTag({
      content: '*,*::before,*::after{transition:none!important;animation:none!important}'
    });
  } else {
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  }
}

async function abrirMeusPedidos(page) {
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus pedidos' }).click();
  await expect(page.locator('.prof-order-card')).toHaveCount(PEDIDOS.length);
}

const corDoIcone = (page, numero) =>
  page
    .locator('.prof-order-card', { hasText: `Pedido #${numero}` })
    .locator('.prof-order-status-icon')
    .evaluate(el => getComputedStyle(el).color);

test('o X de "Recusado" é VERMELHO, e não a cor do lojista', async ({ page }) => {
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  const cor = await corDoIcone(page, 9001);
  expect(cor, 'o estado negativo não pode vestir a marca').not.toBe(AZUL_RGB);

  const [r, g, b] = canais(cor);
  expect(r, 'vermelho de verdade: R alto').toBeGreaterThan(150);
  expect(r - g, 'R bem acima de G').toBeGreaterThan(100);
  expect(r - b, 'R bem acima de B').toBeGreaterThan(100);
});

test('o check de "Finalizado" é VERDE, e não a cor do lojista', async ({ page }) => {
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  const cor = await corDoIcone(page, 9002);
  expect(cor, 'o sucesso não pode vestir a marca').not.toBe(AZUL_RGB);

  const [r, g, b] = canais(cor);
  expect(g, 'verde de verdade: G domina').toBeGreaterThan(r);
  expect(g, 'G domina também o azul').toBeGreaterThan(b);
});

test('os dois estados não podem ser a MESMA cor', async ({ page }) => {
  // O defeito original não era "a cor errada": era a MESMA cor nos dois, e a
  // única diferença ficando no desenho de 12px dentro do círculo.
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  expect(await corDoIcone(page, 9001)).not.toBe(await corDoIcone(page, 9002));
});

test('excluir ENDEREÇO é o mesmo vermelho de excluir item da sacola', async ({ page }) => {
  await bootarAzul(page);

  // O de excluir item da sacola, que já estava certo — é a referência.
  await addH2OToCart(page, 1);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.evaluate(() => {
    const uid = window.PedeAquiCartStore.get().items[0].uid;
    window.RapidexActions.resolve('openCartItemDeleteConfirm')(uid);
  });
  const excluirItem = page.locator('#cartItemDeleteConfirm .addr-delete-yes');
  await expect(excluirItem).toBeVisible();
  const vermelhoDaSacola = await excluirItem.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => window.RapidexActions.resolve('closeCartItemDeleteConfirm')());

  // O de excluir endereço.
  await page.evaluate(() => window.RapidexActions.resolve('openAddrPicker')('profile'));
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  const excluirEndereco = await page
    .locator('#addrPickerModal .addr-delete-yes')
    .evaluate(el => getComputedStyle(el).backgroundColor);

  expect(excluirEndereco, 'apagar endereço e apagar item usam o mesmo vermelho').toBe(
    vermelhoDaSacola
  );
  expect(excluirEndereco, 'e nenhum dos dois veste a marca').not.toBe(AZUL_RGB);
});

// ─────────────────────────────────────────────────────────────────────────────
//  E ONDE A MARCA É A COR CERTA, ELA TEM DE ESTAR LÁ.
//
//  O card de "Pedidos em andamento" tinha uma barrinha de 3px correndo no topo,
//  em degradê da cor do lojista, mais a borda e o número do pedido na marca. O
//  commit 79ab508 (29/08/2026, "963 regras que nao podiam pintar nada") a
//  removeu junto com as cores de estado deste mesmo cartão.
//
//  NÃO FOI DESCUIDO, FOI UM PONTO CEGO DA FERRAMENTA, e ele vale para todo o
//  repositório: `css-usage.mjs` só autoriza apagar pela metade ESTÁTICA — "o
//  nome não existe fora do CSS". Mas estas classes são MONTADAS EM RUNTIME:
//
//      `prof-order-card--${statusClass} prof-order-card--${status.tone}-tone`
//      `prof-order-status--${status.tone}`
//
//  A string `prof-order-card--active-tone` não existe em lugar nenhum do
//  código-fonte. Para uma varredura por nome, ela está morta — e estava viva.
//
//  A prova de que a remoção foi mecânica ficou no arquivo: o
//  `@keyframes prof-order-progress` SOBREVIVEU, órfão, por quatro dias, porque
//  o nome dele aparecia literalmente na regra que o usava.
// ─────────────────────────────────────────────────────────────────────────────
test('o cartão de pedido EM ANDAMENTO tem a barra de progresso na cor do lojista', async ({ page }) => {
  await bootarAzul(page, { congelarAnimacoes: false });
  await abrirMeusPedidos(page);

  const emAndamento = page.locator('.prof-order-card', { hasText: 'Pedido #9003' });
  await expect(emAndamento).toHaveClass(/prof-order-card--active-tone/);

  const barra = await emAndamento.evaluate(el => {
    const cs = getComputedStyle(el, '::before');
    return {
      content: cs.content,
      altura: cs.height,
      posicao: cs.position,
      animacao: cs.animationName,
      degrade: cs.backgroundImage
    };
  });

  expect(barra.content, 'a barra é um ::before, e ele precisa existir').not.toBe('none');
  expect(barra.posicao).toBe('absolute');
  expect(barra.altura).toBe('3px');
  // O `@keyframes` ficou órfão no arquivo quando a regra saiu; isto amarra os dois.
  expect(barra.animacao).toBe('prof-order-progress');
  // O degradê é a cor do LOJISTA, não uma cor fixa: num tenant azul ele é azul.
  expect(barra.degrade, `degradê sem a cor do tenant: ${barra.degrade}`).toContain(AZUL_RGB);

  // A borda e o número do pedido também vinham da marca no cartão em andamento.
  const borda = await emAndamento.evaluate(el => getComputedStyle(el).borderTopColor);
  expect(borda, 'a borda do cartão ativo carrega a marca').toContain('rgba(27, 79, 216');
  const numero = await emAndamento
    .locator('.prof-order-number')
    .evaluate(el => getComputedStyle(el).color);
  expect(numero).toBe(AZUL_RGB);
});

test('o cartão FINALIZADO não tem a barra — ela diz "está acontecendo"', async ({ page }) => {
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  const finalizado = page.locator('.prof-order-card', { hasText: 'Pedido #9002' });
  await expect(finalizado).not.toHaveClass(/prof-order-card--active-tone/);

  const altura = await finalizado.evaluate(el => getComputedStyle(el, '::before').height);
  expect(altura, 'barra correndo num pedido que já acabou promete o que não há').not.toBe('3px');
});
