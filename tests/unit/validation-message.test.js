import { describe, it, expect } from 'vitest';
import '../../scripts/services/validation-message.js';

// ============================================================================
//  O 422 do FastAPI, traduzido.
//
//  Mesma forma do coupon-reason.test.js, e pelo mesmo motivo: o backend manda
//  um valor que não foi escrito para o cliente ler, e a tabela que o traduz só
//  vale se estiver congelada num teste. O que este arquivo guarda é a REGRA
//  DURA — o `msg` do pydantic não sai daqui em hipótese nenhuma.
// ============================================================================

const { fieldErrorMessage, fieldOfError } = window.PedeAquiValidationMessage;

// Itens no formato de produção: `loc` começa em 'body', `msg` em inglês,
// `type` no vocabulário do pydantic v2.
const item = (campo, tipo, msg) => ({ loc: ['body', campo], msg, type: tipo });

describe('nenhum texto do pydantic chega à tela', () => {
  const DO_BACKEND = [
    item('email', 'value_error', 'value is not a valid email address'),
    item('password', 'string_too_short', 'String should have at least 8 characters'),
    item('phone', 'string_too_short', 'String should have at least 8 characters'),
    item('name', 'string_too_short', 'String should have at least 1 character'),
    item('birth_date', 'date_from_datetime_parsing', 'Input should be a valid date'),
    item('privacy_accepted', 'bool_parsing', 'Input should be a valid boolean'),
    item('email', 'missing', 'Field required')
  ];

  it('cada um vira frase em português', () => {
    for (const erro of DO_BACKEND) {
      const frase = fieldErrorMessage(erro);
      expect(frase, `${erro.loc[1]}/${erro.type} ficou sem frase`).toBeTruthy();
      expect(frase, 'o texto do pydantic vazou').not.toContain(erro.msg);
      expect(frase).not.toMatch(/should|valid boolean|Field required|String/);
    }
  });

  it('tipo desconhecido devolve vazio, para quem chama pôr a frase genérica', () => {
    // O contrário de um palpite: o front NÃO inventa uma frase para um tipo que
    // não conhece, e também não mostra o inglês.
    expect(fieldErrorMessage(item('email', 'tipo_que_nao_existe', 'whatever'))).toBe('');
    expect(fieldErrorMessage(null)).toBe('');
    expect(fieldErrorMessage({})).toBe('');
  });
});

describe('a frase é do CAMPO quando a genérica seria pobre', () => {
  it('senha curta diz o mínimo; e-mail inválido diz o que fazer', () => {
    expect(fieldErrorMessage(item('password', 'string_too_short'))).toContain('8');
    expect(fieldErrorMessage(item('email', 'value_error'))).toContain('e-mail');
    expect(fieldErrorMessage(item('phone', 'string_too_short'))).toContain('DDD');
    expect(fieldErrorMessage(item('privacy_accepted', 'missing'))).toContain('privacidade');
  });

  it('o mesmo tipo em campo sem frase própria cai na genérica', () => {
    expect(fieldErrorMessage(item('marketing_opt_in', 'missing'))).toBe('Campo obrigatório');
  });
});

describe('de que campo é o erro', () => {
  it('o último item de `loc` é o campo', () => {
    expect(fieldOfError(item('email', 'missing'))).toBe('email');
  });

  it('erro do corpo inteiro não é de campo nenhum', () => {
    // `loc: ['body']` acontece quando o JSON não é um objeto. Atribuí-lo a um
    // campo poria a mensagem debaixo do input errado.
    expect(fieldOfError({ loc: ['body'], type: 'missing' })).toBe('');
    expect(fieldOfError({})).toBe('');
  });
});
