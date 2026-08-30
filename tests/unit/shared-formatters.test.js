import { describe, it, expect, beforeAll } from 'vitest';

// As três coisas que tinham mais de uma implementação e agora têm uma. O que
// este arquivo prova NÃO é "a função funciona" — é que a implementação única
// devolve o que CADA um dos chamadores antigos devolvia, e que nos dois pontos
// em que as versões divergiam a escolhida é a que não mente na tela.
//
// Ordem de import = ordem do entry-restaurant.js: coupon-format lê o
// formatador de moeda, então currency vem antes. Se alguém inverter a ordem
// lá, isto aqui não pega — quem pega é o E2E, que roda o bundle real.
beforeAll(async () => {
  await import('../../scripts/utils/currency.js');
  await import('../../scripts/utils/validators.js');
  await import('../../scripts/services/coupon-format.js');
  await import('../../scripts/services/card-format.js');
});

// O separador que o Intl poe entre "R$" e o numero e ESPACO NAO SEPARAVEL
// (U+00A0), nao espaco comum. Escrever o literal aqui e erro de lint (e um
// caractere invisivel numa asserção e armadilha), entao ele vira espaco.
const nbsp = (text) => text.replace(/\u00A0/g, ' ');

describe('formatCurrency — o formatador que havia em quatro arquivos', () => {
  it('escreve real brasileiro como as quatro versões escreviam', () => {
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(7.05))).toBe('R$ 7,05');
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(0))).toBe('R$ 0,00');
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(1234.5))).toBe('R$ 1.234,50');
  });

  it('string decimal do contrato novo chega formatada, não como NaN', () => {
    // `min_order_value`, `discount_amount` e `missing_amount` vêm da API como
    // STRING. Era assim que as versões antigas recebiam, e continua sendo.
    expect(nbsp(window.PedeAquiCurrency.formatCurrency('30.00'))).toBe('R$ 30,00');
  });

  it('valor ausente vira zero, nunca "R$ NaN" na tela do cliente', () => {
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(undefined))).toBe('R$ 0,00');
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(null))).toBe('R$ 0,00');
    expect(nbsp(window.PedeAquiCurrency.formatCurrency('abacaxi'))).toBe('R$ 0,00');
  });

  it('a moeda é parâmetro — o extrato de cashback lê `currency` da API', () => {
    // Esta era a única diferença real da versão de cashback-statement.js, e é
    // a razão de o parâmetro existir. Sem ele, uma conta em outra moeda seria
    // exibida com cifrão de real.
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(10, 'USD'))).toBe('US$ 10,00');
    expect(nbsp(window.PedeAquiCurrency.formatCurrency(10, 'brl'))).toBe('R$ 10,00');
  });
});

describe('isValidCpf — a validação que havia no cadastro e no cartão', () => {
  it('aceita CPF válido e recusa dígito verificador errado', () => {
    expect(window.PedeAquiValidators.isValidCpf('11144477735')).toBe(true);
    expect(window.PedeAquiValidators.isValidCpf('52998224725')).toBe(true);
    expect(window.PedeAquiValidators.isValidCpf('11144477734')).toBe(false);
  });

  it('recusa os onze dígitos repetidos — que PASSAM no módulo 11', () => {
    // Não é zelo extra: 111.111.111-11 fecha a conta dos dois dígitos e a
    // Receita não o emite. Sem esta linha, o cadastro e o titular do cartão
    // aceitariam dez documentos inexistentes.
    for (let d = 0; d <= 9; d++) {
      expect(window.PedeAquiValidators.isValidCpf(String(d).repeat(11))).toBe(false);
    }
  });

  it('recusa comprimento errado sem estourar', () => {
    for (const entrada of ['', '123', '1234567890', '123456789012']) {
      expect(window.PedeAquiValidators.isValidCpf(entrada)).toBe(false);
    }
  });
});

