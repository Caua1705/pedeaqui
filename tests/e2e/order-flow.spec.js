import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, addH2OToCart, successOrder, confirmOrderSheet, pixOrder, PRODUCT_H2O, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// Drives product -> cart -> payment -> submit on the BUILT app, with every API
// call mocked (no production traffic, no real orders). Also pins the Fase 1
// invariants: one request per double-click, and a retry reuses the key.

async function selectPixAndReturnToCart(page) {
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3); // 3 x R$7,05 = R$21,15, above the R$20 minimum

  // Fase 3 (item 7): on pickup the CTA no longer demands a delivery address, so
  // the test drives the real button instead of calling openCheckout() directly.
  // If the address gate ever comes back on pickup, this click stops working.
  await page.evaluate(() => window.openModal('cartModal'));
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).not.toHaveText('Informe seu endereço');
  await cta.click();

  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();

  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#orderReviewModal')).toHaveCount(0);
  await expect(page.locator('#cartPaymentTitle')).toBeHidden();
  await expect(page.locator('#cartPaymentTitle')).toHaveText('');
  await expect(page.locator('#cartPaymentLabel')).toHaveText('PIX');
  await expect(cta).toHaveText('Efetuar pagamento');
}

test('sacola nao pisca ao abrir unidades pelo widget do cardapio', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 1);
  await page.evaluate(() => window.RapidexActions.resolve('goToMenuTab')());

  const stickyCart = page.locator('#cartSticky');
  await expect(stickyCart).toBeVisible();
  await page.locator('.delivery-widget').click();
  await expect(page.locator('#operationModal')).toHaveClass(/active/);
  await expect(stickyCart).toHaveClass(/show/);
  await expect(stickyCart).toHaveCSS('display', 'flex');
  await expect(stickyCart).toHaveCSS('visibility', 'visible');

  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await expect(page.locator('#operationModal')).not.toHaveClass(/active/);
  await expect(stickyCart).toBeVisible();
});

test('sacola nao some antes de a tela do produto cobrir a Home', async ({ page }) => {
  // O RELATO: com item na sacola, tocar num item do cardápio fazia o botão
  // "Ver sacola" SUMIR — e sumir ANTES de a tela do produto chegar por cima.
  // A tela vir por cima está certa; a barra piscar fora antes, não.
  //
  // A LARGURA É PARTE DO TESTE. A regra que tira a barra sob overlay mora em
  // `@media(max-width:767px)` (utilities.css), e a largura padrão do Playwright
  // é 1280: um teste sem viewport de celular passa sem ter olhado para o
  // defeito. É a §14.2 da skill.
  //
  // O QUE ESTE TESTE MEDE, e por que não é o estado final: a barra some no
  // MESMO quadro do toque, enquanto o painel do produto ainda está lá embaixo.
  // Afirmar só sobre o fim ("continua flex com o modal aberto") não distingue
  // "nunca saiu" de "saiu e voltou". A sonda anda quadro a quadro do toque até
  // o painel cobrir a tela e pergunta, em cada um, se a barra ainda estava
  // desenhada. Máquina lenta só acrescenta amostras — o lado seguro.
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 1);
  await page.evaluate(() => window.RapidexActions.resolve('goToMenuTab')());

  const stickyCart = page.locator('#cartSticky');
  await expect(stickyCart).toBeVisible();
  await expect(page.locator('#productModal')).not.toHaveClass(/active/);

  // A TELA DO PRODUTO ENTRA PELA DIREITA, não por baixo: no celular
  // `#productModal .modal--product` vai de `translateX(100%)` a
  // `translateX(-50%)` em .53s (utilities.css:3881). A primeira versão desta
  // sonda mediu o TOPO do painel — que nunca sai de 0 — e reprovou por
  // vacuidade, sem uma palavra sobre a barra. Quem anda é a borda ESQUERDA.
  const quadros = await page.evaluate(async (productId) => {
    const barra = document.getElementById('cartSticky');
    const overlay = document.getElementById('productModal');
    const painel = overlay.querySelector('.modal--product');
    const amostras = [];
    window.openProduct(productId);
    await new Promise((resolve) => {
      const quadro = () => {
        const bordaDoPainel = painel.getBoundingClientRect().left;
        amostras.push({ bordaDoPainel, display: getComputedStyle(barra).display });
        if (bordaDoPainel <= 0.5 || amostras.length >= 300) resolve();
        else requestAnimationFrame(quadro);
      };
      requestAnimationFrame(quadro);
    });
    return amostras;
  }, PRODUCT_H2O);

  // SONDA CONTRA VACUIDADE: se o painel já estivesse no lugar no primeiro
  // quadro, o filtro abaixo seria vazio por não ter medido nada.
  const antesDeCobrir = quadros.filter((q) => q.bordaDoPainel > 1);
  expect(
    antesDeCobrir.length,
    `a sonda não pegou o painel em voo: ${JSON.stringify(quadros.slice(0, 6))}`
  ).toBeGreaterThan(1);

  const sumiuAntes = antesDeCobrir.filter((q) => q.display === 'none');
  expect(
    sumiuAntes.length,
    `o rodapé da sacola saiu da tela em ${sumiuAntes.length} de ${antesDeCobrir.length} quadros antes de o painel do produto cobri-lo`
  ).toBe(0);

  // E com a tela aberta ela continua no lugar, atrás do painel — é o mesmo
  // arranjo já afirmado para a sacola e para a tela de unidades.
  await expect(page.locator('#productModal')).toHaveClass(/active/);
  await expect(stickyCart).toHaveClass(/show/);
  await expect(stickyCart).toHaveCSS('display', 'flex');
});

