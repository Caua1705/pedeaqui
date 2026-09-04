import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, ORDERS, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O detalhe do pedido do Perfil, alimentado pelos NOMES DO CONTRATO.
//
//  Este spec consome o mock logado padrão (helpers.js): /customers/me/orders
//  responde o fixture orders.json (CustomerOrderHistoryItem[]) e o GET por id
//  responde orderDetail() (OrderDetailResponse, com endereço FLAT). Nada aqui
//  inventa rota nem campo — se o app ler um nome que o contrato não tem, a
//  informação some da tela e o teste acusa.
//
//  Foi exatamente o que aconteceu em produção: item.name, item.unit_price e
//  selected_options_snapshot (shape da SACOLA local, não da API) faziam TODO
//  pedido abrir sem opções escolhidas, com "Item" no lugar do nome quando o
//  produto saía do cardápio local, e "Endereço não informado" sempre.
// ============================================================================

async function abrirPedidos(page) {
  await page.setViewportSize({ width: 414, height: 844 });
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-profile-contract-token');
  });
  const mock = await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus pedidos' }).click();
  await expect(page.locator('.prof-order-card')).toHaveCount(ORDERS.length);
  return mock;
}

async function abrirDetalhe(page, orderNumber) {
  const card = page.locator('.prof-order-card', { hasText: `Pedido #${orderNumber}` });
  await card.locator('.prof-order-details-button').click();
  await expect(page.locator('#profOrderDetail')).toHaveClass(/active/);
}

test('as opções escolhidas aparecem agrupadas, com o nome e o preço do snapshot', async ({ page }) => {
  await abrirPedidos(page);
  await abrirDetalhe(page, 3001);

  const card = page.locator('.order-details__order-card');
  await expect(card).toContainText('Maminha à Moda (400g)');
  await expect(card).toContainText('Acompanhamento');
  await expect(card).toContainText('Espaguete ao alho');
  // unit_price_snapshot JÁ inclui o adicional (117,50 + 8,50): o item mostra
  // o total do contrato, sem re-somar nada no browser.
  await expect(card).toContainText('R$ 126,00');
  await expect(card).toContainText('Agua H2O');
});

test('o endereço de entrega vem dos campos flat do OrderDetailResponse', async ({ page }) => {
  await abrirPedidos(page);
  await abrirDetalhe(page, 3001);

  const address = page.locator('.order-details__address-copy');
  await expect(address).toContainText('Rua Silva Paulet, 450');
  await expect(address).toContainText('Aldeota');
  await expect(address).not.toContainText('Endereço não informado');
});

test('a seção Valores fecha a conta: taxa de serviço e desconto do cupom aparecem', async ({ page }) => {
  await abrirPedidos(page);
  await abrirDetalhe(page, 3002);

  const totals = page.locator('.order-details__totalContainer');
  await expect(totals).toContainText('Taxa de serviço');
  await expect(totals).toContainText('R$ 0,99');
  await expect(totals).toContainText('Desconto (BEMVINDO10)');
  await expect(totals).toContainText('-R$ 10,00');
  await expect(totals).toContainText('R$ 78,89');
});

test('produto que saiu do cardápio mantém o nome do snapshot — nunca "Item"', async ({ page }) => {
  await abrirPedidos(page);
  await abrirDetalhe(page, 3003);

  const card = page.locator('.order-details__order-card');
  await expect(card).toContainText('Feijoada de Sábado (1kg)');
  await expect(card).not.toContainText(/\b1x\s*Item\b/);
});

test('o caminho inteiro só chamou rotas declaradas no mock', async ({ page }) => {
  const mock = await abrirPedidos(page);
  await abrirDetalhe(page, 3001);
  await expect(page.locator('.order-details__order-card')).toContainText('Maminha');
  expect(mock.rotasDesconhecidas).toEqual([]);
});

// ============================================================================
//  O CARTÃO DIZ O ESTADO DO PEDIDO — e não "Aguardando pagamento" para todos.
//
//  O RELATO: "Pedidos em andamento (39)" conta um conjunto e a lista mostra
//  outro. Medido, o CONTADOR está certo — ele e a lista saem do MESMO array
//  (25 e 25 numa sonda com 40 pedidos). Quem mentia era a LISTA: todo cartão
//  em andamento escrevia "Aguardando pagamento", porque o texto era escolhido
//  pelo TOM (`active`), que é o tom de tudo que não é sucesso nem recusa — e
//  não pelo status.
//
//  Ou seja: o cabeçalho contava "em andamento" e os cartões diziam "aguardando
//  pagamento". Duas expressões do mesmo conjunto discordando na mesma tela, e
//  um pedido que já tinha SAÍDO PARA ENTREGA anunciando que esperava dinheiro.
//
//  E `pending` não é "aguardando pagamento": no contrato ele é o pedido criado
//  esperando confirmação (a tela do entregador o traduz como "Aguardando o
//  restaurante"), e `CustomerOrderHistoryItem` **não traz `payment_status`** —
//  esta lista não tem como saber do dinheiro. Por isso a frase é sobre o
//  PEDIDO: "Aguardando confirmação", a mesma do detalhe.
// ============================================================================

const EM_ANDAMENTO = [
  ['pending', 'Aguardando confirmação'],
  ['accepted', 'Aceito'],
  ['preparing', 'Preparando'],
  ['ready', 'Pronto'],
  ['out_for_delivery', 'Saiu para entrega']
];

