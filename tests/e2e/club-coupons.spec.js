import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, addH2OToCart, confirmOrderSheet, pixOrder, COUPONS, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O cupom, da vitrine ao payload do pedido.
//
//  Esta suíte não existia, e a ausência dela era a fresta: nenhum e2e chegava a
//  DESENHAR um card de cupom, porque a rota devolvia lista vazia. Passaram por
//  aqui, juntos e sem ninguém ver: a rota removida da API, o filtro `eligible`
//  que não filtrava, o rótulo "0% OFF", a tarja fixa, o botão que dizia "Usar
//  cupom" nos três estados — e o pior deles, abaixo: abrir um cupom para LER
//  aplicava o desconto e mandava o coupon_id no pedido.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

/** Sessão logada: o Clube exige conta (mobNavClub abre o login sem token). */
async function seedLoggedSession(page) {
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-club-token');
  });
}

async function mockCustomerRoutes(page) {
  // CashbackBalanceResponse do contrato. O balance da RAIZ (50) soma a conta
  // inteira; o desta loja (12,50) mora em by_restaurant — os dois DISCORDAM de
  // propósito: se a tela mostrar 50, ela está lendo o campo errado.
  await page.route(/\/customers\/me\/cashback(?:\?|$)/, (route) =>
    route.fulfill(json({
      balance: 50,
      currency: 'BRL',
      by_restaurant: [
        { restaurant_id: 'aaaa0000-0000-4000-8000-000000000001', restaurant_name: 'Júnior da Picanha', restaurant_slug: 'junior-da-picanha', balance: 12.5, expires_at: null },
        { restaurant_id: 'bbbb0000-0000-4000-8000-000000000002', restaurant_name: 'Outra Loja', restaurant_slug: 'outra-loja', balance: 37.5, expires_at: null }
      ]
    }))
  );
  await page.route('**/customers/me/addresses**', (route) => route.fulfill(json([])));
  await page.route('**/customers/me/orders**', (route) => route.fulfill(json([])));
  await page.route(/\/customers\/me(?:\?|$)/, (route) =>
    route.fulfill(json({ id: 'customer-e2e', name: 'E2E Test', phone: '85999999999' }))
  );
}

async function openClub(page) {
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);
}

test('os três estados do cupom desenham cada um com a sua frase', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await mockCustomerRoutes(page);

  await openClub(page);

  const cards = page.locator('.club-available-coupon-card');
  await expect(cards).toHaveCount(3);

  // APPLICABLE: o rótulo vem de `title`. Antes vinha de `discount_value`, que
  // não existe neste contrato, e o card anunciava "0% OFF".
  const aplicavel = cards.nth(0);
  await expect(aplicavel.locator('.club-available-coupon-discount')).toHaveText('5% OFF');
  // `label: "selected_for_you"` é o único selo do contrato. A tarja antiga
  // dizia "Cupom disponível" em todos os cards, inclusive neste.
  await expect(aplicavel.locator('.club-available-coupon-badge')).toHaveText(
    'Selecionado para você'
  );
  // E OS OUTROS DOIS NÃO TÊM TARJA NENHUMA — nem "Cupom disponível" (que todo
  // card tinha, e por isso não distinguia nada) nem "Frete grátis" (que repetia
  // o `title` do próprio card, dizendo a mesma coisa duas vezes). O contrato
  // tem UM selo, `selected_for_you`, e `CustomerCouponLabel` diz com todas as
  // letras que "exclusivo" não existe. Uma tarja para todos é ruído com
  // aparência de informação.
  await expect(cards.nth(1).locator('.club-available-coupon-badge')).toHaveCount(0);
  await expect(cards.nth(2).locator('.club-available-coupon-badge')).toHaveCount(0);
  // A SACOLA DESTE TESTE ESTÁ VAZIA, e é isso que o botão diz.
  //
  // Até 02/09/2026 ele dizia "Usar cupom" aqui, e confirmar GUARDAVA o cupom
  // armado ("Cupom selecionado. Adicione produtos à sacola para usar") — um
  // cupom aplicado sem preview nenhum, que seguia no coupon_id do pedido e
  // que, sendo de uso único, o backend queima na primeira tentativa. A regra
  // do fluxo é que cupom só se aplica quando existe sacola; com ela vazia o
  // botão leva ao cardápio, que é a ação que de fato destrava.
  //
  // "Usar cupom" voltou em 03/09/2026 para o caso que APLICA (§14.8: reversão
  // consciente, não conserto). O que este teste guarda — que a sacola vazia
  // NÃO diga "Usar cupom" — é exatamente o motivo antigo, e continua valendo.
  // O caso com sacola está no teste logo abaixo.
  await expect(aplicavel.locator('.club-available-coupon-use')).toHaveText('Ver cardápio');
  // O desconto JÁ CALCULADO pelo backend para esta sacola.
  await expect(aplicavel.locator('.club-available-coupon-meta')).toContainText(
    'Desconto de R$ 1,06'
  );

  // MISSING_AMOUNT: o botão diz o que falta, em vez de prometer aplicar.
  const falta = cards.nth(1);
  await expect(falta.locator('.club-available-coupon-discount')).toHaveText('Frete grátis');
  await expect(falta.locator('.club-available-coupon-use')).toHaveText('Faltam R$ 8,85');
  // E não anuncia "Desconto de R$ 0,00" como se fosse benefício.
  await expect(falta.locator('.club-available-coupon-meta')).not.toContainText('Desconto de');

  // LOGIN_REQUIRED: continua sendo o motivo, não um "Usar cupom" que falha.
  const login = cards.nth(2);
  await expect(login.locator('.club-available-coupon-discount')).toHaveText('10% OFF');
  await expect(login.locator('.club-available-coupon-use')).toHaveText('Entre para usar');

  // Nenhum card repete a mesma frase duas vezes: no contrato do cliente `title`
  // JÁ É o rótulo do desconto, e não há nome de campanha separado.
  await expect(aplicavel.locator('h3')).toHaveCount(0);
});

