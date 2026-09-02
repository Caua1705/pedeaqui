import { describe, it, expect, beforeEach } from 'vitest';
import '../../scripts/services/api-routes.js';
import '../../scripts/services/api.js';
import '../../scripts/services/club-service.js';

// Os cupons do cliente, pelo que sai na tela.
//
// O payload usado aqui é cópia do que
// GET https://api.pederapidex.com/restaurants/junior-da-picanha/coupons
// respondeu em 29/08/2026 — inclusive os tipos: `min_order_value`,
// `discount_amount` e `missing_amount` vêm como STRING decimal, e `label` vem
// null na maioria dos cupons. Inventar números aqui esconderia justamente a
// classe de erro que este arquivo existe para pegar.

const service = window.PedeAquiClubService;

const CUPOM_LOGIN = {
  id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
  code: 'JP10',
  title: '10% OFF',
  description: null,
  image_url: 'https://exemplo/coupon-10-percent-off.webp',
  discount_type: 'percent',
  min_order_value: '30.00',
  valid_until: '2099-12-31T23:59:59Z',
  label: null,
  state: 'login_required',
  discount_amount: '0.00',
  missing_amount: '30.00'
};

const CUPOM_APLICAVEL = {
  ...CUPOM_LOGIN,
  id: '0d6e7327-6637-48fb-ad67-fdc362d32ace',
  code: 'JP5',
  title: '5% OFF',
  label: 'selected_for_you',
  state: 'applicable',
  discount_amount: '2.50',
  missing_amount: '0.00'
};

const CUPOM_FALTA = {
  ...CUPOM_LOGIN,
  id: '11c5185d-1e5c-440a-afcf-cd6e67764853',
  code: 'FRETE0',
  title: 'Frete grátis',
  discount_type: 'free_delivery',
  state: 'missing_amount',
  missing_amount: '8.85'
};

let pedidos;

beforeEach(() => {
  pedidos = [];
  window.PedeAquiCustomerAuth = { authHeaders: () => ({}) };
  window.PedeAquiApiClient = {
    request: (path, options) => {
      pedidos.push({ path, options });
      return Promise.resolve(respostaAtual);
    }
  };
});

let respostaAtual = { coupons: [] };

describe('a rota e o contexto', () => {
  it('chama /coupons com subtotal, taxa e modalidade', async () => {
    respostaAtual = { coupons: [] };
    await service.getCustomerCoupons({
      restaurantSlug: 'junior-da-picanha',
      subtotal: 50,
      deliveryFee: 5,
      orderType: 'delivery'
    });

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].path).toBe(
      '/restaurants/junior-da-picanha/coupons?subtotal=50&delivery_fee=5&order_type=delivery'
    );
  });

  it('sem contexto vai a lista do Clube, sem query', async () => {
    respostaAtual = { coupons: [] };
    await service.getCustomerCoupons({ restaurantSlug: 'junior-da-picanha' });
    expect(pedidos[0].path).toBe('/restaurants/junior-da-picanha/coupons');
  });
});

describe('normalização da lista', () => {
  it('devolve os três estados sem filtrar nenhum', async () => {
    // O ponto do teste. O filtro anterior procurava `eligible === true`; com o
    // contrato novo esse campo não existe, e um filtro literal apagaria a lista
    // inteira. Quem decide o que aparece é o backend — cupom sem conserto nesta
    // sacola nem chega aqui.
    respostaAtual = { coupons: [CUPOM_LOGIN, CUPOM_APLICAVEL, CUPOM_FALTA] };
    const cupons = await service.getCustomerCoupons({ restaurantSlug: 'x' });

    expect(cupons.map((c) => c.state)).toEqual(['login_required', 'applicable', 'missing_amount']);
  });

  it('não usa mais `eligible`: um cupom marcado false continua na lista', async () => {
    // Regressão nominal. Se alguém reintroduzir o filtro, este cupom some — e
    // some em silêncio, que é como o defeito original passava.
    respostaAtual = { coupons: [{ ...CUPOM_APLICAVEL, eligible: false }] };
    const cupons = await service.getCustomerCoupons({ restaurantSlug: 'x' });
    expect(cupons).toHaveLength(1);
  });

  it('descarta linha sem id ou com state desconhecido', async () => {
    respostaAtual = {
      coupons: [
        CUPOM_APLICAVEL,
        { ...CUPOM_APLICAVEL, id: null },
        { ...CUPOM_APLICAVEL, id: 'outro-id', state: 'expired' },
        { ...CUPOM_APLICAVEL, id: 'mais-um', state: undefined }
      ]
    };
    const cupons = await service.getCustomerCoupons({ restaurantSlug: 'x' });
    expect(cupons.map((c) => c.id)).toEqual([CUPOM_APLICAVEL.id]);
  });

  it('resposta sem a chave coupons não explode', async () => {
    respostaAtual = {};
    expect(await service.getCustomerCoupons({ restaurantSlug: 'x' })).toEqual([]);
    respostaAtual = { coupons: null };
    expect(await service.getCustomerCoupons({ restaurantSlug: 'x' })).toEqual([]);
  });
});

