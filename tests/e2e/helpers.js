import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readFixture = (name) =>
  JSON.parse(readFileSync(resolve(here, '..', 'fixtures', name), 'utf8'));

// ============================================================================
//  O MOCK RECUSA COMO O BACKEND RECUSA — corpo conferido contra o OpenAPI.
//
//  "Um mock que só aceita é um teste que só concorda" (skill §4). Esta é a
//  aplicação geral dessa regra, e ela nasceu de um defeito que passou por TODOS
//  os portões: `addressApiPayload()` mandava `postal_code`, `place_id` e
//  `alias` para `POST /customers/me/addresses`, cujo esquema é
//  `additionalProperties: false` — três nomes fora do contrato viram 422 na
//  requisição inteira, e nenhum cliente logado conseguia salvar endereço.
//  Ninguém pegou porque nenhum teste salvava endereço, e porque um mock que
//  responde 200 a qualquer corpo não tem opinião sobre o corpo.
//
//  ## A tabela vem do CONTRATO, não de uma lista escrita aqui
//
//  Uma lista de campos à mão neste arquivo seria a segunda cópia do contrato, e
//  ela divergiria — provavelmente na direção do que o código manda hoje, que é
//  exatamente o defeito que se quer pegar. `ESQUEMAS_DE_CORPO` é montada
//  percorrendo `paths` do `openapi.json`: todo caminho+método que declara um
//  corpo com `$ref` entra, e rota nova entra sozinha.
//
//  ## O que ele confere, e o que NÃO confere
//
//  Confere as duas coisas que um modelo `extra=forbid` do FastAPI recusa e que
//  um mock permissivo esconde: **campo desconhecido** e **obrigatório
//  ausente**. Um nível de aninhamento também (o `address` de
//  `DeliveryEstimateRequest` é um `DeliveryAddressInput`, e ele TAMBÉM é
//  fechado).
//
//  NÃO confere tipo, formato nem faixa. Isso é de propósito: reimplementar o
//  Pydantic aqui seria a terceira cópia do contrato, e o que custou dinheiro
//  neste repositório foi sempre o NOME do campo, não o tipo dele.
// ============================================================================
const SPEC_API = JSON.parse(
  readFileSync(resolve(here, '..', '..', 'scripts', 'types', 'openapi.json'), 'utf8')
);

const ESQUEMAS_DE_CORPO = Object.entries(SPEC_API.paths || {}).flatMap(([caminho, operacoes]) =>
  Object.entries(operacoes || {})
    .map(([metodo, operacao]) => {
      // O corpo pode vir por $ref DIRETO ou dentro de um anyOf — e o segundo
      // caso e o do corpo OPCIONAL, que o FastAPI gera como
      // `anyOf: [{$ref}, {type: null}]`. Duas rotas do contrato sao assim (a
      // cobranca do pedido e o cancelamento pelo cliente), e ler so o $ref
      // direto as deixava de fora da conferencia sem dizer nada.
      const esquemaDoCorpo = operacao?.requestBody?.content?.['application/json']?.schema;
      const nomeDoEsquema = refsDe(esquemaDoCorpo)[0];
      if (!nomeDoEsquema) return null;
      return {
        metodo: metodo.toUpperCase(),
        // `{restaurant_slug}` -> `[^/]+`. A âncora no fim impede que
        // `/coupons/preview` case com o caminho de `/coupons`.
        regex: new RegExp(`^${caminho.replace(/\{[^}]+\}/g, '[^/]+')}$`),
        esquema: nomeDoEsquema
      };
    })
    .filter(Boolean)
);

/** Os `$ref` de um sub-esquema, direto ou dentro de `anyOf`/`allOf`. */
function refsDe(sub) {
  if (!sub) return [];
  if (sub.$ref) return [sub.$ref.split('/').pop()];
  return [...(sub.anyOf || []), ...(sub.allOf || []), ...(sub.oneOf || [])]
    .flatMap(refsDe);
}