test('o Clube abre com cashback antes dos cupons, e a faixa da Home leva à TELA do cupom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await mockCustomerRoutes(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  // O "Usar cupom" DA HOME VOLTOU em 03/09/2026, e a linha pontilhada com ele.
  //
  // Isto é REVERSÃO CONSCIENTE da decisão de 02/09 ("FORA: botão usar cupom na
  // home"), não conserto. O que aquela decisão temia — "aplicar arma um cupom
  // sem preview nenhum" — continua valendo e continua guardado: o botão leva à
  // TELA do cupom, e é lá que se lê a regra. A aplicação segue acontecendo no
  // checkout, e o teste logo abaixo cobra que tocar aqui NÃO fala com
  // /coupons/preview.
  const usar = page.locator('#couponRail .coupon-use-btn').first();
  await expect(page.locator('#couponRail .coupon-card').first()).toBeVisible();
  await expect(usar).toHaveText('Usar cupom');
  // A divisória pontilhada saiu junto com o botão e volta junto: ela existe
  // para separar o corpo do card do botão, e sem botão separava o card do nada.
  await expect(page.locator('#couponRail .coupon-dash').first()).toBeVisible();

  await usar.click();
  await expect(
    page.locator('#couponDetailOverlay'),
    'o botão da Home abre a tela do cupom'
  ).toHaveClass(/active/);
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);
  await expect(page.locator('.club-available-coupon-card').first()).toBeVisible();

  // O SALDO VEM ANTES DA LISTA. Comparação por posição no documento, e não por
  // coordenada: `compareDocumentPosition` responde sobre a ORDEM, que é o que
  // a decisão diz, sem depender de a tela ter assentado num pixel.
  const saldoAntesDosCupons = await page.evaluate(() => {
    const cupons = document.querySelector('.club-coupons-section');
    const saldo = document.querySelector('.club-cashback-panel');
    if (!cupons || !saldo) return null;
    // Node.DOCUMENT_POSITION_FOLLOWING = 4: os cupons vêm DEPOIS do saldo.
    return (saldo.compareDocumentPosition(cupons) & 4) === 4;
  });
  expect(saldoAntesDosCupons, 'o cashback não apareceu antes dos cupons').toBe(true);

  // E o saldo continua ALCANÇÁVEL: o extrato só tem esta porta, e apagar o
  // cartão deixaria aquela tela sem entrada nenhuma.
  await expect(page.locator('.club-cashback-icon')).toHaveCount(1);
});

// A METADE QUE FAZ A REVERSÃO DO ITEM 9 SER SEGURA.
//
// O "Usar cupom" voltou à Home, mas o motivo pelo qual ele saiu — "aplicar arma
// um cupom sem preview nenhum" — continua valendo. Ele leva à TELA do cupom; a
// aplicação segue no checkout. Este teste cobra exatamente isso: tocar nele não
// pode falar com `/coupons/preview`, que é a rota que aplica.
//
// Sem este teste, a reversão do botão poderia voltar a ser a reversão da
// DECISÃO, e ninguém veria.
test('tocar em "Usar cupom" na Home abre a tela e NÃO fala com /coupons/preview', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  const { couponPreviewRequests } = await mockApi(page, {
    onListCoupons: (route) => route.fulfill(json(COUPONS))
  });
  await mockCustomerRoutes(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  await page.locator('#couponRail .coupon-use-btn').first().click();
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);

  expect(
    couponPreviewRequests,
    'o botão da Home não aplica: quem aplica é o checkout'
  ).toHaveLength(0);
});

