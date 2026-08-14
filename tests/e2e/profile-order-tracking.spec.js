import { test, expect } from '@playwright/test';
import { INFO, MENU, mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

const ORDER_ID = '00000000-0000-4000-8000-000000011950';
const HELP_INFO = {
  ...INFO,
  branch: {
    ...INFO.branch,
    name: 'Matriz',
    display_name: 'Matriz',
    email: 'contato@juniordapicanha.com.br',
    phone: '(85) 3025-3303',
    whatsapp: '(85) 9 9754-6465'
  }
};

function orderFixture(overrides = {}) {
  return {
    id: ORDER_ID,
    order_number: 11950,
    status: 'pending',
    payment_status: 'pending',
    order_type: 'delivery',
    branch_name: 'Filial Aldeota',
    restaurant_name: 'Take a Juice',
    created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    subtotal: 44.8,
    delivery_fee: 6.99,
    total: 51.79,
    customer_address_id: 'address-e2e-1',
    items: [{
      quantity: 1,
      product_name: 'Combo Quinta',
      total: 44.8,
      selected_options: [
        { option_group_name: 'Tamanho', option_name: 'Tamanho único' },
        { option_group_name: 'Escolha seu panini', option_name: 'Carde de Sol Chipotle' },
        { option_group_name: 'Escolha seu pão', option_name: 'Tradicional com ervas' },
        { option_group_name: 'Escolha seu blend', option_name: 'Moranja 400 ml' },
        { option_group_name: 'Forma de adoçar', option_name: 'Adoçante stevia' }
      ]
    }],
    ...overrides
  };
}

async function openTrackedOrder(page, orderOverrides = {}) {
  await page.setViewportSize({ width: 414, height: 844 });
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-profile-order-token');
  });
  await mockApi(page);
  await page.route('**/api.pederapidex.com/**', async route => {
    const url = route.request().url();
    if (/\/info(?:\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HELP_INFO) });
    }
    if (url.includes(`/customers/me/orders/${ORDER_ID}`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(orderFixture(orderOverrides)) });
    }
    if (/\/customers\/me\/orders(?:\?|$)/.test(url)) {
      const order = orderFixture(orderOverrides);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([order]) });
    }
    if (/\/customers\/me\/addresses(?:\?|$)/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'address-e2e-1',
          street: 'Rua Eduardo Garcia',
          number: '1019',
          neighborhood: 'Aldeota',
          city: 'Fortaleza',
          state: 'CE'
        }])
      });
    }
    if (/\/customers\/me(?:\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'customer-e2e', name: 'E2E Test' }) });
    }
    return route.fallback();
  });

  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus pedidos' }).click();
  const detailsButton = page.locator('.prof-order-details-button');
  const activeStatuses = new Set(['pending', 'created', 'confirmed', 'accepted', 'preparing', 'ready', 'out_for_delivery']);
  await expect(detailsButton).toHaveText(activeStatuses.has(orderOverrides.status || 'pending') ? 'Acompanhar' : 'Ver detalhes');
  await detailsButton.click();
  await expect(page.locator('#profOrderDetail')).toHaveClass(/active/);
}