function violacoesDoCorpo(corpo, nomeDoEsquema, caminhoDoCampo = 'body') {
  const esquema = SPEC_API.components?.schemas?.[nomeDoEsquema];
  if (!esquema?.properties || corpo == null || typeof corpo !== 'object') return [];
  const erros = [];
  const permitidos = Object.keys(esquema.properties);

  if (esquema.additionalProperties === false) {
    for (const chave of Object.keys(corpo)) {
      if (!permitidos.includes(chave)) {
        erros.push(`${caminhoDoCampo}.${chave}: campo fora do contrato (${nomeDoEsquema} é additionalProperties:false)`);
      }
    }
  }
  for (const chave of esquema.required || []) {
    if (corpo[chave] === undefined || corpo[chave] === null) {
      erros.push(`${caminhoDoCampo}.${chave}: obrigatório ausente (${nomeDoEsquema})`);
    }
  }
  // Um nível de aninhamento: o objeto de endereço dentro do estimate/availability.
  for (const [chave, valor] of Object.entries(corpo)) {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) continue;
    for (const aninhado of refsDe(esquema.properties[chave])) {
      erros.push(...violacoesDoCorpo(valor, aninhado, `${caminhoDoCampo}.${chave}`));
    }
  }
  return erros;
}

/**
 * Devolve a lista de violações do corpo desta requisição, ou `[]`.
 *
 * EXPORTADA para os specs que registram rota própria: uma rota própria vence o
 * `mockApi()` (a última registrada ganha), e com ela o corpo deixaria de ser
 * conferido. Reusar esta função é o que impede que cada spec escreva a SUA
 * cópia da regra do contrato — que divergiria na direção do que o código manda
 * hoje, que é justamente o que se quer pegar.
 */
export function violacoesDaRequisicao(metodo, caminho, textoDoCorpo) {
  const alvo = ESQUEMAS_DE_CORPO.find(item => item.metodo === metodo && item.regex.test(caminho));
  if (!alvo) return [];
  let corpo;
  try { corpo = JSON.parse(textoDoCorpo || 'null'); } catch { return []; }
  if (corpo == null) return [];
  return violacoesDoCorpo(corpo, alvo.esquema);
}

export const MENU = readFixture('menu.json');
export const INFO = readFixture('info.json');
/**
 * Os cupons do cliente (GET /restaurants/{slug}/coupons), nos TRÊS estados que
 * o contrato tem — `applicable`, `missing_amount` e `login_required`.
 *
 * Antes deste fixture a rota devolvia `{coupons: []}` e nenhum e2e chegava a
 * desenhar um card. Foi por essa fresta que passaram, juntos: a rota morta, o
 * filtro `eligible`, o rótulo "0% OFF", a tarja fixa e o botão que dizia
 * "Usar cupom" nos três casos.
 *
 * Os tipos são os de produção, e isso é parte do teste: `min_order_value`,
 * `discount_amount` e `missing_amount` chegam como STRING decimal.
 */
export const COUPONS = readFixture('coupons.json');

/**
 * O histórico de pedidos do cliente (GET /customers/me/orders), com os nomes
 * DO CONTRATO — CustomerOrderHistoryItem / OrderItemResponse do api.d.ts.
 *
 * Antes deste fixture a rota respondia 401 (aqui) ou `[]` (na captura), e a
 * suíte inteira nunca DESENHOU um pedido — a mesma fresta do cupom vazio.
 * Os nomes são parte do teste: `product_name_snapshot`, `unit_price_snapshot`
 * (que JÁ inclui os adicionais), `option_groups[].options[].option_name_snapshot`,
 * e os descontos como STRING decimal. Um pedido tem `product_id: null`
 * (produto que saiu do cardápio) de propósito.
 */
export const ORDERS = readFixture('orders.json');

/** CurrentCustomerResponse de /customers/me — a conta é do Rapidex, global. */
export const CUSTOMER = {
  id: 'c0ffee00-0000-4000-8000-000000000001',
  name: 'Cliente E2E',
  phone: '85999990000',
  email: 'cliente.e2e@exemplo.com',
  email_verified: true,
  birth_date: '1990-04-12',
  marketing_opt_in: false
};

/**
 * OrderDetailResponse (GET /customers/me/orders/{id}) montado a partir de um
 * item do histórico. O detalhe NÃO tem `branch_name`/`restaurant_name` — quem
 * mostra esses dois é o item da lista, e o app mescla os dois lados. O endereço
 * vem FLAT (`address_street`...), que é a única forma que o contrato conhece.
 */
