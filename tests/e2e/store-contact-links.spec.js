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

  // ─────────────────────────────────────────────────────────────────────────
  //  DECISÃO INVERTIDA EM 05/09/2026, e a linha antiga fica registrada aqui.
  //
  //  Este teste afirmava o CONTRÁRIO: "o rótulo continua mostrando os DOIS —
  //  quem quiser o segundo número o vê". A correção de 03/09 tinha arrumado só
  //  o href, e a intenção era não esconder informação do lojista.
  //
  //  O que isso produzia, visto na tela: um link só, escrito
  //  "(85) 3025-3303 / (85) 3025-7808", que disca o primeiro. O cliente lê dois
  //  números, toca uma vez e liga para um deles sem saber qual. Meia correção
  //  parece uma correção — e um rótulo que promete dois e cumpre um é pior que
  //  um rótulo que promete um.
  //
  //  A objeção antiga ERA legítima e continua respondida: o segundo número não
  //  se perde. Perfil > Informações mostra o campo do lojista INTEIRO, e ali
  //  isso está certo porque a linha não é um link — é informação, não promessa.
  //  As duas asserções abaixo guardam exatamente essa divisão.
  //
  //  §14.8: o teste que protegia a decisão antiga é INVERTIDO, não apagado, e o
  //  que dela continua valendo vira asserção própria.
  // ─────────────────────────────────────────────────────────────────────────
  await expect(ligar).toContainText('(85) 3025-3303');
  await expect(ligar, 'o rótulo do link nomeia só o número que ele disca')
    .not.toContainText('3025-7808');
});

test('o segundo número não se perde: Informações mostra o campo inteiro do lojista', async ({
  page
}) => {
  // A METADE QUE CONTINUA VALENDO da decisão invertida acima. Em Informações a
  // linha de Telefone NÃO é um link — é o campo do lojista como ele o escreveu.
  // Nada promete discar, então mostrar os dois números é informação, não engano.
  await mockApi(page);
  await seedPickupSession(page);
  await abrirApp(page);

  // Pelo REGISTRO de ações, não por um global: `openProfSub` não está em
  // `window` — é o barramento que o resto da suíte usa.
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('info'));
  const linha = page.locator('#profSubinfo .prof-info-row-val').filter({ hasText: '3025' });
  await expect(linha).toContainText('(85) 3025-3303');
  await expect(linha).toContainText('(85) 3025-7808');
  await expect(linha.locator('a')).toHaveCount(0);
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
