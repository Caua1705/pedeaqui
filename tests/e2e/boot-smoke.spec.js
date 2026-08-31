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

/**
 * Liga o app e devolve toda exceção não capturada que a página emitiu, mais o
 * registro do mock (para saber que rotas o app chamou).
 */
async function bootar(page) {
  const erros = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  const mock = await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  return { erros, mock };
}

test('o app sai do loader, e sem exceção não capturada', async ({ page }) => {
  const { erros } = await bootar(page);

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
  const { erros } = await bootar(page);
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

// ============================================================================
//  Nenhum destes caminhos chama uma rota que o mock não conhece.
//
//  O `mockApi()` responde a uma lista de rotas e, para tudo o mais, devolve
//  404 e ANOTA o endereço. Anotar sem ninguém ler seria trocar um silêncio por
//  outro — este teste é quem lê.
//
//  Por que importa: até 30/08/2026 o catch-all devolvia 200 com `{}` para
//  qualquer coisa. Um E2E verde não dizia nada sobre a rota existir — o app
//  podia chamar uma rota que o backend removeu, receber o 200 vazio, cair no
//  fallback e o teste passar. Foi exatamente esse o incidente da tela do
//  Clube, com lint, 253 unitários e 243 E2E verdes.
//
//  Isto NÃO substitui `api-contract.test.js`, que confere as rotas do front
//  contra o OpenAPI. São perguntas diferentes: lá é "esta rota existe no
//  contrato?", aqui é "o app chamou alguma coisa que ninguém declarou?". Uma
//  rota inventada em runtime, montada por concatenação, só aparece aqui.
// ============================================================================
test('nenhuma tela chama rota que o mock não declara', async ({ page }) => {
  const { mock } = await bootar(page);
  await expect(page.locator('body')).not.toHaveClass(/app-booting/, { timeout: 30_000 });

  for (const { acao } of TELAS) {
    await page.evaluate(async ([acaoNome]) => {
      const fn = window.RapidexActions?.resolve?.(acaoNome);
      if (typeof fn === 'function') { try { await fn(); } catch { /* o teste acima é quem cobra isto */ } }
    }, [acao]);
    await page.waitForTimeout(150);
  }

  expect(
    mock.rotasDesconhecidas.map(r => r.method + ' ' + r.url),
    'o app chamou rotas que o mock não declara — confira se elas existem na API'
  ).toEqual([]);
});

// ============================================================================
//  As duas portas da fase de telas (skill §9) estão de pé no bundle real.
//
//  O contrato mount(ctx) depende de: kit (as 14 ferramentas) e app (os 13
//  estados por GETTER). O teste do getter é o que importa: uma tela que
//  recebesse `cart` como VALOR funcionaria em todo teste curto e erraria em
//  produção na primeira troca de filial — a fotografia do boot. Aqui se
//  afirma que as chaves de estado são ACESSOR de verdade, e que uma delas
//  devolve o dado VIVO (products, depois do cardápio carregado).
// ============================================================================
test('appPort e screen-kit: as portas das telas existem, e estado vai por getter', async ({ page }) => {
  const { erros } = await bootar(page);
  await expect(page.locator('body')).not.toHaveClass(/app-booting/, { timeout: 30_000 });

  const resultado = await page.evaluate(() => {
    const port = window.PedeAquiAppPort;
    const kit = window.PedeAquiScreenKit;
    if (!port) return { falha: 'PedeAquiAppPort não publicado' };
    if (!kit) return { falha: 'PedeAquiScreenKit não publicado' };
    const chavesPort = Object.keys(port).sort();
    const chavesKit = Object.keys(kit).sort();
    const acessores = ['restaurant', 'cart', 'customer', 'products', 'branches', 'settings', 'appState', 'operationContext', 'restaurantInfoState']
      .filter(nome => !Object.getOwnPropertyDescriptor(port, nome)?.get);
    return {
      chavesPort,
      chavesKit,
      acessores,
      produtosVivos: Array.isArray(port.products) && port.products.length > 0,
      slugDoKit: kit.getRestaurantSlug()
    };
  });

  expect(resultado.falha).toBeUndefined();
  expect(resultado.chavesPort).toEqual([
    'appState', 'branches', 'cart', 'currentCustomerSnapshot', 'customer',
    'deliveryFee', 'isLogged', 'operationContext', 'persistCustomer',
    'products', 'restaurant', 'restaurantInfoState', 'settings'
  ]);
  expect(resultado.chavesKit).toEqual([
    'TAB_LOADER_MIN_MS', '$', 'act', 'esc', 'fallback', 'fmt',
    'getRestaurantSlug', 'initials', 'logAppError', 'onlyDigits',
    'releaseFocusFrom', 'setLoading', 'showEl', 'wait'
  ].sort());
  expect(resultado.acessores, 'estado como VALOR em vez de getter — fotografia do boot').toEqual([]);
  expect(resultado.produtosVivos, 'port.products não devolve o cardápio vivo').toBe(true);
  expect(resultado.slugDoKit).toBe('junior-da-picanha');
  expect(erros).toEqual([]);
});
