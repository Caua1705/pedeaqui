// ============================================================================
//  Prova de que a tela não mudou, quando o commit diz que só moveu código.
//
//  POR QUE ISTO EXISTE
//
//  Quebrar o restaurant-page.js em módulos é mover funções para fora de um
//  fechamento que elas compartilhavam há anos. A suíte E2E confere COMPORTAMENTO
//  (o que acontece ao clicar), mas ela não olha para a maior parte dos pixels:
//  um espaçamento que muda, uma cor que deixa de herdar, um `display` que vira
//  outro — nada disso quebra um teste, e tudo isso é regressão visual.
//
//  Então a prova é medida, não argumentada: abre-se cada tela, lê-se o valor
//  COMPUTADO de um conjunto de propriedades para TODOS os elementos do
//  documento, e compara-se o antes com o depois. Igual é igual. É o método que
//  a auditoria usou ao mexer na escala tipográfica (b21aa13); aqui ele vira
//  ferramenta em vez de script descartável.
//
//  COMO USAR
//    npm run build && npm run preview &
//    node tools/capture-screens.mjs antes.json
//    ...aplique o refactor, npm run build...
//    node tools/capture-screens.mjs depois.json
//    node tools/capture-screens.mjs --diff antes.json depois.json
//
//  A comparação é por CAMINHO ESTRUTURAL do elemento (tag + índice entre os
//  irmãos de mesma tag), não por índice global: assim um elemento a mais numa
//  lista desloca só o ramo dele, e o relatório aponta o ramo em vez de acusar
//  o documento inteiro.
// ============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { mockApi, RESTAURANT_URL, PRODUCT_H2O, SLUG, BRANCH_MATRIZ, MENU, COUPONS, ORDERS, CUSTOMER, orderDetail, pixOrder, trackedOrder, seedPickupSession, seedOnlineCardBranch } from '../tests/e2e/helpers.js';

const BASE = process.env.CAPTURE_BASE_URL || 'http://127.0.0.1:4174';

// As propriedades que descrevem "como isto aparece". Não é a folha inteira de
// propósito: getComputedStyle devolve ~340 nomes, e a maioria (transições,
// grid implícito, contadores) é ruído que muda por motivo legítimo e afogaria
// a diferença que importa.
const PROPS = [
  'display', 'position', 'visibility', 'opacity', 'overflow', 'zIndex',
  'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'whiteSpace',
  'color', 'backgroundColor', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth',
  // AS QUATRO CORES DE BORDA, e nao so a de cima.
  //
  // Por anos esta lista tinha `borderTopColor` sozinha, e a assimetria nao
  // parecia importar — quem escreve `border:1px solid #eee` pinta os quatro
  // lados, e a de cima denuncia as outras tres. So que este app quase nao usa
  // borda inteira: ele usa DIVISORIA, e divisoria e `border-bottom` sozinha.
  // Um commit que trocou a cor da divisoria de sete cabecalhos passou por esta
  // ferramenta com "Nenhuma diferenca" — ela nao estava olhando para o unico
  // lado que mudou.
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopStyle',
  'borderRadius', 'boxShadow', 'transform',
  'flexDirection', 'justifyContent', 'alignItems', 'flexGrow', 'flexShrink',
  'gridTemplateColumns', 'gap',

  // ── O RESTO DAS QUATRO BORDAS, E O QUE NAO E COR NEM CAIXA ───────────────
  //
  // A lista cresce quando alguem mexe numa propriedade que ela nao le — essa
  // e a REGRA, escrita depois do commit que trocou a divisoria de 239
  // elementos e ouviu "Nenhuma diferenca". Um verificador que nao olha onde o
  // app desenha e pior que nenhum: sem ele voce confere a mao; com ele voce
  // para de conferir, e ele assina embaixo.
  //
  // Estas entraram em 30/08/2026, para o commit que tirou 51 marcadores
  // `!important` sem adversario. Sem elas, `inset`, `background:linear-gradient`,
  // `background-size`, `cursor` e `-webkit-text-fill-color` teriam mudado sem
  // que a ferramenta tivesse como ver.
  'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'top', 'right', 'bottom', 'left',
  'backgroundImage', 'backgroundSize', 'backgroundPosition',
  'cursor', 'webkitTextFillColor', 'webkitTextStrokeWidth', 'webkitTextStrokeColor',
  'scrollbarWidth', 'scrollPaddingBottom', 'overscrollBehaviorY',
  'outlineColor', 'outlineWidth', 'fill', 'stroke',
  'textDecorationLine', 'textDecorationColor', 'objectFit'
];

const ready = (page) => page.waitForFunction(
  () => typeof window.openProduct === 'function' && !document.body.classList.contains('app-booting'),
  null,
  { timeout: 30000 }
);

const addToCart = (page) => page.evaluate((id) => {
  window.openProduct(id);
  window.changeQty(1);
  window.changeQty(1);
  window.addToCart();
}, PRODUCT_H2O);

const boot = async (page) => {
  await page.goto(BASE + RESTAURANT_URL);
  await ready(page);
};

/**
 * Dispara uma acao PELO REGISTRO, nao por window.
 *
 * So 11 nomes continuam globais (ver o Object.assign no fim de
 * restaurant-page.js); os outros 160 existem apenas em RapidexActions, que e de
 * onde o markup os chama por data-act-*. Chamar `window.mobNavAssistant()` aqui
 * dava "is not a function" e a tela do assistente saia da captura em silencio —
 * uma tela a menos conferida, sem nada dizendo isso.
 *
 * Por isso esta funcao LANCA quando o nome nao existe: numa ferramenta cujo
 * trabalho e provar que nada mudou, tela que nao abriu tem de ser barulhenta.
 */
const act = (page, name, ...args) => page.evaluate(([acao, argumentos]) => {
  const fn = window.RapidexActions?.resolve?.(acao);
  if (typeof fn !== 'function') throw new Error(`acao desconhecida: ${acao}`);
  return fn(...argumentos);
}, [name, args]);


// ============================================================================
//  PREPARO DE TELA — o que precisa estar de pé ANTES de `go()`
//
//  As 14 telas originais nasciam todas do mesmo preparo: `mockApi()` mais uma
//  sessao de retirada. Isso bastava para o caminho do dinheiro, e por isso
//  1.628 declaracoes `!important` e 229 cores nunca produziram evidencia
//  nenhuma — nao porque estivessem mortas, mas porque o estado que as acende
//  (o Clube com cupom, o extrato, a politica, o chat respondido, o cartao, a
//  tela de erro) exige um preparo proprio: um token, uma rota a mais, um
//  contexto de entrega no localStorage.
//
//  Entao cada tela pode declarar um `setup(page)`, que roda DEPOIS do preparo
//  comum e ANTES de `go()`. A ordem importa nos dois sentidos:
//
//    - `page.route` registrado por ultimo VENCE, entao um setup que sobrepoe
//      `/coupons` ou `/info` tem de vir depois de `mockApi()`;
//    - `addInitScript` empilha, entao um token acrescentado aqui convive com
//      o perfil que `seedPickupSession()` ja gravou.
//
//  As tres ferramentas que abrem estas telas (esta, css-usage e css-important)
//  passaram a chamar `prepararTela()` em vez de repetir as duas linhas. Uma
//  tela que so uma delas prepara direito e uma medida que so vale numa delas.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

/** Sessao COM conta: o Clube, o extrato e as subpaginas do perfil exigem token. */
async function logado(page) {
  await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'captura-token'));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json(CUSTOMER)));
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  // O histórico REAL, não `json([])`: com a lista vazia esta ferramenta
  // capturava só o estado "Nenhum pedido encontrado" e assinava "nenhuma
  // diferença" para qualquer mudança nos cards, no detalhe e nos valores.
  // O fixture é o do contrato (orders.json). A rota do DETALHE vem por último
  // de propósito: em page.route a última registrada vence.
  await page.route('**/customers/me/orders**', route => route.fulfill(json(ORDERS)));
  await page.route('**/customers/me/orders/*', route => {
    const url = route.request().url();
    const id = url.match(/\/customers\/me\/orders\/([^/?]+)/)?.[1];
    const order = ORDERS.find(item => item.id === id);
    if (!order) return route.fulfill(json({ detail: 'Pedido não encontrado' }, 404));
    return route.fulfill(json(orderDetail(order)));
  });
}

/** A lista de cupons nos tres estados do contrato (o mock responde vazio por padrao). */
const comCupons = (page) => page.route(/\/coupons(?:\?|$)/, route => route.fulfill(json(COUPONS)));

/**
 * Extrato de cashback com credito E debito.
 *
 * Sao DUAS rotas, e casar so a primeira deixa o extrato em "Carregando...":
 * `/customers/me/cashback` traz o saldo e
 * `/customers/me/cashback/transactions?limit=&offset=` traz as linhas. A linha
 * negativa tem folha propria (`.cashback-statement-amount.negative` e o
 * `::before` da linha), entao o extrato precisa dos dois sinais.
 */