test('acompanhamento usa a composição e as medidas da referência', async ({ page }) => {
  await openTrackedOrder(page);

  await expect(page.locator('#profOrderDetailTitle')).toHaveText('Pedido #11950');
  await expect(page.locator('.order-details__waiting-copy')).toContainText('Aguardando confirmação');
  await expect(page.locator('.order-details__waiting-copy p')).toHaveText('Aguarde alguns segundos enquanto revisamos o pagamento. Não saia desta tela até a confirmação.');
  await expect(page.locator('.order-details__waiting-copy p > strong')).toHaveText('Não saia desta tela');
  await expect(page.locator('.order-details__waiting-copy p > strong')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.order-details__address-copy')).toContainText('Rua Eduardo Garcia, 1019');
  await expect(page.locator('.order-details__address-copy')).not.toContainText('Filial Aldeota');
  await expect(page.locator('.order-details__waitingPayment')).not.toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.order-details__address')).not.toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.order-details__address-map')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 4)');
  await expect(page.locator('.order-details__order-card')).toContainText('Combo Quinta');
  await expect(page.locator('.order-details__order-card')).toContainText('Escolha seu panini');
  await expect(page.locator('.order-details__totalContainer')).toContainText('R$ 51,79');

  const dimensions = await page.evaluate(() => {
    const size = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      screen: size('#profOrderDetail'),
      header: size('#profOrderDetail > .prof-manage-header'),
      waiting: size('.order-details__waitingPayment'),
      address: size('.order-details__address'),
      total: size('.order-details__totalContainer'),
      help: size('.order-details__help')
    };
  });

  expect(dimensions).toEqual({
    screen: { width: 414, height: 844 },
    header: { width: 414, height: 70 },
    waiting: { width: 374, height: 92 },
    address: { width: 374, height: 172 },
    total: { width: 374, height: 173 },
    help: { width: 374, height: 60 }
  });
});

test('cabeçalho fica fixo durante a rolagem e Ajuda abre o suporte', async ({ page }) => {
  await openTrackedOrder(page);

  await page.locator('#profOrderDetail').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => page.locator('#profOrderDetail > .prof-manage-header').evaluate(header =>
    Math.round(header.getBoundingClientRect().top)
  )).toBe(0);
  const helpButton = page.locator('.order-details__help');
  await expect(helpButton).toHaveCSS('border-top', '1px solid rgb(216, 216, 216)');
  await expect(helpButton).toHaveCSS('border-bottom', '1px solid rgb(216, 216, 216)');
  await helpButton.click();
  await expect(page.locator('#profOrderDetail')).not.toHaveClass(/active/);
  await expect(page.locator('#profSubpedidos')).not.toHaveClass(/active/);
  await expect(page.locator('#profSubajuda')).toHaveClass(/active/);
  await expect(page.locator('#profSubajuda .prof-help-header h1')).toHaveText('Ajuda');
});

