import { describe, it, expect } from 'vitest';
import '../../scripts/utils/currency.js';
import '../../scripts/services/coupon-reason.js';

// A tradução de `ineligibility_reason`.
//
// O DEFEITO: o campo é um CÓDIGO interno do backend, e o front o mostrava cru.
// Com uma sacola de R$ 11 e um cupom de mínimo R$ 30, o cliente lia
// `minimum_order_not_reached` num toast escuro.
//
// Os treze códigos aqui NÃO foram inventados: são os `reason=` de
// `coupon_service.py`. A lista está congelada neste teste de propósito — se o
// backend criar o décimo quarto, ele cai na frase genérica de quem chama (que é
// o desenho), e quem quiser a frase específica passa por aqui.

const { couponReasonMessage, couponMissingAmount } = window.PedeAquiCouponReason;
const fmt = (n) => window.PedeAquiCurrency.formatCurrency(n);

// Os treze `reason=` do backend, em 03/09/2026.
const CODIGOS_DO_BACKEND = [
  'coupon_from_another_restaurant',
  'inactive',
  'not_visible',
  'not_started',
  'expired',
  'total_limit_reached',
  'login_required',
  'outside_hours',
  'payment_method_not_allowed',
  'minimum_order_not_reached',
  'customer_limit_reached',
  'cooldown_active',
  'first_order_only'
];

describe('nenhum código do backend chega cru na tela', () => {
  it('os treze motivos têm frase em português', () => {
    const semFrase = CODIGOS_DO_BACKEND.filter(
      codigo => !couponReasonMessage(codigo, { faltam: 19, fmt })
    );
    expect(semFrase, `sem tradução: ${semFrase.join(', ')}`).toEqual([]);
  });

  it('nenhuma frase contém o próprio código, nem sublinhado de código', () => {
    for (const codigo of CODIGOS_DO_BACKEND) {
      const frase = couponReasonMessage(codigo, { faltam: 19, fmt });
      expect(frase, codigo).not.toContain(codigo);
      expect(frase, codigo).not.toMatch(/[a-z]_[a-z]/);
    }
  });
});

describe('o pedido mínimo diz QUANTO falta', () => {
  it('a frase do relato: sacola de R$ 11, cupom de R$ 30', () => {
    const cupom = { min_order_value: '30.00' };
    const faltam = couponMissingAmount(cupom, 11);
    expect(faltam).toBe(19);
    // O `R$` do Intl vem colado por ESPAÇO FIXO (U+00A0), que é a tipografia
    // certa e é invisível numa comparação de string: sem esta normalização o
    // vermelho diz "expected X to be X", com os dois lados idênticos na tela.
    const frase = couponReasonMessage('minimum_order_not_reached', { faltam, fmt });
    expect(frase.replace(new RegExp(String.fromCharCode(160), 'g'), ' '))
      .toBe('Faltam R$ 19,00 para usar este cupom.');
  });

  it('sem o quanto falta, degrada em vez de anunciar "Faltam R$ 0,00"', () => {
    expect(couponReasonMessage('minimum_order_not_reached', { faltam: null, fmt }))
      .toBe('Este cupom exige um pedido maior. Adicione mais itens à sacola.');
  });
});

describe('couponMissingAmount', () => {
  // `min_order_value` é STRING decimal em CustomerCouponResponse e NÚMERO em
  // PublicCouponResponse. Os dois contratos chegam à mesma folha de detalhe.
  it('aceita os dois tipos do contrato', () => {
    expect(couponMissingAmount({ min_order_value: '30.00' }, 11)).toBe(19);
    expect(couponMissingAmount({ min_order_value: 30 }, 11)).toBe(19);
  });

  it('mínimo já atingido não vira frase de falta', () => {
    expect(couponMissingAmount({ min_order_value: '30.00' }, 30)).toBeNull();
    expect(couponMissingAmount({ min_order_value: '30.00' }, 45)).toBeNull();
  });

  it('cupom sem mínimo não responde nada', () => {
    expect(couponMissingAmount({}, 11)).toBeNull();
    expect(couponMissingAmount({ min_order_value: null }, 11)).toBeNull();
  });

  // Somar reais em `Number` erra na 15ª casa (a mesma razão da tolerância de um
  // centavo do total). Sem o arredondamento, `29.9 - 11` daria 18.900000000000002
  // e a frase sairia com quinze casas.
  it('arredonda ao centavo', () => {
    expect(couponMissingAmount({ min_order_value: '29.90' }, 11)).toBe(18.9);
  });
});

describe('código desconhecido devolve string vazia, e não um palpite', () => {
  it('quem chama cai no fallback dele', () => {
    expect(couponReasonMessage('motivo_que_ainda_nao_existe', { fmt })).toBe('');
    expect(couponReasonMessage('', { fmt })).toBe('');
    expect(couponReasonMessage(null, { fmt })).toBe('');
    expect(couponReasonMessage(undefined, { fmt })).toBe('');
  });
});