test('cada pedido em andamento diz o SEU estado, e o cabeçalho conta o mesmo', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 844 });
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-profile-status-token');
  });
  await mockApi(page);
  // Os cinco status ativos do contrato mais um finalizado, para o cabeçalho ter
  // o que separar.
  const pedidos = [
    ...EM_ANDAMENTO.map(([status], i) => ({ ...ORDERS[0], id: `st-${i}`, order_number: 7000 + i, status })),
    { ...ORDERS[1], id: 'st-fim', order_number: 7100, status: 'completed' }
  ];
  await page.route('**/customers/me/orders**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pedidos) }));

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus pedidos' }).click();

  const emAndamento = page.locator('.prof-orders-current .prof-order-card');
  await expect(emAndamento).toHaveCount(EM_ANDAMENTO.length);

  for (const [index, [status, frase]] of EM_ANDAMENTO.entries()) {
    const cartao = emAndamento.nth(index);
    await expect(cartao.locator('.prof-order-status'), `${status} não diz o próprio estado`)
      .toContainText(frase);
  }

  // O que NÃO pode acontecer, e acontecia com os cinco: o pedido que saiu para
  // entrega anunciando que espera pagamento.
  await expect(emAndamento.nth(4).locator('.prof-order-status')).not.toContainText('pagamento');

  // E o cabeçalho conta exatamente o que a lista mostra.
  await expect(page.locator('.prof-orders-current h2')).toContainText(`(${EM_ANDAMENTO.length})`);
  await expect(page.locator('.prof-orders-history h2')).toContainText('(1)');
  await expect(page.locator('.prof-orders-history .prof-order-card')).toHaveCount(1);
});

// ============================================================================
//  AGUARDANDO PAGAMENTO NÃO É "EM ANDAMENTO" — e o contrato passou a permitir
//  dizer isso.
//
//  O RELATO: "Pedidos em andamento (39)" conta um conjunto e a lista mostra
//  outro. A contagem e a lista sempre saíram do MESMO array (medido: 25 e 25),
//  então o defeito não era aritmético — era de CONJUNTO: entravam em "em
//  andamento" pedidos que o cliente nunca chegou a pagar, e que ficavam ali
//  para sempre esperando uma cozinha que nunca recebeu o pedido.
//
//  `CustomerOrderHistoryItem` ganhou `payment_status` (04/09/2026) para
//  exatamente isto. A tabela é do próprio contrato:
//
//      payment_status   o que aconteceu          o que o cliente faz
//      -------------------------------------------------------------
//      paid             pago, esperando a loja   espera
//      on_delivery      paga na entrega          espera
//      failed           cobrança recusada        TENTA OUTRO CARTÃO
//      pending          nunca chegou a pagar     FINALIZA O PAGAMENTO
//
//  Os dois de baixo são do CLIENTE, e é por isso que eles não são "em
//  andamento": não há nada em andamento — há algo parado esperando ele.
//
//  E `payment_status` é `string | null`: NULO não é "aguardando pagamento".
//  Pedido antigo, gravado antes deste campo existir, continua onde estava.
// ============================================================================

const COM_PAGAMENTO = [
  // [status, payment_status, seção, frase]
  ['pending', 'pending', 'pagamento', 'Aguardando pagamento'],
  ['pending', 'failed', 'pagamento', 'Pagamento recusado'],
  ['pending', 'on_delivery', 'andamento', 'Aguardando confirmação'],
  ['preparing', 'paid', 'andamento', 'Preparando'],
  ['out_for_delivery', null, 'andamento', 'Saiu para entrega']
];

test('o que espera o CLIENTE sai de "em andamento", e cada seção conta a sua lista', async ({
  page
}) => {
  await page.setViewportSize({ width: 414, height: 844 });
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-profile-pagamento-token');
  });
  await mockApi(page);
  const pedidos = COM_PAGAMENTO.map(([status, payment_status], i) => ({
    ...ORDERS[0], id: `pg-${i}`, order_number: 8000 + i, status, payment_status
  }));
  pedidos.push({ ...ORDERS[1], id: 'pg-fim', order_number: 8100, status: 'completed', payment_status: 'paid' });
  await page.route('**/customers/me/orders**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pedidos) }));

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus pedidos' }).click();

  const esperado = {
    pagamento: COM_PAGAMENTO.filter(([, , secao]) => secao === 'pagamento').length,
    andamento: COM_PAGAMENTO.filter(([, , secao]) => secao === 'andamento').length,
    historico: 1
  };

  // CADA CABEÇALHO CONTA A SUA PRÓPRIA LISTA — as três, e não só a do meio:
  // uma contagem que não bate é o mesmo defeito, em qualquer seção.
  for (const [secao, classe, quantos] of [
    ['pagamento', '.prof-orders-awaiting', esperado.pagamento],
    ['andamento', '.prof-orders-current', esperado.andamento],
    ['histórico', '.prof-orders-history', esperado.historico]
  ]) {
    await expect(page.locator(`${classe} h2`), `cabeçalho de ${secao}`).toContainText(`(${quantos})`);
    await expect(page.locator(`${classe} .prof-order-card`), `lista de ${secao}`).toHaveCount(quantos);
  }

  // E cada cartão diz o que É — o pagamento recusado não pode se parecer com o
  // pedido que nunca foi pago: um pede outro cartão, o outro pede concluir.
  await expect(page.locator('.prof-orders-awaiting .prof-order-card').nth(0)).toContainText('Aguardando pagamento');
  await expect(page.locator('.prof-orders-awaiting .prof-order-card').nth(1)).toContainText('Pagamento recusado');

  // NULO NÃO É "AGUARDANDO PAGAMENTO". O pedido antigo, gravado antes do campo
  // existir, continua em andamento — e é o caso que um `!order.payment_status`
  // ingênuo jogaria na seção errada.
  await expect(page.locator('.prof-orders-current')).toContainText('Saiu para entrega');
  await expect(page.locator('.prof-orders-awaiting')).not.toContainText('Saiu para entrega');
});