test('a linha "Cupons" do Perfil leva ao Clube, e não a uma tela que mente', async ({ page }) => {
  // Até 02/09/2026 ela abria #profSubcupons: markup ESTÁTICO dizendo "Nenhum
  // cupom disponível", sem nenhum código que a preenchesse. Ela respondia isso
  // para quem tinha cupons e para quem não tinha, sempre, desde que existe.
  //
  // A lista tem UM dono. Duas superfícies desenhando o mesmo dado é como o
  // rótulo do cupom chegou a ter duas implementações anunciando descontos
  // diferentes para o MESMO cupom (ver services/coupon-format.js).
  // #profSubcupons ERA INALCANÇÁVEL DOS DOIS LADOS, e a sonda de 02/09/2026
  // mostrou que por um motivo mais forte do que se supunha: o Perfil é SEMPRE
  // remontado em JS (`prof-account-page`, restaurant-page.js:5286), tanto para
  // o visitante quanto para quem está logado, e a lista estática de
  // `.prof-option-row` do restaurant.html — inclusive a linha "Cupons" —
  // NUNCA renderiza. Medido: `document.querySelectorAll('.prof-option-row')
  // .length === 0` com o Perfil aberto.
  //
  // Some-se a trava de login de screens/profile-screen.js:419 e o resultado é
  // que aquela tela respondia "Nenhum cupom disponível" para ninguém, desde
  // sempre. O que este teste guarda é que ela não voltou.
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());

  // A tela morta não existe mais no documento — nem escondida.
  await expect(page.locator('#profSubcupons')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Nenhum cupom disponível');

  // E o Clube — o dono único da lista — continua desenhando os três estados.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);
});

test('cupom SEM prazo (valid_until null) não desenha "Válido até" vazio', async ({ page }) => {
  // O backend tornou `valid_until` ANULÁVEL em 02/09/2026 — antes era
  // `required`, string, sempre presente. Um cupom sem prazo passou a ser
  // possível, e o `api-contract.test.js` é quem cobrou a sincronização.
  //
  // O front já tolerava (`formatCouponDate`/`couponValidUntil` devolvem '' para
  // valor vazio, e a linha só entra se houver texto), mas "já tolerava" sem
  // teste é uma afirmação sobre código lido, não sobre comportamento medido —
  // e a fixture do repositório tem prazo em todos os três cupons, então nada
  // exercitava esse caminho.
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  const semPrazo = { coupons: COUPONS.coupons.map((c) => ({ ...c, valid_until: null })) };
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(semPrazo)) });
  await mockCustomerRoutes(page);

  await openClub(page);
  const cards = page.locator('.club-available-coupon-card');
  await expect(cards).toHaveCount(3);

  // Nenhum card anuncia validade, e nenhum deixa a frase pela metade.
  await expect(page.locator('#mobViewClub')).not.toContainText('Válido até');

  // E o resto do card continua inteiro: sem prazo não é sem cupom.
  await expect(cards.nth(0).locator('.club-available-coupon-discount')).toHaveText('5% OFF');
  await expect(cards.nth(0).locator('.club-available-coupon-meta')).toContainText('Em pedidos a partir de');
});

test('o sentinela "para sempre" do banco não vira prazo na tela', async ({ page }) => {
  // O RELATO: a folha de detalhe anunciava "Válido até 31/12/2099".
  //
  // Esse 2099 é a OUTRA forma de dizer o que o teste acima diz com NULO: até
  // 03/09/2026 `restaurant_coupons.valid_until` era NOT NULL, e campanha
  // permanente só podia ser escrita com uma data absurda. As linhas antigas
  // continuam no banco, e a fixture guarda as duas populações de propósito —
  // JP5 com prazo de verdade (30/06/2027), os outros dois com o sentinela.
  //
  // O card do Clube era o pior dos dois lugares: ele escreve só dia/mês, então
  // a mesma linha saía "Válido até 31/12" — o sentinela DISFARÇADO de prazo
  // desta virada de ano, que é pior que o 2099 visível do detalhe.
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await mockCustomerRoutes(page);

  await openClub(page);
  const cards = page.locator('.club-available-coupon-card');
  await expect(cards).toHaveCount(3);

  // O prazo DE VERDADE continua na tela — sem esta linha o teste passaria com
  // um front que simplesmente parou de mostrar validade.
  await expect(cards.nth(0).locator('.club-available-coupon-meta')).toContainText('Válido até 30/06');
  // E o sentinela não vira prazo, em nenhum dos dois cards que o trazem.
  await expect(cards.nth(1).locator('.club-available-coupon-meta')).not.toContainText('Válido até');
  await expect(cards.nth(2).locator('.club-available-coupon-meta')).not.toContainText('Válido até');
  await expect(page.locator('#mobViewClub')).not.toContainText('31/12');

  // E na folha de detalhe, que é onde ele foi visto, com o ano por extenso.
  await page.evaluate(() => window.openCouponDetail('FRETE0'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await expect(page.locator('#couponDetailRules')).not.toContainText('2099');
  await expect(page.locator('#couponDetailRules')).not.toContainText('Válido até');

  // O mesmo cupom com prazo de verdade escreve a linha inteira, com ano.
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await page.evaluate(() => window.openCouponDetail('JP5'));
  await expect(page.locator('#couponDetailRules')).toContainText('Válido até 30/06/2027');
});

test('com sacola, o cupom aplicável passa a oferecer aplicar', async ({ page }) => {
  // O par do teste acima. Os dois juntos provam que quem decide o rótulo é o
  // estado do backend MAIS a sacola — e que a sacola entra por acessor, não
  // por uma cópia do boot: o Clube é montado depois de o carrinho já ter itens.
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await mockCustomerRoutes(page);

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);

  const cards = page.locator('.club-available-coupon-card');
  await expect(cards.nth(0).locator('.club-available-coupon-use')).toHaveText('Usar cupom');
  // Os outros dois não mudam: o veredito deles é do backend, e a sacola não o
  // altera. `missing_amount` continua dizendo quanto falta.
  await expect(cards.nth(1).locator('.club-available-coupon-use')).toHaveText('Faltam R$ 8,85');
  await expect(cards.nth(2).locator('.club-available-coupon-use')).toHaveText('Entre para usar');
});

test('a lista leva o contexto da sacola, para o desconto ser o desta sacola', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  const { couponListRequests } = await mockApi(page, {
    onListCoupons: (route) => route.fulfill(json(COUPONS))
  });
  await mockCustomerRoutes(page);

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await addH2OToCart(page, 3); // 21,15
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('.club-available-coupon-card').first()).toBeVisible();

  const ultima = couponListRequests.at(-1).url;
  expect(ultima).toContain('/coupons?');
  expect(ultima).toContain('subtotal=21.15');
  expect(ultima).toContain('order_type=pickup');
  // A rota morta não pode voltar por nenhum caminho.
  expect(couponListRequests.every((r) => !r.url.includes('/coupons/available'))).toBe(true);
});

