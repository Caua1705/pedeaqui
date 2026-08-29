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
