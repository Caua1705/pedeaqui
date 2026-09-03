import { test, expect } from '@playwright/test';

// ============================================================================
//  A TELA DO ENTREGADOR — terceira página do repositório.
//
//  Mock próprio, e não o `mockApi()` do app do cliente: esta página não fala
//  com nenhuma rota dele. O mock aqui imita as RECUSAS do backend antes de
//  imitar os sucessos — 401 sem o código certo, 409 no pedido fora de estado, e
//  `ok: false` DENTRO de um 200 no lote. Um mock que só aceita é um teste que
//  só concorda (skill §4).
// ============================================================================

const TOKEN = 'lnk_7f3a9c2e';
const CODIGO = '482915';

// Os números NÃO coincidem de propósito: 23,50 a receber e 118,90 de total.
// Se a tela algum dia calcular em vez de exibir, os dois valores divergem e o
// teste acusa — com números iguais, um cálculo errado passaria despercebido.
const PEDIDO_PRONTO = {
  order_id: 'ord-1',
  order_number: 1042,
  status: 'ready',
  can_leave: true,
  can_deliver: false,
  customer_name: 'Marina Alves',
  customer_phone: '5541999990000',
  is_paid: false,
  amount_to_collect: 23.5,
  total: 118.9,
  payment_method: 'Dinheiro',
  address_street: 'Rua das Acácias',
  address_number: '481',
  address_neighborhood: 'Portão',
  address_city: 'Curitiba',
  address_complement: 'Apto 32',
  address_reference: 'Portão verde',
  notes: 'Interfone quebrado, ligar ao chegar',
  delivery_latitude: -25.4809,
  delivery_longitude: -49.2905
};

const PEDIDO_NA_RUA = {
  order_id: 'ord-2',
  order_number: 1043,
  status: 'out_for_delivery',
  can_leave: false,
  can_deliver: true,
  customer_name: 'Jonas Pires',
  customer_phone: '5541988887777',
  is_paid: true,
  amount_to_collect: 0,
  total: 64.2,
  payment_method: 'Pix',
  address_street: 'Av. República Argentina',
  address_number: '1200',
  address_neighborhood: 'Água Verde',
  address_city: 'Curitiba'
};

// O período sem entrega nenhuma. Os três números required continuam vindo:
// zero é uma resposta, não uma ausência.
const HISTORICO_VAZIO = {
  start_date: '2026-09-01',
  end_date: '2026-09-02',
  deliveries_count: 0,
  deliveries_without_fee: 0,
  fee_total: 0,
  deliveries: []
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

/**
 * O backend do entregador, com as recusas dele.
 *
 * `estado` é mutável: os testes trocam a lista e as respostas de lote para
 * exercitar o que acontece DEPOIS de uma ação, que é onde mora o defeito.
 */
async function mockCourier(page, estado = {}) {
  const dados = {
    codigo: CODIGO,
    me: { name: 'Rafael Souza', branch_name: 'Matriz — Batel' },
    pedidos: [PEDIDO_PRONTO, PEDIDO_NA_RUA],
    loteResposta: null,
    entregueStatus: 200,
    historico: null,
    historicoStatus: 200,
    chamadas: [],
    ...estado
  };

  await page.route('**/api.pederapidex.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const caminho = url.pathname;
    const codigo = request.headers()['x-courier-code'];
    dados.chamadas.push({ caminho, metodo: request.method(), codigo });

    if (!caminho.startsWith('/courier/')) {
      // Esta página não tem por que chamar mais nada. 404 barulhento em vez de
      // 200 vazio: é a lição do catch-all do mock do app do cliente.
      return route.fulfill(json({ detail: 'rota fora do escopo do entregador' }, 404));
    }
    if (!caminho.startsWith(`/courier/${TOKEN}/`)) {
      return route.fulfill(json({ detail: 'link inválido' }, 404));
    }
    // O código é a credencial. Sem ele, ou errado, NADA responde.
    if (!codigo || codigo !== dados.codigo) {
      return route.fulfill(json({ detail: 'código inválido' }, 401));
    }

    if (caminho.endsWith('/me')) return route.fulfill(json(dados.me));
    if (caminho.endsWith('/orders')) return route.fulfill(json(dados.pedidos));
    if (caminho.endsWith('/orders/out-for-delivery')) {
      const ids = JSON.parse(request.postData() || '{}').order_ids || [];
      const corpo = dados.loteResposta
        || { items: ids.map(id => ({ order_id: id, ok: true, order: null, error: null, message: null })) };
      return route.fulfill(json(corpo));
    }
    if (caminho.endsWith('/delivered')) {
      if (dados.entregueStatus !== 200) {
        return route.fulfill(json({ detail: 'pedido não está em rota' }, dados.entregueStatus));
      }
      return route.fulfill(json({ ...PEDIDO_NA_RUA, status: 'delivered', can_deliver: false }));
    }
    if (caminho.endsWith('/history')) {
      if (dados.historicoStatus !== 200) {
        return route.fulfill(json({ detail: 'falhou' }, dados.historicoStatus));
      }
      return route.fulfill(json(dados.historico || { ...HISTORICO_VAZIO }));
    }
    return route.fulfill(json({ detail: 'não declarada' }, 404));
  });

  return dados;
}

