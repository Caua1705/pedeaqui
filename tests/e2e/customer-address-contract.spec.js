import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockApi, seedPickupSession, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  SALVAR UM ENDEREÇO NA CONTA — o payload contra o contrato de verdade.
//
//  Este arquivo nasceu de um buraco: até 02/09/2026 **nenhum teste do
//  repositório salvava um endereço**. O `mockApi()` só atende
//  `GET /customers/me/addresses`; um POST caía no catch-all (404 e a rota
//  anotada), e o `boot-smoke` — que é quem lê `rotasDesconhecidas` — percorre as
//  dez telas principais, entre as quais não está o formulário de endereço.
//
//  ## O DEFEITO QUE ELE PEGOU
//
//  `addressApiPayload()` (restaurant-page.js) mandava o CEP como
//  **`postal_code`**, mais **`place_id`** e **`alias`**. O contrato
//  (`CreateCustomerAddressRequest` / `UpdateCustomerAddressRequest`) declara
//  **`zipcode`** e **`label`**, não tem `place_id`, e — o que decide — os dois
//  são **`additionalProperties: false`**.
//
//  Ou seja: todo cliente logado que salvava um endereço recebia 422, via o
//  `alert("Não foi possível salvar o endereço na sua conta...")` e ficava com o
//  endereço só naquele aparelho. Em outro aparelho, nada.
//
//  `postal_code` é o nome INTERNO do front (o normalizador o produz de
//  propósito, e `order-payload.js:70` já mapeava de volta para `zipcode` ao
//  criar o pedido). O que faltava era esta borda fazer o mesmo mapeamento.
//
//  ## POR QUE O MOCK LÊ O `openapi.json`
//
//  "Um mock que só aceita é um teste que só concorda" (skill §4). Um mock com a
//  lista de campos escrita à mão aqui seria a segunda cópia do contrato, e ela
//  divergiria — provavelmente na direção do que o código manda hoje, que é
//  exatamente o defeito. Ele lê `additionalProperties`, `required` e as
//  propriedades DO ESQUEMA e recusa como o backend recusa.
// ============================================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(
  readFileSync(resolve(AQUI, '../../scripts/types/openapi.json'), 'utf8')
);

function regraDe(nomeDoEsquema) {
  const esquema = SPEC.components.schemas[nomeDoEsquema];
  if (!esquema?.properties) throw new Error(`esquema ausente: ${nomeDoEsquema}`);
  return {
    permitidos: Object.keys(esquema.properties),
    obrigatorios: esquema.required || [],
    fechado: esquema.additionalProperties === false
  };
}

const CRIAR = regraDe('CreateCustomerAddressRequest');

/** Recusa como o FastAPI recusa: campo desconhecido em modelo `extra=forbid`. */
function validar(corpo, regra) {
  const erros = [];
  if (regra.fechado) {
    for (const chave of Object.keys(corpo || {})) {
      if (!regra.permitidos.includes(chave)) {
        erros.push({ loc: ['body', chave], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' });
      }
    }
  }
  for (const chave of regra.obrigatorios) {
    if (corpo?.[chave] === undefined || corpo?.[chave] === null || corpo?.[chave] === '') {
      erros.push({ loc: ['body', chave], msg: 'Field required', type: 'missing' });
    }
  }
  return erros;
}

async function prepararConta(page) {
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-endereco-token');
  });
  await mockApi(page);

  const enviados = [];
  // DEPOIS do mockApi de propósito: no Playwright a última rota registrada
  // vence (skill §4, "ordem das rotas importa").
  await page.route('**/customers/me/addresses**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    let corpo;
    try { corpo = request.postDataJSON(); } catch { corpo = null; }
    const erros = validar(corpo, CRIAR);
    enviados.push({ corpo, erros });
    if (erros.length) {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: erros })
      });
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...corpo, id: '9f1c0a6e-0000-4000-8000-000000000001' })
    });
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  return enviados;
}

async function preencherEsalvar(page) {
  await page.evaluate(() => {
    const set = (id, valor) => {
      const campo = document.getElementById(id);
      if (campo) campo.value = valor;
    };
    set('addrDetCep', '60175-047');
    set('addrDetStreet', 'Rua Padre Antonio Tomas');
    set('addrDetNumber', '1234');
    set('addrDetNeighborhood', 'Aldeota');
    set('addrDetComplement', 'Apto 302');
    set('addrDetReference', 'Perto da praca');
    set('addrDetAlias', 'Casa');
  });
  await page.evaluate(() => window.RapidexActions.resolve('saveAddressDetails')());
}

test('o endereço salvo na conta usa os NOMES DO CONTRATO, e o backend aceita', async ({ page }) => {
  const enviados = await prepararConta(page);

  await preencherEsalvar(page);
  await expect.poll(() => enviados.length).toBe(1);

  const { corpo, erros } = enviados[0];

  // O ponto do arquivo. `additionalProperties: false` transforma um nome que o
  // front inventou num 422 — não num campo ignorado.
  expect(erros, 'o backend recusaria este payload').toEqual([]);

  // O CEP vai em `zipcode`. `postal_code` é o nome INTERNO do front e não
  // existe em nenhum esquema de endereço da API.
  expect(corpo.zipcode).toBe('60175047');
  expect(corpo).not.toHaveProperty('postal_code');

  // O apelido vai em `label`. `alias` também é nome interno.
  expect(corpo.label).toBe('Casa');
  expect(corpo).not.toHaveProperty('alias');

  // `place_id` é do Google, não da nossa API: ele não está em esquema nenhum.
  expect(corpo).not.toHaveProperty('place_id');

  // E os obrigatórios chegaram.
  expect(corpo).toMatchObject({
    street: 'Rua Padre Antonio Tomas',
    number: '1234',
    neighborhood: 'Aldeota'
  });
});

test('o endereço salvo NÃO fica marcado como não sincronizado', async ({ page }) => {
  // A outra metade: com o 422 acontecendo, o app gravava o endereço local com
  // `sync_error: true` e avisava a pessoa que ele "continuará disponível neste
  // aparelho". Esse era o sintoma visível do defeito, e é o que este teste
  // impede de voltar.
  const enviados = await prepararConta(page);

  await preencherEsalvar(page);
  await expect.poll(() => enviados.length).toBe(1);

  const guardados = await page.evaluate(() => {
    const bruto = localStorage.getItem('rapidex.customerAddresses.local');
    try { return JSON.parse(bruto || '[]'); } catch { return []; }
  });

  expect(guardados.length, 'o endereço não foi guardado').toBeGreaterThan(0);
  const salvo = guardados[0];
  expect(salvo.sync_error, 'o endereço ficou marcado como não sincronizado').toBeFalsy();
  // E ele voltou com o id REMOTO, que é a prova de que o POST foi aceito.
  expect(String(salvo.id), 'o endereço ficou com id local').not.toMatch(/^local_/);
});