const comExtrato = async (page) => {
  // Duas rotas, dois shapes (o extrato NAO herda do saldo — ver o schema):
  // o saldo com by_restaurant (e o global DISCORDANDO do da loja, de
  // proposito), e as transacoes com credito E debito. A rota especifica vem
  // por ultimo porque em page.route a ultima registrada vence.
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({
    balance: 50,
    currency: 'BRL',
    by_restaurant: [
      { restaurant_id: 'aaaa0000-0000-4000-8000-000000000001', restaurant_name: 'Junior da Picanha', restaurant_slug: SLUG, balance: 12.5, expires_at: null },
      { restaurant_id: 'bbbb0000-0000-4000-8000-000000000002', restaurant_name: 'Outra Loja', restaurant_slug: 'outra-loja', balance: 37.5, expires_at: null }
    ]
  })));
  await page.route('**/customers/me/cashback/transactions**', route => route.fulfill(json({
    balance: 50,
    currency: 'BRL',
    transactions: [
      { id: 't1', type: 'earned', amount: '8.40', description: 'Cashback do pedido #1042', created_at: '2026-08-20T18:12:00Z' },
      { id: 't2', type: 'redeemed', amount: '-4.10', description: 'Usado no pedido #1051', created_at: '2026-08-24T20:03:00Z' }
    ]
  })));
};

/** O assistente respondendo com produtos — o que acende o trilho e o detalhe. */
const comChat = (page) => page.route('**/chat', route => route.fulfill(json({
  response_type: 'products',
  message: 'Boa! Separei uma opcao gelada.',
  products: [{
    id: PRODUCT_H2O,
    name: 'Agua H2O',
    description: 'Produto recomendado pelo Rapi.',
    price: 7.05,
    recommendation_reason: 'Combina com o que voce pediu.'
  }]
})));

/**
 * Contexto de ENTREGA confirmado, com endereco.
 *
 * `seedPickupSession()` grava retirada, e retirada apaga metade do desenho:
 * `.address-strip.has-address`, o cartao de endereco da sacola e o rodape de
 * entrega da tela de pagamento so existem quando a modalidade e entrega.
 */
const entregaConfirmada = (page) => page.addInitScript(
  ({ slug, branchId }) => {
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery',
      branch_id: branchId,
      branch_label: 'Matriz',
      confirmed: true,
      address: {
        id: 'end-captura',
        label: 'Casa',
        street_name: 'Rua Silva Paulet',
        number: '450',
        neighborhood: 'Aldeota',
        city: 'Fortaleza',
        state: 'CE',
        zipcode: '60120-020',
        full_address: 'Rua Silva Paulet, 450 - Aldeota, Fortaleza - CE'
      }
    }));
  },
  { slug: SLUG, branchId: BRANCH_MATRIZ }
);

/**
 * Entrega ESCOLHIDA mas sem endereco: e o estado em que a sacola avisa, e ele
 * tem folha propria (`.cart-location-widget:not(.has-address)`, o CTA que diz
 * "Informe seu endereco"). Sem isto, essas regras nunca sao medidas.
 */
const entregaSemEndereco = (page) => page.addInitScript(
  ({ slug, branchId }) => {
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery', branch_id: branchId, branch_label: 'Matriz', confirmed: true
    }));
  },
  { slug: SLUG, branchId: BRANCH_MATRIZ }
);

/**
 * Um produto COM grupos de opcao.
 *
 * O fixture de cardapio nao tem nenhum — sao 136 produtos e zero
 * `option_groups` —, entao as 14 regras de `#productModal .pm-option-*` nunca
 * pintaram nada em medida nenhuma. A opcao aqui e sobrepor a ROTA para esta
 * tela, e nao mexer no fixture compartilhado: o fixture e copia fiel da
 * producao e e afirmacao de outros testes; uma tela de captura nao deve mudar
 * o que os E2E leem.
 */
const comOpcoesDeProduto = (page) => page.route(/\/menu(?:\?|$)/, route => {
  const menu = JSON.parse(JSON.stringify(MENU));
  const produto = menu.products.find(p => p.id === PRODUCT_H2O);
  produto.option_groups = [{
    id: 'grp-captura-1',
    name: 'Escolha o tamanho',
    min_select: 1,
    max_select: 1,
    is_required: true,
    sort_order: 0,
    options: [
      { id: 'opt-captura-1', name: 'Copo 300ml', description: 'Serve uma pessoa', price: '0.00', is_active: true, sort_order: 0 },
      { id: 'opt-captura-2', name: 'Garrafa 500ml', description: 'Gelada', price: '2.50', is_active: true, sort_order: 1 }
    ]
  }];
  return route.fulfill(json(menu));
});

/**
 * Enderecos salvos na conta.
 *
 * A rota respondia `[]` e o escolhedor abria vazio — 25 regras de operation.css
 * desenham a LISTA (o pino, o texto, o check, os tres pontos, o lixo) e nenhuma
 * podia ser medida. O primeiro item repete o endereco do contexto de operacao
 * de proposito: e ele que nasce `selected`, e o dialogo de apagar o endereco
 * EM USO e outro desenho (`is-active-warning`).
 */
/**
 * O endereço ATIVO da tela de "apagar o que está em uso".
 *
 * É o PRIMEIRO da lista de `comEnderecos`, com o mesmo id: `sameAddress` casa
 * por id, e é isso que faz o backend do picker responder "não dá para apagar o
 * ativo". Se a lista mudar, este objeto muda junto — são um par.
 */
const ENDERECO_ATIVO_DA_CAPTURA = {
  id: 'end-captura',
  label: 'Casa',
  street: 'Rua Silva Paulet',
  number: '450',
  neighborhood: 'Aldeota',
  city: 'Fortaleza',
  state: 'CE',
  postal_code: '60120-020'
};

const comEnderecos = (page) => page.route('**/customers/me/addresses**', route => route.fulfill(json([
  {
    id: 'end-captura',
    label: 'Casa',
    street_name: 'Rua Silva Paulet',
    number: '450',
    neighborhood: 'Aldeota',
    city: 'Fortaleza',
    state: 'CE',
    zipcode: '60120-020',
    full_address: 'Rua Silva Paulet, 450 - Aldeota, Fortaleza - CE'
  },
  {
    id: 'end-captura-2',
    label: 'Trabalho',
    street_name: 'Avenida Santos Dumont',
    number: '3131',
    neighborhood: 'Papicu',
    city: 'Fortaleza',
    state: 'CE',
    zipcode: '60150-162',
    full_address: 'Avenida Santos Dumont, 3131 - Papicu, Fortaleza - CE'
  }
])));

/** Espera um seletor casar, sem depender de relogio de parede. */
const esperar = (page, seletor, timeout = 15000) => page.waitForSelector(seletor, { timeout });

// ── O backend da TELA DO ENTREGADOR ───────────────────────────────────────────
// Fixture proprio: a terceira pagina nao chama nenhuma rota do app do cliente, e
// o mock dele responde 404 a /courier/*. Registrado no `setup` de cada tela,
// portanto DEPOIS do mockApi() — no Playwright a ultima rota registrada vence.
//
// Os valores nao coincidem de proposito, como no spec: 23,50 a receber contra
// 118,90 de total, e fee_total 91,00 contra 15,00 de soma das taxas visiveis. Se
// a tela algum dia calcular em vez de exibir, a captura muda e a diferenca
// aparece no diff.
const TOKEN_ENTREGADOR = "lnk_captura";
const CODIGO_ENTREGADOR = "482915";

const ENTREGADOR_PEDIDOS = [
  {
    order_id: "cap-1", order_number: 1042, status: "ready",
    can_leave: true, can_deliver: false,
    customer_name: "Marina Alves", customer_phone: "5541999990000",
    is_paid: false, amount_to_collect: 23.5, total: 118.9, payment_method: "Dinheiro",
    address_street: "Rua das Acacias", address_number: "481",
    address_neighborhood: "Portao", address_city: "Curitiba",
    address_complement: "Apto 32", address_reference: "Portao verde",
    notes: "Interfone quebrado, ligar ao chegar",
    delivery_latitude: -25.4809, delivery_longitude: -49.2905
  },
  {
    order_id: "cap-2", order_number: 1043, status: "out_for_delivery",
    can_leave: false, can_deliver: true,
    customer_name: "Jonas Pires", customer_phone: "5541988887777",
    is_paid: true, amount_to_collect: 0, total: 64.2, payment_method: "Pix",
    address_street: "Av. Republica Argentina", address_number: "1200",
    address_neighborhood: "Agua Verde", address_city: "Curitiba"
  }
];

const ENTREGADOR_HISTORICO = {
  start_date: "2026-09-01", end_date: "2026-09-02",
  deliveries_count: 12, deliveries_without_fee: 3, fee_total: 91,
  deliveries: [
    { order_id: "h1", order_number: 1001, delivered_at: "2026-09-01T18:32:00Z", courier_fee: 8, address_neighborhood: "Portao", distance_km: 3.4 },
    { order_id: "h2", order_number: 1002, delivered_at: "2026-09-01T19:10:00Z", courier_fee: 7, address_neighborhood: "Batel", distance_km: 0 },
    // courier_fee nulo NAO e zero: e a entrega "sem taxa registrada", que a
    // tela mostra separada da soma.
    { order_id: "h3", order_number: 1003, delivered_at: "2026-09-02T12:05:00Z", courier_fee: null, address_neighborhood: "Agua Verde", distance_km: null }
  ]
};