const abrir = (page, token = TOKEN) => page.goto(`/entregador/${token}`);

/** Entra pela porta, digitando o código. */
async function entrar(page, codigo = CODIGO) {
  await page.locator('#courierCodeInput').fill(codigo);
  await page.locator('#courierGateSubmit').click();
}

test('sem token na URL a tela não pede código: não há o que abrir', async ({ page }) => {
  await mockCourier(page);
  await page.goto('/entregador');

  await expect(page.locator('#courierDead')).toBeVisible();
  await expect(page.locator('#courierDeadTitle')).toHaveText('Link incompleto');
  await expect(page.locator('#courierGate')).toBeHidden();
  await expect(page.locator('#courierApp')).toBeHidden();
});

test('o link sozinho não abre nada: o código de 6 dígitos é a segunda credencial', async ({ page }) => {
  const dados = await mockCourier(page);
  await abrir(page);

  await expect(page.locator('#courierGate')).toBeVisible();
  await expect(page.locator('#courierApp')).toBeHidden();
  // Nada foi pedido à API ainda: sem código não há o que perguntar.
  expect(dados.chamadas, 'a tela chamou a API antes de ter o código').toEqual([]);
});

test('código errado é recusado pelo backend e a tela não entra', async ({ page }) => {
  const dados = await mockCourier(page);
  await abrir(page);
  await entrar(page, '000000');

  await expect(page.locator('#courierGateError')).toHaveText('Código incorreto.');
  await expect(page.locator('#courierApp')).toBeHidden();
  // E o código errado NÃO ficou guardado — senão a próxima abertura repetiria
  // a recusa sozinha, sem o entregador entender por quê.
  const guardado = await page.evaluate(t => localStorage.getItem(`rapidex.courier.code.${t}`), TOKEN);
  expect(guardado).toBeNull();
  expect(dados.chamadas.some(c => c.caminho.endsWith('/me')), 'nem tentou o /me').toBe(true);
});

test('com o código certo, o header X-Courier-Code vai em TODA requisição', async ({ page }) => {
  const dados = await mockCourier(page);
  await abrir(page);
  await entrar(page);

  await expect(page.locator('#courierName')).toHaveText('Rafael Souza');
  await expect(page.locator('#courierBranch')).toHaveText('Matriz — Batel');

  const semCodigo = dados.chamadas.filter(c => c.codigo !== CODIGO);
  expect(semCodigo, `requisições sem o código: ${JSON.stringify(semCodigo)}`).toEqual([]);
  expect(dados.chamadas.length).toBeGreaterThanOrEqual(2);
});