export function orderDetail(order, overrides = {}) {
  const base = { ...order };
  delete base.branch_name;
  delete base.restaurant_name;
  return {
    ...base,
    branch_id: BRANCH_MATRIZ,
    restaurant_id: 'aaaa0000-0000-4000-8000-000000000001',
    customer_id: CUSTOMER.id,
    customer_name_snapshot: CUSTOMER.name,
    customer_phone_snapshot: CUSTOMER.phone,
    customer_address_id: order.order_type === 'delivery' ? 'addre550-0000-4000-8000-000000000001' : null,
    payment_status: order.status === 'pending' ? 'pending' : 'not_required',
    payment_flow: 'delivery',
    payment_method: 'cash',
    address_street: order.order_type === 'delivery' ? 'Rua Silva Paulet' : null,
    address_number: order.order_type === 'delivery' ? '450' : null,
    address_neighborhood: order.order_type === 'delivery' ? 'Aldeota' : null,
    address_city: order.order_type === 'delivery' ? 'Fortaleza' : null,
    address_state: order.order_type === 'delivery' ? 'CE' : null,
    address_zipcode: order.order_type === 'delivery' ? '60120-020' : null,
    notes: null,
    updated_at: order.created_at,
    status_history: [
      { id: '57a70000-0000-4000-8000-000000000001', status: order.status, created_at: order.created_at, changed_by: null, note: null }
    ],
    ...overrides
  };
}

export const SLUG = 'junior-da-picanha';
export const BRANCH_MATRIZ = '4b054122-ee72-424c-817c-110f02c6b994';
export const BRANCH_VARJOTA = '81b11c6b-8f9c-4a45-9a7f-fc25e781dfc6';
export const PRODUCT_H2O = '80f16645-1d6b-4fca-b9e4-dd838e4134d2';
export const RESTAURANT_URL = `/restaurant.html?slug=${SLUG}`;

/**
 * O `/menu` de UMA filial.
 *
 * Desde 20/08/2026 o `branch_id` da raiz diz de qual loja é a resposta inteira
 * — produtos, categorias e `settings`. O fixture tem um cardápio só, então aqui
 * a diferença entre as filiais é o carimbo: é ele que o app compara para saber
 * se a tela está mostrando a loja escolhida. Quem precisa de produtos
 * diferentes por loja sobrescreve a rota no próprio spec.
 */
export function menuForBranch(branchId) {
  const id = branchId || MENU.branch_id;
  return { ...MENU, branch_id: id, settings_branch_id: id };
}