function mockEntregador(page) {
  return page.route("**/api.pederapidex.com/**", (route) => {
    const caminho = new URL(route.request().url()).pathname;
    if (!caminho.startsWith("/courier/")) return route.fulfill(json({ detail: "fora do escopo" }, 404));
    // O codigo e credencial: sem ele, nada responde. A captura o digita.
    if (route.request().headers()["x-courier-code"] !== CODIGO_ENTREGADOR) {
      return route.fulfill(json({ detail: "codigo invalido" }, 401));
    }
    if (caminho.endsWith("/me")) return route.fulfill(json({ name: "Rafael Souza", branch_name: "Matriz - Batel" }));
    if (caminho.endsWith("/orders")) return route.fulfill(json(ENTREGADOR_PEDIDOS));
    if (caminho.endsWith("/history")) return route.fulfill(json(ENTREGADOR_HISTORICO));
    return route.fulfill(json({ detail: "nao declarada" }, 404));
  });
}

/**
 * As telas. Cada uma é levada ao estado por AÇÕES do próprio app — nunca por
 * um estado montado à mão, que provaria só que o CSS existe, e não que o
 * caminho que leva até ele continua chegando lá.
 */
export const SCREENS = [
  { name: 'home', go: boot },

  {
    name: 'cardapio',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavMenu');
      await page.waitForFunction(() => document.body.classList.contains('menu-tab'));
    }
  },
  {
    name: 'produto',
    async go(page) {
      await boot(page);
      await page.evaluate((id) => window.openProduct(id), PRODUCT_H2O);
      await page.waitForSelector('#productModal.active');
    }
  },
  {
    name: 'sacola',
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await page.waitForSelector('#cartModal.active');
    }
  },
  {
    name: 'formas-de-pagamento',
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await page.waitForSelector('#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await page.waitForSelector('#paymentMethodModal.active');
    }
  },
  {
    name: 'endereco-escolha',
    async go(page) {
      await boot(page);
      await act(page, 'openAddressChoice');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'endereco-picker',
    async go(page) {
      await boot(page);
      await act(page, 'openAddrPicker');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'endereco-busca',
    async go(page) {
      await boot(page);
      await act(page, 'openAddrSearch');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'login',
    async go(page) {
      await boot(page);
      await act(page, 'openLoginScreen');
      await page.waitForSelector('#loginModal.active');
    }
  },
  {
    name: 'cadastro',
    async go(page) {
      await boot(page);
      await act(page, 'openRegisterScreen');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'clube',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavClub');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'perfil',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'assistente',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'operacao',
    async go(page) {
      await boot(page);
      await act(page, 'openOperationScreen');
      await page.waitForTimeout(500);
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  AS TELAS QUE FALTAVAM
  //
  //  Cada uma existe porque um pedaco do CSS so acende nela, e enquanto ela
  //  nao era aberta esse pedaco ficava em `sem-evidencia` — nem provado vivo,
  //  nem podendo ser removido. O comentario de cada bloco diz o que ela
  //  acende, para que a proxima pessoa saiba o que perde ao apaga-la.
  // ══════════════════════════════════════════════════════════════════════════

  // --- Informacoes da loja: as tres abas sao TRES desenhos, e as duas ultimas
  //     tem regras proprias em utilities.css (`#infoModal[data-store-info-tab=...]`).
  {
    name: 'info-horarios',
    async go(page) {
      await boot(page);
      await act(page, 'openRestaurantInfo');
      await esperar(page, '#infoModal.active');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'info-endereco',
    async go(page) {
      await boot(page);
      await act(page, 'openRestaurantInfo');
      await esperar(page, '#infoModal.active');
      await act(page, 'setStoreInfoTab', 'address');
      await esperar(page, '#infoModal[data-store-info-tab="address"]');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'info-pagamento',
    async go(page) {
      await boot(page);
      await act(page, 'openRestaurantInfo');
      await esperar(page, '#infoModal.active');
      await act(page, 'setStoreInfoTab', 'payment');
      await esperar(page, '#infoModal[data-store-info-tab="payment"]');
      await page.waitForTimeout(400);
    }
  },

  // --- Politica de privacidade. Ela tem DOIS desenhos, e a diferenca esta no
  //     `body.policy-from-profile` (a barra de baixo fica, e o cabecalho muda).
  {
    name: 'politica',
    async go(page) {
      await boot(page);
      await act(page, 'openPolicyScreen');
      await esperar(page, '.policy-screen.active');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'politica-do-perfil',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await esperar(page, '#mobViewProfile.active');
      await act(page, 'openPolicyScreen');
      await esperar(page, 'body.policy-from-profile .policy-screen.active');
      await page.waitForTimeout(400);
    }
  },

  // --- Clube COM cupons desenhados. A lista vazia escondia a tela inteira;
  //     e por essa fresta que ja passaram oito defeitos juntos.
  {
    name: 'clube-com-cupons',
    setup: async (page) => { await logado(page); await comCupons(page); await comExtrato(page); },
    async go(page) {
      await boot(page);
      await act(page, 'mobNavClub');
      await esperar(page, '#mobViewClub.active .club-available-coupon-card');
      await page.waitForTimeout(600);
    }
  },
  {
    name: 'cupom-detalhe',
    setup: async (page) => { await logado(page); await comCupons(page); await comExtrato(page); },
    async go(page) {
      await boot(page);
      await act(page, 'mobNavClub');
      await esperar(page, '#mobViewClub.active .club-available-coupon-card');
      await act(page, 'openCouponDetail', COUPONS.coupons[0].code);
      await esperar(page, '.coupon-detail-overlay.active');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'extrato-cashback',
    setup: async (page) => { await logado(page); await comCupons(page); await comExtrato(page); },
    async go(page) {
      await boot(page);
      await act(page, 'mobNavClub');
      await esperar(page, '#mobViewClub.active');
      await act(page, 'openCashbackStatement');
      await esperar(page, '#cashbackStatementModal.active .cashback-statement-row');
      await page.waitForTimeout(500);
    }
  },

  // --- Perfil: as subpaginas sao telas cheias, e cada uma repinta a barra de
  //     baixo e a sacola flutuante por conta propria.
  {
    name: 'perfil-ajuda',
    setup: logado,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await esperar(page, '#mobViewProfile.active');
      await act(page, 'openProfSub', 'ajuda');
      await esperar(page, '#profSubajuda.active');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'perfil-meus-dados',
    setup: logado,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await esperar(page, '#mobViewProfile.active');
      await act(page, 'openProfSub', 'meusdados');
      await esperar(page, '#profSubmeusdados.active');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'perfil-pedidos',
    setup: logado,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await esperar(page, '#mobViewProfile.active');
      await act(page, 'openProfSub', 'pedidos');
      await esperar(page, '#profSubpedidos.active');
      await page.waitForTimeout(700);
    }
  },
  {
    // O detalhe de um pedido do historico — a tela onde moravam os campos
    // fantasma (item.name, unit_price, selected_options_snapshot). Nunca tinha
    // sido capturada porque a lista respondia [] e nao havia card para abrir.
    name: 'perfil-pedido-detalhe',
    setup: logado,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await esperar(page, '#mobViewProfile.active');
      await act(page, 'openProfSub', 'pedidos');
      await esperar(page, '#profSubpedidos.active');
      await act(page, 'openProfOrderDetails', 0);
      await esperar(page, '#profOrderDetail.active');
      await page.waitForTimeout(700);
    }
  },
  {
    // A confirmacao de sair inverte o papel dos dois botoes (ver §4.1 da skill):
    // aqui `.addr-delete-yes` e o botao de FICAR. E a folha desta tela que
    // repinta por cima, e ela nunca tinha sido medida.
    name: 'sair-confirmacao',
    setup: logado,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavProfile');
      await esperar(page, '#mobViewProfile.active');
      await act(page, 'logout');
      await esperar(page, '#logoutConfirm.active');
      await page.waitForTimeout(400);
    }
  },

  // --- Cardapio em BUSCA: esconde catNav e titulos e acende
  //     `.product-card.is-search-hidden`, que so existe aqui.
  {
    name: 'busca-cardapio',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavMenu');
      await page.waitForFunction(() => document.querySelectorAll('.product-card').length > 1);
      await page.locator('#searchInput').fill('pudim');
      await esperar(page, 'body.menu-tab.menu-search-active');
      await page.waitForTimeout(500);
    }
  },

  // --- Produto COM grupos de opcao (a rota do cardapio e sobreposta so aqui).
  {
    name: 'produto-com-opcoes',
    setup: comOpcoesDeProduto,
    async go(page) {
      await boot(page);
      await page.evaluate((id) => window.openProduct(id), PRODUCT_H2O);
      await esperar(page, '#productModal.active .pm-option-group');
      await page.waitForTimeout(400);
    }
  },

  // --- Sacola em ENTREGA sem endereco: o aviso, o mapa apagado e o CTA que
  //     diz "Informe seu endereco" tem folha propria em restaurant.css.
  {
    name: 'sacola-entrega-sem-endereco',
    setup: entregaSemEndereco,
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.waitForTimeout(600);
    }
  },
  // --- Sacola em ENTREGA com endereco: `.address-strip.has-address` e o
  //     widget de local preenchido.
  {
    name: 'sacola-entrega-com-endereco',
    setup: entregaConfirmada,
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.waitForTimeout(600);
    }
  },
  // --- Formas de pagamento com uma opcao ESCOLHIDA (`.payment-method-option.active`)
  //     e o rodape de confirmacao aberto.
  {
    name: 'pagamento-escolhido',
    setup: entregaConfirmada,
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#paymentMethodModal.active');
      await page.locator('.payment-method-option[data-payment-key="pix"]').click();
      await esperar(page, '.payment-method-option.active');
      await page.waitForTimeout(500);
    }
  },
  // --- A sacola DEPOIS do Pix escolhido: o cartao de pagamento troca de cara
  //     inteira (`.cart-payment-card.is-pix-payment`, 9 regras so dele).
  {
    name: 'sacola-com-pix-escolhido',
    setup: entregaConfirmada,
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#paymentMethodModal.active');
      await page.locator('.payment-method-option[data-payment-key="pix"]').click();
      await esperar(page, '#paymentMethodFooter');
      await page.locator('.payment-method-confirm').click();
      await esperar(page, '#cartModal.active .cart-payment-card.is-pix-payment');
      await page.waitForTimeout(500);
    }
  },
  // --- A folha de confirmacao que fica ENTRE o CTA da sacola e o POST /orders.
  {
    name: 'confirmar-pedido',
    setup: entregaConfirmada,
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#paymentMethodModal.active');
      await page.locator('.payment-method-option[data-payment-key="pix"]').click();
      await esperar(page, '#paymentMethodFooter');
      await page.locator('.payment-method-confirm').click();
      await esperar(page, '#cartModal.active .cart-payment-card.is-pix-payment');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#orderConfirmSheet.active');
      await page.waitForTimeout(500);
    }
  },
  // --- Pix: a tela de cobranca, com QR, codigo e o acompanhamento.
  //
  //     O `POST /orders` precisa responder um pedido de PIX. O padrao do mock
  //     e `successOrder()`, que leva a tela de "pedido recebido" — outro
  //     desenho, e a folha do Pix (1.117 linhas) continuaria sem ser medida.
  {
    name: 'pix',
    setup: async (page) => {
      await entregaConfirmada(page);
      await page.route(/\/orders(\?|$)/, route =>
        route.request().method() === 'POST' ? route.fulfill(json(pixOrder(1))) : route.fallback());
    },
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#paymentMethodModal.active');
      await page.locator('.payment-method-option[data-payment-key="pix"]').click();
      await esperar(page, '#paymentMethodFooter');
      await page.locator('.payment-method-confirm').click();
      await esperar(page, '#cartModal.active .cart-payment-card.is-pix-payment');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#orderConfirmSheet.active');
      await page.locator('#orderConfirmSheet .order-confirm-cta').click();
      await esperar(page, '#pixPaymentModal.active');
      await page.waitForTimeout(900);
    }
  },
  // --- PAGAMENTO APROVADO: a ULTIMA tela que o cliente ve depois de pagar.
  //
  //     Ela ficou fora das 62 por meses, e o buraco tem a forma de sempre: a
  //     tela do Pix estava aqui, a de sucesso nao — e sucesso e o desfecho
  //     NORMAL. O verificador media a espera e nao media a chegada.
  //
  //     O caminho e o real: cobranca Pix criada, e o `track` respondendo pago
  //     na primeira consulta. O polling do app reconhece sozinho e troca de
  //     tela — nenhum atalho por `window.showOrderSuccess`, senao a captura
  //     mediria uma tela que o app talvez nao saiba mais abrir (§22.1).
  {
    name: 'pagamento-aprovado',
    setup: async (page) => {
      await entregaConfirmada(page);
      await page.route(/\/orders(\?|$)/, route =>
        route.request().method() === 'POST' ? route.fulfill(json(pixOrder(1))) : route.fallback());
      await page.route(/\/orders\/track\//, route =>
        route.fulfill(json(trackedOrder({ payment_status: 'paid', status: 'confirmed' }))));
    },
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#paymentMethodModal.active');
      await page.locator('.payment-method-option[data-payment-key="pix"]').click();
      await esperar(page, '#paymentMethodFooter');
      await page.locator('.payment-method-confirm').click();
      await esperar(page, '#cartModal.active .cart-payment-card.is-pix-payment');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#orderConfirmSheet.active');
      await page.locator('#orderConfirmSheet .order-confirm-cta').click();
      // O primeiro polling leva ate ~5 s; o teto de `esperar` e 15 s.
      await esperar(page, '#orderSuccessModal.active', 20000);
      await page.waitForTimeout(600);
    }
  },
  // --- Cartao online: a lista de cartoes salvos e o formulario de campos
  //     seguros. Exige TRES coisas que nenhuma outra tela exige, e e por isso
  //     que ele nunca tinha sido medido:
  //
  //       1. uma FILIAL que aceite cartao online — no fixture de producao
  //          `credit_card` so existe no grupo `delivery` (a maquininha na
  //          porta), e quem decide e a filial, nao o gateway;
  //       2. `/payment-config` com `card_enabled`;
  //       3. o SDK do Mercado Pago. O daqui e um duble MINIMO: monta um
  //          <input> por campo e avisa `ready`. Ele nao imita as recusas do
  //          gateway (o mock dos E2E imita, e deve continuar imitando) porque
  //          aqui nao se testa comportamento nenhum — so se abre a tela para
  //          medir o que ela pinta.
  //
  //     As duas regras de `.payment-secure-field iframe` continuam sem
  //     evidencia de proposito: o iframe so existe com o SDK REAL, e quem o
  //     roda sob a CSP de producao e `mercado-pago-secure-fields.spec.js`.
  {
    name: 'pagamento-cartao',
    setup: async (page) => {
      await logado(page);
      await entregaConfirmada(page);
      await seedOnlineCardBranch(page);
      await page.route('**/payment-config', route => route.fulfill(json({
        provider: 'mercadopago', public_key: 'APP_USR-captura-public-key', card_enabled: true
      })));
      await page.route('**/customers/me/cards**', route => route.fulfill(json([{
        id: '11111111-1111-4111-8111-111111111111',
        provider_card_id: '1562188766181',
        brand: 'visa',
        last_four_digits: '2508',
        expiration_month: 12,
        expiration_year: 2030,
        created_at: '2026-08-25T12:00:00Z'
      }])));
      await page.addInitScript(() => {
        window.MercadoPago = class {
          constructor() {
            this.fields = {
              create: (tipo) => ({
                on(evento, callback) { this._[evento] = callback; return this; },
                _: {},
                mount(hostId) {
                  const input = document.createElement('input');
                  input.dataset.secureField = tipo;
                  input.setAttribute('aria-label', tipo);
                  document.getElementById(hostId)?.appendChild(input);
                  queueMicrotask(() => this._.ready?.({ field: tipo }));
                  return this;
                },
                unmount() {}
              }),
              createCardToken: async () => ({ id: 'tok_captura' })
            };
          }
        };
      });
    },
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'openModal', 'cartModal');
      await esperar(page, '#cartModal.active');
      await page.locator('#cartCtaBtn').click();
      await esperar(page, '#paymentMethodModal.active');
      await esperar(page, '.payment-saved-card');
      await page.locator('#paymentAddCard').click();
      await esperar(page, '#addCardTypeModal.active');
      await page.locator('#addCreditCardOption').click();
      await esperar(page, '#creditCardModal.active');
      await esperar(page, '[data-secure-field="cardNumber"]');
      await page.waitForTimeout(700);
    }
  },

  // --- Endereco: a folha de escolha (geo x manual) com uma opcao SELECIONADA,
  //     e o esqueleto de sugestoes que aparece enquanto o Places nao responde.
  {
    name: 'endereco-novo',
    async go(page) {
      await boot(page);
      await act(page, 'openAddressChoiceDirect');
      await esperar(page, '#addAddressModal.active');
      await act(page, 'selectAdcOption', 'manual');
      await esperar(page, '.adc-opt-card.selected');
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'endereco-sugestoes',
    async go(page) {
      await boot(page);
      await act(page, 'openAddrSearch');
      await esperar(page, '#addrSearchModal.active');
      await page.locator('#addrSearchInput').fill('Rua Silva Paulet');
      await esperar(page, '.addr-sug-skeleton');
      await page.waitForTimeout(300);
    }
  },

  // --- Operacao em ENTREGA: a lista de filiais, com cartao de endereco
  //     preenchido. Em retirada essa lista nao aparece.
  {
    name: 'operacao-entrega',
    setup: entregaConfirmada,
    async go(page) {
      await boot(page);
      await act(page, 'openOperationScreen');
      await esperar(page, '#operationModal.active');
      await act(page, 'setOperationType', 'delivery');
      await esperar(page, '#operationModal.active .op-branch-card');
      await page.waitForTimeout(600);
    }
  },
  // --- Primeira visita: nenhum contexto de operacao gravado. E o unico estado
  //     em que `.delivery-widget.pending-selection` existe (21 regras).
  {
    name: 'primeira-visita',
    setup: (page) => page.addInitScript(({ slug }) => {
      localStorage.removeItem(`rapidex.operationContext.${slug}`);
    }, { slug: SLUG }),
    async go(page) {
      await page.goto(BASE + RESTAURANT_URL);
      await page.waitForFunction(() => !document.body.classList.contains('app-booting'), null, { timeout: 30000 });
      await esperar(page, '.delivery-widget.pending-selection');
      await page.waitForTimeout(700);
    }
  },

  // --- Assistente respondendo: o balao do usuario, o do assistente, o trilho
  //     de produtos e os botoes de avaliacao. E o maior bloco de CSS que nunca
  //     tinha sido medido — 583 declaracoes `!important` so em assistant.css.
  {
    name: 'assistente-resposta',
    setup: comChat,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await esperar(page, '#assistantStarter.is-ready');
      await page.locator('#assistantInput').fill('Me recomenda uma bebida');
      await page.locator('.assistant-ai-send').click();
      await esperar(page, '.assistant-product-card');
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'assistente-detalhe-produto',
    setup: comChat,
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await esperar(page, '#assistantStarter.is-ready');
      await page.locator('#assistantInput').fill('Me recomenda uma bebida');
      await page.locator('.assistant-ai-send').click();
      await esperar(page, '.assistant-product-card');
      await page.locator('.assistant-product-card').first().click();
      await esperar(page, '#assistantProductDetail.is-open');
      await page.waitForTimeout(700);
    }
  },
  {
    // O modo voz e faturado por minuto, entao o transporte e trocado pelo
    // mesmo `setDriver` que os E2E usam: a tela abre, o microfone nao.
    name: 'assistente-voz',
    setup: logado,
    async go(page) {
      await boot(page);
      await page.evaluate(() => window.RapidexAssistantVoice.setDriver({
        start: () => {}, stop: () => {}, setMuted: () => {}
      }));
      await act(page, 'mobNavAssistant');
      await esperar(page, '#assistantStarter.is-ready');
      await page.locator('#mobViewAssistant .assistant-ai-send').click();
      await esperar(page, '#assistantVoice.is-open');
      await page.waitForTimeout(900);
    }
  },

  // --- A tela de erro do boot. Ela tem folha propria (`body.app-error`) e
  //     nunca foi aberta por medida nenhuma: a captura so sabia subir o app.
  {
    name: 'erro-de-boot',
    // QUEM DERRUBA O BOOT E O CARDAPIO, nao o /info: `loadInitialData()` so
    // aguarda `/menu`, e um 503 em `/info` passa batido (a tela de informacoes
    // carrega depois, sob demanda). Um 503 aqui e falha de rede, nao 404/410 —
    // e a diferenca importa: 404 vira "restaurante nao encontrado", que e OUTRO
    // desenho (`body.app-error--not-found`, sem botao de tentar de novo).
    setup: (page) => page.route(/\/menu(\?|$)/, route => route.fulfill(json({ detail: 'indisponivel' }, 503))),
    async go(page) {
      await page.goto(BASE + RESTAURANT_URL);
      await esperar(page, 'body.app-error', 30000);
      await page.waitForTimeout(500);
    }
  },

  // --- O OUTRO desenho do erro: slug que nao existe. `app-error--not-found`
  //     esconde o botao de tentar de novo, porque ali recarregar nao resolve.
  {
    name: 'erro-restaurante-inexistente',
    setup: (page) => page.route(/\/menu(\?|$)/, route => route.fulfill(json({ detail: 'nao encontrado' }, 404))),
    async go(page) {
      await page.goto(BASE + RESTAURANT_URL);
      await esperar(page, 'body.app-error--not-found', 30000);
      await page.waitForTimeout(500);
    }
  },

  // --- A landing. E a outra pagina do repositorio, e `landing.css` inteira
  //     nunca tinha sido medida por ninguem.
  {
    name: 'landing',
    async go(page) {
      await page.goto(BASE + '/index.html');
      await page.waitForLoadState('load');
      await page.waitForTimeout(700);
    }
  },

  // ── SEGUNDA RODADA ────────────────────────────────────────────────────────
  //  A primeira levou `sem-evidencia` de 1.628 para 865. O que sobrou nao era
  //  aleatorio: eram TELAS COM DADO (a lista de enderecos vazia nao desenha
  //  item nenhum), ESTADOS DE ESPERA (o assistente pensando) e VARIANTES DE
  //  ORIGEM (o login aberto pelo cupom nao e o login aberto pelo menu). Cada
  //  bloco abaixo ataca um desses.

  // --- O escolhedor de enderecos COM enderecos salvos. Vinte e cinco regras de
  //     operation.css desenham essa lista, e nenhuma tinha sido medida: a rota
  //     respondia `[]` e a tela abria vazia.
  {
    name: 'endereco-picker-com-enderecos',
    setup: async (page) => { await logado(page); await comEnderecos(page); },
    async go(page) {
      await boot(page);
      await act(page, 'openAddrPicker');
      await esperar(page, '#addrPickerModal.active .addr-picker-item');
      await page.waitForTimeout(600);
    }
  },
  // --- O mesmo item com as acoes abertas (o lixo deslizando por baixo).
  {
    name: 'endereco-picker-acoes',
    setup: async (page) => { await logado(page); await comEnderecos(page); },
    async go(page) {
      await boot(page);
      await act(page, 'openAddrPicker');
      await esperar(page, '#addrPickerModal.active .addr-picker-item');
      await page.waitForTimeout(600);
      await page.locator('.addr-picker-item .addr-picker-dots').first().click();
      await esperar(page, '.addr-picker-item.actions-open');
      await page.waitForTimeout(400);
    }
  },
  // --- Apagar o endereco QUE ESTA EM USO tem um dialogo proprio
  //     (`.addr-delete-confirm.is-active-warning`), diferente do apagar comum.
  {
    name: 'endereco-apagar-em-uso',
    // "EM USO" É O ENDEREÇO DO CONTEXTO DE OPERAÇÃO, e não o cartão destacado.
    // Este roteiro clicava num cartão e esperava o aviso — e funcionava
    // enquanto `requestAddrPickerDelete` também perguntava
    // "`_addrPickerSelected === id`". Esse ramo saiu em 79ab508 (ele acusava
    // "ativo" sobre um endereço que não era o ativo, e com o sentinela
    // `__current__` travava a exclusão de TODOS), e desde então esta tela
    // nunca mais foi medida: a espera estourava 15 s e a varredura seguia.
    //
    // O contexto de RETIRADA que `seedPickupSession` deixa não tem endereço
    // nenhum, então nenhum endereço pode estar em uso. Aqui ele é sobrescrito
    // por um de ENTREGA cujo endereço é o primeiro da lista de `comEnderecos` —
    // `sameAddress` casa por id.
    setup: async (page) => {
      await logado(page);
      await comEnderecos(page);
      await page.addInitScript(({ slug, branchId, endereco }) => {
        localStorage.setItem('rapidex.customerAddress', JSON.stringify(endereco));
        localStorage.setItem(
          `rapidex.operationContext.${slug}`,
          JSON.stringify({ order_type: 'delivery', branch_id: branchId, branch_label: 'Matriz', confirmed: true, address: endereco })
        );
      }, { slug: SLUG, branchId: BRANCH_MATRIZ, endereco: ENDERECO_ATIVO_DA_CAPTURA });
    },
    async go(page) {
      await boot(page);
      await act(page, 'openAddrPicker');
      await esperar(page, '#addrPickerModal.active .addr-picker-item');
      await page.waitForTimeout(600);
      // O lixo fica ESCONDIDO ate as acoes do item abrirem: existe no DOM desde
      // o primeiro render, mas so e clicavel com `actions-open`.
      const emUso = page.locator('.addr-picker-item').first();
      await emUso.locator('.addr-picker-dots').click();
      await esperar(page, '.addr-picker-item.actions-open');
      await emUso.locator('.addr-picker-delete').click();
      await esperar(page, '.addr-delete-confirm.is-active-warning');
      await page.waitForTimeout(400);
    }
  },

  // --- O assistente na ABERTURA, com os cartoes de sugestao revelados. O
  //     `assistente` original media 900 ms depois de abrir, e a intro ainda
  //     nao tinha terminado.
  {
    name: 'assistente-abertura',
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await esperar(page, '#assistantStarter.is-ready .assistant-starter-card');
      await page.waitForTimeout(900);
    }
  },
  // --- O trilho de OPCOES da resposta. `.assistant-suggest-chip` nao e o
  //     cartao da abertura (`.assistant-starter-card`): ele so nasce de uma
  //     resposta `response_type: "options"`, e nenhum fixture tinha uma.
  {
    name: 'assistente-opcoes',
    setup: (page) => page.route('**/chat', route => route.fulfill(json({
      response_type: 'options',
      message: 'Quer algo gelado ou quente?',
      options: ['Quero algo gelado', 'Prefiro quente', 'Tanto faz']
    }))),
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await esperar(page, '#assistantStarter.is-ready');
      await page.locator('#assistantInput').fill('Me ajuda a escolher');
      await page.locator('.assistant-ai-send').click();
      await esperar(page, '.assistant-suggest-chip');
      await page.waitForTimeout(900);
    }
  },
  // --- O assistente PENSANDO: o balao de digitacao, os pontos e as tres linhas
  //     de esqueleto. Sao ~20 regras que so existem enquanto a resposta nao
  //     chega, e a unica forma de medi-las e segurar a resposta.
  {
    name: 'assistente-pensando',
    setup: (page) => page.route('**/chat', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 30000));
      return route.fulfill(json({ response_type: 'text', message: 'Demorei.' }));
    }),
    async go(page) {
      await boot(page);
      await act(page, 'mobNavAssistant');
      await esperar(page, '#assistantStarter.is-ready');
      await page.locator('#assistantInput').fill('Me recomenda uma bebida');
      await page.locator('.assistant-ai-send').click();
      await esperar(page, '.assistant-chat-typing');
      /*
       * A FRASE DO BALAO DE ESPERA E SORTEADA.
       *
       * `Math.floor(Math.random() * ASSISTANT_TYPING_STATUSES.length)` escolhe
       * qual dos textos aparece, e cada texto tem uma largura. A captura
       * comparou duas builds e acusou 4 elementos com
       * `width: 118,391px -> 210,094px` — nada a ver com o CSS que mudou entre
       * elas: era "Pensando" contra uma frase mais longa.
       *
       * Duas rodadas seguidas tinham dado "Nenhuma diferenca", o que mostra o
       * tamanho da armadilha: um sorteio de N frases acerta o mesmo valor com
       * frequencia suficiente para parecer estavel, e so aparece no dia em que
       * ele decide a favor de um falso positivo — que e o dia em que alguem
       * esta usando a ferramenta para julgar um commit.
       *
       * O texto e fixado aqui, DEPOIS de a tela chegar ao estado: o sorteio
       * continua sendo o do app, e o que se mede e o desenho do balao.
       */
      await page.evaluate(() => {
        const rotulo = document.querySelector('#assistantTypingMessage .assistant-typing-label');
        if (!rotulo) return;
        rotulo.dataset.text = 'Pensando';
        rotulo.textContent = 'Pensando';
      });
      await page.waitForTimeout(900);
    }
  },

  // --- O cardapio na PRIMEIRA VISITA nao entra aqui, e o motivo vale escrito:
  //     ELE NAO EXISTE. Medido — tocar no cardapio com a operacao pendente
  //     abre a tela de operacao por cima e o body continua `home-tab`; fechar
  //     essa tela volta para a home. Nao ha caminho no app em que
  //     `body.menu-tab` e `.delivery-widget.pending-selection` valham ao mesmo
  //     tempo, e as ~10 regras de utilities.css que combinam os dois nao podem
  //     pintar nada. Ficam como candidatas a remocao, nao como tela.

  // --- A sacola FLUTUANTE. Ela nao aparece na home: `syncCartStickyForActiveView()`
  //     so a mostra com `body.menu-tab`, sem nenhuma mob-view aberta e com item
  //     na sacola. Nenhuma tela media isso — a sacola so aparecia ja ABERTA,
  //     por cima de tudo.
  {
    name: 'cardapio-com-sacola-flutuante',
    async go(page) {
      await boot(page);
      await addToCart(page);
      await act(page, 'mobNavMenu');
      await esperar(page, '.cart-sticky.show');
      await page.waitForTimeout(700);
    }
  },

  // --- Uma opcao ESCOLHIDA no produto: o radio marcado e o botao de expandir.
  {
    name: 'produto-opcao-escolhida',
    setup: comOpcoesDeProduto,
    async go(page) {
      await boot(page);
      await page.evaluate((id) => window.openProduct(id), PRODUCT_H2O);
      await esperar(page, '#productModal.active .pm-option-row');
      await page.locator('#productModal .pm-option-row').first().click();
      await esperar(page, '#productModal .pm-option-row.selected');
      await page.waitForTimeout(400);
    }
  },

  // --- Uma filial FECHADA e que nao entrega no endereco. O selo, o motivo e a
  //     tarja de erro sao cinco regras que so existem quando a resposta e nao.
  {
    name: 'operacao-filial-indisponivel',
    setup: async (page) => {
      await entregaConfirmada(page);
      await page.route(/\/branches\/availability(\?|$)/, route => route.fulfill(json({
        restaurant_slug: SLUG,
        address_provided: true,
        default_branch_id: MENU.branch_id,
        branches: MENU.branches.map(branch => ({
          ...branch,
          display_name: null,
          address: {
            street: branch.address, number: null, neighborhood: branch.neighborhood,
            city: branch.city, state: branch.state, zipcode: branch.zipcode,
            full_address: branch.full_address || [branch.address, branch.neighborhood, branch.city].filter(Boolean).join(' - ')
          },
          is_open_now: false,
          delivery: { delivers_to_address: false, reason: 'out_of_range', message: null, distance_km: 42, delivery_fee: null }
        }))
      })));
    },
    async go(page) {
      await boot(page);
      await act(page, 'openOperationScreen');
      await esperar(page, '#operationModal.active');
      await act(page, 'setOperationType', 'delivery');
      await esperar(page, '.op-branch-card.unavailable');
      await page.waitForTimeout(700);
    }
  },

  // --- O login aberto PELO CUPOM. `#loginModal.from-coupon` e
  //     `.signin-open` sao outra folha do mesmo modal: quem chega pelo cupom
  //     ve um cabecalho e uma barra de baixo diferentes de quem chega pelo menu.
  // --- O MESMO modal de entrar, em tres desenhos diferentes. `openLoginScreen`
  //     recebe a ORIGEM e marca o modal com ela (`from-coupon`,
  //     `from-add-address`), e `openSigninScreen()` acrescenta `signin-open`.
  //     Sao ~8 regras de utilities.css, e a tela `login` media so a origem
  //     padrao ('profile').
  {
    name: 'login-vindo-do-cupom',
    async go(page) {
      await boot(page);
      await act(page, 'openLoginScreen', 'coupon');
      await esperar(page, '#loginModal.active.from-coupon');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'login-vindo-do-endereco',
    async go(page) {
      await boot(page);
      await act(page, 'openLoginScreen', 'address');
      await esperar(page, '#loginModal.active.from-add-address');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'login-formulario-de-senha',
    async go(page) {
      await boot(page);
      await act(page, 'openLoginScreen', 'profile');
      await esperar(page, '#loginModal.active');
      await act(page, 'openSigninScreen');
      await esperar(page, '#loginModal.signin-open');
      await page.waitForTimeout(500);
    }
  },

  // --- Cardapio SEM foto de produto. `.product-image--placeholder` (as
  //     iniciais no lugar da imagem) e o que o cliente ve quando o lojista nao
  //     subiu foto — o caso comum num cadastro novo, e nenhuma medida o via:
  //     no fixture os 136 produtos tem imagem.
  {
    name: 'cardapio-sem-fotos',
    setup: (page) => page.route(/\/menu(\?|$)/, route => {
      const menu = JSON.parse(JSON.stringify(MENU));
      for (const produto of menu.products) { produto.image_url = null; produto.image_path = null; }
      return route.fulfill(json(menu));
    }),
    async go(page) {
      await boot(page);
      await act(page, 'mobNavMenu');
      await esperar(page, '.product-image--placeholder');
      await page.waitForTimeout(700);
    }
  },

  // ── A TELA DO ENTREGADOR (terceira pagina, 02/09/2026) ────────────────────
  //  `styles/courier.css` nasceu inteira sem medida nenhuma, que e exatamente
  //  a condicao em que `landing.css` e `assistant.css` acumularam regra morta
  //  por meses. Entram aqui as tres telas dela.
  //
  //  Preparo PROPRIO, e por isso o `setup`: esta pagina nao fala com nenhuma
  //  rota do app do cliente, e o mock dele responde 404 para /courier/*. A rota
  //  registrada aqui roda DEPOIS de `mockApi()` e por isso vence (no Playwright
  //  a ultima registrada ganha) — a mesma regra do `seedOnlineCardBranch`.
  //
  //  O codigo de 6 digitos e a SEGUNDA credencial: sem ele a tela nao passa da
  //  porta, entao as duas telas de dentro precisam digita-lo.
  {
    name: "entregador-porta",
    setup: (page) => mockEntregador(page),
    async go(page) {
      await page.goto(BASE + "/entregador/" + TOKEN_ENTREGADOR);
      await esperar(page, "#courierGate:not([hidden])");
      await page.waitForTimeout(400);
    }
  },
  {
    name: "entregador-lista",
    setup: (page) => mockEntregador(page),
    async go(page) {
      await page.goto(BASE + "/entregador/" + TOKEN_ENTREGADOR);
      await esperar(page, "#courierGate:not([hidden])");
      await page.locator("#courierCodeInput").fill(CODIGO_ENTREGADOR);
      await page.locator("#courierGateSubmit").click();
      await esperar(page, ".cr-card");
      await page.waitForTimeout(400);
    }
  },
  {
    name: "entregador-acerto",
    setup: (page) => mockEntregador(page),
    async go(page) {
      await page.goto(BASE + "/entregador/" + TOKEN_ENTREGADOR);
      await esperar(page, "#courierGate:not([hidden])");
      await page.locator("#courierCodeInput").fill(CODIGO_ENTREGADOR);
      await page.locator("#courierGateSubmit").click();
      await esperar(page, ".cr-card");
      // A ABA, e não um botão de cabeçalho: `#courierHistoryBtn` não existe em
      // lugar nenhum do repositório — nem no HTML, nem no JS, nem no CSS. Esta
      // tela ficou meses SEM SER MEDIDA por causa disso, e a varredura seguia
      // em frente dizendo "FALHOU" numa linha que rola para fora da tela.
      await page.locator('#courierTabs [data-aba="acerto"]').click();
      await esperar(page, ".cr-entrega");
      await page.waitForTimeout(400);
    }
  }
];

/**
 * Duas fontes de RUIDO que a primeira rodada da ferramenta encontrou sozinha —
 * capturei duas vezes o MESMO codigo e deu diferenca em duas telas:
 *
 *   assistente: os dois <path> de vapor da marca tem animacao CSS em curso, e
 *   `opacity` lida no meio dela vale um numero diferente a cada captura
 *   (0,791926 contra 0,884243).
 *
 *   endereco-busca: o campo de busca recebe foco, e o fundo dele muda com
 *   :focus — entao o valor dependia de o foco ter chegado ou nao. Esta segunda
 *   voltou depois (o foco e agendado dentro de um `.finally()` de rede, e nem
 *   sempre chegava antes do blur): a correcao esta em `estabilizar()`.
 *
 * Uma ferramenta que acusa diferenca sem que nada tenha mudado e pior que
 * nenhuma: em duas semanas todo mundo ignora a saida dela. Entao, antes de ler:
 * anima e transicao desligadas (o que congela cada elemento no estado FINAL,
 * que e o que interessa), e o foco tirado de qualquer campo.
 */
async function estabilizar(page) {
  /*
   * O CARROSSEL DO CABECALHO ANDA SOZINHO, e nao e transicao — e um
   * `setInterval` que reescreve `transform` no elemento e troca a classe
   * `active` de um ponto para o outro. Congelar transicao e animacao pelo
   * CSSOM (abaixo) nao alcanca nada disso.
   *
   * O sintoma foi este, capturando a MESMA build duas vezes: as telas do
   * assistente acusaram 3 elementos diferentes —
   * `transform: matrix(...,-780,0) -> matrix(...,-390,0)` no trilho, mais os
   * dois pontos trocando de largura entre 6px e 20px. Nao era o assistente:
   * eram as telas que demoram mais para chegar ao estado, e por isso pegam o
   * carrossel um passo adiante. Numa ferramenta cujo trabalho e provar que
   * nada mudou, 3 elementos de ruido sao 3 elementos que a proxima pessoa
   * aprende a ignorar.
   *
   * Duas medidas, nesta ordem: leva o carrossel a um slide CONHECIDO (pelo
   * registro de acoes, que e como o markup o chama), e so entao para todo
   * temporizador da pagina. O `clearInterval` cego e grosseiro de proposito —
   * neste ponto a tela ja esta no estado final e ninguem mais precisa correr,
   * e ele apanha de uma vez a contagem regressiva do Pix e o que mais vier.
   */
  await page.evaluate(() => {
    window.RapidexActions?.resolve?.('setHeroBanner')?.(0);
    const ultimo = setInterval(() => {}, 1 << 30);
    for (let id = 1; id <= ultimo; id++) clearInterval(id);
  });

  // PRIMEIRA CAMADA, e a que resolve: apagar `transition` e `animation` das
  // REGRAS, pelo CSSOM, em vez de tentar sobrepo-las com outra regra.
  //
  // A tentativa anterior era um `*{transition:none!important}` injetado, e ela
  // perde por especificidade: o app declara transicao com `!important` sob
  // classe e sob id (`.addr-search-field{transition:border-color .15s!important}`,
  // `#mobViewAssistant .assistant-ai-input-bar{...!important}`), e `!important`
  // contra `!important` quem decide e a especificidade — 0,0,1,0 ganha de
  // 0,0,0,0. Apagando a declaracao da propria regra nao ha disputa: nao existe
  // mais transicao nenhuma para correr, e todo valor lido e o estado FINAL.
  //
  // Sem isto, o ruido aparecia como cor a um passo do destino:
  // `borderTopColor: rgb(204,204,204) -> rgb(205,206,207)` no mesmo codigo.
  await page.evaluate(() => {
    const limpar = (regras) => {
      for (const regra of regras) {
        if (regra.style) { regra.style.removeProperty('transition'); regra.style.removeProperty('animation'); }
        if (regra.cssRules) limpar(regra.cssRules);   // @media
      }
    };
    for (const folha of document.styleSheets) {
      try { limpar(folha.cssRules); } catch { /* folha de outra origem: nao ha o que congelar nela */ }
    }
  });

  // Cinto e suspensorio: pega `style="transition:..."` inline e as animacoes
  // declaradas em regras que por algum motivo o laco acima nao alcance.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}'
  });

  /*
   * A FONTE PRECISA TER CHEGADO ANTES DE MEDIR LARGURA.
   *
   * Capturando a mesma build duas vezes, a home acusou 104 elementos
   * diferentes — todos por fracao de pixel na largura de texto
   * (`63,4375px -> 64,6094px`). Nao ha regra nenhuma decidindo isso: e a
   * primeira leitura tendo pegado a fonte de fallback e a segunda a fonte
   * carregada. Como a lista de propriedades tem `width`, `height` e
   * `lineHeight`, uma troca de fonte no meio da captura contamina todo
   * elemento com texto dentro.
   *
   * `document.fonts.ready` resolve na hora quando ja carregou, entao isto nao
   * custa nada nas telas em que a corrida nao existe.
   */
  await page.evaluate(() => document.fonts.ready);

  // Deixa o layout assentar depois de tudo isso.
  await page.waitForTimeout(400);
}

