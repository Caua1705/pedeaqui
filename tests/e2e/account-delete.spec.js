import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, esperarAppPronto, AUTH_CONTA } from './helpers.js';

// ============================================================================
//  EXCLUIR CONTA (LGPD, Art. 18, VI) — `DELETE /customers/me`.
//
//  A rota estava no contrato e o front nunca a chamou: o botão "Excluir conta"
//  existia no markup SEM `data-act-*`. A política e os termos mandavam pedir
//  por e-mail — o direito cumprido à mão.
//
//  O QUE ESTES TESTES GUARDAM, e por que cada um existe:
//
//  1. QUAL CAMPO VAI NO CORPO NÃO É ESCOLHA DO APP. `password_set` decide, e o
//     backend responde 400 ao campo errado. O mock imita essa recusa, então um
//     front que mandasse sempre a senha reprovaria aqui — e é o único jeito de
//     provar que ele leu o contrato em vez de escolher.
//  2. O SALDO PERDIDO APARECE COM NÚMERO, e é o `balance` da RAIZ. Em todo o
//     resto do app ler a raiz é defeito (a soma não é gastável em lugar
//     nenhum, §10); aqui é o certo, porque a exclusão não perde "o saldo desta
//     loja" — perde a conta inteira. Sem este teste, a próxima pessoa
//     "conserta" para `by_restaurant` e esconde dinheiro de quem vai perdê-lo.
//  3. 409 NÃO É FALHA DE PROVA. Pedido em andamento recusa a exclusão, e a
//     pessoa não pode sair da tela achando que errou a senha — nem ser
//     deslogada por um erro que não excluiu nada.
//
//  A LARGURA É PARTE DO TESTE (§14.2): a tela inteira mora em
//  `@media(max-width:767px)`, e na largura padrão do Playwright (1280) não há
//  nada para medir.
// ============================================================================

const CELULAR = { width: 390, height: 844 };

async function abrirExcluirConta(page, { token = 'e2e-delete-token' } = {}) {
  await page.addInitScript((t) => localStorage.setItem('rapidex.customer.token', t), token);
}

async function irParaAExclusao(page) {
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('meusdados'));
  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
  await page.locator('.prof-manage-delete').click();
  await expect(page.locator('#profDeleteScreen')).toHaveClass(/active/);
}

test('conta COM senha: a tela pede senha e o corpo leva `password`, nunca `email_code`', async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await abrirExcluirConta(page);
  await seedPickupSession(page);
  const { deleteAccountRequests, deleteCodeRequests } = await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await irParaAExclusao(page);

  // A prova é a senha, e não há botão de pedir código nesta conta.
  await expect(page.locator('#profDeletePassword')).toBeVisible();
  await expect(page.locator('#profDeleteCode')).toHaveCount(0);
  await expect(page.locator('.prof-delete-code-btn')).toHaveCount(0);

  // Campo vazio é conferido LOCALMENTE — nenhuma ida à rede para ouvir o 400.
  // A afirmação do FATO (nada saiu) vem antes da frase na tela, que é o
  // mecanismo (§13.3).
  await page.locator('.prof-delete-submit').click();
  expect(deleteAccountRequests).toHaveLength(0);
  await expect(page.locator('#profDeleteError')).toContainText('Informe sua senha');

  // Senha ERRADA primeiro: 401 mostra a frase e NÃO derruba a sessão.
  await page.locator('#profDeletePassword').fill('nao-e-a-senha');
  await page.locator('.prof-delete-submit').click();
  await expect(page.locator('#profDeleteError')).toContainText('Senha incorreta');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rapidex.customer.token'))).not.toBeNull();

  // A senha SAI DA CONTA DE TESTE, não de uma string escrita aqui: um literal
  // divergiria de `AUTH_CONTA` no dia em que ela mudasse, e o teste passaria a
  // medir o 401 achando que mede o 204.
  await page.locator('#profDeletePassword').fill(AUTH_CONTA.senha);
  await page.locator('.prof-delete-submit').click();

  await expect.poll(() => deleteAccountRequests.length).toBe(2);
  expect(deleteAccountRequests[1].body).toHaveProperty('password', AUTH_CONTA.senha);
  // A metade que importa: `email_code` NÃO pode viajar junto. Um corpo com os
  // dois convidaria o servidor a decidir o que o contrato diz ser da conta.
  expect(deleteAccountRequests[1].body).not.toHaveProperty('email_code');
  // E a conta com senha nunca pede código: essa rota responde 400 para ela.
  expect(deleteCodeRequests).toHaveLength(0);

  // 204: a sessão morre e a Home volta ao estado de quem nunca entrou.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rapidex.customer.token'))).toBeNull();
  await expect(page.locator('#profDeleteScreen')).not.toHaveClass(/active/);
});

