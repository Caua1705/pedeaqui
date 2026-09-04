import { describe, it, expect } from 'vitest';
import '../../scripts/utils/currency.js';
import '../../scripts/services/coupon-format.js';

// ============================================================================
//  O PRAZO DO CUPOM — e o valor sentinela que vazava do banco para a tela.
//
//  O RELATO: a folha de detalhe do cupom anunciava "Válido até 31/12/2099".
//
//  De onde vem esse 2099: até 03/09/2026 `restaurant_coupons.valid_until` era
//  NOT NULL no banco (a migração `20260722_add_coupon_campaigns.sql` chega a
//  fazer `ALTER COLUMN valid_until SET NOT NULL`), então uma campanha
//  PERMANENTE — o frete grátis que a loja mantém o ano inteiro — só podia ser
//  escrita com uma data absurda no futuro. Hoje o jeito certo é NULO
//  (`CustomerCouponResponse.valid_until` é `string | null`, e a dica do painel
//  diz "em branco, a campanha não tem prazo"), mas as linhas antigas continuam
//  no banco com o sentinela dentro.
//
//  O front já tratava o NULO (a linha inteira sai). O que faltava era tratar a
//  outra forma de dizer a mesma coisa.
//
//  ## POR QUE UMA DISTÂNCIA, E NÃO UMA LISTA DE DATAS PROIBIDAS
//
//  Uma lista nominal (2099-12-31, 9999-12-31) é o idioma daqui para CÓDIGOS de
//  um conjunto fechado — é o que `coupon-reason.js` faz com os treze
//  `reason=`. Data não é código: quem escreveu "para sempre" pôde digitar
//  31/12/2099, 01/01/2100 ou qualquer outra, e uma lista erra em silêncio na
//  primeira que não estiver nela.
//
//  A régua é a pergunta que a linha responde: um prazo existe para a pessoa
//  decidir se dá tempo. Uma data a uma DÉCADA daqui não responde essa pergunta
//  em campanha nenhuma — ela é a linha dizendo "não vence".
//
//  O outro lado da conta, e é ele que fixa a ordem de grandeza: a mesma
//  migração preencheu `valid_until` ausente com `now() + interval '1 year'`.
//  Essas linhas são prazos DE VERDADE e precisam continuar aparecendo. Dez
//  anos deixa uma ordem de grandeza inteira entre os dois casos.
//
//  ## E O CARD ESCONDE O ANO
//
//  O card do Clube escreve só dia/mês. Com o sentinela cru, ele dizia "Válido
//  até 31/12" — o mesmo dado do detalhe, disfarçado de prazo desta virada de
//  ano. É por isso que a regra mora no formatador ÚNICO e não em cada tela: as
//  duas liam o campo, e a tela que menos mostrava era a que mais mentia.
// ============================================================================

const { couponDeadline } = window.PedeAquiCouponFormat;

const anoDaqui = (anos) => new Date().getFullYear() + anos;

describe('o sentinela do banco não chega à tela', () => {
  it('a data absurda no futuro não é prazo: some do card e do detalhe', () => {
    expect(couponDeadline('2099-12-31T23:59:59Z')).toBe('');
    expect(couponDeadline('2099-12-31T23:59:59Z', { withYear: true })).toBe('');
  });

  it('as outras formas de escrever "para sempre" caem na mesma régua', () => {
    // Nenhuma destas é a data observada em produção — e é esse o ponto: uma
    // lista de datas proibidas deixaria passar todas as três.
    expect(couponDeadline('9999-12-31T00:00:00Z', { withYear: true })).toBe('');
    expect(couponDeadline('2100-01-01T00:00:00Z', { withYear: true })).toBe('');
    expect(couponDeadline(`${anoDaqui(10)}-06-15T12:00:00Z`, { withYear: true })).toBe('');
  });

  it('sem prazo (o jeito certo desde 02/09/2026) continua sem linha', () => {
    expect(couponDeadline(null)).toBe('');
    expect(couponDeadline(undefined)).toBe('');
    expect(couponDeadline('')).toBe('');
  });
});

describe('prazo de verdade continua na tela', () => {
  it('o card mostra dia/mês e o detalhe mostra o ano junto', () => {
    expect(couponDeadline('2026-09-30T23:59:59Z')).toBe('30/09');
    expect(couponDeadline('2026-09-30T23:59:59Z', { withYear: true })).toBe('30/09/2026');
  });

  it('o preenchimento de `now() + 1 ano` da migração é prazo, e aparece', () => {
    const daquiAUmAno = `${anoDaqui(1)}-03-10T00:00:00Z`;
    expect(couponDeadline(daquiAUmAno, { withYear: true })).toBe(`10/03/${anoDaqui(1)}`);
  });

  it('a véspera da régua ainda é prazo', () => {
    const nove = `${anoDaqui(9)}-01-05T00:00:00Z`;
    expect(couponDeadline(nove, { withYear: true })).toBe(`05/01/${anoDaqui(9)}`);
  });
});

describe('o que não é data não vira palpite', () => {
  it('texto que não parseia volta como veio, em vez de virar "Invalid Date"', () => {
    expect(couponDeadline('quando o backend quiser')).toBe('quando o backend quiser');
  });
});