function json(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * Intercept every API call so the app never reaches the network. GET endpoints
 * return fixtures; the order endpoints are delegated to per-test handlers so
 * each test decides how they behave (success, failure, counting).
 *
 * @param {object} [handlers]
 * @param {Function} [handlers.onCreateOrder]  POST /restaurants/{slug}/orders
 * @param {Function} [handlers.onStartPayment] POST /orders/{token}/payment
 * @param {Function} [handlers.onTrackOrder]   GET  /orders/track/{token}
 * @param {Function} [handlers.orderResponse]  body of the default created order
 * @param {Function} [handlers.onListCoupons]   GET  /restaurants/{slug}/coupons
 * @param {Function} [handlers.onPreviewCoupon] POST /restaurants/{slug}/coupons/preview
 *
 * Returns live arrays of every order/payment/tracking call seen, so a test can
 * assert BOTH what was sent and how many times. `paymentRequests` and
 * `trackRequests` are what pin the Pix flow: a charge is created once, and the
 * polling stops when it stops. `couponListRequests` e `couponPreviewRequests`
 * fazem o mesmo pelo cupom: qual contexto de sacola foi enviado, e quantas
 * vezes — um cupom validado duas vezes é uma requisição a mais por toque.
 */
export async function mockApi(page, {
  onCreateOrder,
  onStartPayment,
  onTrackOrder,
  orderResponse,
  onListCoupons,
  onPreviewCoupon
} = {}) {
  const orderRequests = [];
  const paymentRequests = [];
  const trackRequests = [];
  const couponListRequests = [];
  const couponPreviewRequests = [];
  const rotasDesconhecidas = [];

  await page.route('**/api.pederapidex.com/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    // O CORPO E CONFERIDO ANTES DE QUALQUER ROTA. Um mock que responde 200 a
    // qualquer corpo nao tem opiniao sobre o corpo — e foi assim que um payload
    // com tres nomes fora do contrato passou por todos os portoes. Ver o
    // cabecalho de ESQUEMAS_DE_CORPO.
    const violacoes = violacoesDaRequisicao(method, new URL(url).pathname, request.postData());
    if (violacoes.length) {
      return route.fulfill(json({
        detail: violacoes.map(mensagem => ({ msg: mensagem, type: 'contrato' }))
      }, 422));
    }

    // POST /restaurants/{slug}/orders/{tracking_token}/payment
    if (method === 'POST' && /\/orders\/[^/]+\/payment(\?|$)/.test(url)) {
      paymentRequests.push({ url, token: url.match(/\/orders\/([^/]+)\/payment/)?.[1] });
      if (onStartPayment) return onStartPayment(route, request, paymentRequests.length);
      return route.fulfill(json(pixCharge()));
    }

    // GET /restaurants/{slug}/orders/track/{tracking_token}
    if (method === 'GET' && /\/orders\/track\//.test(url)) {
      trackRequests.push({ url, token: url.split('/orders/track/')[1] });
      if (onTrackOrder) return onTrackOrder(route, request, trackRequests.length);
      return route.fulfill(json(trackedOrder({ payment_status: 'pending' })));
    }

    if (method === 'POST' && /\/orders(\?|$)/.test(url)) {
      orderRequests.push({
        idempotencyKey: request.headers()['idempotency-key'] || null,
        body: JSON.parse(request.postData() || '{}')
      });
      if (onCreateOrder) return onCreateOrder(route, request, orderRequests.length);
      const body = orderResponse
        ? orderResponse(orderRequests.length)
        : successOrder(orderRequests.length);
      return route.fulfill(json(body));
    }

    // A rota pública por telefone NÃO EXISTE MAIS. Se o app voltar a chamá-la,
    // o teste precisa quebrar aqui em vez de receber um 200 benigno lá embaixo.
    if (/\/orders\/[^/]+\?.*phone=/.test(url)) {
      return route.fulfill(json({ detail: 'rota removida' }, 410));
    }

    if (method === 'POST' && /\/branches\/availability(\?|$)/.test(url)) {
      const requestBody = JSON.parse(request.postData() || '{}');
      const addressProvided = Boolean(requestBody.address || requestBody.address_id);
      return route.fulfill(json({
        restaurant_slug: SLUG,
        address_provided: addressProvided,
        default_branch_id: MENU.branch_id,
        branches: MENU.branches.map(branch => ({
          ...branch,
          display_name: null,
          address: {
            street: branch.address,
            number: null,
            neighborhood: branch.neighborhood,
            city: branch.city,
            state: branch.state,
            zipcode: branch.zipcode,
            full_address: branch.full_address
              || [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(' - ')
          },
          is_open_now: branch.is_open !== false,
          delivery: addressProvided
            ? { delivers_to_address: true, reason: null, message: null, distance_km: 3, delivery_fee: 5 }
            : null
        }))
      }));
    }

    // O cardápio é da FILIAL. Filial que não é deste restaurante responde 404
    // — e o app precisa distinguir esse 404 do "restaurante não existe", senão
    // um branch_id velho no localStorage vira tela de erro permanente.
    if (/\/menu(\?|$)/.test(url)) {
      const branchId = new URL(url).searchParams.get('branch_id');
      if (branchId && !MENU.branches.some(branch => branch.id === branchId)) {
        return route.fulfill(json({ detail: 'Filial não encontrada para este restaurante' }, 404));
      }
      return route.fulfill(json(menuForBranch(branchId)));
    }
    if (/\/info(\?|$)/.test(url)) return route.fulfill(json(INFO));
    if (/\/delivery\/estimate/.test(url)) {
      return route.fulfill(json({ serviceable: true, delivery_fee: 5, eta_min: 30, eta_max: 60 }));
    }
    // A ORDEM importa: /coupons/preview é POST e precisa ser testado ANTES do
    // /coupons genérico, senão a lista responderia à validação também.
    if (/\/coupons\/preview(\?|$)/.test(url)) {
      couponPreviewRequests.push({ body: JSON.parse(request.postData() || '{}') });
      if (onPreviewCoupon) return onPreviewCoupon(route, request, couponPreviewRequests.length);
      return route.fulfill(json({ detail: 'Token ausente' }, 401));
    }
    if (/\/coupons(\?|$)/.test(url)) {
      couponListRequests.push({ url });
      if (onListCoupons) return onListCoupons(route, request, couponListRequests.length);
      // O padrão é a lista VAZIA, como era antes: quem quer cards pede.
      return route.fulfill(json({ coupons: [] }));
    }
    // ── /customers/me*: o mock espelha o BACKEND, não um estado fixo ──
    //
    // Isto era `return route.fulfill(json({}, 401))` para TUDO sob
    // /customers/me — com ou sem token. O efeito: a suíte inteira nunca
    // desenhou um pedido, um endereço salvo ou um perfil preenchido, e o
    // detalhe do pedido pôde ler `item.name`/`item.unit_price` (campos que a
    // API não tem) por meses sem nenhum teste reclamar.
    //
    // Agora a resposta depende do que o backend olharia: o header
    // Authorization. Sem ele, 401 — visitante continua visitante. Com ele,
    // fixtures com os nomes do contrato. Subrota que não está aqui cai no
    // catch-all 404 e aparece em `rotasDesconhecidas`. Specs que sobrepõem
    // rotas DEPOIS de mockApi() continuam vencendo (a última registrada vence).
    if (/\/customers\/me/.test(url)) {
      if (!request.headers()['authorization']) {
        return route.fulfill(json({ detail: 'Não autenticado' }, 401));
      }
      const orderIdMatch = url.match(/\/customers\/me\/orders\/([^/?]+)/);
      if (method === 'GET' && orderIdMatch) {
        const order = ORDERS.find(item => item.id === orderIdMatch[1]);
        if (!order) return route.fulfill(json({ detail: 'Pedido não encontrado' }, 404));
        return route.fulfill(json(orderDetail(order)));
      }
      if (method === 'GET' && /\/customers\/me\/orders(\?|$)/.test(url)) {
        return route.fulfill(json(ORDERS));
      }
      if (method === 'GET' && /\/customers\/me\/addresses(\?|$)/.test(url)) {
        return route.fulfill(json([]));
      }
      if (method === 'GET' && /\/customers\/me\/cashback\/transactions/.test(url)) {
        return route.fulfill(json({ balance: 0, currency: 'BRL', transactions: [] }));
      }
      if (method === 'GET' && /\/customers\/me\/cashback(\?|$)/.test(url)) {
        return route.fulfill(json({ balance: 0, currency: 'BRL', by_restaurant: [] }));
      }
      if (method === 'GET' && /\/customers\/me\/cards(\?|$)/.test(url)) {
        return route.fulfill(json([]));
      }
      if (method === 'GET' && /\/customers\/me(\?|$)/.test(url)) {
        return route.fulfill(json(CUSTOMER));
      }
      // POST/PATCH/DELETE e subrotas não declaradas: catch-all lá embaixo.
    }

    // ── QUALQUER OUTRA COISA: 404, e o endereço fica gravado ──
    //
    // Isto era `route.fulfill(json({}))` — 200 com corpo vazio para toda rota
    // que o app inventasse. A intenção era boa (a suíte não pode escapar para a
    // rede), mas o efeito era que um E2E verde não dizia NADA sobre a rota
    // existir: o app podia chamar `/restaurants/x/coupons/available`, uma rota
    // que o backend removeu, receber 200 com `{}`, cair no fallback silencioso
    // e o teste passar. Foi exatamente esse o incidente que criou o
    // `api-contract.test.js`: a tela do Clube ficou em "Não foi possível
    // carregar seus cupons" para todo mundo, com lint, 253 unitários e 243 E2E
    // verdes.
    //
    // Agora responde 404. Não é rigor por rigor: 404 é o que o backend responde
    // a uma rota que não existe, e um mock que só ACEITA é um teste que só
    // CONCORDA — a mesma lição do `createCardToken` falso, que aceitava
    // qualquer `card_id` enquanto o gateway real recusava.
    //
    // E o endereço fica em `rotasDesconhecidas`, que sai junto com os outros
    // arrays: um teste pode afirmar que a lista está VAZIA, que é a afirmação
    // "este caminho não chamou nada que eu não tenha declarado aqui". Sem
    // isso, o 404 só troca um silêncio por outro.
    rotasDesconhecidas.push({ url, method });
    return route.fulfill(json({ detail: 'rota nao declarada no mock' }, 404));
  });

  return { orderRequests, paymentRequests, trackRequests, couponListRequests, couponPreviewRequests, rotasDesconhecidas };
}

export const TRACKING_TOKEN = 'trk_e2e_0000000000000000';

/**
 * Uma validade de cartão que ainda é FUTURA quando o teste rodar.
 *
 * Aqui havia o literal `11/31` em três sítios, e ele não era inofensivo: quem
 * confere a validade é o relógio REAL nos dois lados — o SDK falso do
 * Mercado Pago (`new Date()` dentro do mock de `card-payment-flow` e de
 * `payment-card-validation-timing`) e, em `mercado-pago-secure-fields`, o SDK
 * de verdade. Em 01/12/2031 os três testes passariam a recusar o cartão e a
 * suíte ficaria vermelha sem uma linha de código ter mudado.
 *
 * É a mesma classe do teste que só quebrava entre 00:00 e 01:30 por ler a hora
 * real, só que com a virada em anos em vez de em horas — e por isso ainda mais
 * cara: quando estourar, ninguém vai lembrar deste literal.
 *
 * Cinco anos à frente porque o cartão de teste tem de ser aceito hoje e daqui
 * a muito tempo, e porque um mês fixo (novembro) mantém a string com dois
 * dígitos sempre.
 */
export function validadeFutura() {
  return `11/${String((new Date().getFullYear() + 5) % 100).padStart(2, '0')}`;
}

// Payload EMV de Pix (copia e cola), no formato que o gateway devolve.
export const PIX_QR_CODE =
  '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-12d1-a456-42665544000052040000530398654041.005802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

/**
 * CreateOrderResponse do fluxo PAGO NA ENTREGA — o caminho que já existia.
 * tracking_token vem mesmo aqui: é ele que dá acesso ao pedido agora que a
 * consulta por telefone saiu da API.
 */
export function successOrder(n = 1, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    order_number: 4200 + n,
    tracking_token: `${TRACKING_TOKEN}${n}`,
    status: 'pending',
    payment_flow: 'delivery',
    payment_status: 'not_required',
    subtotal: 21.15,
    delivery_fee: 0,
    service_fee: 0.99,
    coupon_discount_amount: '0.00',
    discount_total: '0.00',
    cashback_redeemed_amount: '0.00',
    total: 22.14,
    message: 'Pedido criado com sucesso',
    ...overrides
  };
}

