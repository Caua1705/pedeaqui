import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, SLUG, ORDERS, orderDetail, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O CLIENTE CANCELANDO O PRÓPRIO PEDIDO.
//
//  A rota existia no contrato e o front nunca a chamou — é a pendência que o
//  `docs/order-contract.md` (item 11) chama de "a mais cara": numa recusa de
//  cartão o pedido já está gravado, e não havia como o cliente desfazê-lo.
//
//  ## As duas condições, e por que as DUAS
//
//  1. **A JANELA.** O backend só aceita em `pending` e `accepted`; de
//     `preparing` em diante responde 409. Um botão fora da janela é a oferta
//     que falha depois — o mesmo defeito que o fluxo do cupom passou a rodada
//     consertando.
//  2. **O TOKEN.** Quem autoriza é o `tracking_token`, e ele NÃO vem no
//     `OrderDetailResponse`: só existe no localStorage do aparelho que criou o
//     pedido. Sem ele o botão não aparece, porque não haveria com o que
//     cancelar.
//
//  ## A folha de confirmação diz o que acontece com o DINHEIRO
//
//  E ela lê o PEDIDO para isso. Prometer estorno num pedido que se paga na
//  entrega é mentir para quem nunca pagou; omitir o estorno num Pix já pago é
//  esconder a informação que faz a pessoa decidir sem medo.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

const TOKEN = 'trk_e2e_cancelamento_0000';
const PEDIDO_BASE = ORDERS[0];

/**
 * Um pedido na janela, com o token deste aparelho gravado — que é a condição
 * que o app não consegue inventar.
 */