test('product -> cart -> payment -> submit creates an order with the contract payload', async ({
  page
}) => {
  const { orderRequests } = await mockApi(page, { orderResponse: pixOrder });
  await seedPickupSession(page);

  await selectPixAndReturnToCart(page);

  await expect(page.locator('#cartList')).toContainText('H2O');
  await expect(page.locator('#csTotal')).toContainText('22,14');
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  // Pix é fluxo online: o pedido criado leva à cobrança, não à confirmação.
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
  await expect(page.locator('#pixOrderNumber')).toHaveText(
    `Nº do pedido ${pixOrder(1).order_number}`
  );

  // Exactly one order was created, with the contract-shaped payload.
  expect(orderRequests).toHaveLength(1);
  const { body } = orderRequests[0];
  expect(body.order_type).toBe('pickup');
  expect(body.payment_method).toBe('pix'); // obrigatório desde o pagamento online
  expect(body.items[0]).toMatchObject({ product_id: expect.any(String), quantity: 3 });
  expect(body).not.toHaveProperty('total'); // backend is authoritative

  // No fluxo ONLINE a sacola sobrevive à criação do pedido, de propósito: ela é
  // o caminho de volta à cobrança pendente, e o CTA reabre a cobrança existente
  // em vez de criar um segundo pedido. Quem é dono desse contrato é
  // pix-payment.spec.js ("Cancelar pedido" volta lateralmente à sacola sem
  // criar outro pedido); aqui só se registra que ela NÃO é esvaziada agora.
  // O esvaziamento acontece na confirmação do pagamento — ver, no mesmo
  // arquivo, "o pagamento confirmado apaga a pendência guardada para a loja".
  const cartCount = await page.evaluate(
    () => (window.PedeAquiCartStore?.get?.().items || []).length
  );
  expect(cartCount).toBe(1);
});

test('pedido pago na entrega vai direto para a tela de sucesso, sem passar pelo Pix', async ({
  page
}) => {
  // O caminho que já existia. Ele não pode ter mudado: quem paga na entrega
  // nunca vê cobrança, e o app não chama o endpoint de pagamento.
  const { orderRequests, paymentRequests } = await mockApi(page);
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();

  await page.locator('[data-payment-screen-tab=delivery]').click();
  // Crédito Visa: escolher na entrega confirma na hora e volta para a sacola.
  await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#cartCtaBtn')).toHaveText('Efetuar pagamento');

  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessNumber')).toHaveText(`#${successOrder(1).order_number}`);
  await expect(page.locator('#ordSuccessTotal')).toContainText('22,14');
  // A tela de sucesso continua idêntica: sem linha de pagamento, que é do Pix.
  await expect(page.locator('#ordSuccessPaymentRow')).toBeHidden();
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);

  expect(orderRequests).toHaveLength(1);
  expect(orderRequests[0].body.payment_method).toBe('credit_card');
  expect(paymentRequests, 'pagamento na entrega não cria cobrança').toHaveLength(0);
});