for (const orderCase of [
  { status: 'confirmed', label: 'confirmado' },
  { status: 'preparing', label: 'em andamento' },
  { status: 'cancelled', label: 'cancelado' }
]) {
  test(`detalhes do pedido ${orderCase.label} entram e voltam com efeito lateral`, async ({ page }) => {
    await openTrackedOrder(page, { status: orderCase.status });

    const detail = page.locator('#profOrderDetail');
    await expect(detail).toHaveCSS('transition-property', 'transform, visibility');
    await expect(detail).toHaveCSS('transition-duration', '0.53s, 0s');
    await expect.poll(() => detail.evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(0);

    await detail.locator('.profile-orders-back').click();

    await expect(detail).not.toHaveClass(/active/);
    await expect(detail).toHaveCSS('transition-duration', '0.6s, 0s');
    await expect.poll(() => detail.evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(414);
    await expect(detail).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#profSubpedidos > .prof-manage-header h1')).toHaveText('Pedidos');
  });
}

test('pedido cancelado segue a composição da referência e oferece Ajuda no aviso', async ({ page }) => {
  await openTrackedOrder(page, {
    status: 'cancelled',
    cancelled_at: '2026-08-13T18:03:00'
  });

  const finishedOrder = page.locator('.order-details__finishedOrder');
  await expect(finishedOrder).toContainText('Pedido recusado em 13/08/2026 - 18:03');
  await expect(finishedOrder).toContainText('Sentimos muito por isso. O estabelecimento teve que recusar o seu pedido. Tente em outro momento!');
  await expect(page.locator('.order-details__waitingPayment')).toHaveCount(0);

  const dimensions = await page.evaluate(() => {
    const size = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      finishedOrder: size('.order-details__finishedOrder'),
      address: size('.order-details__address'),
      total: size('.order-details__totalContainer')
    };
  });

  expect(dimensions).toEqual({
    finishedOrder: { width: 374, height: 180 },
    address: { width: 374, height: 172 },
    total: { width: 374, height: 173 }
  });
  await expect(page.locator('.order-details__help')).toHaveCount(0);

  await page.locator('.order-details__finished-help').click();
  await expect(page.locator('#profOrderDetail')).not.toHaveClass(/active/);
  await expect(page.locator('#profSubpedidos')).not.toHaveClass(/active/);
  await expect(page.locator('#profSubajuda')).toHaveClass(/active/);
  await expect(page.locator('#profSubajuda .prof-help-header h1')).toHaveText('Ajuda');
});

test('pedido recusado abre lateralmente no topo visível mesmo com o histórico rolado', async ({ page }) => {
  await openTrackedOrder(page, { status: 'cancelled' });

  const detail = page.locator('#profOrderDetail');
  await detail.locator('.profile-orders-back').click();
  await expect(detail).toHaveCSS('visibility', 'hidden');

  const ordersScreen = page.locator('#profSubpedidos');
  await ordersScreen.evaluate(element => {
    const body = element.querySelector('#profSubPedidosBody');
    body.style.setProperty('padding-top', '600px', 'important');
    element.scrollTop = 350;
  });
  await expect.poll(() => ordersScreen.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  await page.locator('.prof-order-details-button').evaluate(button => button.click());
  await expect(detail).toHaveClass(/active/);
  await expect.poll(() => detail.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0);
  await expect.poll(() => detail.evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(0);
  await expect(detail).toHaveCSS('transition-duration', '0.53s, 0s');
});

test('telas internas do Perfil reutilizam exatamente o botão de voltar de Pedidos', async ({ page }) => {
  await openTrackedOrder(page);

  const signature = selector => page.locator(selector).evaluate(button => {
    const style = getComputedStyle(button);
    const svg = button.querySelector('svg');
    const svgStyle = getComputedStyle(svg);
    const rect = button.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      background: style.backgroundColor,
      color: style.color,
      radius: style.borderRadius,
      padding: style.padding,
      svgWidth: svgStyle.width,
      svgHeight: svgStyle.height,
      strokeWidth: svgStyle.strokeWidth,
      paths: [...svg.querySelectorAll('path')].map(path => path.getAttribute('d'))
    };
  });

  await page.locator('#profOrderDetail .profile-orders-back').click();
  const ordersBack = '#profSubpedidos > .prof-manage-header .profile-orders-back';
  const reference = await signature(ordersBack);
  expect(reference).toEqual({
    width: 32,
    height: 32,
    background: 'rgb(236, 236, 236)',
    color: 'rgb(63, 69, 75)',
    radius: '9px',
    padding: '0px',
    svgWidth: '17px',
    svgHeight: '17px',
    strokeWidth: '1.5px',
    paths: ['M19 12H5', 'm12 19-7-7 7-7']
  });

  await page.locator(ordersBack).click();
  const stickyCart = page.locator('#cartSticky');
  await stickyCart.evaluate(element => element.classList.add('show'));
  await expect(stickyCart).toBeVisible();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Gerenciar perfil' }).click();
  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
  await expect(stickyCart).not.toBeVisible();
  expect(await signature('#profSubmeusdados > .prof-manage-header .profile-orders-back')).toEqual(reference);

  await page.locator('#profSubmeusdados > .prof-manage-header .profile-orders-back').click();
  await expect(stickyCart).toBeVisible();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus endereços' }).click();
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  await expect(page.locator('#addrPickerModal')).toHaveClass(/from-profile/);
  await expect(stickyCart).not.toBeVisible();
  expect(await signature('#addrPickerModal .profile-orders-back')).toEqual(reference);

  await page.locator('#addrPickerModal .profile-orders-back').click();
  await expect(stickyCart).toBeVisible();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Política de privacidade' }).click();
  await expect(page.locator('#privacyPolicyScreen')).toHaveClass(/active/);
  await expect(stickyCart).not.toBeVisible();
  expect(await signature('#privacyPolicyBack')).toEqual(reference);
});

test('Perfil mostra Ajuda e abre o cartao exato com os contatos da unidade', async ({ page }) => {
  await openTrackedOrder(page);

  await page.locator('#profOrderDetail .profile-orders-back').click();
  await page.locator('#profSubpedidos > .prof-manage-header .profile-orders-back').click();

  const stickyCart = page.locator('#cartSticky');
  await stickyCart.evaluate(element => element.classList.add('show'));
  await expect(stickyCart).toBeVisible();

  const labels = page.locator('#mobViewProfile .prof-account-row-label');
  await expect(labels).toHaveText([
    'Gerenciar perfil',
    'Meus pedidos',
    'Meus endereços',
    'Política de privacidade',
    'Ajuda',
    'Sair'
  ]);

  const helpRow = page.locator('#mobViewProfile .prof-account-row').filter({ hasText: 'Ajuda' });
  await expect(helpRow).toBeVisible();
  await expect(helpRow).toHaveCSS('height', '60px');
  await expect(helpRow).toHaveCSS('width', '374px');
  await helpRow.click();

  await expect(page.locator('#profSubajuda')).toHaveClass(/active/);
  await expect(stickyCart).not.toBeVisible();
  await expect(page.locator('#profSubajuda .prof-help-header h1')).toHaveText('Ajuda');
  await expect(page.locator('.help-store-name')).toHaveText(MENU.restaurant.name);
  await expect(page.locator('.help-store-branch')).toHaveText('Matriz');
  await expect(page.locator('.help-store-intro')).toContainText('Se precisar de ajuda, entre em contato conosco pelos seguintes meios:');
  await expect(page.locator('.help-store-contact').nth(0)).toContainText('(85) 3025-3303');
  await expect(page.locator('.help-store-contact').nth(1)).toContainText('CONTATO@JUNIORDAPICANHA.COM.BR');
  await expect(page.locator('.help-store-contact--whatsapp')).toContainText('(85) 9 9754-6465');
  await expect(page.locator('.help-store-contact--whatsapp')).toHaveAttribute('href', 'https://wa.me/5585997546465');

  const dimensions = await page.evaluate(() => {
    const size = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      screen: size('#profSubajuda'),
      header: size('#profSubajuda .prof-help-header'),
      card: size('#profSubajuda .help-store-info'),
      logo: size('#profSubajuda .help-store-logo'),
      back: size('#profSubajuda .profile-orders-back')
    };
  });

  expect(dimensions).toEqual({
    screen: { width: 414, height: 844 },
    header: { width: 414, height: 70 },
    card: { width: 374, height: 362 },
    logo: { width: 95, height: 95 },
    back: { width: 32, height: 32 }
  });
  await expect(page.locator('#mobBottomNav')).not.toBeVisible();

  await page.locator('#profSubajuda .profile-orders-back').click();
  await expect(page.locator('#profSubajuda')).not.toHaveClass(/active/);
  await expect(stickyCart).toBeVisible();
  await expect(page.locator('#mobBottomNav')).toBeVisible();
});

test('cartao Seu pedido cresce conforme a quantidade real de conteudo', async ({ page }) => {
  await openTrackedOrder(page, {
    items: [{
      quantity: 1,
      product_name: 'Produto simples',
      total: 44.8,
      selected_options: []
    }]
  });

  const layout = await page.locator('.order-details__order-card').evaluate(card => {
    const style = getComputedStyle(card);
    const rect = card.getBoundingClientRect();
    return {
      height: Math.round(rect.height),
      scrollHeight: card.scrollHeight,
      minHeight: style.minHeight
    };
  });

  expect(layout.minHeight).toBe('0px');
  expect(layout.height).toBe(layout.scrollHeight);
  expect(layout.height).toBeLessThan(300);
  await expect(page.locator('.order-details__help')).toHaveCSS('width', '374px');
  await expect(page.locator('.order-details__help')).toHaveCSS('height', '60px');

  await page.locator('.order-details__help').click();
  await expect(page.locator('#profSubajuda')).toHaveClass(/active/);
});
