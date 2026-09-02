import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/services/api-routes.js';
import '../../scripts/services/order-service.js';

// ============================================================================
//  CANCELAR O PRÓPRIO PEDIDO — o serviço.
//
//  A rota existe no contrato e o front nunca a chamou. Ela foi encontrada em
//  02/09/2026 varrendo as ESCRITAS, e é a pendência que a §8 da skill e o
//  `docs/order-contract.md` (item 11) chamam de "a mais cara, e continua
//  aberta: numa recusa de cartão o pedido já está gravado e não há rota de
//  cliente para cancelá-lo".
//
//  Ela deixou de estar aberta e ninguém percebeu, porque `api-contract.test.js`
//  confere um sentido só: rota que o front CHAMA existe no spec — nunca rota
//  que o spec oferece e o front ignora.
//
//  Os três fatos que estes testes prendem, e cada um é uma decisão:
//
//  1. **Sem Bearer.** A rota não declara `security`; quem autoriza é o
//     `tracking_token` do path. Mandar o header do cliente numa chamada que não
//     o pede é vazar credencial de graça — e quebraria o convidado, que é o
//     caso que a rota existe para atender.
//  2. **Corpo opcional de verdade.** Sem motivo, sem corpo.
//  3. **O 409 sobe com o status.** Ele não é falha de rede: é o pedido tendo
//     saído da janela, e a tela precisa dizer outra coisa por causa dele.
// ============================================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(
  readFileSync(resolve(AQUI, '../../scripts/types/openapi.json'), 'utf8')
);
const CAMINHO_DA_ROTA = '/restaurants/{restaurant_slug}/orders/track/{tracking_token}/cancel';

const service = window.PedeAquiOrderService;

let pedidos;
let resposta;

beforeEach(() => {
  pedidos = [];
  resposta = { id: 'ord-1', status: 'cancelled' };
  window.PedeAquiCustomerAuth = { authHeaders: () => ({ Authorization: 'Bearer NAO-DEVE-IR' }) };
  window.PedeAquiApiClient = {
    request: (path, options) => {
      pedidos.push({ path, options });
      return resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta);
    }
  };
});

describe('a rota', () => {
  it('é exatamente a que o contrato declara', () => {
    // A rota é montada por concatenação, então `api-contract.test.js` a vê. Este
    // teste é o outro lado: o caminho gerado casa com o TEMPLATE do spec, e não
    // só com uma string que alguém escreveu duas vezes.
    const gerado = window.PedeAquiApiRoutes.cancelOrder('junior-da-picanha', 'trk_abc');
    const molde = new RegExp(`^${CAMINHO_DA_ROTA.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    expect(SPEC.paths[CAMINHO_DA_ROTA]?.post, 'a rota sumiu do contrato').toBeTruthy();
    expect(gerado).toMatch(molde);
    expect(gerado).toBe('/restaurants/junior-da-picanha/orders/track/trk_abc/cancel');
  });

  it('o contrato NÃO exige autenticação nesta rota', () => {
    // A premissa de que o serviço depende. Se o backend passar a exigir
    // `security` aqui, este teste cai e o comentário do serviço fica errado —
    // é melhor descobrir assim do que pelo 401 do convidado.
    expect(SPEC.paths[CAMINHO_DA_ROTA].post.security ?? null).toBeNull();
  });
});

describe('o que sai na requisição', () => {
  it('NÃO manda o Bearer do cliente', async () => {
    // O mock de auth devolve um header de propósito: se o serviço o repassar,
    // este teste acusa. Quem autoriza é o token da URL.
    await service.cancelOrder('junior-da-picanha', 'trk_abc');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].options.headers, 'a rota não pede Bearer, e mandar é vazar').toBeUndefined();
    expect(pedidos[0].options.method).toBe('POST');
  });

  it('sem motivo, não manda corpo nenhum', async () => {
    await service.cancelOrder('x', 'trk_abc');
    expect(pedidos[0].options.body).toBeUndefined();
    await service.cancelOrder('x', 'trk_abc', { reason: '   ' });
    expect(pedidos[1].options.body).toBeUndefined();
  });

  it('com motivo, manda `reason` — o único campo do esquema', async () => {
    await service.cancelOrder('x', 'trk_abc', { reason: '  mudei de ideia  ' });
    expect(JSON.parse(pedidos[0].options.body)).toEqual({ reason: 'mudei de ideia' });
  });

  it('corta o motivo em 150, que é o `maxLength` do contrato', async () => {
    const limite = SPEC.components.schemas.CustomerCancelOrderRequest
      .properties.reason.anyOf.find(alternativa => alternativa.maxLength)?.maxLength;
    expect(limite, 'o contrato mudou o teto do motivo').toBe(150);

    await service.cancelOrder('x', 'trk_abc', { reason: 'a'.repeat(400) });
    const enviado = JSON.parse(pedidos[0].options.body).reason;
    expect(enviado).toHaveLength(limite);
  });
});

describe('o que volta', () => {
  it('devolve o pedido já cancelado', async () => {
    resposta = { id: 'ord-1', status: 'cancelled', total: 51.79 };
    expect(await service.cancelOrder('x', 'trk_abc')).toEqual(resposta);
  });

  it('o 409 SOBE com o status, para a tela dizer outra coisa', async () => {
    // "O pedido já saiu da janela" não é "tente de novo". Se o status se
    // perdesse no caminho, a tela ofereceria retentativa de uma coisa que nunca
    // mais vai dar certo.
    resposta = Object.assign(new Error('conflito'), { status: 409 });
    await expect(service.cancelOrder('x', 'trk_abc')).rejects.toMatchObject({ status: 409 });
  });
});
