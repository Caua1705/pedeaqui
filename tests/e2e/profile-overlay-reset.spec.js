import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  ENTRAR EM "Gerenciar perfil" MOSTRA A LISTA DE OPÇÕES, SEMPRE.
//
//  As sobreposições dessa subtela (Meus dados, Alterar senha, Contas
//  conectadas, Excluir conta) guardam o próprio `.active`, e a `.prof-sub` some
//  sem apagá-lo. Quem deixasse uma aberta e trocasse de aba voltava DIRETO
//  nela, sem ter tocado em nada — e elas ACUMULAVAM: com duas abertas em
//  sequência, as duas voltavam ativas, uma por cima da outra.
//
//  Só a de contas conectadas era fechada. O buraco estava escrito como escape
//  conhecido, nomeando UMA tela (`#profPasswordScreen`); a sonda mostrou DUAS —
//  o `#profDataScreen` vaza junto com o backdrop dele. É a §12.1 de novo: a
//  família é maior que o sítio.
//
//  ESTE TESTE É GENÉRICO DE PROPÓSITO, e o código não é. O código fecha cada
//  sobreposição pela porta DELA (a de senha recusa fechar no meio de um envio;
//  as outras devolvem o foco), então ele enumera. Quem guarda a lista contra a
//  QUINTA sobreposição — a que alguém vai acrescentar sem lembrar disto — é a
//  varredura daqui, que não conhece nome nenhum.
//
//  A LARGURA É PARTE DO TESTE (§14.2).
// ============================================================================

const CELULAR = { width: 390, height: 844 };

// Toda sobreposição da subtela, por FORMA e não por nome: uma `section` filha
// direta de `#profSubmeusdados`, mais o backdrop que uma delas usa.
const SOBREPOSICOES = '#profSubmeusdados > section, #profSubmeusdados > .prof-data-backdrop';

const ativas = (page) => page.evaluate((sel) =>
  [...document.querySelectorAll(sel)].filter(el => el.classList.contains('active')).map(el => el.id || el.className),
SOBREPOSICOES);

async function entrarEmGerenciarPerfil(page) {
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('meusdados'));
  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
}

test('nenhuma sobreposicao de Gerenciar perfil sobrevive a uma saida e volta', async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'e2e-overlay-token'));
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  // Sonda contra vacuidade: se o seletor parar de casar, a varredura acha zero
  // sobreposições e o teste passa sem ter olhado para nada.
  const total = await page.evaluate((sel) => document.querySelectorAll(sel).length, SOBREPOSICOES);
  expect(total, 'a varredura não achou sobreposição nenhuma — o seletor mudou?').toBeGreaterThanOrEqual(4);

  const ABRIDORES = [
    'openCustomerDataScreen',
    'openCustomerPasswordScreen',
    'openConnectedAccountsScreen',
    'openDeleteAccountScreen'
  ];

  for (const abrir of ABRIDORES) {
    await entrarEmGerenciarPerfil(page);
    await page.evaluate(a => window.RapidexActions.resolve(a)(), abrir);
    // A sobreposição realmente abriu — senão o teste não exerceu nada.
    await expect.poll(() => ativas(page)).not.toEqual([]);

    // Sai da aba e volta.
    await page.evaluate(() => window.RapidexActions.resolve('mobNavMenu')());
    await entrarEmGerenciarPerfil(page);

    expect(await ativas(page), `${abrir} deixou sobreposição ativa ao voltar`).toEqual([]);
  }
});

test('as sobreposicoes nao ACUMULAM: abrir duas em sequencia nao volta com as duas', async ({ page }) => {
  // O sintoma que a sonda achou e que o escape não descrevia: com "Meus dados"
  // e "Alterar senha" abertas em rodadas seguidas, as DUAS voltavam ativas.
  await page.setViewportSize(CELULAR);
  await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'e2e-overlay-token'));
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  for (const abrir of ['openCustomerDataScreen', 'openCustomerPasswordScreen']) {
    await entrarEmGerenciarPerfil(page);
    await page.evaluate(a => window.RapidexActions.resolve(a)(), abrir);
    await page.evaluate(() => window.RapidexActions.resolve('mobNavMenu')());
  }
  await entrarEmGerenciarPerfil(page);
  expect(await ativas(page)).toEqual([]);
});
