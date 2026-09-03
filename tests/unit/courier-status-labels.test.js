import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
//  O STATUS DO PEDIDO NA TELA DO ENTREGADOR — nome fantasma e nome faltando.
//
//  `CourierOrderResponse.status` é `string` livre no OpenAPI: não há enum, e
//  por isso nem o `api-contract.test.js` nem o `typecheck:cards` têm opinião
//  sobre qual valor pode chegar ali. A lista de verdade mora numa constante
//  PYTHON (`ORDER_STATUSES`), que nenhum portão deste repositório lia.
//
//  O que passou por essa fresta, achado em 03/09/2026:
//
//   1. `STATUS_EM_PORTUGUES` traduzia **`delivered`**, que NÃO EXISTE em
//      `ORDER_STATUSES`. O nome do contrato é `completed`, e é ele que
//      `COURIER_TRANSITIONS` produz (`out_for_delivery` -> `completed`).
//      Chave fantasma: nenhuma resposta do backend jamais casou com ela.
//   2. E o mock do e2e RESPONDIA `status: 'delivered'` no `/delivered`, ou
//      seja o dublê confirmava a leitura errada — a mesma família do fixture
//      que mandava `ineligibility_reason` como frase pronta (skill §14.7).
//   3. Do outro lado, **`pending` e `accepted` FALTAVAM**. Os dois chegam à
//      lista do entregador: a atribuição só recusa status TERMINAL
//      (`admin_courier_service._assign_one`), e a lista só exclui os
//      terminais (`courier_delivery_service.list_orders`). Um pedido
//      atribuído antes de o restaurante aceitar aparecia SEM chip nenhum.
//
//  É a mesma forma do `orderStatusLabel()` da §14.5 da skill: a tabela errada
//  dos DOIS lados — sobrando nome que não existe e faltando nome que chega.
//
//  ESTE ARQUIVO RODA SEMPRE. A lista declarada abaixo é uma segunda cópia do
//  contrato, e uma segunda cópia diverge — então o último teste, esse sim
//  atrás do backend, existe para acusar a divergência na máquina de quem tem
//  os dois repositórios. É o desenho do `api-contract.test.js`: o que dá para
//  conferir sem o backend confere sempre; o que precisa dele avisa onde ele
//  existe.
// ============================================================================

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGINA = resolve(ROOT, 'scripts', 'pages', 'courier-page.js');
const SPEC_E2E = resolve(ROOT, 'tests', 'e2e', 'courier-screen.spec.js');
const CONSTANTES_BACK = resolve(ROOT, '..', 'pedeaqui_back', 'src', 'core', 'constants.py');

// `ORDER_STATUSES` (../pedeaqui_back/src/core/constants.py:54).
const ORDER_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled'
];

// Os TERMINAIS, derivados de `ORDER_STATUS_TRANSITIONS` (destino vazio) em
// `../pedeaqui_back/src/services/order_state_machine.py:31`. São exatamente os
// que a lista do entregador exclui, então nenhum deles precisa de rótulo aqui.
const TERMINAIS = ['completed', 'cancelled', 'rejected'];

// O que pode chegar à lista do entregador, e portanto o que a tela precisa
// saber dizer.
const ALCANCAVEIS = ORDER_STATUSES.filter(s => !TERMINAIS.includes(s));

// O status que o e2e inventa DE PROPÓSITO, para provar que valor desconhecido
// não vaza cru na tela. Ele é a única exceção legítima da varredura de
// fixture; qualquer outro nome fora do contrato é defeito.
const INVENTADO_DE_PROPOSITO = 'awaiting_courier_pickup';

/** As chaves de `STATUS_EM_PORTUGUES`, lidas do arquivo como texto. */
function rotulosDaTela() {
  const fonte = readFileSync(PAGINA, 'utf8');
  const bloco = fonte.match(/STATUS_EM_PORTUGUES\s*=\s*\{([\s\S]*?)\}/);
  if (!bloco) return [];
  return [...bloco[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map(m => m[1]);
}

/** Todo `status: '...'` escrito no spec do entregador. */
function statusDoSpec() {
  const fonte = readFileSync(SPEC_E2E, 'utf8');
  return [...new Set([...fonte.matchAll(/\bstatus:\s*'([a-z_]+)'/g)].map(m => m[1]))];
}

describe('o status do pedido na tela do entregador', () => {
  it('a varredura acha as duas listas — sonda contra vacuidade', () => {
    // Sem isto, uma mudança de indentação ou de aspas faz as varreduras
    // devolverem vazio e os testes abaixo passarem por VACUIDADE, que é a
    // pior forma de passar (skill §2.1).
    expect(rotulosDaTela().length, 'a varredura de STATUS_EM_PORTUGUES não casou').toBeGreaterThan(2);
    expect(statusDoSpec().length, 'a varredura de status do spec não casou').toBeGreaterThan(2);
  });

  it('nenhum rótulo traduz um status que o contrato não tem', () => {
    const fantasmas = rotulosDaTela().filter(s => !ORDER_STATUSES.includes(s));
    expect(
      fantasmas,
      `STATUS_EM_PORTUGUES traduz status que não existe em ORDER_STATUSES: ${fantasmas.join(', ')}`
    ).toEqual([]);
  });

  it('todo status que CHEGA à lista do entregador tem rótulo', () => {
    const rotulos = rotulosDaTela();
    const semRotulo = ALCANCAVEIS.filter(s => !rotulos.includes(s));
    expect(
      semRotulo,
      `status que a lista do entregador recebe e a tela não sabe dizer: ${semRotulo.join(', ')}`
    ).toEqual([]);
  });

  it('o mock do e2e não inventa status fora do contrato', () => {
    const inventados = statusDoSpec()
      .filter(s => s !== INVENTADO_DE_PROPOSITO)
      .filter(s => !ORDER_STATUSES.includes(s));
    expect(
      inventados,
      `o dublê responde status que o backend nunca manda: ${inventados.join(', ')}`
    ).toEqual([]);
  });

  const temBackend = existsSync(CONSTANTES_BACK);

  it.skipIf(!temBackend)('a lista declarada aqui ainda é a do backend', () => {
    const fonte = readFileSync(CONSTANTES_BACK, 'utf8');
    const bloco = fonte.match(/ORDER_STATUSES\s*=\s*\(([\s\S]*?)\)/);
    expect(bloco, 'ORDER_STATUSES sumiu de constants.py').toBeTruthy();
    const doBackend = [...bloco[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
    expect(doBackend.length, 'a varredura de ORDER_STATUSES não casou').toBeGreaterThan(2);
    expect(
      doBackend,
      'ORDER_STATUSES mudou no backend — atualize a lista deste arquivo e confira a tabela da tela'
    ).toEqual(ORDER_STATUSES);
  });
});
