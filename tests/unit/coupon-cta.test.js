import { describe, it, expect } from 'vitest';
import '../../scripts/utils/currency.js';
import '../../scripts/services/coupon-format.js';
// As frases das duas restrições. Precisa vir ANTES do coupon-cta pela MESMA
// razão que em `entry-restaurant.js`: o decisor lê `PedeAquiCouponRestriction`
// e não tem fallback de propósito — código do backend não pode virar texto de
// tela por acidente. Sem esta linha os oito casos novos morrem com
// "Cannot read properties of undefined", que é o aviso certo.
import '../../scripts/services/coupon-restriction.js';
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
  it('applicable com sacola: aplica, e o rótulo é a palavra do cliente', () => {
    // "Usar cupom" VOLTOU em 03/09/2026, e isso é REVERSÃO CONSCIENTE, não
    // conserto. Ele saiu em 02/09 porque o botão dizia "Usar cupom" nos QUATRO
    // casos — inclusive sem o mínimo, sem conta e com a sacola vazia. Hoje os
    // outros três têm rótulo próprio, então "Usar cupom" só aparece onde o
    // cupom de fato pode ser usado.
    expect(cta(APLICAVEL)).toEqual({ acao: ACOES.APLICAR, rotulo: 'Usar cupom' });
  });

  it('e NENHUM dos outros casos diz "Usar cupom" — a guarda do motivo antigo', () => {
    // Esta é a metade que faz a reversão ser segura (§14.8 da skill): o teste
    // que protegia a decisão antiga foi INVERTIDO, não apagado. O medo de
    // 02/09 era um "Usar cupom" que não usa nada; ele continua barrado aqui,
    // caso a caso, inclusive com a sacola vazia.
    for (const [nome, cupom, vazia] of [
      ['missing_amount', FALTA, false],
      ['login_required', LOGIN, false],
      ['applicable com sacola vazia', APLICAVEL, true],
      ['estado desconhecido', { state: 'expired' }, false],
      ['cupom nulo', null, false]
    ]) {
      expect(cta(cupom, vazia).rotulo, nome).not.toBe('Usar cupom');
    }
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

  it('estado desconhecido nunca vira um botão que aplica', () => {
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

// ============================================================================
//  OS DOIS ESTADOS QUE O FRONT NÃO CONHECIA (03/09/2026).
//
//  `CustomerCouponState` tem cinco valores e este decisor conhecia três.
//  `payment_method_not_allowed` e `outside_hours` eram descartados antes de
//  chegar aqui, o cupom sumia da lista do Clube, e — desde
//  `judgedCouponForDetail` — a folha de detalhe caía no cupom da vitrine (sem
//  `state`) e o botão dizia "Usar cupom" para um cupom que o backend acabou de
//  recusar. Era esse o defeito.
//
//  Os TIPOS aqui são os de produção: `valid_hours_from` é `format: time`
//  ("15:00:00", não "15:00"), e `allowed_payment_methods` traz o vocabulário
//  fechado do backend (`PAYMENT_METHODS` em src/core/constants.py).
// ============================================================================

const FORA_DE_HORARIO = {
  state: 'outside_hours',
  missing_amount: '0.00',
  valid_hours_from: '15:00:00',
  valid_hours_until: '18:00:00'
};
const SO_NO_PIX = {
  state: 'payment_method_not_allowed',
  missing_amount: '0.00',
  allowed_payment_methods: ['pix']
};

describe('fora do horário: o card aparece, o botão diz quando vale, e não navega', () => {
  it('o rótulo é a faixa do contrato', () => {
    expect(cta(FORA_DE_HORARIO)).toEqual({
      acao: ACOES.SEM_DESTINO,
      rotulo: 'Vale das 15h às 18h'
    });
  });

  it('minuto quebrado entra na frase, e o zero não vira "15h00"', () => {
    expect(cta({ ...FORA_DE_HORARIO, valid_hours_from: '09:30:00' }).rotulo)
      .toBe('Vale das 9h30 às 18h');
  });

  it('SEM a faixa no contrato, a frase é genérica — nunca um horário inventado', () => {
    // O backend recusa um sem o outro, mas o front não vive de promessa: um
    // horário adivinhado aqui é pior que a frase genérica.
    for (const parcial of [
      { valid_hours_from: '15:00:00', valid_hours_until: null },
      { valid_hours_from: null, valid_hours_until: '18:00:00' },
      { valid_hours_from: null, valid_hours_until: null }
    ]) {
      const resultado = cta({ ...FORA_DE_HORARIO, ...parcial });
      expect(resultado.rotulo, JSON.stringify(parcial)).toBe('Fora do horário');
      expect(resultado.acao, JSON.stringify(parcial)).toBe(ACOES.SEM_DESTINO);
    }
  });

  it('a sacola vazia NÃO muda nada: entrar no cardápio não adianta o relógio', () => {
    expect(cta(FORA_DE_HORARIO, true).acao).toBe(ACOES.SEM_DESTINO);
  });
});

describe('forma de pagamento: o card diz em qual vale, e leva onde se troca', () => {
  it('uma forma só', () => {
    expect(cta(SO_NO_PIX)).toEqual({ acao: ACOES.VER_PAGAMENTO, rotulo: 'Só no Pix' });
  });

  it('duas formas viram uma frase, não uma lista de códigos', () => {
    expect(cta({ ...SO_NO_PIX, allowed_payment_methods: ['pix', 'credit_card'] }).rotulo)
      .toBe('Só no Pix ou no cartão de crédito');
  });

  it('o CÓDIGO do backend nunca chega à tela', () => {
    // A regra da §14.5: tabela nominal, e o que não estiver nela vira a frase
    // genérica. `meal_voucher` enfeitado por replace(/_/g,' ') foi como
    // "minimum_order_not_reached" chegou a um toast do cliente.
    const desconhecida = cta({ ...SO_NO_PIX, allowed_payment_methods: ['cripto'] });
    expect(desconhecida.rotulo).toBe('Vale em outra forma de pagamento');
    expect(desconhecida.rotulo).not.toContain('cripto');
    const vale = cta({ ...SO_NO_PIX, allowed_payment_methods: ['meal_voucher'] });
    expect(vale.rotulo).toBe('Só no vale-refeição');
    expect(vale.rotulo).not.toContain('meal_voucher');
    expect(vale.rotulo).not.toContain('meal voucher');
  });

  it('lista ausente ou vazia cai na frase genérica', () => {
    // `null` quer dizer "vale em todas" e a lista vazia o backend recusa com
    // 422 — nos dois casos não há restrição a anunciar.
    for (const lista of [null, [], undefined]) {
      expect(cta({ ...SO_NO_PIX, allowed_payment_methods: lista }).rotulo)
        .toBe('Vale em outra forma de pagamento');
    }
  });
});

describe('e nenhum dos dois novos diz "Usar cupom" — era esse o defeito', () => {
  it('os cinco estados do contrato, e só um deles aplica', () => {
    const porEstado = {
      applicable: cta(APLICAVEL),
      missing_amount: cta(FALTA),
      login_required: cta(LOGIN),
      outside_hours: cta(FORA_DE_HORARIO),
      payment_method_not_allowed: cta(SO_NO_PIX)
    };
    const queAplicam = Object.entries(porEstado)
      .filter(([, resultado]) => resultado.acao === ACOES.APLICAR)
      .map(([estado]) => estado);
    expect(queAplicam).toEqual(['applicable']);
    for (const [estado, resultado] of Object.entries(porEstado)) {
      if (estado === 'applicable') continue;
      expect(resultado.rotulo, estado).not.toBe('Usar cupom');
    }
  });
});