/** CreateOrderResponse do fluxo ONLINE: nasce aguardando a cobrança. */
export function pixOrder(n = 1, overrides = {}) {
  return successOrder(n, { payment_flow: 'online', payment_status: 'pending', ...overrides });
}

/** StartPaymentResponse com QR e checkout, como um gateway real de Pix. */
export function pixCharge(overrides = {}) {
  return {
    provider: 'e2e-gateway',
    provider_payment_id: 'pay_e2e_1',
    payment_status: 'pending',
    qr_code: PIX_QR_CODE,
    checkout_url: 'https://pagamento.example.com/checkout/pay_e2e_1',
    ...overrides
  };
}

/** OrderDetailResponse da rota pública de acompanhamento. */
export function trackedOrder(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    order_number: 4201,
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    branch_id: BRANCH_MATRIZ,
    customer_name_snapshot: 'E2E Test',
    customer_phone_snapshot: '85999999999',
    order_type: 'pickup',
    status: 'pending',
    payment_method: 'pix',
    payment_flow: 'online',
    payment_status: 'pending',
    subtotal: 21.15,
    delivery_fee: 0,
    service_fee: 0.99,
    discount_total: '0.00',
    coupon_discount_amount: '0.00',
    cashback_redeemed_amount: '0.00',
    total: 22.14,
    items: [],
    status_history: [],
    ...overrides
  };
}

