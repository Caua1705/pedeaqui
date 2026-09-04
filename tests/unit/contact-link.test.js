import { describe, it, expect } from 'vitest';
import '../../scripts/utils/contact-link.js';

// ============================================================================
//  De um campo de contato para um link — as três respostas que divergiam.
//
//  Este arquivo nasceu da varredura de "campo do contrato usado para MONTAR
//  alguma coisa", que é a família do telefone sentinela do entregador. Cada
//  bloco abaixo é um defeito que estava no ar, não um caso hipotético.
// ============================================================================

const { telHref, whatsAppHref, mailHref } = window.PedeAquiContactLink;

describe('o campo do lojista pode ter mais de um número', () => {
  // O TELEFONE DO PILOTO, copiado de tests/fixtures/info.json.
  const DOIS_NUMEROS = '(85) 3025-3303 / (85) 3025-7808';

  it('liga para o primeiro, e não para os vinte dígitos grudados', () => {
    expect(telHref(DOIS_NUMEROS)).toBe('tel:8530253303');
  });

  it('o ramal escrito depois não entra no número', () => {
    expect(telHref('(85) 3025-3303 ramal 22')).toBe('tel:8530253303');
  });

  it('e quando o primeiro pedaço não é telefone, o segundo é procurado', () => {
    expect(telHref('ramal 22 / (85) 3025-3303')).toBe('tel:8530253303');
  });
});

describe('o país entra por COMPRIMENTO, nunca por prefixo', () => {
  it('DDD 55 (Santa Maria/RS) não é confundido com país já digitado', () => {
    // O defeito: `startsWith('55')` fazia disto wa.me/5532201234, que o
    // WhatsApp lê como país 55 + DDD 32 — Juiz de Fora, outra pessoa.
    expect(whatsAppHref('(55) 3220-1234')).toBe('https://wa.me/555532201234');
    expect(whatsAppHref('(55) 99999-1234')).toBe('https://wa.me/5555999991234');
  });

  it('quem já veio com país não ganha um segundo 55', () => {
    // O defeito espelhado, do #infoModal pelo /menu: '55' + d, sempre.
    expect(whatsAppHref('5541999990000')).toBe('https://wa.me/5541999990000');
    expect(whatsAppHref('558530253303')).toBe('https://wa.me/558530253303');
  });

  it('o número nacional de 10 e de 11 dígitos ganha o 55', () => {
    expect(whatsAppHref('(85) 9 9754-6465')).toBe('https://wa.me/5585997546465');
    expect(whatsAppHref('8530253303')).toBe('https://wa.me/558530253303');
  });
});

describe('o que não é telefone não vira link', () => {
  it('o SENTINELA da conta excluída não sobrevive a nenhuma das duas portas', () => {
    // As letras do hex separam os dígitos em cacos de 1 a 3 — nenhum chega ao
    // piso. É o mesmo valor que virava wa.me/55<lixo> na tela do entregador.
    const sentinela = 'removido-4f2a1b6c8d9e0f1a2b3c4d5e6f708192';
    expect(telHref(sentinela)).toBe('');
    expect(whatsAppHref(sentinela)).toBe('');
  });

  it('texto do lojista, vazio e nulo', () => {
    for (const valor of ['não temos', 'ver no Instagram', '   ', '', null, undefined]) {
      expect(telHref(valor), `telHref(${JSON.stringify(valor)})`).toBe('');
      expect(whatsAppHref(valor), `whatsAppHref(${JSON.stringify(valor)})`).toBe('');
    }
  });

  it('sem DDD há discagem local, mas NÃO há WhatsApp', () => {
    // 8 dígitos discam dentro da cidade; no wa.me eles viram país e DDD de
    // outra pessoa, então o link não existe.
    expect(telHref('3025-3303')).toBe('tel:30253303');
    expect(whatsAppHref('3025-3303')).toBe('');
  });

  it('dígitos demais não são um telefone longo: não são um telefone', () => {
    expect(telHref('85302533038530257808')).toBe('');
    expect(whatsAppHref('85302533038530257808')).toBe('');
  });
});

describe('e-mail', () => {
  it('endereço vira mailto:', () => {
    expect(mailHref('contato@juniordapicanha.com.br')).toBe('mailto:contato@juniordapicanha.com.br');
    expect(mailHref('  contato@loja.com  ')).toBe('mailto:contato@loja.com');
  });

  it('o que não é endereço não vira alvo de toque', () => {
    for (const valor of ['não temos', 'contato', '@loja', 'a@b', 'a @ b.com', '', null]) {
      expect(mailHref(valor), `mailHref(${JSON.stringify(valor)})`).toBe('');
    }
  });
});