async function prepararPedidoCancelavel(page, {
  status = 'accepted',
  paymentFlow = 'online',
  paymentStatus = 'paid',
  couponCode = null,
  cashbackRedeemed = 0,
  onCancel = null
} = {}) {
  await seedPickupSession(page);
  await page.addInitScript(([slug, token, orderId, statusInicial]) => {
    localStorage.setItem('rapidex.customer.token', 'e2e-cancel-token');
    localStorage.setItem(`rapidex.orderTracking.${slug}`, JSON.stringify([{
      tracking_token: token,
      order_id: orderId,
      order_number: 3001,
      status: statusInicial,
      payment_flow: 'online',
      payment_status: 'paid',
      total: 51.79,
      saved_at: Date.now()
    }]));
  }, [SLUG, TOKEN, PEDIDO_BASE.id, status]);

  await mockApi(page);

  const pedido = {
    ...orderDetail(PEDIDO_BASE),
    status,
    payment_flow: paymentFlow,
    payment_status: paymentStatus,
    coupon_code: couponCode,
    cashback_redeemed_amount: cashbackRedeemed
  };

  const cancelamentos = [];
  // DEPOIS do mockApi: a última rota registrada vence (skill §4).
  await page.route(/\/customers\/me\/orders(\?|$)/, (route) =>
    route.fulfill(json([{ ...PEDIDO_BASE, status }]))
  );
  await page.route(/\/customers\/me\/orders\/[^/?]+/, (route) => route.fulfill(json(pedido)));
  await page.route(/\/orders\/track\/[^/]+\/cancel$/, async (route) => {
    cancelamentos.push({
      url: route.request().url(),
      headers: route.request().headers(),
      body: route.request().postData()
    });
    if (onCancel) return onCancel(route);
    return route.fulfill(json({ ...pedido, status: 'cancelled' }));
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('pedidos'));
  await page.evaluate(() => window.RapidexActions.resolve('openProfOrderDetails')(0));
  await expect(page.locator('#profOrderDetail')).toHaveClass(/active/);
  return cancelamentos;
}

const botaoCancelar = (page) => page.locator('.order-details__cancel');
const folha = (page) => page.locator('#orderCancelConfirm');

test('na janela e com o token, a tela oferece cancelar — e só depois de confirmar', async ({ page }) => {
  const cancelamentos = await prepararPedidoCancelavel(page);

  await expect(botaoCancelar(page)).toBeVisible();

  // Abrir a confirmação NÃO cancela nada. É a mesma separação do cupom: ler não
  // é aplicar, e aqui a ação é irreversível.
  await botaoCancelar(page).click();
  await expect(folha(page)).toBeVisible();
  expect(cancelamentos, 'abrir a confirmação não pode cancelar').toHaveLength(0);

  // E desistir da desistência devolve a tela como estava.
  await page.locator('.order-cancel-keep').click();
  await expect(folha(page)).toBeHidden();
  expect(cancelamentos).toHaveLength(0);

  await botaoCancelar(page).click();
  await page.locator('#orderCancelGo').click();
  await expect.poll(() => cancelamentos.length).toBe(1);

  // O token do PATH é quem autoriza, e o Bearer NÃO vai junto: a rota não pede,
  // e mandar um header que a rota não pede é vazar credencial de graça.
  expect(cancelamentos[0].url).toContain(`/orders/track/${TOKEN}/cancel`);
  expect(cancelamentos[0].headers.authorization, 'a rota não pede Bearer').toBeUndefined();
  // Sem motivo digitado, sem corpo.
  expect(cancelamentos[0].body).toBeFalsy();

  // A tela passa a mostrar o pedido cancelado, e o botão some.
  await expect(page.locator('#profOrderDetailBody')).toContainText('Pedido recusado');
  await expect(botaoCancelar(page)).toHaveCount(0);
  await expect(folha(page)).toBeHidden();
});

test('a confirmação diz o que acontece com o pagamento, o cupom e o cashback', async ({ page }) => {
  await prepararPedidoCancelavel(page, {
    paymentFlow: 'online',
    paymentStatus: 'paid',
    couponCode: 'JP10',
    cashbackRedeemed: 4.5
  });

  await botaoCancelar(page).click();
  const lista = page.locator('#orderCancelConsequences');
  await expect(lista).toContainText('estornado');
  await expect(lista).toContainText('JP10');
  await expect(lista).toContainText('cashback');
  // E o aviso de que não dá para desfazer.
  await expect(folha(page)).toContainText('Não dá para desfazer');
});

test('num pedido que se paga na entrega, a folha NÃO promete estorno', async ({ page }) => {
  // O ponto: a lista sai do PEDIDO. Uma lista fixa diria "o valor pago é
  // estornado" a quem nunca pagou nada.
  await prepararPedidoCancelavel(page, {
    paymentFlow: 'delivery',
    paymentStatus: 'pending',
    couponCode: null,
    cashbackRedeemed: 0
  });

  await botaoCancelar(page).click();
  const lista = page.locator('#orderCancelConsequences');
  await expect(lista).toContainText('pago na entrega');
  await expect(lista).not.toContainText('estornado');
  await expect(lista).not.toContainText('cashback');
});

test('fora da janela o botão NEM APARECE — não se oferece o que vai falhar', async ({ page }) => {
  await prepararPedidoCancelavel(page, { status: 'preparing' });
  await expect(page.locator('#profOrderDetailBody')).toBeVisible();
  await expect(botaoCancelar(page), '`preparing` está fora da janela do backend').toHaveCount(0);
});

test('sem o token deste aparelho o botão não aparece, mesmo na janela', async ({ page }) => {
  // O token não vem no OrderDetailResponse: ele é do aparelho que fez o pedido.
  // Sem ele não há com o que autorizar, e um botão que erra 404 é pior que
  // botão nenhum.
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-cancel-token');
  });
  await mockApi(page);
  await page.route(/\/customers\/me\/orders(\?|$)/, (route) =>
    route.fulfill(json([{ ...PEDIDO_BASE, status: 'accepted' }]))
  );
  await page.route(/\/customers\/me\/orders\/[^/?]+/, (route) =>
    route.fulfill(json({ ...orderDetail(PEDIDO_BASE), status: 'accepted' }))
  );

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('pedidos'));
  await page.evaluate(() => window.RapidexActions.resolve('openProfOrderDetails')(0));
  await expect(page.locator('#profOrderDetail')).toHaveClass(/active/);

  await expect(botaoCancelar(page)).toHaveCount(0);
});

test('409 diz que o restaurante já começou, e NÃO oferece tentar de novo', async ({ page }) => {
  // 409 não é falha de rede: é o pedido tendo saído da janela entre o desenho
  // da tela e o toque. Oferecer retentativa aqui é oferecer o que nunca mais
  // vai dar certo.
  const cancelamentos = await prepararPedidoCancelavel(page, {
    onCancel: (route) => route.fulfill(json({ detail: 'Pedido em preparo' }, 409))
  });

  await botaoCancelar(page).click();
  await page.locator('#orderCancelGo').click();
  await expect.poll(() => cancelamentos.length).toBe(1);

  const erro = page.locator('#orderCancelError');
  await expect(erro).toBeVisible();
  await expect(erro).toContainText('já começou a preparar');
  await expect(erro).not.toContainText('Tente de novo');

  // A folha continua aberta com o motivo, e o pedido segue como estava.
  await expect(folha(page)).toBeVisible();
  await expect(page.locator('#profOrderDetailBody')).not.toContainText('Pedido recusado');
});