/**
 * O APP SUBIU — que não é a mesma coisa que "não está mais subindo".
 *
 * A espera que a suíte usava, `!document.body.classList.contains('app-booting')`,
 * é satisfeita TAMBÉM quando o boot FALHA: `showAppError()`
 * (restaurant-page.js:390) tira `app-booting` e põe `app-error`. O teste
 * seguia em frente sobre a tela de erro — e como um boot falho nunca chega a
 * `applyTheme()`, a página fica pintada na cor da PLATAFORMA.
 *
 * Foi assim que `tenant-theme.spec.js` acusou "cor de marca chumbada" em
 * 31/08/2026: o CSS estava certo, o app é que não tinha subido. Medido com o
 * /menu respondendo 500: a espera antiga passa direto e 24 elementos ficam no
 * laranja do piloto — um diagnóstico que aponta para a folha de estilo quando o
 * problema foi a rede.
 *
 * Esta espera falha na hora, com a frase certa. É a mesma lição do
 * boot-smoke.spec.js: o problema nunca foi cobertura, foi diagnóstico.
 */
export async function esperarAppPronto(page) {
  await page.waitForFunction(() => {
    if (document.body.classList.contains('app-error')) {
      const motivo = document.getElementById('appLoaderMessage')?.textContent || '';
      throw new Error(`o app NÃO subiu: caiu na tela de erro de boot (body.app-error). ${motivo}`.trim());
    }
    return !document.body.classList.contains('app-booting');
  });
}

