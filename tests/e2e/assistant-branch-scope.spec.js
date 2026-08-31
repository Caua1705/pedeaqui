import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, MENU, BRANCH_MATRIZ, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// O assistente de TEXTO fala do cardápio de UMA filial.
//
// Desde 20/08/2026 cada loja tem produtos, preços e disponibilidade próprios, e
// `POST /chat` exige `branch_id` — 422 sem ele, e sem queda para a filial
// padrão (backend `docs/cardapio-por-filial.md`, §3.5). O que estes testes
// travam é de ONDE sai essa filial: a mesma do carrinho e do pedido, lida no
// momento da chamada, e nenhuma quando o cliente não escolheu.

const RESPOSTA = {
  response_type: 'text',
  message: 'Temos sim!'
};

const json = (body, status = 200) => ({
  status, contentType: 'application/json', body: JSON.stringify(body)
});

/** Sobe o app na tela do assistente e devolve os corpos que /chat recebeu. */
async function montar(page, { semFilial = false } = {}) {
  const chats = [];

  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);

  // Depois do mockApi de propósito: a rota registrada por último é a que vale.
  // Restaurante sem NENHUMA filial ativa é o único jeito de o app chegar ao
  // assistente sem loja escolhida — é o caso que o backend descreve em §3.1.
  if (semFilial) {
    await page.route('**/restaurants/*/menu*', route => route.fulfill(json({
      ...MENU, branches: [], products: [], categories: [], settings: null
    })));
  }

  await page.route('**/chat', route => {
    chats.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(json(RESPOSTA));
  });

  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();

  return chats;
}

async function perguntar(page, texto) {
  await page.locator('#assistantInput').fill(texto);
  await page.evaluate(() => window.assistantSendMessage());
}

test('o /chat leva a filial escolhida, e passa a levar a nova quando o cliente troca', async ({ page }) => {
  const chats = await montar(page);
  const varjotaId = MENU.branches.find(branch => branch.name === 'Varjota').id;

  await perguntar(page, 'tem picanha?');
  await expect.poll(() => chats.length).toBe(1);
  expect(chats[0].branch_id, 'a pergunta saiu sem filial').toBe(BRANCH_MATRIZ);
  expect(chats[0].restaurant_id).toBeTruthy();

  // Trocar de loja no meio da conversa: a filial é lida na hora da chamada, e
  // não guardada no boot. Sem isto o assistente continuaria respondendo com o
  // cardápio da loja anterior — com preço, com foto e sem erro nenhum.
  await page.evaluate(branchId => {
    window.RapidexActions.resolve('openOperationScreen')();
    window.RapidexActions.resolve('selectBranch')(branchId);
    window.RapidexActions.resolve('confirmOperation')();
  }, varjotaId);

  await perguntar(page, 'e agora?');
  await expect.poll(() => chats.length).toBe(2);
  expect(chats[1].branch_id, 'continuou falando da loja anterior').toBe(varjotaId);
});

test('sem filial escolhida o /chat nem é chamado, e a tela diz por quê', async ({ page }) => {
  const chats = await montar(page, { semFilial: true });

  await perguntar(page, 'tem picanha?');

  // A resposta certa é pedir a loja, e não deixar o backend responder 422 —
  // que na tela viraria "não consegui responder agora", uma mentira sobre o
  // que falta. O que NÃO pode acontecer é o app escolher uma filial sozinho.
  await expect(page.locator('.assistant-chat-assistant-message:not(.assistant-chat-typing)'))
    .toContainText(/escolha a unidade/i, { timeout: 15000 });
  expect(chats, 'perguntou ao backend sem saber de qual loja').toEqual([]);
});
