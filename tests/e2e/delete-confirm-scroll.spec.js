import { test, expect } from '@playwright/test';
import { mockApi, MENU, SLUG, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  O POPUP DE CONFIRMAR EXCLUSÃO NÃO PODE ESCAPAR DA TELA.
//
//  O que o cliente via, ao excluir um endereço: o botão de confirmar saltava e
//  o popup descia para fora da tela.
//
//  A CAUSA é a caixa, não o botão. `.addr-delete-confirm` é `position:absolute;
//  inset:0` e o painel entra de baixo com `transform:translate3d(0,118%,0)` —
//  257px ABAIXO da caixa durante os 0,9s da animação. Com `overflow:hidden` a
//  caixa vira um CONTAINER DE ROLAGEM (medido: scrollHeight 1153 contra
//  clientHeight 896). Ela não rola no dedo, mas rola POR PROGRAMA — e
//  `setAccessibleDialogState()` dá foco ao botão de confirmar um quadro depois
//  de abrir, quando ele ainda está 128px fora da caixa.
//
//  O foco pede `preventScroll:true`, que é o certo. Mas ele NÃO é garantia: o
//  Safari só passou a honrá-lo no 15.4, e num iPhone anterior a opção é
//  simplesmente ignorada. É por isso que este teste REMOVE a opção antes de
//  medir — o Chromium sozinho nunca reproduziria o defeito, e um teste que só
//  roda no motor que já se comporta não guarda nada.
//
//  A guarda é `overflow:clip`, que clipa igual e não cria container de rolagem.
//  Medido nos dois braços, 414x896:
//
//    hidden + preventScroll   -> scrollTop 0
//    hidden SEM preventScroll -> scrollTop 216 -> 64 -> 0   (o salto)
//    clip   SEM preventScroll -> scrollTop 0
//    clip   + preventScroll   -> scrollTop 0
//
//  Os três diálogos do app usam esta MESMA classe (excluir endereço, remover
//  item da sacola, sair da conta), então a caixa é uma só e a guarda também.
// ============================================================================

const CELULAR = { width: 414, height: 896 };

/** Um browser que IGNORA `preventScroll`, que é o parque de iPhones anterior ao 15.4. */
async function browserSemPreventScroll(page) {
  await page.addInitScript(() => {
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function focarSemPreventScroll() {
      return original.call(this);
    };
  });
}

async function abrirPickerComEnderecos(page, quantos = 4) {
  await page.setViewportSize(CELULAR);
  await mockApi(page);
  await page.addInitScript(
    ({ slug, branchId, n }) => {
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({ order_type: 'pickup', branch_id: branchId, branch_label: 'Matriz', confirmed: true })
      );
      const lista = [];
      for (let i = 1; i <= n; i++) {
        lista.push({
          client_reference: `a${i}`,
          street: `Rua Numero ${i}`,
          number: String(i * 10),
          neighborhood: 'Centro',
          city: 'Fortaleza',
          state: 'CE',
          postal_code: '60000-000'
        });
      }
      localStorage.setItem('rapidex.customerAddresses.local', JSON.stringify(lista));
    },
    { slug: SLUG, branchId: MENU.branch_id, n: quantos }
  );
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openAddrPicker')?.('profile'));
  await expect(page.locator('#addrPickerModal .addr-picker-item').first()).toBeVisible();
}

const medir = (page) => page.evaluate(() => {
  const caixa = document.getElementById('addrDeleteConfirm');
  const painel = caixa?.querySelector('.addr-delete-panel');
  const r = painel?.getBoundingClientRect();
  return {
    scrollTop: caixa?.scrollTop ?? null,
    overflow: caixa ? getComputedStyle(caixa).overflow : null,
    // O que o cliente vê: o painel encosta no rodapé da tela, sem passar dele.
    fundoDoPainel: r ? Math.round(r.bottom) : null,
    alturaDaJanela: window.innerHeight
  };
});

test('o popup de excluir endereço não escapa da tela, nem num browser que ignora preventScroll', async ({
  page
}) => {
  await browserSemPreventScroll(page);
  await abrirPickerComEnderecos(page);

  const item = page.locator('#addrPickerModal .addr-picker-item').nth(1);
  await item.locator('.addr-picker-dots').click();
  await item.locator('.addr-picker-delete').click();
  await expect(page.locator('#addrDeleteConfirm')).toHaveClass(/active/);

  // A AFIRMAÇÃO É DURANTE A ANIMAÇÃO, e não só no fim: o defeito é um salto no
  // meio dela, e no fim (com a área rolável já encolhida a zero) até o braço
  // quebrado voltava a `scrollTop` 0. Medir só o repouso não veria nada.
  const leituras = [];
  for (let i = 0; i < 12; i++) {
    leituras.push(await medir(page));
  }
  const rolou = leituras.filter(l => l.scrollTop !== 0);
  expect(
    rolou.map(l => l.scrollTop),
    'a caixa do popup rolou: o foco no botão a arrastou, e o painel vai junto'
  ).toEqual([]);

  // E o painel assenta encostado no rodapé, sem passar dele.
  await expect
    .poll(async () => (await medir(page)).fundoDoPainel, { timeout: 5000 })
    .toBe(CELULAR.height);
});

test('a caixa do popup não é um container de rolagem — é ela que guarda, não a opção de foco', async ({
  page
}) => {
  await abrirPickerComEnderecos(page);
  const item = page.locator('#addrPickerModal .addr-picker-item').nth(1);
  await item.locator('.addr-picker-dots').click();
  await item.locator('.addr-picker-delete').click();
  await expect(page.locator('#addrDeleteConfirm')).toHaveClass(/active/);

  // `overflow:hidden` clipa E cria container de rolagem; `clip` só clipa.
  // Afirmar a propriedade é afirmar a causa — e o que ela produz é a linha
  // abaixo, que é o fato: por mais que se peça, a caixa não sai do lugar.
  expect((await medir(page)).overflow, 'hidden faz desta caixa um container de rolagem').toBe('clip');
  const naoRola = await page.evaluate(() => {
    const caixa = document.getElementById('addrDeleteConfirm');
    caixa.scrollTop = 500;
    return caixa.scrollTop;
  });
  expect(naoRola, 'a caixa aceitou ser rolada por programa').toBe(0);
});