/**
 * Lê o documento inteiro. Este corpo roda dentro do browser.
 *
 * O BLUR MORA AQUI, e nao em estabilizar(), de proposito.
 *
 * O foco desta suite nao chega junto com a tela: em
 * `restaurant-address-flow.js:716` ele e agendado num `setTimeout(200)`
 * pendurado no `.finally()` de uma promessa de REDE. A hora em que ele pousa
 * depende de o mock responder, entao um blur dado num `page.evaluate()` e a
 * leitura dada em OUTRO deixam uma fresta entre os dois turnos por onde esse
 * foco atrasado entra — e `.addr-search-field:focus-within` troca a borda e o
 * fundo. Era 1 elemento diferente em `endereco-busca` comparando a MESMA build
 * consigo mesma, intermitente. E o custo disso nao e o falso alarme de hoje: e
 * a rodada de amanha, em que alguem ve "1 elemento diferente" e assume que e o
 * de sempre.
 *
 * Desfocar e ler no MESMO turno fecha a fresta: JS de pagina e uma thread so,
 * nenhum timer roda no meio desta funcao. E como estabilizar() ja apagou as
 * transicoes das regras, o blur vale na hora, sem estado intermediario.
 */
function readDocument(props) {
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && typeof ativo.blur === 'function') ativo.blur();

  const path = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) { parts.unshift(node.tagName.toLowerCase()); break; }
      const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      parts.unshift(node.tagName.toLowerCase() + (sameTag.length > 1 ? '[' + sameTag.indexOf(node) + ']' : ''));
    }
    return parts.join('>');
  };
  /*
   * O QUE NAO DESENHA FICA DE FORA.
   *
   * `<script>`, `<link>` e afins nao pintam pixel nenhum, e um deles entrando
   * na conta so produz ruido: o loader do Google Maps e injetado no <head> por
   * JS, e a tela de sugestoes de endereco acusou "sumiu html>head>script[8]"
   * comparando a mesma build consigo mesma — o script tinha chegado numa
   * rodada e nao na outra. Uma diferenca que nao pode virar pixel nao e
   * assunto de uma ferramenta que mede pixel.
   */
  const INVISIVEIS = new Set(['SCRIPT', 'LINK', 'META', 'STYLE', 'TITLE', 'HEAD', 'BASE', 'NOSCRIPT']);

  return Array.from(document.querySelectorAll('*')).filter((el) => !INVISIVEIS.has(el.tagName)).map((el) => {
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of props) style[p] = cs[p];
    return {
      path: path(el),
      id: el.id || '',
      // A classe entra porque uma classe a mais que não muda nada hoje muda
      // tudo no dia em que alguém escrever a regra dela.
      cls: el.getAttribute('class') || '',
      style
    };
  });
}

