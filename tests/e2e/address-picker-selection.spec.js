import { test, expect } from '@playwright/test';
import {
  mockApi,
  BRANCH_MATRIZ,
  RESTAURANT_URL,
  SLUG
} from './helpers.js';

const HOME_ADDRESS = {
  id: 'address-home',
  label: 'Casa',
  street: 'Rua das Flores',
  number: '123',
  neighborhood: 'Centro',
  city: 'Fortaleza',
  state: 'CE',
  postal_code: '60000-000'
};

const WORK_ADDRESS = {
  id: 'address-work',
  label: 'Trabalho',
  street: 'Avenida Santos Dumont',
  number: '2000',
  neighborhood: 'Aldeota',
  city: 'Fortaleza',
  state: 'CE',
  postal_code: '60150-161'
};

async function seedLoggedCustomer(page) {
  await page.addInitScript(
    ({ branchId, slug }) => {
      localStorage.setItem(
        'rapidex.customer.profile',
        JSON.stringify({ id: 'customer-e2e', name: 'Cliente E2E', phone: '85999999999' })
      );
      localStorage.removeItem('rapidex.customerAddresses.local');
      localStorage.removeItem('rapidex.customerAddress');
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({
          order_type: 'delivery',
          branch_id: branchId,
          branch_label: 'Matriz',
          confirmed: true
        })
      );
    },
    { branchId: BRANCH_MATRIZ, slug: SLUG }
  );
}

async function expectAddressSelected(page, id) {
  const item = page.locator(`#addrPickerList .addr-picker-item[data-addr-id="${id}"]`);
  await expect(item).toHaveClass(/selected/);
  await expect(item.locator('.addr-picker-check')).toBeVisible();
  await expect(item.locator('.addr-picker-check circle')).toHaveAttribute('fill', '#15803d');
  await expect(page.locator('#addrPickerConfirmBtn')).toBeEnabled();
}

test('enderecos existentes sao selecionados no perfil e em unidades sem abrir o formulario', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await seedLoggedCustomer(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(addresses => {
    window.PedeAquiCustomerAuth.setToken('e2e-customer-token');
    window.PedeAquiCustomerService.getCurrentCustomer = async () => ({
      id: 'customer-e2e',
      name: 'Cliente E2E',
      phone: '85999999999'
    });
    window.PedeAquiAddressService.getCustomerAddresses = async () => addresses;
    window.PedeAquiAddressService.setDefaultCustomerAddress = async () => ({ ok: true });
    window.PedeAquiOrderService.getCustomerOrders = async () => [];
  }, [HOME_ADDRESS, WORK_ADDRESS]);

  // Unidades e Operacao: mesmo sem endereco ativo, a conta com enderecos abre
  // o seletor. Tocar no nome/rua marca o cartao, em vez de abrir CEP/logradouro.
  await page.evaluate(() => window.RapidexActions.resolve('openOperationScreen')?.());
  await page.locator('#opAddrCard').click();
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  await expect(page.locator('#addAddressModal')).not.toHaveClass(/active/);

  const workAddressCopy = page.locator(
    '#addrPickerList .addr-picker-item[data-addr-id="address-work"] .addr-picker-copy'
  );
  await expect(workAddressCopy).toBeVisible();
  await workAddressCopy.click();
  await expectAddressSelected(page, 'address-work');
  await expect(page.locator('#addrDetailsModal')).not.toHaveClass(/active/);
  await page.locator('#addrPickerConfirmBtn').click();

  await expect(page.locator('#addrPickerModal')).not.toHaveClass(/active/);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rapidex.customerAddress') || 'null')?.id))
    .toBe('address-work');

  // Perfil > Meus enderecos usa o mesmo seletor e deve ter o mesmo
  // comportamento ao tocar diretamente no texto do endereco.
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.locator('#mobNavProfile').click();
  await page.locator('.prof-account-row', { hasText: /Meus endere/ }).click();
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);

  await page
    .locator('#addrPickerList .addr-picker-item[data-addr-id="address-home"] .addr-picker-copy')
    .click();
  await expectAddressSelected(page, 'address-home');
  await expect(page.locator('#addrDetailsModal')).not.toHaveClass(/active/);
  await page.locator('#addrPickerConfirmBtn').click();

  await expect(page.locator('#addrPickerModal')).not.toHaveClass(/active/);
  await expect(page.locator('#mobViewProfile')).toHaveClass(/active/);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rapidex.customerAddress') || 'null')?.id))
    .toBe('address-home');

  await page.locator('.prof-account-row', { hasText: /Meus endere/ }).click();
  await page.locator('#addrPickerModal .addr-picker-add-btn').click();
  await expect(page.locator('#addAddressModal')).toHaveClass(/active/);
  await expect(page.locator('#addrDetailsModal')).not.toHaveClass(/active/);
});
