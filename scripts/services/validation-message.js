// ============================================================================
//  O 422 DO FASTAPI VIRA FRASE — e a frase é NOSSA.
//
//  `detail` de um 422 é um array de `{ loc, msg, type }`, e `msg` é o texto do
//  PYDANTIC: "value is not a valid email address", "String should have at least
//  8 characters", "Input should be a valid date". Em inglês, com vocabulário de
//  validador, para quem está preenchendo um cadastro em português. Ele ia CRU
//  para debaixo do campo.
//
//  É a mesma família do `ineligibility_reason` que virou coupon-reason.js: um
//  valor do backend que não foi escrito para o cliente ler chegando à tela. E a
//  correção tem a mesma forma — tabela NOMINAL, e o que não estiver nela cai
//  numa frase genérica em português, nunca num palpite e nunca no texto cru.
//
//  ## Por que a chave é o `type`, e não o `msg`
//
//  `type` é vocabulário fechado do pydantic v2 (`missing`, `string_too_short`,
//  `value_error`, `date_from_datetime_parsing`...) e não muda com a versão do
//  texto; `msg` é prosa e muda. Casar por prosa é o que faz uma tabela
//  envelhecer sem ninguém notar.
//
//  ## O que o backend de fato manda neste caminho
//
//  Levantado em `../pedeaqui_back/src/services/auth_service.py`: o cadastro
//  responde **400 com frase em português** ("Email inválido", "Aceite de
//  privacidade obrigatório") e **409** ("Email já cadastrado") — esses três não
//  passam por aqui, e não devem: já são texto de cliente. O 422 em array fica
//  para o que o pydantic barra ANTES do serviço: campo ausente, tipo errado,
//  `phone` com menos de 8 caracteres, `name` vazio, data que não parseia.
//
//  Na prática o front valida os mesmos campos antes de enviar, então este
//  caminho é o do DESACORDO — o dia em que o backend apertar uma regra que o
//  front não conhece. É exatamente o dia em que a mensagem precisa estar certa.
// ============================================================================
(function () {
  'use strict';

  // Frases por CAMPO, para os tipos em que a frase genérica seria pobre. O
  // nome do campo é o do CONTRATO (`loc` do 422), não o id do input.
  const POR_CAMPO = {
    email: {
      value_error: 'Informe um e-mail válido',
      string_too_short: 'Informe um e-mail válido'
    },
    phone: {
      value_error: 'Informe o telefone completo, com DDD',
      string_too_short: 'Informe o telefone completo, com DDD'
    },
    name: {
      string_too_short: 'Informe seu nome'
    },
    password: {
      string_too_short: 'Informe ao menos 8 caracteres'
    },
    birth_date: {
      value_error: 'O formato deve ser DD/MM/AAAA'
    },
    privacy_accepted: {
      bool_parsing: 'É necessário aceitar a política de privacidade',
      bool_type: 'É necessário aceitar a política de privacidade',
      missing: 'É necessário aceitar a política de privacidade'
    }
  };

  // Frases por TIPO, quando o campo não pede uma própria.
  const POR_TIPO = {
    missing: 'Campo obrigatório',
    string_too_short: 'Preenchimento muito curto',
    string_too_long: 'Preenchimento muito longo',
    string_type: 'Valor inválido',
    value_error: 'Valor inválido',
    bool_parsing: 'Valor inválido',
    bool_type: 'Valor inválido',
    date_type: 'O formato deve ser DD/MM/AAAA',
    date_parsing: 'O formato deve ser DD/MM/AAAA',
    date_from_datetime_parsing: 'O formato deve ser DD/MM/AAAA',
    date_from_datetime_inexact: 'O formato deve ser DD/MM/AAAA'
  };

  /**
   * A frase para UM item do `detail` de um 422.
   *
   * Devolve '' quando não conhece o tipo — e quem chama põe a frase genérica
   * dele. O que NUNCA sai daqui é o `msg` do pydantic.
   */
  function fieldErrorMessage(item) {
    const loc = Array.isArray(item?.loc) ? item.loc : [];
    const campo = String(loc[loc.length - 1] ?? '');
    const tipo = String(item?.type ?? '');
    return POR_CAMPO[campo]?.[tipo] || POR_TIPO[tipo] || '';
  }

  /** O campo (nome do contrato) a que um item do `detail` se refere. */
  function fieldOfError(item) {
    const loc = Array.isArray(item?.loc) ? item.loc : [];
    const ultimo = String(loc[loc.length - 1] ?? '');
    // `loc` começa em 'body'; um erro do corpo INTEIRO não é de campo nenhum.
    return ultimo && ultimo !== 'body' ? ultimo : '';
  }

  window.PedeAquiValidationMessage = { fieldErrorMessage, fieldOfError };
})();