/**
 * O preparo comum + o preparo DA TELA, num lugar so.
 *
 * As tres ferramentas que abrem estas telas (esta, css-usage e css-important)
 * repetiam `mockApi()` e `seedPickupSession()` cada uma no seu laco. Enquanto
 * toda tela nascia do mesmo preparo isso era so repeticao; a partir do momento
 * em que uma tela precisa de token, de uma rota sobreposta ou de outro contexto
 * de operacao, repeticao vira DIVERGENCIA — a mesma tela medida de um jeito
 * aqui e de outro la, e duas respostas diferentes para a mesma pergunta.
 */
export async function prepararTela(page, screen) {
  await mockApi(page);
  await seedPickupSession(page);
  if (screen.setup) await screen.setup(page);
}

/**
 * TELA QUE NÃO ABRE TEM DE SER BARULHENTA — e por meses não foi.
 *
 * O laço já registrava o erro e imprimia "FALHOU", mas a linha rolava para fora
 * da tela no meio de outras 61 e o fim da execução dizia só "escrito: x.json".
 * Duas telas ficaram assim: `entregador-acerto` clicando um id que não existe
 * mais em lugar nenhum do repositório, e `endereco-apagar-em-uso` esperando um
 * estado que a correção de 79ab508 tornou inalcançável por aquele gesto.
 *
 * Num verificador cujo trabalho é assinar embaixo de "nada mudou", uma tela que
 * não foi medida é PIOR que uma tela diferente: a diferente aparece. Agora o
 * resumo nomeia as que falharam e o processo SAI COM 1.
 */