// ---------------------------------------------------------------------------
//  O defeito mais caro da auditoria.
// ---------------------------------------------------------------------------

test('abrir um cupom para LER não aplica nada e não vai no pedido', async ({ page }) => {
  const { orderRequests, couponPreviewRequests } = await mockApi(page, {
    orderResponse: pixOrder
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);

  // O gesto: tocar no card só para ler as regras, e fechar pelo fundo.
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await expect(page.locator('#couponDetailCode')).toHaveText('JP10');
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  // Nenhuma validação foi disparada: ler não fala com o backend.
  await page.waitForTimeout(400);
  expect(couponPreviewRequests, 'ler um cupom não pode validá-lo').toHaveLength(0);

  // E a sacola segue sem desconto: 3 x 7,05 + 0,99 = 22,14, inteiro.
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('22,14');

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  // A asserção que importa: o pedido não carrega um cupom que ninguém escolheu.
  // Num cupom de uso único, mandá-lo aqui o QUEIMA.
  expect(orderRequests).toHaveLength(1);
  expect(orderRequests[0].body).not.toHaveProperty('coupon_id');
  expect(orderRequests[0].body).not.toHaveProperty('coupon_code');
});

test('confirmar o cupom aplica o desconto e o pedido leva o coupon_id', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const couponsForCheckout = {
    coupons: COUPONS.coupons.map(coupon => coupon.code === 'JP10'
      ? { ...coupon, state: 'applicable', discount_amount: '2.12', missing_amount: '0.00' }
      : coupon)
  };
  const { orderRequests, couponPreviewRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onListCoupons: (route) => route.fulfill(json(couponsForCheckout)),
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '2.12',
          total_after_coupon: '20.02',
          valid: true
        })
      )
  });
  await seedLoggedSession(page); // o preview exige token: auth OBRIGATORIA no backend

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await expect(page.locator('#cartModal .cart-benefit-card .cart-benefit-copy'))
    .toHaveText('3 benefícios para você');
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartModal .cart-benefit-card .cart-benefit-action').click();
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);
  await page.locator('.club-available-coupon-card', { hasText: '10% OFF' }).click();
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#couponNotice')).not.toBeVisible();

  expect(couponPreviewRequests).toHaveLength(1);
  expect(couponPreviewRequests[0].body).toMatchObject({ subtotal: 21.15, order_type: 'pickup' });

  const benefit = page.locator('#cartModal .cart-benefit-card .cart-benefit-action');
  await expect(benefit.locator('.cart-benefit-copy')).toContainText('10% OFF');
  await expect(benefit.locator('.cart-benefit-code')).toHaveText('JP10');
  await expect(benefit.locator('.cart-benefit-add')).toHaveText('Trocar');
  await expect(page.locator('#csDiscountRow')).toContainText('Benefícios');
  await expect(page.locator('#csDiscount')).toHaveText('- R$ 2,12');
  await expect(page.locator('#csTotal')).toContainText('20,02');
  const benefitColor = await page.locator('#csDiscount').evaluate(element => getComputedStyle(element).color);
  const brandColor = await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--brand-primary-rgb').trim());
  expect(benefitColor).toBe(`rgb(${brandColor})`);
  await expect.poll(() => page.locator('.cart-price-summary').evaluate(element => element.getBoundingClientRect().height))
    .toBeGreaterThan(152);

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  expect(orderRequests[0].body.coupon_id).toBe('d0d99eee-9cf1-409d-bd48-b5afb991da70');
});

