import { test, expect } from '@playwright/test';
import { mockApi, MENU, SLUG, BRANCH_MATRIZ, BRANCH_VARJOTA, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

const BRANCH_SUL = '11111111-1111-4111-8111-111111111111';
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

function branchPayload(branch, overrides = {}) {
  return {
    id: branch.id,
    name: branch.name,
    display_name: null,
    slug: branch.slug,
    address: {
      street: branch.address,
      number: null,
      neighborhood: branch.neighborhood,
      city: branch.city,
      state: branch.state,
      zipcode: branch.zipcode || null,
      full_address: [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(' - ')
    },
    is_main: branch.is_main === true,
    is_open_now: true,
    closed_reason: null,
    current_period: null,
    delivery: null,
    ...overrides
  };
}

async function seedDeliveryAddress(page, confirmed = true) {
  await page.addInitScript(({ slug, branchId, isConfirmed }) => {
    const address = {
      street: 'Rua Visconde de Mauá',
      number: '682',
      neighborhood: 'Aldeota',
      city: 'Fortaleza',
      state: 'CE',
      latitude: -3.738,
      longitude: -38.497
    };
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery',
      branch_id: branchId,
      branch_label: 'Varjota',
      address,
      confirmed: isConfirmed
    }));
  }, { slug: SLUG, branchId: BRANCH_VARJOTA, isConfirmed: confirmed });
}

test('com endereço mostra km e taxa, ordena e mantém a filial sem cobertura visível e bloqueada', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDeliveryAddress(page);
  await mockApi(page);

  const sul = {
    ...MENU.branches[0],
    id: BRANCH_SUL,
    name: 'Sul',
    slug: 'sul',
    address: 'Avenida Washington Soares, 3600',
    neighborhood: 'Edson Queiroz',
    is_main: false
  };
  await page.route('**/restaurants/*/menu*', route => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id') || MENU.branch_id;
    return route.fulfill(json({ ...MENU, branch_id: branchId, settings_branch_id: branchId, branches: [...MENU.branches, sul] }));
  });

  const availabilityBodies = [];
  await page.route('**/restaurants/*/branches/availability', route => {
    availabilityBodies.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(json({
      restaurant_slug: SLUG,
      address_provided: true,
      default_branch_id: BRANCH_MATRIZ,
      branches: [
        branchPayload(MENU.branches[0], {
          is_open_now: false,
          closed_reason: 'outside_business_hours',
          delivery: { delivers_to_address: true, reason: null, message: null, distance_km: 1.2, delivery_fee: 11.3 }
        }),
        branchPayload(MENU.branches[1], {
          is_open_now: true,
          delivery: { delivers_to_address: true, reason: null, message: null, distance_km: 2.4, delivery_fee: 7.5 }
        }),
        branchPayload(sul, {
          is_open_now: true,
          delivery: {
            delivers_to_address: false,
            reason: 'outside_delivery_area',
            message: 'Não entrega no endereço selecionado.',
            distance_km: null,
            delivery_fee: 14
          }
        })
      ]
    }));
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('openOperationScreen')());
  await expect.poll(() => availabilityBodies.length).toBe(1);
  await expect(page.locator('.op-branch-badge.metric')).toHaveCount(5);

  const cards = page.locator('.op-branch-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).locator('.op-branch-name')).toHaveText('Varjota');
  await expect(cards.nth(1).locator('.op-branch-name')).toHaveText('Matriz');
  await expect(cards.nth(2).locator('.op-branch-name')).toHaveText('Sul');

  await expect(cards.nth(0).locator('.op-branch-badge')).toHaveText(['2,4 km', 'R$ 7,50', 'Aberto']);
  await expect(cards.nth(1).locator('.op-branch-badge')).toHaveText(['1,2 km', 'R$ 11,30', 'Fechado']);
  await expect(cards.nth(2).locator('.op-branch-badge')).toHaveText(['R$ 14,00', 'Aberto']);
  await expect(cards.nth(2)).toBeDisabled();
  await expect(cards.nth(2)).toHaveClass(/unavailable/);
  await expect(cards.nth(2).locator('.op-branch-reason')).toHaveText('Não entrega no endereço selecionado.');
  await expect(cards.nth(2)).not.toContainText(/null|km/i);

  expect(availabilityBodies).toHaveLength(1);
  expect(availabilityBodies[0]).toEqual({
    address: {
      street: 'Rua Visconde de Mauá',
      number: '682',
      neighborhood: 'Aldeota',
      city: 'Fortaleza',
      state: 'CE',
      latitude: -3.738,
      longitude: -38.497
    }
  });

  await page.locator('#operationModal .modal--fs').screenshot({ path: 'test-results/preview-unidades-entrega.png' });
});