describe('couponLabel — as DUAS versões divergiam, e em quê', () => {
  const label = (coupon) => nbsp(window.PedeAquiCouponFormat.couponLabel(coupon));

  it('o caminho normal é `title`, que os dois contratos já mandam pronto', () => {
    // Em CustomerCouponResponse `discount_value` NÃO EXISTE. Recalcular a
    // partir dele foi o defeito do "0% OFF"; ler `title` é o caminho.
    expect(label({ title: '10% OFF', discount_type: 'percent', discount_value: 0 })).toBe('10% OFF');
  });

  it('DIVERGÊNCIA 1: cupom fixo sem valor não vira "R$ 0,00 OFF"', () => {
    // A versão do Clube reconhecia `fixed` e imprimia o valor sem conferir se
    // havia valor — o mesmo defeito que o comentário daquele arquivo conta ter
    // acontecido do lado percentual. Ficou a regra da folha de detalhe: só
    // imprime valor se houver valor.
    expect(label({ discount_type: 'fixed', name: 'Cupom de boas-vindas' }))
      .toBe('Cupom de boas-vindas');
    expect(label({ discount_type: 'fixed_amount', discount_value: 0, name: 'Bem-vindo' }))
      .toBe('Bem-vindo');
    // Com valor, continua imprimindo como as duas faziam.
    expect(label({ discount_type: 'fixed', discount_value: 15 })).toBe('R$ 15,00 OFF');
  });

  it('DIVERGÊNCIA 2: sem título nem nome, o código identifica; "Cupom" não', () => {
    expect(label({ code: 'JP10' })).toBe('JP10');
    expect(label({})).toBe('Cupom');
  });

  it('percentual e frete grátis saem como nas duas versões', () => {
    expect(label({ discount_type: 'percent', discount_value: 10 })).toBe('10% OFF');
    expect(label({ discount_type: 'percentage', discount_value: 12.5 })).toBe('12,5% OFF');
    expect(label({ discount_type: 'free_delivery' })).toBe('Frete grátis');
    expect(label({ discount_type: 'free_shipping' })).toBe('Frete grátis');
  });

  it('valor em string decimal, que é como a API manda', () => {
    expect(label({ discount_type: 'fixed', discount_value: '30.00' })).toBe('R$ 30,00 OFF');
    expect(window.PedeAquiCouponFormat.couponAmount('30.00')).toBe(30);
    expect(window.PedeAquiCouponFormat.couponAmount(undefined)).toBe(0);
    expect(window.PedeAquiCouponFormat.couponAmount('abacaxi')).toBe(0);
  });

  it('cupom nulo não derruba a renderização da lista', () => {
    expect(label(null)).toBe('Cupom');
  });
});

// ---------------------------------------------------------------------------
describe('cardBrandLabel — a tabela de bandeiras que havia em dois arquivos', () => {
  const label = (v) => window.PedeAquiCardFormat.cardBrandLabel(v);

  // As duas versoes (`brandLabel` em payment-card-flow.js e
  // `savedCardBrandLabel` em restaurant-page.js) eram copias exatas — nao havia
  // divergencia a resolver. O que este bloco prova e que a implementacao unica
  // devolve o que as DUAS devolviam, incluindo os dois caminhos que ninguem
  // olha: bandeira desconhecida e bandeira ausente.
  it('cada chave da tabela sai como as duas versões escreviam', () => {
    expect(label('visa')).toBe('Visa');
    expect(label('master')).toBe('Mastercard');
    expect(label('mastercard')).toBe('Mastercard');
    expect(label('amex')).toBe('American Express');
    expect(label('american_express')).toBe('American Express');
    expect(label('elo')).toBe('Elo');
    expect(label('hiper')).toBe('Hiper');
  });

  it('a bandeira chega em qualquer caixa e continua casando', () => {
    // O gateway ja mandou 'Visa' e 'VISA'; a tabela e minuscula de proposito.
    expect(label('VISA')).toBe('Visa');
    expect(label('MasterCard')).toBe('Mastercard');
  });

  it('bandeira que a tabela não conhece vira o próprio nome, não um vazio', () => {
    // Bandeira nova no gateway (hipercard, aura) tem de aparecer legivel na
    // linha de pagamento em vez de sumir — a alternativa e o cliente ver
    // "Crédito -  •••• 1234" e nao saber qual cartao escolheu.
    expect(label('hipercard')).toBe('Hipercard');
    expect(label('aura')).toBe('Aura');
  });

  it('sem bandeira nenhuma, "Cartão" — e nunca "undefined" na tela', () => {
    expect(label('')).toBe('Cartão');
    expect(label(null)).toBe('Cartão');
    expect(label(undefined)).toBe('Cartão');
  });
});
