import { describe, it, expect } from 'vitest';
import '../../scripts/services/address-service.js';

// ============================================================================
//  A LINHA DE ENDERECO NUNCA ESCREVE "undefined" NA TELA.
//
//  Havia DOIS montadores para a mesma linha. Este servico somava com
//  `filter(Boolean)`; `restaurant-page.js` interpolava cru:
//
//      `${a.street}, ${a.number} - ${a.neighborhood}`
//
//  Interpolacao crua nao devolve string vazia quando falta o campo: devolve a
//  PALAVRA `undefined`. A tela de Unidades e Operacao escrevia
//  "undefined, 450 - Aldeota" para qualquer endereco gravado sem `street` — e
//  `street` falta de verdade, tanto que `normalizeAddress` aceita `street_name`
//  como sinonimo. A lista do Perfil nunca mostrou isso porque passa pelo
//  servico; era so o caminho que nao normalizava.
//
//  E a §3.1 ("existe UM dono") aplicada a texto em vez de dinheiro: com dois
//  donos, o errado e o que ganha nos sitios que nao passam pelo certo.
// ============================================================================
const { formatAddressSummary, normalizeAddress } = window.PedeAquiAddressService;

describe('nenhum campo ausente vira palavra na tela', () => {
  // A SONDA CONTRA VACUIDADE: se um dia esta funcao sumir ou parar de ser
  // exportada, o `undefined` viraria `''` em toda chamada e o arquivo inteiro
  // passaria por vazio, que e a pior forma de passar.
  it('a funcao existe e monta o caso completo', () => {
    expect(typeof formatAddressSummary).toBe('function');
    expect(formatAddressSummary({ street: 'Rua Silva Paulet', number: '450', neighborhood: 'Aldeota' }))
      .toBe('Rua Silva Paulet, 450 - Aldeota');
  });

  // O CASO REAL, copiado do contexto de operacao que a captura fotografou.
  it('endereço gravado com street_name não escreve "undefined"', () => {
    const guardado = { street_name: 'Rua Silva Paulet', number: '450', neighborhood: 'Aldeota' };
    expect(formatAddressSummary(guardado)).toBe('Rua Silva Paulet, 450 - Aldeota');
  });

  it('nenhuma combinação de campos faltando produz "undefined" ou "null"', () => {
    const campos = ['street', 'number', 'neighborhood'];
    // As 8 combinacoes de presente/ausente, cada uma com os tres jeitos de
    // "nao veio": ausente, undefined explicito e null.
    for (const vazio of [undefined, null]) {
      for (let mascara = 0; mascara < 8; mascara++) {
        const endereco = {};
        campos.forEach((campo, i) => {
          endereco[campo] = (mascara >> i) & 1 ? `v-${campo}` : vazio;
        });
        const linha = formatAddressSummary(endereco);
        expect(linha, JSON.stringify(endereco)).not.toMatch(/undefined|null/);
      }
    }
  });

  it('sem endereço nenhum devolve string vazia, não "undefined, undefined"', () => {
    expect(formatAddressSummary(null)).toBe('');
    expect(formatAddressSummary(undefined)).toBe('');
    expect(formatAddressSummary({})).toBe('');
  });

  it('só o bairro ainda é informação, e sai sem a vírgula solta', () => {
    expect(formatAddressSummary({ neighborhood: 'Aldeota' })).toBe('Aldeota');
  });

  it('sem número não deixa a vírgula pendurada', () => {
    expect(formatAddressSummary({ street: 'Rua Silva Paulet', neighborhood: 'Aldeota' }))
      .toBe('Rua Silva Paulet - Aldeota');
  });

  // O DONO E UM: `normalizeAddress` tem de produzir a MESMA linha, senao os
  // dois caminhos voltam a divergir — que e o defeito inteiro.
  it('normalizeAddress usa este montador, não uma segunda cópia', () => {
    const cru = { street_name: 'Rua Silva Paulet', number: '450', neighborhood: 'Aldeota' };
    expect(normalizeAddress(cru).summary).toBe(formatAddressSummary(cru));
    expect(normalizeAddress({ number: '450' }).summary).toBe(formatAddressSummary({ number: '450' }));
  });

  // O `summary` que ja veio pronto continua vencendo: e o que o backend ou o
  // Google escreveram, e reescrever por cima perderia complemento e referencia.
  it('um summary já pronto não é reescrito', () => {
    expect(normalizeAddress({ summary: 'Av. Beira Mar, 1000 - Meireles', street: 'x' }).summary)
      .toBe('Av. Beira Mar, 1000 - Meireles');
  });
});