test('conta SEM senha (Google): a tela pede codigo e o corpo leva `email_code`', async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await abrirExcluirConta(page);
  await seedPickupSession(page);
  const { deleteAccountRequests, deleteCodeRequests } = await mockApi(page, {
    // `password_set: false` é, por construção do backend, a conta que nasceu
    // pelo Google: o único lugar que grava o hash inutilizável é o cadastro
    // social, e ele cria a identidade na MESMA transação.
    social: { contas: [{ provider: 'google', linked_at: '2026-09-04T10:00:00Z', last_login_at: null }], passwordSet: false }
  });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await irParaAExclusao(page);

  await expect(page.locator('#profDeleteCode')).toBeVisible();
  await expect(page.locator('#profDeletePassword')).toHaveCount(0);

  await page.locator('.prof-delete-code-btn').click();
  await expect.poll(() => deleteCodeRequests.length).toBe(1);
  // A frase NÃO promete que o código saiu: a resposta do backend é a MESMA no
  // cooldown e no teto de três em 15 minutos, de propósito — variar contaria
  // quantos códigos já saíram.
  await expect(page.locator('#profDeleteNotice')).toContainText('Se houver um código');

  await page.locator('#profDeleteCode').fill('000000'); // errado de propósito
  await page.locator('.prof-delete-submit').click();
  await expect(page.locator('#profDeleteError')).toContainText('Código incorreto');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rapidex.customer.token'))).not.toBeNull();

  await page.locator('#profDeleteCode').fill('123456');
  await page.locator('.prof-delete-submit').click();

  await expect.poll(() => deleteAccountRequests.length).toBe(2);
  expect(deleteAccountRequests[1].body).toHaveProperty('email_code', '123456');
  expect(deleteAccountRequests[1].body).not.toHaveProperty('password');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rapidex.customer.token'))).toBeNull();
});

test('o saldo perdido e o `balance` da RAIZ, com as lojas nomeadas', async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await abrirExcluirConta(page);
  await seedPickupSession(page);
  await mockApi(page);
  // A rota do cashback é sobreposta DEPOIS de mockApi(): a última registrada
  // vence (§4). Os números discordam de propósito — 12,50 numa loja e 27,50 na
  // outra somam 40, e um front que lesse `by_restaurant` filtrado pelo slug
  // mostraria 12,50. É a mesma regra do "fixture cujos números coincidem".
  await page.route('**/api.pederapidex.com/**/customers/me/cashback', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      balance: 40,
      currency: 'BRL',
      by_restaurant: [
        { restaurant_id: 'r1', restaurant_name: 'Junior da Picanha', restaurant_slug: 'junior-da-picanha', balance: 12.5, expires_at: null },
        { restaurant_id: 'r2', restaurant_name: 'Outra Loja', restaurant_slug: 'outra-loja', balance: 27.5, expires_at: null }
      ]
    })
  }));
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await irParaAExclusao(page);

  const aviso = page.locator('.prof-delete-warning');
  await expect(aviso).toContainText('40,00');
  await expect(aviso).not.toContainText('12,50');
  await expect(aviso).toContainText('Junior da Picanha');
  await expect(aviso).toContainText('Outra Loja');
  // As outras duas consequências, que também são pedidos explícitos da tela.
  await expect(aviso).toContainText('pedidos continuam com o restaurante');
  await expect(aviso).toContainText('não tem desfazer');
});

test('409 (pedido em andamento) explica o motivo e NAO derruba a sessao', async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await abrirExcluirConta(page);
  await seedPickupSession(page);
  const { deleteAccountRequests } = await mockApi(page, { exclusao: { codigo: '123456', tentativasDeCodigo: 0, pedidoEmAndamento: true } });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await irParaAExclusao(page);

  // A senha está CERTA de propósito: o 409 do backend vem ANTES da conferência
  // da prova, e um teste com a senha errada não distinguiria um do outro.
  await page.locator('#profDeletePassword').fill(AUTH_CONTA.senha);
  await page.locator('.prof-delete-submit').click();

  await expect.poll(() => deleteAccountRequests.length).toBe(1);
  await expect(page.locator('#profDeleteError')).toContainText('pedido em andamento');
  // NADA foi excluído: a tela continua de pé, o token continua vivo, e o botão
  // volta a aceitar toque. Deslogar aqui seria punir quem não errou nada.
  await expect(page.locator('#profDeleteScreen')).toHaveClass(/active/);
  await expect(page.locator('.prof-delete-submit')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('rapidex.customer.token'))).not.toBeNull();
});

test('entrar em Gerenciar perfil sempre mostra a lista, nunca a exclusao aberta', async ({ page }) => {
  // §21.3: a sobreposição guarda o próprio `.active` e a `.prof-sub` some sem
  // apagá-lo. Sem a limpeza, quem deixasse esta tela aberta e trocasse de aba
  // voltaria DIRETO numa tela de excluir conta que ninguém pediu para abrir.
  await page.setViewportSize(CELULAR);
  await abrirExcluirConta(page);
  await seedPickupSession(page);
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await irParaAExclusao(page);

  await page.evaluate(() => window.RapidexActions.resolve('mobNavMenu')());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('meusdados'));

  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
  await expect(page.locator('#profDeleteScreen')).not.toHaveClass(/active/);
});
