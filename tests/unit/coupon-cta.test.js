import { describe, it, expect } from 'vitest';
import '../../scripts/utils/currency.js';
import '../../scripts/services/coupon-format.js';
import '../../scripts/services/coupon-cta.js';

// O decisor do botão do cupom. Puro: entra `CustomerCouponResponse` mais o
// único fato que o backend não pode conhecer (a sacola está vazia?), sai o
// rótulo e o destino.
//
// Os tipos são OS DE PRODUÇÃO: `missing_amount` chega como STRING decimal
// (skill §4, "fixture cujos números coincidem" / os três estados do contrato).
// Escrever 12 em vez de '12.00' aqui esconderia a classe de erro que este
// arquivo existe para pegar.

const { couponCta, ACOES } = window.PedeAquiCouponCta;
const fmt = (n) => window.PedeAquiCurrency.formatCurrency(n);
const cta = (coupon, sacolaVazia = false) => couponCta(coupon, { sacolaVazia, fmt });

const APLICAVEL = { state: 'applicable', missing_amount: '0.00' };
const FALTA = { state: 'missing_amount', missing_amount: '12.00' };
const LOGIN = { state: 'login_required', missing_amount: '30.00' };

describe('os três estados do contrato', () => {
  it('applicable com sacola: aplica', () => {
    expect(cta(APLICAVEL)).toEqual({ acao: ACOES.APLICAR, rotulo: 'Aplicar cupom' });
  });

  it('missing_amount diz QUANTO falta e leva ao cardápio', () => {
    // O número vem do backend já resolvido para esta sacola. O front não o
    // calcula, e a string decimal é o tipo de produção.
    // O rótulo é "Faltam " + o dinheiro COMO O APP FORMATA. Escrever o literal
    // 'Faltam R$ 12,00' falha por um espaço: em pt-BR o Intl separa o símbolo
    // com espaço NÃO-QUEBRÁVEL (U+00A0), e a diferença é invisível no diff.
    expect(cta(FALTA)).toEqual({ acao: ACOES.VER_CARDAPIO, rotulo: `Faltam ${fmt(12)}` });
    expect(cta(FALTA).rotulo).toContain('12,00');
  });

  it('login_required leva ao login', () => {
    expect(cta(LOGIN)).toEqual({ acao: ACOES.ENTRAR, rotulo: 'Entre para usar' });
  });
});

describe('a sacola vazia, que é o que o backend não sabe', () => {
  it('applicable com a sacola VAZIA não aplica: manda ao cardápio', () => {
    // O defeito que isto fecha: até 02/09/2026 confirmar um cupom com a sacola
    // vazia o GUARDAVA armado, e ele seguia no coupon_id do pedido sem nunca
    // ter passado por um preview. Num cupom de uso único, isso o queima.
    expect(cta(APLICAVEL, true)).toEqual({ acao: ACOES.VER_CARDAPIO, rotulo: 'Ver cardápio' });
  });

  it('login_required VENCE a sacola vazia', () => {
    // Precedência escrita no cabeçalho do módulo: sem conta o cupom não volta
    // nem na lista, então "Ver cardápio" mandaria a pessoa ao lugar errado.
    expect(cta(LOGIN, true)).toEqual({ acao: ACOES.ENTRAR, rotulo: 'Entre para usar' });
  });

  it('missing_amount com a sacola vazia continua dizendo quanto falta', () => {
    expect(cta(FALTA, true)).toEqual({ acao: ACOES.VER_CARDAPIO, rotulo: `Faltam ${fmt(12)}` });
  });
});

describe('as bordas que não podem virar um botão que cobra', () => {
  it('missing_amount SEM valor não promete número nenhum', () => {
    expect(cta({ state: 'missing_amount', missing_amount: '0.00' }))
      .toEqual({ acao: ACOES.VER_CARDAPIO, rotulo: 'Ver cardápio' });
  });

  it('estado desconhecido nunca vira "Aplicar cupom"', () => {
    // `normalizeCustomerCoupons` já descarta a linha antes daqui; esta é a rede
    // de baixo. Mandar ao cardápio não cobra nada de ninguém.
    for (const estado of ['expired', 'ineligible', 'usado', 'APPLICABLE']) {
      expect(cta({ state: estado }).acao, `state=${estado}`).toBe(ACOES.VER_CARDAPIO);
    }
  });

  it('cupom da VITRINE (sem state) aplica: quem julga é o preview', () => {
    // `PublicCouponResponse` não tem `state` — o backend nunca o julgou contra
    // esta pessoa. Ausência não é estado desconhecido: aplicar continua
    // passando pelo backend, só que uma porta adiante (POST /coupons/preview,
    // A MESMA função que decidiu os estados da lista).
    for (const estado of [undefined, null, '']) {
      expect(cta({ state: estado, code: 'JP10' }).acao, `state=${estado}`).toBe(ACOES.APLICAR);
    }
  });

  it('cupom da vitrine com a sacola VAZIA continua indo ao cardápio', () => {
    expect(cta({ code: 'JP10' }, true).acao).toBe(ACOES.VER_CARDAPIO);
  });

  it('cupom nulo não explode', () => {
    expect(cta(null).acao).toBe(ACOES.VER_CARDAPIO);
  });
});