test('o valor a receber é o do backend, exibido sem conta nenhuma', async ({ page }) => {
  await mockCourier(page);
  await abrir(page);
  await entrar(page);

  const pronto = page.locator('.cr-card[data-order-id="ord-1"]');
  // 23,50 é `amount_to_collect`. O total do pedido é 118,90 — se a tela algum
  // dia subtrair, somar ou "corrigir", este texto muda.
  await expect(pronto.locator('.cr-card__money')).toHaveText('Receber R$ 23,50 (Dinheiro)');
  await expect(pronto.getByText('118,90')).toHaveCount(0);

  // Pago não mostra valor nenhum: parcela zerada é linha FORA, nunca um
  // "R$ 0,00" solto — a mesma regra da sacola do cliente.
  const naRua = page.locator('.cr-card[data-order-id="ord-2"]');
  await expect(naRua.locator('.cr-card__money')).toHaveCount(0);
  await expect(naRua.locator('.cr-card__paid')).toHaveText('Pedido pago — nada a receber');
});

test('quem decide a ação é can_leave/can_deliver, não o status', async ({ page }) => {
  // O status diz o contrário das permissões de propósito: se a tela inferir a
  // ação a partir dele, os botões trocam de lugar e este teste acusa.
  await mockCourier(page, {
    pedidos: [
      { ...PEDIDO_PRONTO, status: 'out_for_delivery', can_leave: true, can_deliver: false },
      { ...PEDIDO_NA_RUA, status: 'ready', can_leave: false, can_deliver: true }
    ]
  });
  await abrir(page);
  await entrar(page);

  const um = page.locator('.cr-card[data-order-id="ord-1"]');
  const dois = page.locator('.cr-card[data-order-id="ord-2"]');
  await expect(um.locator('button[data-acao="alternar"]')).toHaveCount(1);
  await expect(um.locator('button[data-acao="entregue"]')).toHaveCount(0);
  await expect(dois.locator('button[data-acao="alternar"]')).toHaveCount(0);
  await expect(dois.locator('button[data-acao="entregue"]')).toHaveCount(1);
});

test('sair para entrega: 200 NÃO é sucesso quando um item vem ok:false', async ({ page }) => {
  const dados = await mockCourier(page);
  await abrir(page);
  await entrar(page);

  await page.locator('.cr-card[data-order-id="ord-1"] button[data-acao="alternar"]').click();
  await expect(page.locator('#courierBar')).toBeVisible();
  await expect(page.locator('#courierBarCount')).toHaveText('1 pedido');

  // O backend responde 200 e recusa o pedido DENTRO do envelope.
  dados.loteResposta = {
    items: [{
      order_id: 'ord-1',
      ok: false,
      error: 'wrong_status',
      message: 'pedido não está pronto',
      order: { ...PEDIDO_PRONTO }
    }]
  };
  await page.locator('#courierLeaveBtn').click();

  // A tela tem de dizer que NÃO saiu, e nomear o pedido. Ler só o HTTP faria
  // ela comemorar uma saída que não aconteceu.
  const aviso = page.locator('#courierAlert');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('Nenhum pedido saiu');
  await expect(aviso).toContainText('#1042');
});

test('sair para entrega com tudo aceito não deixa aviso na tela', async ({ page }) => {
  const dados = await mockCourier(page);
  await abrir(page);
  await entrar(page);

  await page.locator('.cr-card[data-order-id="ord-1"] button[data-acao="alternar"]').click();
  // Depois da saída o pedido some da lista de "pode sair" — é o que o backend
  // faria, e é o que prova que a tela recarregou em vez de acreditar em si.
  dados.pedidos = [{ ...PEDIDO_PRONTO, can_leave: false, can_deliver: true, status: 'out_for_delivery' }, PEDIDO_NA_RUA];
  await page.locator('#courierLeaveBtn').click();

  await expect(page.locator('#courierAlert')).toBeHidden();
  await expect(page.locator('#courierBar')).toBeHidden();
  await expect(page.locator('.cr-card[data-order-id="ord-1"] button[data-acao="entregue"]')).toHaveCount(1);
});

test('409 em "entregue" não é erro de rede: a lista estava velha e se recarrega', async ({ page }) => {
  const dados = await mockCourier(page, { entregueStatus: 409 });
  await abrir(page);
  await entrar(page);

  const antes = dados.chamadas.filter(c => c.caminho.endsWith('/orders')).length;
  await page.locator('.cr-card[data-order-id="ord-2"] button[data-acao="entregue"]').click();

  await expect(page.locator('#courierAlert')).toContainText('mudou de estado');
  await expect.poll(
    () => dados.chamadas.filter(c => c.caminho.endsWith('/orders')).length,
    'a tela não recarregou a lista depois do 409'
  ).toBeGreaterThan(antes);
});