test('pré-carrega a disponibilidade no boot e o widget abre a tela pronta sem loader na seta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDeliveryAddress(page);
  await mockApi(page);

  let markRequestStarted;
  let releaseResponse;
  const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/restaurants/*/branches/availability', async route => {
    markRequestStarted();
    await responseGate;
    return route.fulfill(json({
      restaurant_slug: SLUG,
      address_provided: true,
      default_branch_id: BRANCH_MATRIZ,
      branches: [
        branchPayload(MENU.branches[0], {
          is_open_now: true,
          delivery: { delivers_to_address: true, reason: null, message: null, distance_km: 1.2, delivery_fee: 11.3 }
        }),
        branchPayload(MENU.branches[1], {
          is_open_now: true,
          delivery: { delivers_to_address: true, reason: null, message: null, distance_km: 2.4, delivery_fee: 7.5 }
        })
      ]
    }));
  });

  const navigation = page.goto(RESTAURANT_URL);
  await requestStarted;

  await expect(page.locator('body')).toHaveClass(/app-booting/);
  await expect(page.locator('.delivery-widget')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('.delivery-widget')).not.toHaveClass(/is-loading/);

  releaseResponse();
  await navigation;
  await esperarAppPronto(page);
  await page.locator('.delivery-widget').click();
  await expect(page.locator('#operationModal')).toHaveClass(/active/);
  await expect(page.locator('.op-branch-badge.metric')).toHaveCount(4);
  await expect(page.locator('.delivery-widget')).not.toHaveAttribute('aria-busy');
});

test('Cardápio também abre unidades direto porque os dados já vieram no boot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDeliveryAddress(page, false);
  await mockApi(page);

  let markRequestStarted;
  let releaseResponse;
  const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/restaurants/*/branches/availability', async route => {
    markRequestStarted();
    await responseGate;
    return route.fulfill(json({
      restaurant_slug: SLUG,
      address_provided: true,
      default_branch_id: BRANCH_MATRIZ,
      branches: MENU.branches.map(branch => branchPayload(branch, {
        is_open_now: true,
        delivery: { delivers_to_address: true, reason: null, message: null, distance_km: 3, delivery_fee: 5 }
      }))
    }));
  });

  const navigation = page.goto(RESTAURANT_URL);
  await requestStarted;

  await expect(page.locator('body')).toHaveClass(/app-booting/);

  releaseResponse();
  await navigation;
  await esperarAppPronto(page);
  await page.locator('#mobNavMenu').click();
  await expect(page.locator('#operationModal')).toHaveClass(/active/);
  await expect(page.locator('.op-branch-badge.metric')).toHaveCount(4);
  await expect(page.locator('#mobNavMenu')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#mobNavMenu')).not.toHaveClass(/is-loading/);
});