// A trava de duplo-clique acompanhou o botão: quem cria o pedido agora é o
// "Confirmar" da folha, e é nele que os dois cliques têm de virar um pedido só.
test('double-click on Confirmar creates only ONE order', async ({ page }) => {
  // Hold the response open briefly so both clicks land while the request is in flight.
  const { orderRequests } = await mockApi(page, {
    onCreateOrder: async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pixOrder(1))
      });
    }
  });
  await seedPickupSession(page);
  await selectPixAndReturnToCart(page);

  await page.locator('#cartCtaBtn').click();
  const submitButton = page.locator('#orderConfirmSheet .order-confirm-cta');
  await submitButton.click();
  await submitButton.click({ force: true }).catch(() => {}); // second click while disabled/in-flight

  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
  expect(orderRequests).toHaveLength(1);
});

test('a retry after a network failure reuses the same Idempotency-Key', async ({ page }) => {
  // Fail the first attempt at the network layer, succeed on the second.
  const { orderRequests } = await mockApi(page, {
    onCreateOrder: async (route, _request, attempt) => {
      if (attempt === 1) return route.abort('connectionfailed');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pixOrder(2))
      });
    }
  });
  await seedPickupSession(page);
  await selectPixAndReturnToCart(page);

  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  // First attempt failed: error shown, cart intact, button re-enabled.
  await expect(page.locator('#cartOrderError')).toBeVisible();
  await expect(page.locator('#cartCtaBtn')).toBeEnabled();

  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  expect(orderRequests).toHaveLength(2);
  expect(orderRequests[0].idempotencyKey).toBeTruthy();
  expect(orderRequests[1].idempotencyKey).toBe(orderRequests[0].idempotencyKey);
});

test('a chave que o servidor recusa por corpo diferente e trocada, e a tela nao manda "revisar"', async ({ page }) => {
  // O DEPLOY DO CASHBACK É O GATILHO. `use_cashback` entra em
  // `CreateOrderRequest` e o fingerprint do servidor sai de `model_dump()` do
  // corpo inteiro — então toda chave reservada ANTES do deploy e retentada
  // DEPOIS recebe 422 por um pedido IDÊNTICO, durante as 24h de vida dela.
  //
  // O que o app fazia: tratava esse 422 como dado inválido ("Revise e tente
  // novamente") e PRESERVAVA a chave. Tocar de novo mandava a mesma chave e
  // recebia o mesmo 422 — laço fechado, o cliente nunca pedia.
  //
  // Os três fatos que este teste prende, nesta ordem:
  //   1. a chave ainda é REUSADA na falha de rede (a garantia antiga, intacta);
  //   2. a frase muda: o 422 de chave reciclada não manda revisar dado nenhum,
  //      manda CONFERIR antes de reenviar — porque a reserva da chave vive na
  //      transação do INSERT, então linha que sobreviveu é pedido que commitou;
  //   3. o toque seguinte sai com chave NOVA.
  const { orderRequests } = await mockApi(page, {
    onCreateOrder: async (route, _request, attempt) => {
      if (attempt === 1) return route.abort('connectionfailed');
      if (attempt === 2) {
        return route.fulfill({
          status: 422,
          contentType: 'application/json',
          // `detail` STRING, que é a assinatura estrutural deste 422 — o de
          // validação do FastAPI vem como array de {loc,msg,type}.
          body: JSON.stringify({
            detail: 'Idempotency-Key já utilizada com um corpo diferente. Gere uma nova chave para uma nova requisição.'
          })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pixOrder(3))
      });
    }
  });
  await seedPickupSession(page);
  await selectPixAndReturnToCart(page);

  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#cartOrderError')).toBeVisible();

  // Segunda tentativa: mesma chave, e é ela que o servidor recusa.
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  const erro = page.locator('#cartOrderError');
  await expect(erro).toBeVisible();
  await expect(erro).toContainText('tentativa anterior pode ter sido concluída');
  await expect(erro).not.toContainText('Revise');
  // Nenhum pedido nasceu: a tela de Pix não pode ter aberto.
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);

  // Terceira: o cliente decide reenviar, e agora a chave é OUTRA.
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  expect(orderRequests).toHaveLength(3);
  expect(orderRequests[1].idempotencyKey).toBe(orderRequests[0].idempotencyKey);
  expect(orderRequests[2].idempotencyKey).toBeTruthy();
  expect(orderRequests[2].idempotencyKey).not.toBe(orderRequests[1].idempotencyKey);
});
// A criação do pedido é o outro ponto que renderiza `detail`. Vale a mesma
// regra da cobrança: o formato do `detail` muda (string, array de 422, objeto),
// a garantia não — o cliente lê português, nunca "[object Object]", e o
// carrinho continua intacto para ele tentar de novo.
for (const [nome, status, detail] of [
  [
    'array de validação (422)',
    422,
    [{ loc: ['body', 'items'], msg: 'campo obrigatório', type: 'missing' }]
  ],
  ['objeto estruturado', 409, { code: 'COUPON_ALREADY_USED', retryable: false }],
  ['string simples', 409, 'cupom já utilizado']
]) {
  test(`erro de criação com detail em ${nome} vira mensagem legível`, async ({ page }) => {
    await mockApi(page, {
      onCreateOrder: (route) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ detail })
        })
    });
    await seedPickupSession(page);
    await selectPixAndReturnToCart(page);

    await page.locator('#cartCtaBtn').click();
    await confirmOrderSheet(page);

    const error = page.locator('#cartOrderError');
    await expect(error).toBeVisible();
    await expect(error).not.toContainText('[object Object]');
    await expect(error).not.toContainText('undefined');
    await expect(error).not.toBeEmpty();

    // O carrinho não pode ter sido esvaziado pela falha, e o botão volta.
    await expect(page.locator('#cartList')).toContainText('H2O');
    await expect(page.locator('#cartCtaBtn')).toBeEnabled();
  });
}

