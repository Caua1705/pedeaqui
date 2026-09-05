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

// ============================================================================
//  O ROTULO TEM DE NOMEAR O NUMERO QUE O LINK DISCA (05/09/2026).
//
//  A correcao de 03/09 arrumou o HREF e deixou o ROTULO: em Perfil > Ajuda e em
//  Informacoes o cliente lia "(85) 3025-3303 / (85) 3025-7808" num link so, e
//  ligava para o primeiro sem saber qual dos dois foi. Meia correcao parece uma
//  correcao — e esta metade nao tinha teste porque nenhum spec perguntava o que
//  estava ESCRITO no link, so para onde ele ia.
// ============================================================================
const { telLabel, whatsAppLabel } = window.PedeAquiContactLink;

describe('o rótulo do link é o número que o link disca', () => {
  const DOIS_NUMEROS = '(85) 3025-3303 / (85) 3025-7808';

  it('mostra só o primeiro número, não o campo inteiro', () => {
    expect(telLabel(DOIS_NUMEROS)).toBe('(85) 3025-3303');
  });

  it('preserva a máscara do lojista — não remonta os dígitos com máscara nossa', () => {
    expect(telLabel('85 3025.3303 / 85 3025.7808')).toBe('85 3025.3303');
    expect(telLabel('+55 (85) 3025-3303')).toBe('+55 (85) 3025-3303');
  });

  // A INVARIANTE, e é ela que impede a metade de voltar: rótulo e href
  // percorrem a MESMA divisão, na mesma ordem, com o mesmo piso. Se um dia os
  // pisos divergirem, o rótulo nomeia um número e o link abre outro — que é
  // exatamente o defeito que este bloco existe para barrar.
  it('rótulo e href nomeiam SEMPRE o mesmo número', () => {
    const campos = [
      DOIS_NUMEROS,
      '(85) 3025-3303 ramal 22',
      'ramal 22 / (85) 3025-3303',
      '(85) 9 9754-6465',
      '5532201234 / (85) 99999-0000'
    ];
    for (const campo of campos) {
      const href = telHref(campo);
      expect(href, campo).not.toBe('');
      expect(`tel:${telLabel(campo).replace(/\D+/g, '')}`, campo).toBe(href);
    }
  });

  it('o mesmo vale para o WhatsApp, com o piso dele (10 dígitos, que é o DDD)', () => {
    const campo = '3025-3303 / (85) 9 9754-6465';
    // O primeiro pedaço tem 8 dígitos: disca por `tel:`, mas NÃO vira wa.me —
    // um wa.me sem DDD é um link para outra pessoa.
    expect(telLabel(campo)).toBe('3025-3303');
    expect(whatsAppLabel(campo)).toBe('(85) 9 9754-6465');
    expect(whatsAppHref(campo)).toBe('https://wa.me/5585997546465');
  });

  it('campo sem número discável não vira rótulo nenhum', () => {
    expect(telLabel('falar com a Maria')).toBe('');
    expect(whatsAppLabel('removido-9f2a1c')).toBe('');
  });
});