test('ao confirmar o primeiro endereço mantém o seletor carregando e revela KM e taxa de uma vez', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const address = {
    id: 'local_first_address',
    label: 'Casa',
    street: 'Rua Visconde de Mauá',
    number: '682',
    neighborhood: 'Aldeota',
    city: 'Fortaleza',
    state: 'CE',
    latitude: -3.738,
    longitude: -38.497
  };
  await page.addInitScript(({ slug, branchId, savedAddress }) => {
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery',
      branch_id: branchId,
      branch_label: 'Matriz',
      address: null,
      confirmed: true
    }));
    localStorage.setItem('rapidex.customerAddresses.local', JSON.stringify([savedAddress]));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ, savedAddress: address });
  await mockApi(page);

  let markAddressRequestStarted;
  let releaseAddressResponse;
  const addressRequestStarted = new Promise(resolve => { markAddressRequestStarted = resolve; });
  const addressResponseGate = new Promise(resolve => { releaseAddressResponse = resolve; });
  await page.route('**/restaurants/*/branches/availability', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const addressProvided = Boolean(body.address || body.address_id);
    if (!addressProvided) {
      return route.fulfill(json({
        restaurant_slug: SLUG,
        address_provided: false,
        default_branch_id: BRANCH_MATRIZ,
        branches: MENU.branches.map(branch => branchPayload(branch, { delivery: null }))
      }));
    }
    markAddressRequestStarted();
    await addressResponseGate;
    return route.fulfill(json({
      restaurant_slug: SLUG,
      address_provided: true,
      default_branch_id: BRANCH_MATRIZ,
      branches: MENU.branches.map((branch, index) => branchPayload(branch, {
        is_open_now: true,
        delivery: {
          delivers_to_address: true,
          reason: null,
          message: null,
          distance_km: index === 0 ? 1.2 : 2.4,
          delivery_fee: index === 0 ? 11.3 : 7.5
        }
      }))
    }));
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('openOperationScreen')());
  await page.locator('#opAddrCard').click();
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  await page.locator('[data-addr-id="local_first_address"] .addr-picker-copy').click();
  await page.locator('#addrPickerConfirmBtn').click();
  await addressRequestStarted;

  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  await expect(page.locator('#addrPickerConfirmBtn')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#addrPickerConfirmBtn')).toHaveClass(/is-loading/);
  await page.locator('#addrPickerModal .modal--fs').screenshot({ path: 'test-results/preview-carregamento-endereco.png' });

  releaseAddressResponse();
  await expect(page.locator('#addrPickerModal')).not.toHaveClass(/active/);
  await expect(page.locator('.op-branch-badge.metric')).toHaveCount(4);
  await expect(page.locator('.op-branch-card').nth(0).locator('.op-branch-badge')).toHaveText(['1,2 km', 'R$ 11,30', 'Aberto']);
  await expect(page.locator('#addrPickerConfirmBtn')).not.toHaveAttribute('aria-busy');
});

test('sem endereço delivery null mantém as unidades selecionáveis e só mostra aberto ou fechado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);

  const requestBodies = [];
  await page.route('**/restaurants/*/branches/availability', route => {
    requestBodies.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(json({
      restaurant_slug: SLUG,
      address_provided: false,
      default_branch_id: BRANCH_MATRIZ,
      branches: [
        branchPayload(MENU.branches[0], { is_open_now: true, delivery: null }),
        branchPayload(MENU.branches[1], { is_open_now: false, delivery: null })
      ]
    }));
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('openOperationScreen')());
  await expect.poll(() => requestBodies.length).toBeGreaterThan(0);
  await expect(page.locator('.op-branch-feedback')).toHaveCount(0);

  const cards = page.locator('.op-branch-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.locator('.op-branch-badge.metric')).toHaveCount(0);
  await expect(cards.locator('.op-branch-reason')).toHaveCount(0);
  await expect(cards.nth(0)).toBeEnabled();
  await expect(cards.nth(1)).toBeEnabled();
  await expect(cards.nth(0).locator('.op-branch-badge')).toHaveText('Aberto');
  await expect(cards.nth(1).locator('.op-branch-badge')).toHaveText('Fechado');
  expect(requestBodies.at(-1)).toEqual({});
});
