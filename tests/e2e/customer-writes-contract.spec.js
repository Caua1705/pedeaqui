import { test, expect } from '@playwright/test';
import {
  mockApi, seedPickupSession, RESTAURANT_URL, CUSTOMER,
  esperarAppPronto, violacoesDaRequisicao
} from './helpers.js';

// ============================================================================
//  AS TRÊS ESCRITAS DE ESQUEMA FECHADO QUE NENHUM TESTE EXERCITAVA.
//
//  A varredura de 02/09/2026 mediu — instrumentando o `mockApi()` e rodando a
//  suíte inteira — quais escritas do front chegam a algum teste. Cinco chegavam.
//  Estas três não:
//
//    PATCH /customers/me                    UpdateCurrentCustomerRequest
//    PATCH /customers/me/addresses/{id}     UpdateCustomerAddressRequest
//    POST  /customers/me/addresses/import   ImportCustomerAddressesRequest
//
//  As três têm `additionalProperties: false`, e é isso que as torna a mesma
//  bomba: num modelo `extra=forbid` um nome fora do contrato não é campo
//  ignorado — é a requisição inteira recusada com 422. Foi exatamente assim que
//  `POST /customers/me/addresses` ficou quebrado (nenhum cliente logado
//  conseguia salvar endereço na conta) até esta rodada.
//
//  Nenhuma das três estava quebrada quando este arquivo nasceu — os payloads
//  foram conferidos campo a campo. O que faltava era a PROVA, e é ela que
//  transforma "está certo porque eu li" em "está certo porque falha se mudar".
//
//  A do meio é a que mais assusta: ela usa o MESMO `addressApiPayload` que
//  estava quebrado. Estava certa por carona da correção, e sem teste próprio.
//
//  ## O validador vem do HELPERS, não daqui
//
//  Estes specs registram rota própria (a última registrada vence o `mockApi()`),
//  então o corpo deixaria de ser conferido. `violacoesDaRequisicao` é a MESMA
//  função que o mock usa, lendo o `openapi.json` — uma cópia da regra escrita
//  aqui divergiria na direção do que o código manda hoje, que é o que se quer
//  pegar.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

const ENDERECO_REMOTO = {
  id: '5a1f0b3c-0000-4000-8000-00000000aaaa',
  label: 'Casa',
  street: 'Rua Padre Antonio Tomas',
  number: '1234',
  neighborhood: 'Aldeota',
  city: 'Fortaleza',
  state: 'CE',
  zipcode: '60175047',
  complement: 'Apto 302',
  reference: 'Perto da praca',
  latitude: -3.74,
  longitude: -38.49,
  is_default: true
};

/**
 * Registra as rotas de escrita conferindo o corpo contra o CONTRATO, e devolve
 * o que foi enviado. Um corpo em desacordo vira 422, como o backend faria.
 */
async function espionarEscritas(page, { enderecosRemotos = [] } = {}) {
  const enviados = [];

  const conferir = async (route, metodo) => {
    const request = route.request();
    const caminho = new URL(request.url()).pathname;
    const violacoes = violacoesDaRequisicao(metodo, caminho, request.postData());
    let corpo;
    try { corpo = request.postDataJSON(); } catch { corpo = null; }
    enviados.push({ caminho, metodo, corpo, violacoes });
    if (violacoes.length) {
      return route.fulfill(json({ detail: violacoes.map((msg) => ({ msg, type: 'contrato' })) }, 422));
    }
    return null;
  };

  // DEPOIS do mockApi de propósito: a última rota registrada vence (skill §4).
  await page.route('**/customers/me/addresses/import**', async (route) => {
    const recusa = await conferir(route, 'POST');
    if (recusa) return recusa;
    return route.fulfill(json({ created: enderecosRemotos, existing: [], ignored: [] }, 201));
  });
  await page.route('**/customers/me/addresses/**', async (route) => {
    const metodo = route.request().method();
    if (metodo !== 'PATCH') return route.fulfill(json(enderecosRemotos));
    const recusa = await conferir(route, 'PATCH');
    if (recusa) return recusa;
    return route.fulfill(json({ ...ENDERECO_REMOTO, ...(route.request().postDataJSON() || {}) }));
  });
  await page.route('**/customers/me/addresses**', async (route) => {
    const metodo = route.request().method();
    if (metodo === 'GET') return route.fulfill(json(enderecosRemotos));
    const recusa = await conferir(route, metodo);
    if (recusa) return recusa;
    return route.fulfill(json({ ...ENDERECO_REMOTO, ...(route.request().postDataJSON() || {}) }, 201));
  });
  await page.route(/\/customers\/me(?:\?|$)/, async (route) => {
    const metodo = route.request().method();
    if (metodo !== 'PATCH') return route.fulfill(json(CUSTOMER));
    const recusa = await conferir(route, 'PATCH');
    if (recusa) return recusa;
    return route.fulfill(json({ ...CUSTOMER, ...(route.request().postDataJSON() || {}) }));
  });

  return enviados;
}

/**
 * A ORDEM AQUI É O PONTO, e a primeira versão deste arquivo errou nela: os
 * espiões precisam ser registrados DEPOIS do `mockApi()`, porque no Playwright
 * a última rota registrada VENCE (skill §4). Registrados antes, o `mockApi`
 * respondia por tudo e os três testes falhavam com "nenhuma requisição" — que
 * é indistinguível de "o app não chamou", e foi por isso que a primeira leitura
 * do vermelho apontou para o lugar errado.
 */