test('o código fica guardado: reabrir o link não pede de novo', async ({ page }) => {
  await mockCourier(page);
  await abrir(page);
  await entrar(page);
  await expect(page.locator('#courierApp')).toBeVisible();

  await abrir(page);
  await expect(page.locator('#courierApp')).toBeVisible();
  await expect(page.locator('#courierGate')).toBeHidden();
  await expect(page.locator('#courierName')).toHaveText('Rafael Souza');
});

test('código revogado no meio do turno volta para a porta e apaga o guardado', async ({ page }) => {
  const dados = await mockCourier(page);
  await abrir(page);
  await entrar(page);
  await expect(page.locator('#courierApp')).toBeVisible();

  // O painel trocou o código do entregador enquanto ele trabalhava.
  dados.codigo = '999111';
  await page.locator('#courierReload').click();

  await expect(page.locator('#courierGate')).toBeVisible();
  await expect(page.locator('#courierGateError')).toContainText('não vale mais');
  const guardado = await page.evaluate(t => localStorage.getItem(`rapidex.courier.code.${t}`), TOKEN);
  expect(guardado, 'o código revogado continuou guardado').toBeNull();
});

test('link revogado responde 404 e não adianta digitar código nenhum', async ({ page }) => {
  await mockCourier(page);
  await abrir(page, 'lnk_morto');
  await entrar(page);

  await expect(page.locator('#courierDead')).toBeVisible();
  await expect(page.locator('#courierDeadTitle')).toHaveText('Link inválido');
  await expect(page.locator('#courierGate')).toBeHidden();
});

test('a página não carrega o app do cliente: nada de cardápio, sacola ou tema', async ({ page }) => {
  await mockCourier(page);
  await abrir(page);
  await entrar(page);

  // O peso é a razão de ela ser uma página separada. Se alguém importar o
  // restaurant-page aqui, estes globais aparecem e a página engorda 380 kB.
  const vazou = await page.evaluate(() => [
    'PedeAquiCartStore', 'RapidexActions', 'RapidexTheme', 'PedeAquiRestaurantUi',
    'openProduct', 'addToCart', 'openModal'
  ].filter(nome => typeof window[nome] !== 'undefined'));
  expect(vazou, `o app do cliente vazou para a tela do entregador: ${vazou.join(', ')}`).toEqual([]);
});

test('o status vira frase em português, e o desconhecido não vaza jargão', async ({ page }) => {
  await mockCourier(page, {
    pedidos: [
      { ...PEDIDO_PRONTO, status: 'ready' },
      // Um status que o backend pode inventar amanhã. Ele NÃO pode chegar cru
      // na tela de quem está na rua — "AWAITING_COURIER_PICKUP" é vocabulário
      // nosso, não dele.
      { ...PEDIDO_NA_RUA, status: 'awaiting_courier_pickup' }
    ]
  });
  await abrir(page);
  await entrar(page);

  await expect(page.locator('.cr-card[data-order-id="ord-1"] .cr-card__status')).toHaveText('Pronto');
  await expect(page.locator('.cr-card[data-order-id="ord-2"] .cr-card__status')).toHaveCount(0);
  // E o cartão sem rótulo continua servindo: endereço, pagamento e ação.
  await expect(page.locator('.cr-card[data-order-id="ord-2"] button[data-acao="entregue"]')).toHaveCount(1);
  await expect(page.getByText(/awaiting|OUT_FOR_DELIVERY|READY/i)).toHaveCount(0);
});