async function capture(out, filtro) {
  const browser = await chromium.launch();
  const result = {};
  const falhas = [];
  const alvo = filtro ? SCREENS.filter(t => t.name.includes(filtro)) : SCREENS;
  if (!alvo.length) {
    console.log('nenhuma tela casa com "' + filtro + '"');
    await browser.close();
    process.exit(1);
  }
  for (const screen of alvo) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await prepararTela(page, screen);
    try {
      await screen.go(page);
      // Deixa a animação de entrada terminar: transform a meio caminho não é
      // um estado, é um instante, e comparar instantes dá diferença todo dia.
      await page.waitForTimeout(900);
      await estabilizar(page);
      result[screen.name] = await page.evaluate(readDocument, PROPS);
      process.stdout.write('  ' + screen.name + ': ' + result[screen.name].length + ' elementos\n');
    } catch (error) {
      result[screen.name] = { erro: String((error && error.message) || error) };
      falhas.push(screen.name);
      process.stdout.write('  ' + screen.name + ': FALHOU - ' + error.message + '\n');
    }
    await context.close();
  }
  await browser.close();
  writeFileSync(out, JSON.stringify(result, null, 1));
  const resumo = () => {
    console.log(alvo.length - falhas.length + ' de ' + alvo.length + ' telas medidas.');
    if (!falhas.length) return;
    console.log('');
    console.log(falhas.length + ' TELA(S) NÃO ABRIRAM — ninguém está conferindo estas:');
    falhas.forEach(nome => console.log('  ' + nome));
  };
  console.log('\nescrito: ' + out);
  resumo();
  if (falhas.length) process.exit(1);
}