async function bootarLogado(page, { enderecosLocais = [], enderecosRemotos = [] } = {}) {
  await seedPickupSession(page);
  await page.addInitScript(([locais]) => {
    localStorage.setItem('rapidex.customer.token', 'e2e-escritas-token');
    if (locais.length) {
      localStorage.setItem('rapidex.customerAddresses.local', JSON.stringify(locais));
    }
  }, [enderecosLocais]);
  await mockApi(page);
  const enviados = await espionarEscritas(page, { enderecosRemotos });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  return enviados;
}

// --------------------------------------------------------------------------
// 1. PATCH /customers/me — "meus dados"
// --------------------------------------------------------------------------
test('PATCH /customers/me manda os quatro campos do contrato, e nada mais', async ({ page }) => {
  const enviados = await bootarLogado(page);

  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openCustomerDataScreen')?.());
  await page.evaluate(() => {
    const set = (id, valor) => { const campo = document.getElementById(id); if (campo) campo.value = valor; };
    set('profDataName', 'Cliente E2E');
    set('profDataEmail', 'cliente.e2e@exemplo.com');
    set('profDataPhone', '85999999999');
    set('profDataBirth', '12/04/1990');
  });
  await page.evaluate(() => window.RapidexActions.resolve('submitCustomerData')());

  await expect.poll(() => enviados.filter((e) => e.metodo === 'PATCH' && e.caminho === '/customers/me').length).toBe(1);
  const { corpo, violacoes } = enviados.find((e) => e.caminho === '/customers/me');

  expect(violacoes, 'o backend recusaria este payload').toEqual([]);
  // Os quatro são os `required` de UpdateCurrentCustomerRequest.
  expect(Object.keys(corpo).sort()).toEqual(['birth_date', 'email', 'name', 'phone']);
  expect(corpo.birth_date).toBe('1990-04-12');
});

// --------------------------------------------------------------------------
// 2. PATCH /customers/me/addresses/{id} — editar endereço
// --------------------------------------------------------------------------
test('PATCH de endereço usa os nomes do contrato — o mesmo payload que estava quebrado', async ({ page }) => {
  const enviados = await bootarLogado(page, { enderecosRemotos: [ENDERECO_REMOTO] });

  await page.evaluate(() => window.RapidexActions.resolve('openAddrPicker')?.('profile'));
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  // Espera o endereço remoto entrar na lista: a sincronização é assíncrona, e
  // editar antes dela é editar um item que ainda não existe.
  await expect(page.locator('.addr-picker-item')).toHaveCount(1);

  await page.evaluate((id) => window.RapidexActions.resolve('editAddrPickerItem')?.(null, id), ENDERECO_REMOTO.id);
  await expect(page.locator('#addrDetailsModal')).toHaveClass(/active/);
  await page.evaluate(() => {
    const campo = document.getElementById('addrDetComplement');
    if (campo) campo.value = 'Apto 401';
  });
  await page.evaluate(() => window.RapidexActions.resolve('saveAddressDetails')());

  await expect.poll(() => enviados.filter((e) => e.metodo === 'PATCH' && e.caminho.includes('/addresses/')).length).toBe(1);
  const { corpo, violacoes } = enviados.find((e) => e.metodo === 'PATCH' && e.caminho.includes('/addresses/'));

  expect(violacoes, 'o backend recusaria este payload').toEqual([]);
  // As três trocas que o POST precisou, e que valem igual aqui — é o MESMO
  // `addressApiPayload`.
  expect(corpo).not.toHaveProperty('postal_code');
  expect(corpo).not.toHaveProperty('alias');
  expect(corpo).not.toHaveProperty('place_id');
  expect(corpo.zipcode).toBe('60175047');
  expect(corpo.complement).toBe('Apto 401');
});

// --------------------------------------------------------------------------
// 3. POST /customers/me/addresses/import — importar os locais ao entrar
// --------------------------------------------------------------------------
test('a importação de endereços locais respeita o contrato, item a item', async ({ page }) => {
  const local = {
    id: 'local_1756800000000_abcdef',
    client_reference: 'local_1756800000000_abcdef',
    label: 'Trabalho',
    street: 'Avenida Santos Dumont',
    number: '5000',
    neighborhood: 'Papicu',
    city: 'Fortaleza',
    state: 'CE',
    postal_code: '60175047',
    latitude: -3.73,
    longitude: -38.48
  };
  const enviados = await bootarLogado(page, { enderecosLocais: [local], enderecosRemotos: [] });

  await page.evaluate(() => window.RapidexActions.resolve('openAddrPicker')?.('profile'));
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);

  await expect.poll(() => enviados.filter((e) => e.caminho.endsWith('/addresses/import')).length).toBe(1);
  const { corpo, violacoes } = enviados.find((e) => e.caminho.endsWith('/addresses/import'));

  expect(violacoes, 'o backend recusaria este payload').toEqual([]);
  expect(Array.isArray(corpo.addresses), 'o contrato pede { addresses: [...] }').toBe(true);
  expect(corpo.addresses).toHaveLength(1);

  // O item de dentro TAMBÉM tem esquema fechado (ImportCustomerAddressRequest),
  // e é ele que carrega o CEP — que no front se chama `postal_code`.
  const item = corpo.addresses[0];
  expect(item).not.toHaveProperty('postal_code');
  expect(item.zipcode).toBe('60175047');
  expect(item.label).toBe('Trabalho');
  expect(item.client_reference).toBe(local.client_reference);
});
