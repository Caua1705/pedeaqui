import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, INFO, esperarAppPronto } from './helpers.js';

// ============================================================================
//  As formas de pagamento do Perfil vêm do /info DAQUELA filial — de mais nada.
//
//  Este spec é a outra metade de `tests/unit/white-label-markup.test.js`. Lá se
//  prova que o HTML não escreve a lista; aqui se prova que, sem aquele markup, a
//  tela continua desenhando a lista CERTA — a que o backend respondeu.
//
//  Os rótulos esperados saem da própria fixture, e não de uma lista escrita
//  aqui: uma lista à mão no teste seria o mesmo defeito do markup, um andar
//  acima. `tests/fixtures/info.json` é cópia fiel da produção (skill §4), e nela
//  a filial aceita PIX no grupo online e só crédito/débito no de entrega.
// ============================================================================

// O que o markup chumbado prometia e esta filial NÃO aceita.
const NUNCA_ACEITOS = ['Vale-refeição', 'Vale-alimentação', 'Dinheiro'];

const corpo = (page) => page.locator('#profSubpagamento .prof-sub-body');

async function abrirPagamentoDoPerfil(page) {
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('pagamento'));
  await expect(page.locator('#profSubpagamento')).toHaveClass(/active/);
}

test('a subtela desenha exatamente as formas que o /info da filial devolveu', async ({ page }) => {
  await seedPickupSession(page);
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await abrirPagamentoDoPerfil(page);

  const online = INFO.payment_methods.online.map((m) => m.label);
  const entrega = INFO.payment_methods.delivery.map((m) => m.label);
  expect(online.length, 'a fixture perdeu as formas online').toBeGreaterThan(0);
  expect(entrega.length, 'a fixture perdeu as formas de entrega').toBeGreaterThan(0);

  const painelOnline = page.locator('#profSubpagamento [data-profile-payment-panel=online]');
  for (const rotulo of online) await expect(painelOnline).toContainText(rotulo);

  await page.locator('#profSubpagamento [data-profile-payment-tab=delivery]').click();
  const painelEntrega = page.locator('#profSubpagamento [data-profile-payment-panel=delivery]');
  for (const rotulo of entrega) await expect(painelEntrega).toContainText(rotulo);

  // E o que a filial NÃO aceita não aparece em lugar nenhum da subtela. A
  // primeira afirmação de cada volta guarda a própria premissa: no dia em que a
  // fixture passar a aceitar vale ou dinheiro, este teste diz isso em vez de
  // ficar verde afirmando uma coisa que deixou de valer.
  const aceitos = [...online, ...entrega].join(' | ');
  for (const rotulo of NUNCA_ACEITOS) {
    expect(aceitos, `a fixture passou a aceitar ${rotulo} — reveja este teste`).not.toContain(rotulo);
    await expect(
      corpo(page),
      `"${rotulo}" na tela, e o /info desta filial não o devolveu`
    ).not.toContainText(rotulo);
  }
});

test('sem resposta do /info a subtela diz que está carregando, e não uma lista', async ({ page }) => {
  await seedPickupSession(page);
  await mockApi(page);

  // Segura o /info. Registrada DEPOIS do mockApi de propósito: no Playwright a
  // última rota registrada vence (skill §4, "ordem das rotas importa").
  let liberar;
  const segurado = new Promise((resolve) => { liberar = resolve; });
  await page.route(/\/info(\?|$)/, async (route) => {
    await segurado;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INFO) });
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  // SEM `await` de propósito: `openProfSub('pagamento')` só resolve depois de
  // `ensureRestaurantInfo()`, e com a rota segurada isso leva os 8 s do teto do
  // api-client e termina na tela de erro. O estado que este teste quer é o do
  // meio — a subtela já aberta, o /info ainda em voo.
  const aberturaEmCurso = page.evaluate(() => window.RapidexActions.resolve('openProfSub')('pagamento'));
  await expect(page.locator('#profSubpagamento')).toHaveClass(/active/);

  // Quem escreve isto é openProfSub (screens/profile-screen.js:440), e é ele
  // que fecha a janela de flash: com o markup chumbado, ele já cobria os seis
  // chips antes de a subtela aparecer. Com o markup fora, o "Carregando" é o
  // único conteúdo possível aqui — e este teste é quem impede que alguém
  // "conserte" a tela vazia recolocando uma lista de exemplo.
  await expect(corpo(page)).toContainText('Carregando formas de pagamento');
  await expect(corpo(page).locator('.prof-pay-chip')).toHaveCount(0);
  for (const rotulo of NUNCA_ACEITOS) {
    await expect(corpo(page), `"${rotulo}" anunciado sem o backend ter dito nada`).not.toContainText(rotulo);
  }

  liberar();
  await aberturaEmCurso;
});