function diff(a, b) {
  const A = JSON.parse(readFileSync(a, 'utf8'));
  const B = JSON.parse(readFileSync(b, 'utf8'));
  let problemas = 0;
  const naoComparadas = [];
  // UMA TELA A MENOS NÃO É UMA TELA IGUAL, e as duas metades são contadas à
  // parte: um número que soma "esta mudou" com "esta eu não medi" não responde
  // nenhuma das duas perguntas. O laço percorre as chaves de A, então tela que
  // só existe em B sumia da conta inteira.
  for (const name of Object.keys(B)) {
    if (!(name in A)) naoComparadas.push(name + ' (só existe na captura DEPOIS)');
  }
  for (const name of Object.keys(A)) {
    const before = A[name];
    const after = B[name];
    if (!(name in B)) { naoComparadas.push(name + ' (só existe na captura ANTES)'); continue; }
    if (!Array.isArray(before) || !Array.isArray(after)) {
      console.log(name + ': NÃO PUDE COMPARAR - ' + ((before && before.erro) || (after && after.erro)));
      naoComparadas.push(name);
      continue;
    }
    /*
     * A CHAVE E `caminho|id`, E A CLASSE E COMPARADA A PARTE.
     *
     * Ela ja foi `caminho|id|classe`, e a ideia era boa: uma classe a mais que
     * nao muda nada hoje muda tudo no dia em que alguem escrever a regra dela.
     * So que, com a classe DENTRO da chave, trocar uma classe de nome faz o
     * elemento sumir de um lado e nascer do outro — e a comparacao de estilo
     * dele, que e o que a ferramenta existe para fazer, nunca acontece. Num
     * commit que introduz classes de componente, isso e exatamente o elemento
     * que se precisa conferir, e era o unico que escapava.
     *
     * Agora a classe continua sendo relatada (linha `classe:`), mas separada da
     * conta de estilo: da para ler "17 elementos trocaram de classe, 0 mudaram
     * de valor computado", que e a frase que um commit de componentizacao
     * precisa dizer. Uma mudanca de classe nao conta como problema; uma
     * mudanca de VALOR conta.
     */
    const index = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.path + '|' + r.id, r);
      return m;
    };
    const mb = index(before);
    const ma = index(after);
    let mudou = 0, classesTrocadas = 0;
    const exemplos = [];
    for (const [key, antes] of mb) {
      const depois = ma.get(key);
      if (!depois) {
        mudou++;
        if (exemplos.length < 6) exemplos.push('sumiu  ' + key + ' [' + antes.cls + ']');
        continue;
      }
      if (antes.cls !== depois.cls) {
        classesTrocadas++;
        if (exemplos.length < 6) exemplos.push('classe: ' + key + '\n         "' + antes.cls + '" -> "' + depois.cls + '"');
      }
      for (const p of PROPS) {
        if (antes.style[p] !== depois.style[p]) {
          mudou++;
          if (exemplos.length < 6) exemplos.push(key + '\n         ' + p + ': ' + antes.style[p] + ' -> ' + depois.style[p]);
          break;
        }
      }
    }
    for (const [key, depois] of ma) {
      if (!mb.has(key)) {
        mudou++;
        if (exemplos.length < 6) exemplos.push('novo   ' + key + ' [' + depois.cls + ']');
      }
    }
    const sufixo = classesTrocadas ? ' (' + classesTrocadas + ' com classe trocada)' : '';
    if (mudou) {
      problemas++;
      console.log(name + ': ' + mudou + ' elementos diferentes (de ' + before.length + ')' + sufixo);
      exemplos.forEach(e => console.log('    ' + e));
    } else {
      console.log(name + ': identico (' + before.length + ' elementos)' + sufixo);
      if (classesTrocadas) exemplos.forEach(e => console.log('    ' + e));
    }
  }
  console.log(problemas ? '\n' + problemas + ' tela(s) com diferenca.' : '\nNenhuma diferenca.');
  if (naoComparadas.length) {
    console.log('');
    console.log(naoComparadas.length + ' TELA(S) NÃO PUDERAM SER COMPARADAS — a linha acima NÃO fala delas:');
    naoComparadas.forEach(nome => console.log('  ' + nome));
  }
  process.exit(problemas || naoComparadas.length ? 1 : 0);
}