// ============================================================================
//  Resgatar um cupom pelo CÓDIGO — `POST /coupons/claim`.
//
//  A rota existe no contrato desde sempre e o front NUNCA a chamou: quem
//  recebia um código de fora (panfleto, mensagem, embalagem) não tinha onde
//  digitá-lo. Ligada em 02/09/2026.
//
//  A distinção que estes testes guardam é a do próprio backend: RESGATE NÃO É
//  USO. O resgate grava em `coupon_claims`, que não tem pedido nem valor e só
//  concede visibilidade; o teto da campanha continua contando
//  `coupon_redemptions`. Se o front tratasse resgate como aplicação, um cupom
//  de 100 usos se esgotaria com gente que só digitou o código.
// ============================================================================

const CUPOM_RESGATADO = {
  ...CUPOM_LOGIN,
  id: 'f3a4c1e2-0000-4000-8000-000000000009',
  code: 'PANFLETO10',
  state: 'missing_amount',
  missing_amount: '30.00'
};

describe('resgatar por código', () => {
  it('manda o código no corpo, para a rota de claim', async () => {
    respostaAtual = { coupon: CUPOM_RESGATADO };
    await service.claimCoupon({ restaurantSlug: 'junior-da-picanha', code: 'PANFLETO10' });

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].path).toBe('/restaurants/junior-da-picanha/coupons/claim');
    expect(pedidos[0].options.method).toBe('POST');
    expect(JSON.parse(pedidos[0].options.body)).toEqual({ code: 'PANFLETO10' });
  });

  it('apara o código antes de mandar', async () => {
    // Colar um código de uma mensagem traz espaço em volta com frequência.
    respostaAtual = { coupon: CUPOM_RESGATADO };
    await service.claimCoupon({ restaurantSlug: 'x', code: '  PANFLETO10 ' });
    expect(JSON.parse(pedidos[0].options.body)).toEqual({ code: 'PANFLETO10' });
  });

  it('código vazio não vira requisição', async () => {
    expect(await service.claimCoupon({ restaurantSlug: 'x', code: '   ' })).toBeNull();
    expect(await service.claimCoupon({ restaurantSlug: 'x' })).toBeNull();
    expect(pedidos).toHaveLength(0);
  });

  it('devolve o cupom no mesmo formato da lista', async () => {
    // `CouponClaimResponse.coupon` é um CustomerCouponResponse — de propósito,
    // para o app inserir o card resgatado sem uma segunda chamada e para não
    // existirem duas descrições de cupom que precisem concordar.
    respostaAtual = { coupon: CUPOM_RESGATADO };
    const cupom = await service.claimCoupon({ restaurantSlug: 'x', code: 'PANFLETO10' });
    expect(cupom.id).toBe(CUPOM_RESGATADO.id);
    expect(cupom.state).toBe('missing_amount');
  });

  it('o cupom resgatado passa pelo MESMO filtro da lista', async () => {
    // Sem `id` não há como abrir o detalhe, e com `state` desconhecido não há
    // botão que faça sentido. Empurrar uma linha quebrada para dentro da lista
    // é pior que não inserir nada.
    respostaAtual = { coupon: { ...CUPOM_RESGATADO, id: null } };
    expect(await service.claimCoupon({ restaurantSlug: 'x', code: 'A' })).toBeNull();
    respostaAtual = { coupon: { ...CUPOM_RESGATADO, state: 'expired' } };
    expect(await service.claimCoupon({ restaurantSlug: 'x', code: 'A' })).toBeNull();
  });

  it('a recusa do backend SOBE, em vez de virar um null mudo', async () => {
    // Código inexistente, cupom de outro segmento ou fora da validade voltam
    // como falha HTTP. Quem chama precisa da mensagem para dizer à pessoa o que
    // aconteceu — um `null` para tudo faria a tela responder "não deu" a um
    // código correto e a um código errado com a mesma cara.
    const recusa = Object.assign(new Error('Cupom não encontrado'), { status: 404 });
    window.PedeAquiApiClient = { request: () => Promise.reject(recusa) };
    await expect(service.claimCoupon({ restaurantSlug: 'x', code: 'NAOEXISTE' })).rejects.toBe(recusa);
  });
});