// ── A tela sob a CSP restrita dela ────────────────────────────────────────────
// `csp.spec.js` prova que a política está escrita e é subconjunto da global.
// Este prova o outro lado, que nenhuma leitura de arquivo alcança: a página
// BOOTA e trabalha sob ela, sem uma violação. O `vite preview` não aplica
// headers da Vercel, então o header é injetado na resposta do documento — o
// mesmo caminho que csp.spec.js usa para o app do cliente.
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { dirname, resolve } = await import('node:path');
const raiz = dirname(fileURLToPath(import.meta.url));
const vercelJson = JSON.parse(readFileSync(resolve(raiz, '..', '..', 'vercel.json'), 'utf8'));
const CSP_ENTREGADOR = vercelJson.headers
  .find(h => h.source === '/entregador(/.*)?')
  ?.headers.find(h => h.key.toLowerCase() === 'content-security-policy')?.value;

test('a tela trabalha inteira sob a CSP restrita, sem uma violação', async ({ page }) => {
  expect(CSP_ENTREGADOR, 'a política do entregador sumiu da vercel.json').toBeTruthy();

  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__csp.push(`${event.effectiveDirective || event.violatedDirective} bloqueou ${event.blockedURI} ${event.sample || ''}`);
    });
  });
  const dados = await mockCourier(page);
  // O padrão tem de casar a URL que o BROWSER pede — /entregador/<token> — e
  // não o destino do rewrite. O rewrite acontece no servidor; para o Playwright
  // a navegação continua sendo o caminho original, e um `**/entregador.html*`
  // aqui não casa nada. Foi assim que a primeira versão deste teste rodou com a
  // política JAMAIS aplicada: as violações deram zero porque não havia CSP, e
  // quem acusou foi a sonda de inércia no fim do teste.
  await page.route(
    (url) => url.pathname.startsWith('/entregador'),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': CSP_ENTREGADOR }
      });
    }
  );

  await abrir(page);
  await entrar(page);
  await expect(page.locator('#courierApp')).toBeVisible();

  // Exercita o caminho inteiro: a folha carrega, os cartões são montados em
  // runtime, o lote sai e a lista se redesenha. É aqui que um style ou script
  // inline apareceria.
  await page.locator('.cr-card[data-order-id="ord-1"] button[data-acao="alternar"]').click();
  dados.pedidos = [{ ...PEDIDO_PRONTO, can_leave: false, can_deliver: true }, PEDIDO_NA_RUA];
  await page.locator('#courierLeaveBtn').click();
  await expect(page.locator('#courierBar')).toBeHidden();

  const violacoes = await page.evaluate(() => window.__csp);
  expect(violacoes, `violações de CSP na tela do entregador:\n${violacoes.join('\n')}`).toEqual([]);

  // E a política está ATIVA, não inerte: sem esta sonda o teste acima passaria
  // com o header ausente. É a mesma guarda que csp.spec.js tem para o cliente.
  const xss = await page.evaluate(() => {
    window.__xss = false;
    const script = document.createElement('script');
    script.textContent = 'window.__xss = true;';
    document.body.appendChild(script);
    script.remove();
    return window.__xss;
  });
  expect(xss, 'a CSP estava inerte: um script inline executou').toBe(false);
});

// ── O ACERTO ─────────────────────────────────────────────────────────────────
// `fee_total` (91,00) NÃO é a soma de `courier_fee` das entregas (8+7 = 15,00),
// e a diferença é de propósito: se a tela algum dia somar em vez de exibir, os
// dois números divergem e estes testes acusam. Com números que coincidem, um
// cálculo indevido passaria batido — é a armadilha do "fixture cujos números
// coincidem" da skill §4.
const HISTORICO = {
  start_date: '2026-09-01',
  end_date: '2026-09-02',
  deliveries_count: 12,
  deliveries_without_fee: 3,
  fee_total: 91,
  deliveries: [
    { order_id: 'h1', order_number: 1001, delivered_at: '2026-09-01T18:32:00Z', courier_fee: 8, address_neighborhood: 'Portão', distance_km: 3.4 },
    { order_id: 'h2', order_number: 1002, delivered_at: '2026-09-01T19:10:00Z', courier_fee: 7, address_neighborhood: 'Batel', distance_km: 0 },
    // `courier_fee: null` NÃO é zero: é "sem taxa registrada", e é o que
    // `deliveries_without_fee` conta lá em cima.
    { order_id: 'h3', order_number: 1003, delivered_at: '2026-09-02T12:05:00Z', courier_fee: null, address_neighborhood: 'Água Verde', distance_km: null }
  ]
};