// Seed a confirmed pickup context + a guest identity BEFORE the app boots, so
// the test starts on the money path instead of the operation/address setup.
export async function seedPickupSession(page) {
  await page.addInitScript(
    ({ slug, branchId }) => {
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({ order_type: 'pickup', branch_id: branchId, branch_label: 'Matriz', confirmed: true })
      );
      // Chave única e global da sessão (Fase 3). Sem slug: a conta é do
      // Rapidex, não do restaurante.
      localStorage.setItem(
        'rapidex.customer.profile',
        JSON.stringify({ name: 'E2E Test', phone: '85999999999' })
      );
    },
    { slug: SLUG, branchId: BRANCH_MATRIZ }
  );
}

/**
 * Confirma o pedido na folha que sobe sobre a sacola — o passo que fica ENTRE
 * o botão da sacola e a criação do pedido. Toda rota que cria pedido passa por
 * aqui; um spec que clique só no CTA da sacola nunca vê o POST /orders.
 */
export async function confirmOrderSheet(page) {
  const sheet = page.locator('#orderConfirmSheet');
  await expect(sheet).toHaveClass(/active/);
  await sheet.locator('.order-confirm-cta').click();
}

/**
 * Leva o app de produto -> sacola -> Pix escolhido -> de volta na sacola, com a
 * sacola pronta para submeter. As esperas intermediárias não são decoração: a
 * sacola só recalcula o CTA depois que o método é confirmado, e clicar antes
 * disso pega um botão ainda sem rótulo.
 */
export async function selectPixAndReturnToCart(page, qty = 3) {
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, qty); // 3 x R$7,05 = R$21,15, acima do mínimo

  await page.evaluate(() => window.openModal('cartModal'));
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).not.toHaveText('Informe seu endereço');
  await cta.click();

  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();

  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(cta).toHaveText('Efetuar pagamento');
}

// Drive product -> cart via the app's own functions (robust against the huge
// unknown DOM), then assert on real rendering and real network afterwards.
export async function addH2OToCart(page, qty = 3) {
  // Boot finished => the menu payload (products array) is loaded and openProduct resolves it.
  await esperarAppPronto(page);
  await page.waitForFunction(() => typeof window.openProduct === 'function');
  await page.evaluate(
    ({ productId, qty }) => {
      window.openProduct(productId);
      for (let i = 1; i < qty; i++) window.changeQty(1);
      window.addToCart();
    },
    { productId: PRODUCT_H2O, qty }
  );
}

/**
 * Uma filial que ACEITA CARTÃO ONLINE.
 *
 * `info.json` é cópia fiel da produção, e lá `credit_card` existe SÓ no grupo
 * `delivery` — a maquininha na porta. Nessa filial o checkout NÃO oferece
 * cartão, e é isso que impede o pedido de nascer `payment_flow: "delivery"`
 * com o cartão já tokenizado e nenhuma cobrança (é o backend quem decide o
 * fluxo, em `_resolve_payment_flow`, lendo `branch_payment_methods`).
 *
 * Todo teste que exercita o CARTÃO precisa, portanto, de uma filial que o
 * habilite — que é a linha que esta função acrescenta. Chame DEPOIS de
 * mockApi(): no Playwright a rota registrada por último vence.
 */
export async function seedOnlineCardBranch(page) {
  const info = JSON.parse(JSON.stringify(INFO));
  info.payment_methods.online.push({
    id: 'c0000000-0000-4000-8000-000000000001',
    payment_flow: 'online',
    method_type: 'credit_card',
    brand: null,
    label: 'Cartão de crédito',
    icon_key: 'credit',
    enabled: true,
    requires_gateway: true
  });
  await page.route(/\/info(\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(info)
  }));
}
