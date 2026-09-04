import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, INFO, MENU, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  OS LINKS DE CONTATO DA LOJA — ligar, WhatsApp, e-mail.
//
//  A pergunta destes testes não é "a linha aparece?", é "o link vai PARA ONDE?".
//  Um `<a>` que abre o discador com o número errado não tem sintoma na tela: o
//  rótulo mostra o número bonito, e só quem toca descobre.
//
//  ## Os dois defeitos que criaram este arquivo
//
//  1. O TELEFONE DO PILOTO TEM DOIS NÚMEROS. `tests/fixtures/info.json` é cópia
//     fiel da produção, e lá `branch.phone` é
//     "(85) 3025-3303 / (85) 3025-7808" — como o lojista digitou. O front fazia
//     `onlyDigits()` no campo inteiro e montava `tel:` com os VINTE dígitos
//     grudados. Ninguém viu porque o rótulo mostra o texto original.
//
//  2. HAVIA CINCO IMPLEMENTAÇÕES DE "telefone -> wa.me", com TRÊS regras:
//     `length <= 11 ? 55+d : d` (entregador e Perfil>Ajuda), `sempre 55+d`
//     (#infoModal pelo /menu) e `d.startsWith('55') ? d : 55+d` (Perfil>Info,
//     #infoModal pelo /info e o store-info-format, que tem teste unitário e
//     ninguém chamava).
//
//     A do `startsWith` erra numa cidade inteira: **DDD 55 é Santa Maria/RS**.
//     Um fixo de lá tem 10 dígitos e COMEÇA com 55 ("5532201234"), então a
//     regra o toma por número que já tem país e monta `wa.me/5532201234` — que
//     o WhatsApp lê como país 55 + DDD 32 (Juiz de Fora). É o mesmo dano do
//     telefone sentinela do entregador: link para o WhatsApp de outra pessoa.
//     E a do "sempre 55" erra ao contrário, com quem digitou o país: 5541...
//     vira 555541....
//
//  Hoje quem responde é UM dono: `scripts/utils/contact-link.js`.
// ============================================================================

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function abrirApp(page) {
  await page.setViewportSize({ width: 414, height: 896 });
  // O Perfil exige conta: `mobNavProfile` manda para o login sem token, e a
  // subtela de Ajuda ficaria fora do alcance. O mock responde /customers/me
  // como o backend — 401 sem header, fixture do contrato com ele.
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-contato-token');
  });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
}

/** Perfil > Ajuda, que é a tela onde os TRÊS links de contato são montados. */
async function abrirAjuda(page) {
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await expect(page.locator('#mobViewProfile')).toHaveClass(/active/);
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('ajuda'));
  await expect(page.locator('#profSubajuda')).toHaveClass(/active/);
}

/** A loja com o contato trocado nas DUAS fontes: o /menu e o /info. */
async function lojaComContato(page, { phone, whatsapp, email = null }) {
  const info = JSON.parse(JSON.stringify(INFO));
  info.branch.phone = phone;
  info.branch.whatsapp = whatsapp;
  info.branch.email = email;
  const menu = JSON.parse(JSON.stringify(MENU));
  (menu.branches || []).forEach((unidade) => {
    unidade.phone = phone;
    unidade.whatsapp = whatsapp;
  });
  await page.route(/\/info(\?|$)/, (route) => route.fulfill(json(info)));
  await page.route(/\/menu(\?|$)/, (route) => route.fulfill(json(menu)));
}

test('o telefone com DOIS números liga para o primeiro, e não para os vinte dígitos', async ({
  page
}) => {
  await mockApi(page);
  await seedPickupSession(page);
  await abrirApp(page);

  // Perfil > Ajuda é a tela que monta os três links de contato.
  await abrirAjuda(page);
  const ligar = page.locator('#profHelpContacts a[href^="tel:"]');
  await expect(ligar).toHaveCount(1);

  // O fixture de produção: "(85) 3025-3303 / (85) 3025-7808".
  await expect(ligar).toHaveAttribute('href', 'tel:8530253303');
  // E o rótulo continua mostrando os DOIS: quem quiser o segundo número o vê.
  await expect(ligar).toContainText('3025-7808');
});

test('numa cidade de DDD 55 o WhatsApp não perde o país, nas três superfícies', async ({ page }) => {
  await mockApi(page);
  await lojaComContato(page, { phone: '(55) 3220-1234', whatsapp: '(55) 3220-1234' });
  await seedPickupSession(page);
  await abrirApp(page);

  // 10 dígitos, começando com 55 porque o DDD É 55. O país entra do mesmo
  // jeito: 55 (país) + 55 (DDD) + 32201234.
  const esperado = 'https://wa.me/555532201234';

  // 1. O #infoModal, que monta o link com a unidade do /menu.
  await page.evaluate(() => window.RapidexActions.resolve('openRestaurantInfo')());
  await expect(page.locator('#infoModal')).toHaveClass(/active/);
  await expect(page.locator('#infoModal .store-contact-row--wa')).toHaveAttribute('href', esperado);
  await page.evaluate(() => window.PedeAquiRestaurantUi.closeModalId('infoModal'));

  // 2. Perfil > Ajuda.
  await abrirAjuda(page);
  await expect(page.locator('#profHelpContacts a[href^="https://wa.me/"]')).toHaveAttribute(
    'href',
    esperado
  );

  // 3. Perfil > Informações, que monta a partir do /info.
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('info'));
  await expect(page.locator('#profSubinfo a.prof-info-row-link')).toHaveAttribute('href', esperado);
});

test('contato que não é contato não vira link', async ({ page }) => {
  // O lojista escreve no campo o que quiser. "Não temos" não pode virar um
  // `mailto:` nem um discador — é a mesma regra do telefone em branco do
  // entregador: alvo que promete e não cumpre.
  await mockApi(page);
  await lojaComContato(page, { phone: 'não temos', whatsapp: '', email: 'não temos' });
  await seedPickupSession(page);
  await abrirApp(page);

  await abrirAjuda(page);
  const cartao = page.locator('#profHelpContacts');
  await expect(cartao).toBeVisible();
  await expect(cartao.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(cartao.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(cartao.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
});