test('o total exibido é o total_after_coupon do backend, não a nossa subtração', async ({
  page
}) => {
  // O desconto é 1,00 e o total antes é 22,14 — a subtração local daria 21,14.
  // O backend responde 20,90 (teto, arredondamento, o que for). O contrato diz
  // que quem calcula é ele; a tela tem que mostrar o número DELE, senão o
  // cliente confirma 21,14 e é cobrado 20,90.
  await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '1.00',
          total_after_coupon: '20.90',
          valid: true
        })
      )
  });
  await seedLoggedSession(page); // o preview exige token: auth OBRIGATORIA no backend

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  await page.evaluate(() => window.openModal('cartModal'));
  const total = page.locator('#csTotal');
  await expect(total).toContainText('20,90');
  await expect(total, 'a subtração local não pode ganhar do backend').not.toContainText('21,14');
});

test('cupom recusado com 200 não vira "cupom aplicado" nem entra no pedido', async ({ page }) => {
  // O caso que ninguém lia: a rota responde 200 com `valid: false` e o motivo.
  // Antes isso virava `selectedCouponPreview = response`, a mensagem "Cupom
  // aplicado. Desconto de R$ 0,00", e o coupon_id ia no pedido assim mesmo.
  const { orderRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '0.00',
          total_after_coupon: '22.14',
          valid: false,
          // O TIPO DE PRODUCAO. `ineligibility_reason` NAO e uma frase: e um
          // codigo interno do backend (os treze `reason=` de coupon_service.py).
          // Este fixture trazia 'Este cupom e valido apenas na primeira compra.',
          // que e a assuncao de quem o escreveu — e foi ela que deixou o front
          // mostrar o campo cru por meses com o e2e verde.
          ineligibility_reason: 'first_order_only'
        })
      )
  });
  await seedLoggedSession(page); // o preview exige token: auth OBRIGATORIA no backend

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();

  // O motivo do backend chega ao cliente, com as palavras dele.
  const aviso = page.locator('#couponNotice');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('primeira compra');
  await expect(aviso, 'o codigo do backend nao pode aparecer').not.toContainText('first_order_only');
  await expect(aviso).not.toContainText('Cupom aplicado');

  // A folha NÃO fecha: o motivo está nela, e fechar jogaria a pessoa de volta
  // ao cardápio com um aviso que some. Quem decide sair é ela.
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await expect(page.locator('.coupon-detail-use'), 'o botão volta ao normal').toHaveText(
    'Usar cupom'
  );
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  // A sacola segue inteira, sem desconto.
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('22,14');

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  // O cupom que o backend recusou não pode chegar ao POST /orders.
  expect(orderRequests[0].body).not.toHaveProperty('coupon_id');
  expect(orderRequests[0].body).not.toHaveProperty('coupon_code');
});

// O RELATO, reproduzido: sacola de R$ 11 e cupom de pedido minimo R$ 30. O que
// aparecia era um toast escuro com `minimum_order_not_reached` — o codigo
// interno do backend, cru, na tela do cliente.
//
// O numero da frase sai de duas entradas que o BACKEND deu: o `min_order_value`
// do cupom e o subtotal que acabou de ir no preview. E a mesma subtracao que o
// backend faz (`missing_amount = minimum - subtotal`), e o resultado nao entra
// na sacola nem no pedido — ele vive dentro da frase.
test('pedido minimo nao atingido vira frase com o quanto falta, e nao o codigo', async ({ page }) => {
  // 3 x H2O = 21,15; o cupom JP10 tem min_order_value 30,00 -> faltam 8,85.
  await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '0.00',
          total_after_coupon: '21.15',
          valid: false,
          ineligibility_reason: 'minimum_order_not_reached'
        })
      )
  });
  await seedLoggedSession(page); // o preview exige token: auth OBRIGATORIA no backend

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();

  const aviso = page.locator('#couponNotice');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('Faltam');
  await expect(aviso).toContainText('8,85');
  await expect(aviso, 'o codigo do backend nao pode aparecer').not.toContainText(
    'minimum_order_not_reached'
  );
  // Nenhum sublinhado: e a assinatura de um codigo interno vazando.
  await expect(aviso).not.toHaveText(/[a-z]_[a-z]/);
});

test('cupom aplicado sobrevive a abrir OUTRO cupom para leitura', async ({ page }) => {
  // O outro lado da separação: desarmar na leitura não pode desaplicar o que
  // já estava valendo.
  await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '2.12',
          total_after_coupon: '20.02',
          valid: true
        })
      )
  });
  await seedLoggedSession(page); // o preview exige token: auth OBRIGATORIA no backend

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('20,02');
  await page.evaluate(() => window.closeModal?.('cartModal'));

  // Abre outro cupom só para ler, e fecha.
  await page.evaluate(() => window.openCouponDetail('JP5'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal'), 'o cupom aplicado continua aplicado').toContainText(
    '20,02'
  );
});