// SCREENS e exportado, entao este arquivo tambem e IMPORTADO (por
// tools/css-usage.mjs, que reusa a lista de telas). Sem esta guarda, importar
// a lista dispararia uma captura inteira de 14 telas como efeito colateral.
if (process.argv[1] && process.argv[1].endsWith('capture-screens.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === '--diff') diff(args[1], args[2]);
  else {
    // `--so <parte-do-nome>` mede um subconjunto. Serve para consertar UMA tela
    // sem esperar as 62 — e NÃO serve para produzir linha de base: um arquivo
    // parcial comparado com um inteiro cai em "não pude comparar", que é o
    // desfecho certo.
    const i = args.indexOf('--so');
    const filtro = i >= 0 ? args[i + 1] : null;
    // SEM `--so`, `i` é -1 e `i + 1` é 0 — e um filtro ingênuo comeria o
    // primeiro argumento, que é o arquivo de saída. Era assim que uma captura
    // inteira ia parar em `captura.json` na RAIZ do repositório em vez do
    // caminho pedido, e arquivo de ferramenta na raiz já custou 426 regras
    // "vivas" uma vez (armadilha 2 da §5.1).
    const restante = i >= 0 ? args.filter((a, n) => n !== i && n !== i + 1) : args;
    const saida = restante[0] || 'captura.json';
    await capture(saida, filtro);
  }
}