test('guest adds one item, sees the bag, and is gated only by the cart CTA', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await mockApi(page);
  await page.route('**/coupons/preview', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Authentication required' })
    })
  );

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await expect(page.locator('#operationModal')).not.toHaveClass(/active/);

  // A public coupon may be selected before the guest has any cart items.
  // Its automatic preview must never hijack Add-to-cart with the login modal.
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await expect(page.locator('#operationModal')).not.toHaveClass(/active/);

  await page.evaluate((productId) => window.openProduct(productId), PRODUCT_H2O);
  await page.locator('#pmAddBtn').click();

  await page.waitForTimeout(250);
  await expect(page.locator('#productModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).not.toHaveClass(/active/);
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartList .cart-item-row')).toHaveCount(1);
  await expect(page.locator('#cartItemCountLabel')).toHaveText('1 item');

  const stickyCart = page.locator('#cartSticky');
  await expect(stickyCart).not.toBeVisible();
  await expect(page.locator('#mobBottomNav')).toBeVisible();
  await page.evaluate(() => window.RapidexActions.resolve('goToMenuTab')());
  await expect(page.locator('body')).toHaveClass(/menu-tab/);
  await expect(stickyCart).toBeVisible();

  const stickyCartButton = page.locator('#cartStickyBtn');
  await stickyCartButton.click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(stickyCart).toHaveCSS('display', 'flex');
  await expect(stickyCart).toHaveCSS('visibility', 'visible');
  await expect(page.locator('#cartModal')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#cartModal')).toHaveCSS('backdrop-filter', 'none');
  await expect(stickyCartButton).toHaveCSS('outline-style', 'none');
  await expect(stickyCartButton).toHaveCSS('border-top-width', '0px');
  const focusShadow = await stickyCartButton.evaluate(button => getComputedStyle(button).boxShadow);
  expect(focusShadow === 'none' || focusShadow.includes('inset')).toBeTruthy();

  // A continuação deste cenário cobre as abas legadas, ocultas no layout mobile.
  await page.setViewportSize({ width: 1280, height: 720 });
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).toHaveText('Informe seu endereço');
  await page.locator('#cartTabRetirada').click();
  await expect(cta).toHaveText('Entre ou cadastre-se');
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
  await cta.click();
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await page.waitForTimeout(800);
  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
});