test('o saldo do Clube é o DESTA loja (by_restaurant), nunca a soma da conta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  await mockApi(page);
  await mockCustomerRoutes(page);
  await openClub(page);

  // O mock manda 50 na raiz (soma da conta) e 12,50 nesta loja. O schema da
  // CashbackBalanceResponse avisa que a soma não é gastável — mostrar 50 aqui
  // é prometer desconto de outra loja.
  await expect(page.locator('#clubCashbackBalance')).toHaveText('R$ 12,50');
});

// ============================================================================
//  SEM CONTA, O LOGIN VEM ANTES DO PREVIEW.
//
//  O que o cliente via: sacola cheia, sem login, abria um cupom pela vitrine da
//  Home e tocava no botão. Ele virava "Validando...", ficava assim meio
//  segundo, e só então abria a tela de login — que não tem nada a ver com
//  validação. Não faz sentido validar o que não vai ser aplicado.
//
//  A causa é a mesma do item 7 desta rodada, por outra porta: o cupom da
//  vitrine é `PublicCouponResponse` e NÃO TEM `state`, então o decisor caía em
//  "aplicar" mesmo para um visitante. O ramo que já existia só cobria
//  `state: 'login_required'`, que é veredito do backend sobre um cupom da
//  LISTA — e o visitante da Home nunca tem esse veredito na mão.
//
//  O preview não é opcional aqui: `POST /coupons/preview` declara `HTTPBearer`,
//  e sem token responde 401. Ou seja, a ida à rede era garantidamente inútil.
// ============================================================================
test('sem login, o botão do cupom abre o login direto — sem "Validando..." e sem preview', async ({
  page
}) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await seedPickupSession(page);
  // SEM token de propósito: é o visitante.
  const { couponPreviewRequests } = await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.RapidexActions.resolve('showHomeTab')?.());

  await page.locator('#couponRail .coupon-use-btn').first().click();
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);

  const botao = page.locator('.coupon-detail-use');
  // A sacola está CHEIA, então o botão é o que aplica — é esse o caminho do
  // defeito. Com a sacola vazia ele diria "Ver cardápio" e nunca chegaria aqui.
  await expect(botao).toHaveText('Usar cupom');

  await botao.click();
  await expect(page.locator('#loginModal')).toHaveClass(/active/);

  // A afirmação que vale: o rótulo NUNCA passou por "Validando...". Ela é lida
  // do texto atual porque o app restaura o rótulo no fim do caminho — se o
  // teste só olhasse o estado final, o "Validando..." de meio segundo passaria
  // batido, que foi exatamente como ele sobreviveu.
  await expect(botao).not.toHaveText('Validando...');
  expect(
    couponPreviewRequests,
    'sem token o preview responde 401: a ida à rede era garantidamente inútil'
  ).toHaveLength(0);
});

