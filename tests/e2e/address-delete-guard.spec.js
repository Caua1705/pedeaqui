import { test, expect } from '@playwright/test';
import { mockApi, BRANCH_MATRIZ, RESTAURANT_URL, SLUG, esperarAppPronto } from './helpers.js';

// O AVISO DE "ENDERECO ATIVO" APARECIA EM QUALQUER ENDERECO — e o cliente
// ficava sem conseguir apagar nenhum.
//
// A condicao que abria o aviso era
//
//     sameAddress(address, activeAddress) || _addrPickerSelected === String(id)
//
// e cada metade tinha um defeito proprio:
//
// 1. `_addrPickerSelected` responde "qual cartao esta DESTACADO na lista", nao
//    "qual endereco esta ativo". Tocar num cartao so o destaca — a escolha so
//    vale no Confirmar. Um cliente logado que tocasse noutro endereco e o
//    apagasse em seguida levava o aviso de ativo sobre um endereco que nao era
//    o ativo (medido: sonda A2, com "Casa" ativa e "Trabalho" tocado).
//
// 2. TODO endereco sem id do backend recebia o mesmo id `__current__`
//    (`currentPickerItem()` carimbava o sentinela como `id`). Numa conta de
//    visitante — enderecos so neste aparelho — os DOIS cartoes saiam com
//    `data-addr-id="__current__"`, entao `_addrPickerSelected === id` era
//    verdadeiro para todos e NENHUM endereco podia ser apagado (sonda B1).
//    Pior: se o aviso nao barrasse, `confirmAddrPickerDelete()` filtra a lista
//    local por esse mesmo id — apagar um teria apagado todos.
//
// A pergunta certa e uma so, e e a que sobrou: este endereco e o que esta
// ativo agora?

const CASA = {
  id: 'address-home',
  label: 'Casa',
  street: 'Rua das Flores',
  number: '123',
  neighborhood: 'Centro',
  city: 'Fortaleza',
  state: 'CE',
  postal_code: '60000-000'
};

const TRABALHO = {
  id: 'address-work',
  label: 'Trabalho',
  street: 'Avenida Santos Dumont',
  number: '2000',
  neighborhood: 'Aldeota',
  city: 'Fortaleza',
  state: 'CE',
  postal_code: '60150-161'
};

// Os mesmos dois enderecos SEM id: e o que o visitante tem no aparelho, e foi
// onde o defeito travava tudo.
const CASA_LOCAL = { ...CASA, id: undefined };
const TRABALHO_LOCAL = { ...TRABALHO, id: undefined };

const dialogo = (page) => page.locator('#addrDeleteConfirm');
const textoDoDialogo = (page) => page.locator('#addrDeleteConfirm .addr-delete-text');

/** O caminho real do cliente: os tres pontinhos e depois a lixeira. */
async function pedirParaExcluir(card) {
  await card.locator('.addr-picker-dots').click();
  await card.locator('.addr-picker-delete').click();
}

async function abrirListaDeEnderecos(page) {
  await page.locator('#mobNavProfile').click();
  await page.locator('.prof-account-row', { hasText: /Meus endere/ }).click();
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
}

async function bootar(page, { local = null, ativo = CASA } = {}) {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await page.addInitScript(
    ({ branchId, slug, listaLocal, enderecoAtivo }) => {
      localStorage.setItem(
        'rapidex.customer.profile',
        JSON.stringify({ id: 'customer-e2e', name: 'Cliente E2E', phone: '85999999999' })
      );
      if (listaLocal) localStorage.setItem('rapidex.customerAddresses.local', JSON.stringify(listaLocal));
      else localStorage.removeItem('rapidex.customerAddresses.local');
      localStorage.setItem('rapidex.customerAddress', JSON.stringify(enderecoAtivo));
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({
          order_type: 'delivery',
          branch_id: branchId,
          branch_label: 'Matriz',
          confirmed: true,
          address: enderecoAtivo
        })
      );
    },
    { branchId: BRANCH_MATRIZ, slug: SLUG, listaLocal: local, enderecoAtivo: ativo }
  );
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
}

test('tocar num cartao nao o torna o endereco ativo — e nao impede de apaga-lo', async ({ page }) => {
  await bootar(page);
  await page.evaluate(enderecos => {
    window.PedeAquiCustomerAuth.setToken('e2e-customer-token');
    window.PedeAquiCustomerService.getCurrentCustomer = async () => ({
      id: 'customer-e2e',
      name: 'Cliente E2E',
      phone: '85999999999'
    });
    window.PedeAquiAddressService.getCustomerAddresses = async () => enderecos;
    window.PedeAquiOrderService.getCustomerOrders = async () => [];
  }, [CASA, TRABALHO]);

  await abrirListaDeEnderecos(page);
  await expect(page.locator('#addrPickerList .addr-picker-item')).toHaveCount(2);

  const trabalho = page.locator('#addrPickerList .addr-picker-item[data-addr-id="address-work"]');
  // Tocar SO DESTACA: a escolha ainda nao foi confirmada, e "Casa" segue ativa.
  await trabalho.locator('.addr-picker-copy').click();
  await expect(trabalho).toHaveClass(/selected/);

  await pedirParaExcluir(page.locator('#addrPickerList .addr-picker-item[data-addr-id="address-work"]'));

  await expect(dialogo(page)).toHaveAttribute('aria-hidden', 'false');
  await expect(textoDoDialogo(page)).toHaveText('Tem certeza que deseja excluir este endereço?');
});

test('o aviso de ativo continua saindo no endereco que esta MESMO ativo', async ({ page }) => {
  await bootar(page);
  await page.evaluate(enderecos => {
    window.PedeAquiCustomerAuth.setToken('e2e-customer-token');
    window.PedeAquiCustomerService.getCurrentCustomer = async () => ({
      id: 'customer-e2e',
      name: 'Cliente E2E',
      phone: '85999999999'
    });
    window.PedeAquiAddressService.getCustomerAddresses = async () => enderecos;
    window.PedeAquiOrderService.getCustomerOrders = async () => [];
  }, [CASA, TRABALHO]);

  await abrirListaDeEnderecos(page);
  await pedirParaExcluir(page.locator('#addrPickerList .addr-picker-item[data-addr-id="address-home"]'));

  await expect(textoDoDialogo(page)).toHaveText('Não é possível excluir o endereço que está ativo neste momento.');
});

test('enderecos so deste aparelho tem identidade PROPRIA, e o nao ativo se apaga', async ({ page }) => {
  await bootar(page, { local: [CASA_LOCAL, TRABALHO_LOCAL], ativo: CASA_LOCAL });
  await abrirListaDeEnderecos(page);

  const cartoes = page.locator('#addrPickerList .addr-picker-item');
  await expect(cartoes).toHaveCount(2);

  // A prova do defeito 2: os dois cartoes saiam com `__current__`.
  const ids = await cartoes.evaluateAll(els => els.map(el => el.dataset.addrId));
  expect(new Set(ids).size, `dois enderecos com o mesmo id: ${ids.join(' , ')}`).toBe(2);

  await pedirParaExcluir(cartoes.nth(1));
  await expect(textoDoDialogo(page)).toHaveText('Tem certeza que deseja excluir este endereço?');

  // E apagar UM apaga um: o filtro da lista local usa esse mesmo id.
  await page.locator('#addrDeleteConfirm .addr-delete-yes').click();
  await expect(cartoes).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rapidex.customerAddresses.local') || '[]').length))
    .toBe(1);
});
