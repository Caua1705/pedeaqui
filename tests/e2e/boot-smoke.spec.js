import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, seedPickupSession } from './helpers.js';

// ============================================================================
//  O app SOBE, e nenhuma tela morre ao abrir.
//
//  POR QUE ISTO EXISTE, e por que não é redundante com o resto da suíte.
//
//  Em 29/08/2026 uma linha no lugar errado (`onTeardown(...)` no corpo de um
//  módulo, fora de init()) derrubou o app inteiro no boot. `npm run lint`,
//  `npm run typecheck:cards` e os 239 unitários passaram — nenhum dos três
//  executa o app.
//
//  A E2E pegou: medido, 9 de 10 testes de dois arquivos quebraram. Mas o
//  sintoma era uma parede de falhas de timeout onde NENHUMA linha dizia "o app
//  não subiu", e a causa só apareceu depois de um build com sourcemap para
//  traduzir "p is not a function".
//
//  Este arquivo não acrescenta cobertura: acrescenta DIAGNÓSTICO. Ele falha
//  primeiro, com uma frase, e traz a mensagem original do erro em vez do nome
//  minificado. Quando ele estiver vermelho e o resto também, comece por ele.
//
//  A trava que faz a diferença é `pageerror`: a suíte inteira ignora exceção
//  não capturada de boot, porque todo spec afirma sobre o efeito, não sobre a
//  ausência de erro. Um app que sobe COM uma exceção engolida passa em tudo e
//  falha aqui.
//
//  O gate rápido equivalente é tests/unit/page-modules.test.js, que pega a
//  mesma classe em milissegundos e sem browser. Este aqui é a rede de baixo:
//  ele roda o BUNDLE REAL, e portanto pega também o que só existe depois do
//  Vite (ordem de import, minificação, tree-shaking indevido).
// ============================================================================

/** Liga o app e devolve toda exceção não capturada que a página emitiu. */
async function bootar(page) {
  const erros = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  return erros;
}

test('o app sai do loader, e sem exceção não capturada', async ({ page }) => {
  const erros = await bootar(page);

  await expect(
    page.locator('body'),
    'o app não saiu de app-booting — veja os erros de página no relatório'
  ).not.toHaveClass(/app-booting/, { timeout: 30_000 });

  // Chega DEPOIS da asserção acima de propósito: se o app travou, a frase útil
  // é "não saiu do loader"; a lista de erros é a explicação, não o título.
  expect(erros, 'exceção não capturada durante o boot').toEqual([]);

  // Um boot que "termina" numa tela de erro não é um boot.
  await expect(page.locator('body')).not.toHaveClass(/app-error/);
});

// As telas que o cliente alcança pela barra de baixo e pelos caminhos de
// endereço e conta. Abrir cada uma executa o markup gerado em runtime — que é
// onde um módulo mal costurado estoura, já com o app no ar.
//
// As ações vêm do REGISTRO, não de window: só 11 nomes continuam globais, e
// chamar `window.mobNavClub()` daria "is not a function" por um motivo que não
// tem nada a ver com o que este teste afirma.
const TELAS = [
  { nome: 'cardápio', acao: 'mobNavMenu' },
  { nome: 'clube', acao: 'mobNavClub' },
  { nome: 'assistente', acao: 'mobNavAssistant' },
  { nome: 'perfil', acao: 'mobNavProfile' },
  { nome: 'entrar', acao: 'openLoginScreen' },
  { nome: 'cadastro', acao: 'openRegisterScreen' },
  { nome: 'endereço: escolha', acao: 'openAddressChoice' },
  { nome: 'endereço: salvos', acao: 'openAddrPicker' },
  { nome: 'endereço: busca', acao: 'openAddrSearch' },
  { nome: 'unidades', acao: 'openOperationScreen' }
];

test('cada tela abre sem estourar, e a ação existe no registro', async ({ page }) => {
  const erros = await bootar(page);
  await expect(page.locator('body')).not.toHaveClass(/app-booting/, { timeout: 30_000 });

  const falhas = [];
  for (const { nome, acao } of TELAS) {
    const problema = await page.evaluate(async ([acaoNome]) => {
      const fn = window.RapidexActions?.resolve?.(acaoNome);
      // Ação que sumiu do registro é falha: foi assim que 82 nomes mudaram de
      // arquivo, e é assim que um deles some sem ninguém perceber — o markup
      // continua com o data-act e o clique deixa de fazer efeito, calado.
      if (typeof fn !== 'function') return 'não está no registro de ações';
      try {
        await fn();
        return null;
      } catch (erro) {
        return String(erro?.message || erro);
      }
    }, [acao]);
    if (problema) falhas.push(`${nome} (${acao}): ${problema}`);
    await page.waitForTimeout(150);
  }

  expect(falhas, 'telas que não abriram').toEqual([]);
  expect(erros, 'exceção não capturada ao abrir as telas').toEqual([]);
});