// ============================================================================
//  A TELA DO CUPOM NÃO PODE SE CONTRADIZER — quem diz é o BOTÃO.
//
//  O que o cliente via: abria um cupom pela vitrine da Home com a sacola abaixo
//  do mínimo, e a tela mostrava um toast "Faltam R$ 28,90 para usar este cupom"
//  ao lado de um botão dizendo "Usar cupom". Duas frases opostas no mesmo
//  instante.
//
//  A CAUSA é de contrato: o cupom da vitrine é `PublicCouponResponse` e NÃO TEM
//  `state` — o backend nunca julgou aquele cupom contra esta pessoa. Sem
//  `state`, `coupon-cta.js` cai em "aplicar", e a pessoa só descobria depois do
//  toque.
//
//  E O FRONT NÃO PASSOU A CALCULAR NADA. A rota que julga já existe e já é
//  chamada por este app: `GET /coupons` aceita `subtotal`/`delivery_fee`/
//  `order_type` opcionais e responde com o estado pronto. O que faltava era
//  PERGUNTAR. Este teste prova as duas coisas: que o botão passa a dizer o
//  quanto falta, e que quem disse isso foi o backend — a lista é pedida com a
//  sacola desta pessoa.
//
//  Havia AINDA uma segunda causa, e ela é a que fazia o defeito sobreviver a
//  quem já estava logado com a lista carregada: `clubController.getCoupon()`
//  casava por `id ?? code`, ou seja pelo ID, e a vitrine da Home chama
//  `openCouponDetail(coupon.code)`. O mesmo cupom que a lista já tinha julgado
//  voltava `null` e a folha caía no da vitrine.
// ============================================================================
test('cupom da vitrine SEM mínimo atingido: o botão diz o quanto falta, e não "Usar cupom"', async ({
  page
}) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await seedLoggedSession(page);
  // A lista JULGADA: JP10 vem `missing_amount` com 8,85 faltando. É o backend
  // dizendo, não o front calculando.
  const { couponListRequests, couponPreviewRequests } = await mockApi(page, {
    onListCoupons: (route) => route.fulfill(json(COUPONS))
  });
  await mockCustomerRoutes(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.RapidexActions.resolve('showHomeTab')?.());

  // FRETE0 é o cupom que a lista julgada devolve como `missing_amount`.
  await page.evaluate(() => window.openCouponDetail('FRETE0'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);

  const botao = page.locator('.coupon-detail-use');
  await expect(
    botao,
    'a tela abriu pela vitrine (sem state) e o botão prometeu aplicar um cupom que não cabe'
  ).toHaveText('Faltam R$ 8,85');

  // QUEM DISSE FOI O BACKEND: a lista foi pedida com a sacola desta pessoa.
  expect(couponListRequests.length).toBeGreaterThan(0);
  const comSacola = couponListRequests.some(r => /subtotal=21\.15/.test(r.url));
  expect(comSacola, 'a lista foi pedida sem a sacola: o veredito não seria o desta sacola').toBe(true);

  // E a regra na lista diz o mesmo que o botão — a tela não fala com duas vozes.
  await expect(page.locator('#couponDetailRules')).toContainText('Faltam R$ 8,85');

  // Tocar leva ao cardápio, SEM TOAST e sem aplicar nada.
  //
  // A ausência é gravada por um observador instalado ANTES do toque, e não
  // conferida depois: o toast é criado sob demanda, vive 3,6s e some sozinho,
  // e um `toHaveCount(0)` logo após o clique passa por chegar ANTES de ele
  // nascer. Foi o que aconteceu na primeira escrita deste teste — com o toast
  // reinjetado de propósito ele continuou VERDE. Um teste de ausência precisa
  // de uma testemunha que não pisque.
  await page.evaluate(() => {
    window.__toastVisto = false;
    const olho = new MutationObserver(() => {
      if (document.getElementById('couponNotice')) window.__toastVisto = true;
    });
    olho.observe(document.body, { childList: true, subtree: true, attributes: true });
  });

  // O CAMINHO INTEIRO, AGUARDADO — não um marco no meio dele.
  //
  // `confirmCouponDetail` é async, e o toast nascia DEPOIS do
  // `await shell.mobNavMenu()`. Medido em três execuções: `body.menu-tab`
  // entra aos ~1000ms e o toast aos ~1360ms. A primeira versão deste teste
  // esperava `menu-tab` e lia a testemunha aos 1000ms — 360ms ANTES do que
  // queria pegar, e por isso passou com o toast reinjetado de propósito.
  //
  // Chamar a ação e AGUARDÁ-LA elimina o palpite: quando o `evaluate` resolve,
  // o caminho terminou, inclusive o que vem depois do await interno. É a mesma
  // função que o `data-act-click` do botão resolve, e o clique de verdade
  // continua exercitado nos outros testes deste arquivo.
  await page.evaluate(() => window.RapidexActions.resolve('confirmCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
  await expect(page.locator('body')).toHaveClass(/menu-tab/);
  expect(
    await page.evaluate(() => window.__toastVisto),
    'a tela falou com duas vozes: o botão disse o que falta e um toast repetiu'
  ).toBe(false);
  expect(couponPreviewRequests, 'um cupom que não cabe não vai ao preview').toHaveLength(0);
});

test('cupom da vitrine que CABE: o veredito do backend chega e o botão aplica', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await seedLoggedSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await mockCustomerRoutes(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.RapidexActions.resolve('showHomeTab')?.());

  // JP5 vem `applicable` na lista julgada, com desconto de R$ 1,06.
  await page.evaluate(() => window.openCouponDetail('JP5'));
  await expect(page.locator('.coupon-detail-use')).toHaveText('Usar cupom');
  // E a folha passa a mostrar o desconto DESTA sacola, que só o veredito tem.
  await expect(page.locator('#couponDetailRules')).toContainText('Desconto de R$ 1,06');
});

// ============================================================================
//  OS DOIS ESTADOS QUE O FRONT NÃO CONHECIA, na tela (03/09/2026).
//
//  `CustomerCouponState` tem cinco valores e o front conhecia três:
//  `outside_hours` e `payment_method_not_allowed` eram descartados por
//  `club-service.normalizeCustomerCoupons`. O cupom sumia da lista do Clube e,
//  desde `judgedCouponForDetail`, a folha de detalhe caía no cupom da vitrine
//  (que não tem `state`) e o botão dizia "Usar cupom" para um cupom que o
//  backend acabou de recusar.
//
//  As decisões, cada uma com o seu motivo:
//
//  - FORA DO HORÁRIO o card APARECE, com a faixa escrita, e o botão diz quando
//    o cupom vale sem levar a lugar nenhum. Sumir de manhã seria pior: a
//    campanha da tarde ficaria invisível para quem olha o Clube antes das 15h.
//  - FORMA DE PAGAMENTO o card diz em qual forma vale, e o botão leva à escolha
//    de pagamento — o backend só marca este estado quando a forma JÁ foi
//    escolhida, então existe uma escolha para desfazer.
//
//  Os TIPOS são os de produção: `valid_hours_from` é `format: time`
//  ("15:00:00") e `allowed_payment_methods` traz o vocabulário fechado do
//  backend. Escrever "15:00" aqui esconderia a classe de erro que o formatador
//  existe para pegar.
// ============================================================================
const CUPONS_DOS_DOIS_ESTADOS = {
  coupons: [
    {
      id: '0d6e7327-6637-48fb-ad67-fdc362d32ace',
      code: 'JP5',
      title: '5% OFF',
      description: null,
      image_url: 'https://cdn.example/coupon-5-percent-off.webp',
      discount_type: 'percent',
      min_order_value: '20.00',
      valid_until: '2099-12-31T23:59:59Z',
      label: 'selected_for_you',
      state: 'outside_hours',
      discount_amount: '0.00',
      missing_amount: '0.00',
      valid_hours_from: '15:00:00',
      valid_hours_until: '18:00:00'
    },
    {
      id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
      code: 'JP10',
      title: '10% OFF',
      description: null,
      image_url: 'https://cdn.example/coupon-10-percent-off.webp',
      discount_type: 'percent',
      min_order_value: '20.00',
      valid_until: '2099-12-31T23:59:59Z',
      label: null,
      state: 'payment_method_not_allowed',
      discount_amount: '0.00',
      missing_amount: '0.00',
      allowed_payment_methods: ['pix']
    }
  ]
};

async function clubeComOsDoisEstados(page) {
  await page.setViewportSize({ width: 414, height: 896 });
  await seedLoggedSession(page);
  const mock = await mockApi(page, {
    onListCoupons: (route) => route.fulfill(json(CUPONS_DOS_DOIS_ESTADOS))
  });
  await mockCustomerRoutes(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await addH2OToCart(page, 3);
  return mock;
}

test('cupom fora do horário APARECE na lista, com a faixa e sem prometer nada', async ({ page }) => {
  await clubeComOsDoisEstados(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);

  // O card EXISTE. Antes ele era descartado e a campanha da tarde ficava
  // invisível de manhã — que é a metade cara desta decisão.
  const cards = page.locator('.club-available-coupon-card');
  await expect(cards).toHaveCount(2);

  const foraDeHorario = cards.filter({ hasText: '5% OFF' });
  await expect(foraDeHorario.locator('.club-available-coupon-badge')).toHaveText('Vale das 15h às 18h');
  await expect(foraDeHorario.locator('.club-available-coupon-use')).toHaveText('Vale das 15h às 18h');
  // A faixa VENCE o selo: este cupom tem `label: "selected_for_you"`, e
  // "Selecionado para você" ao lado de um cupom que não vale agora é elogio no
  // lugar da informação.
  await expect(foraDeHorario.locator('.club-available-coupon-badge')).not.toHaveText('Selecionado para você');
});

test('tocar no cupom fora do horário não leva a lugar nenhum, e não aplica nada', async ({ page }) => {
  const { couponPreviewRequests } = await clubeComOsDoisEstados(page);
  await page.evaluate(() => window.openCouponDetail('JP5'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);

  const botao = page.locator('.coupon-detail-use');
  await expect(botao).toHaveText('Vale das 15h às 18h');
  // `aria-disabled`, e não `disabled`: o rótulo É a informação, e `disabled` o
  // tiraria da leitura de tela justamente onde ele é o conteúdo.
  await expect(botao).toHaveAttribute('aria-disabled', 'true');
  // A regra também aparece na lista da folha.
  await expect(page.locator('#couponDetailRules')).toContainText('Vale das 15h às 18h');

  await page.evaluate(() => window.RapidexActions.resolve('confirmCouponDetail')());
  // NADA aconteceu: a folha continua aberta, ninguém foi ao cardápio, e o
  // cupom não foi ao preview. Não existe tela que adiante o relógio.
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await expect(page.locator('body')).not.toHaveClass(/menu-tab/);
  expect(couponPreviewRequests, 'um cupom fora do horário não vai ao preview').toHaveLength(0);
});

test('cupom de outra forma de pagamento diz qual é, e leva onde ela se troca', async ({ page }) => {
  const { couponPreviewRequests } = await clubeComOsDoisEstados(page);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);

  const botao = page.locator('.coupon-detail-use');
  await expect(botao).toHaveText('Só no Pix');
  // Este é acionável: a pessoa resolve agora.
  await expect(botao).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#couponDetailRules')).toContainText('Só no Pix');

  await page.evaluate(() => window.RapidexActions.resolve('confirmCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
  // O DESTINO: a escolha de pagamento, sobre a sacola. As duas, e nesta ordem —
  // a tela de pagamento volta para a sacola ao confirmar, e é na sacola que o
  // cupom se aplica.
  await expect(page.locator('#paymentMethodModal')).toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  expect(couponPreviewRequests, 'nada foi aplicado: quem julga é o backend').toHaveLength(0);
});
