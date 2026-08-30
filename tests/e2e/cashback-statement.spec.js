import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

// ============================================================================
//  O extrato de cashback, desenhado com os CINCO tipos do contrato.
//
//  Nenhum e2e abria este modal (só a captura o fazia), e o rótulo de cada
//  linha nunca tinha sido afirmado. Por essa fresta o mapa de rótulos do
//  scripts/pages/cashback-statement.js viveu com duas chaves que a API não
//  emite ('used' e 'refund' — o enum de `type` é earned|redeemed|expired|
//  cancelled|adjustment; 'used' é valor de STATUS) e SEM a chave 'cancelled',
//  que a API emite: uma linha cancelada saía como "Movimentação de cashback",
//  o rótulo de quem não sabe o que aconteceu.
//
//  As linhas usam `description` quando ela vem — o rótulo por tipo é o
//  caminho da descrição vazia, que o contrato permite (string, sem minLength).
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

// CashbackTransactionResponse do contrato: id, type (enum), amount (number),
// description (string), created_at, expires_at, order_id, restaurant_name, status.
const transacao = (n, type, amount, status = 'available') => ({
  id: `7e000000-0000-4000-8000-00000000000${n}`,
  type,
  amount,
  description: '',
  created_at: '2026-08-20T18:12:00Z',
  expires_at: null,
  order_id: null,
  restaurant_name: 'Júnior da Picanha',
  status
});

async function abrirExtrato(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-cashback-token');
  });
  await mockApi(page);
  await page.route('**/customers/me/cashback/transactions**', route => route.fulfill(json({
    balance: 21.4,
    currency: 'BRL',
    transactions: [
      transacao(1, 'earned', 8.4),
      transacao(2, 'redeemed', -4.1, 'used'),
      transacao(3, 'expired', -2.0, 'expired'),
      transacao(4, 'cancelled', -8.4, 'cancelled'),
      transacao(5, 'adjustment', 3.0)
    ]
  })));
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openCashbackStatement')());
  await expect(page.locator('#cashbackStatementModal')).toHaveClass(/active/);
  await expect(page.locator('.cashback-statement-row')).toHaveCount(5);
}

test('cada tipo do contrato tem rótulo próprio — inclusive cancelled', async ({ page }) => {
  await abrirExtrato(page);
  const rotulos = await page.locator('.cashback-statement-row strong').allTextContents();
  expect(rotulos).toEqual([
    'Crédito de cashback',
    'Uso de saldo',
    'Cashback expirado',
    'Cashback cancelado',
    'Lançamento de crédito'
  ]);
  // O rótulo genérico é o de tipo DESCONHECIDO; nenhum dos cinco do enum
  // pode cair nele.
  expect(rotulos).not.toContain('Movimentação de cashback');
});

test('o sinal da linha segue o valor: débito com menos, crédito com mais', async ({ page }) => {
  await abrirExtrato(page);
  const valores = page.locator('.cashback-statement-amount');
  await expect(valores.nth(0)).toHaveClass(/positive/);
  await expect(valores.nth(1)).toHaveClass(/negative/);
  await expect(valores.nth(3)).toHaveClass(/negative/);
  await expect(valores.nth(1)).toContainText('-');
  await expect(valores.nth(0)).toContainText('+');
});