async function abrirAcerto(page, historico = HISTORICO) {
  const dados = await mockCourier(page, { historico });
  await abrir(page);
  await entrar(page);
  await page.locator('#courierHistoryBtn').click();
  await expect(page.locator('#courierHistory')).toBeVisible();
  return dados;
}

test('o acerto mostra o fee_total do backend, não uma soma feita aqui', async ({ page }) => {
  await abrirAcerto(page);

  // 91,00 é `fee_total`. A soma das taxas visíveis é 15,00 — se aparecer, a
  // tela calculou.
  await expect(page.locator('#courierFeeTotal')).toHaveText('R$ 91,00');
  await expect(page.locator('#courierFeeTotal')).not.toHaveText('R$ 15,00');
  await expect(page.locator('#courierCount')).toHaveText('12 entregas');
  await expect(page.locator('#courierPeriod')).toHaveText('01/09 a 02/09');
});

test('entregas sem taxa aparecem SEPARADAS da soma, e dizem que não estão nela', async ({ page }) => {
  await abrirAcerto(page);

  const semTaxa = page.locator('#courierWithoutFee');
  await expect(semTaxa).toBeVisible();
  await expect(semTaxa).toContainText('3 entregas sem taxa');
  await expect(semTaxa).toContainText('NÃO estão no valor acima');
  // E fora da caixa do total: o número grande continua sendo só o fee_total.
  await expect(page.locator('#courierFeeTotal')).toHaveText('R$ 91,00');
});

test('sem entrega sem taxa, a linha some — não vira "0 sem taxa"', async ({ page }) => {
  await abrirAcerto(page, { ...HISTORICO, deliveries_without_fee: 0 });

  await expect(page.locator('#courierWithoutFee')).toBeHidden();
  await expect(page.getByText(/0 entregas sem taxa/)).toHaveCount(0);
});

test('courier_fee nulo não vira R$ 0,00 na linha da entrega', async ({ page }) => {
  await abrirAcerto(page);

  const linhas = page.locator('.cr-entrega');
  await expect(linhas).toHaveCount(3);
  await expect(linhas.nth(0).locator('.cr-entrega__taxa')).toHaveText('R$ 8,00');
  // Nulo é "sem taxa registrada", não zero: escrever R$ 0,00 afirmaria que a
  // entrega vale zero, e é justamente a que ele vai querer questionar.
  await expect(linhas.nth(2).locator('.cr-entrega__taxa')).toHaveText('sem taxa');
  await expect(page.getByText('R$ 0,00')).toHaveCount(0);
});

test('distância 0 km é distância, não ausência', async ({ page }) => {
  await abrirAcerto(page);

  // `distance_km: 0` na segunda entrega. Um `||` no lugar de `!= null` a
  // apagaria — a mesma armadilha do sort_order.
  await expect(page.locator('.cr-entrega').nth(1)).toContainText('0.0 km');
});

test('acerto que falha não deixa número velho na tela', async ({ page }) => {
  const dados = await abrirAcerto(page);
  await expect(page.locator('#courierFeeTotal')).toHaveText('R$ 91,00');

  await page.locator('#courierHistoryBack').click();
  dados.historicoStatus = 500;
  await page.locator('#courierHistoryBtn').click();

  await expect(page.locator('#courierHistoryAlert')).toBeVisible();
  // O 91,00 da consulta anterior NÃO pode continuar ali ao lado do erro.
  await expect(page.locator('#courierFeeTotal')).toHaveText('—');
  await expect(page.locator('.cr-entrega')).toHaveCount(0);
});

test('voltar do acerto recarrega a lista, em vez de mostrar uma congelada', async ({ page }) => {
  const dados = await abrirAcerto(page);
  const antes = dados.chamadas.filter(c => c.caminho.endsWith('/orders')).length;

  await page.locator('#courierHistoryBack').click();
  await expect(page.locator('#courierApp')).toBeVisible();

  await expect.poll(
    () => dados.chamadas.filter(c => c.caminho.endsWith('/orders')).length,
    'voltar do acerto não recarregou a lista'
  ).toBeGreaterThan(antes);
});
