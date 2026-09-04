// ============================================================================
//  DE UM CAMPO DE CONTATO PARA UM LINK. Uma implementação.
//
//  A pergunta que este arquivo responde é sempre a mesma: "isto pode virar um
//  `tel:`, um `wa.me` ou um `mailto:` que vai PARA ONDE diz que vai?". Ela
//  estava respondida em SEIS lugares, com TRÊS respostas diferentes, e duas
//  delas montavam link para o número de outra pessoa.
//
//  ## O que estava errado, medido
//
//  1. `d.startsWith('55') ? d : '55' + d` (store-info-format, Perfil>Info e o
//     #infoModal pelo /info). **DDD 55 é Santa Maria/RS**: um fixo de lá tem 10
//     dígitos e começa com 55 ("5532201234"). A regra o toma por número que já
//     traz o país e monta `wa.me/5532201234`, que o WhatsApp lê como país 55 +
//     DDD 32 (Juiz de Fora). Uma região inteira com o botão de WhatsApp
//     apontando para a pessoa errada.
//
//  2. `'55' + d`, sempre (o #infoModal pelo /menu). Erra ao contrário: quem
//     digitou o país vira `555541999990000`.
//
//  3. `onlyDigits()` no campo INTEIRO (todos, para o `tel:`). O telefone do
//     piloto é "(85) 3025-3303 / (85) 3025-7808" — dois números, como o lojista
//     digitou —, e o link dialava os VINTE dígitos grudados. Não tinha sintoma
//     na tela: o rótulo mostra o texto original, bonito.
//
//  ## A regra
//
//  Um campo de contato é TEXTO LIVRE de lojista: pode trazer dois números, um
//  ramal, um "falar com a Maria" — ou, no caso do cliente, o sentinela
//  `removido-<hex>` que o backend grava ao excluir a conta. Então tudo que não
//  é dígito nem máscara de telefone SEPARA, e o primeiro pedaço com quantidade
//  plausível de dígitos é o telefone. O sentinela cai fora sozinho: as letras
//  do hex separam os dígitos em cacos de 1 a 3, e nenhum chega ao piso.
//
//  Os pisos não são palpite:
//
//   - `tel:` aceita 8 a 13 dígitos. Oito é o `Field(min_length=8)` que o
//     backend exige de um telefone de cliente (auth_schema.py), e é o número
//     local sem DDD, que disca dentro da mesma cidade.
//   - `wa.me` exige 10 a 13. Abaixo disso não há DDD, e um link sem DDD não é
//     um link incompleto: é um link para OUTRA pessoa, porque o WhatsApp lê os
//     primeiros dígitos como país e DDD de qualquer jeito.
//
//  E o país entra por COMPRIMENTO, nunca por prefixo: 10 ou 11 dígitos é
//  número nacional e ganha o 55; 12 ou 13 já vem com país e não se mexe. Esta é
//  a regra que o entregador já usava, e a única das três que acerta o DDD 55.
//
//  ASSUMIDO, e escrito porque tem custo: telefone BRASILEIRO. Um número
//  estrangeiro de 10 ou 11 dígitos ganharia um 55 que não é dele. O app é de um
//  produto brasileiro, o backend normaliza para dígitos e todos os DDIs deste
//  repositório são 55 — quando isso mudar, muda aqui, num lugar só.
//
//  Guardas: tests/unit/contact-link.test.js e tests/e2e/store-contact-links.spec.js.
// ============================================================================
(function () {
  'use strict';

  // Dígito, espaço e máscara ficam; QUALQUER outra coisa separa — inclusive
  // letra, que é o que desmonta o sentinela do backend e o "ramal".
  const SEPARADOR = /[^\d\s()+.-]+/;

  const DDI_BR = '55';

  /** Os grupos de dígitos do campo, na ordem em que foram escritos. */
  function gruposDeDigitos(value) {
    return String(value ?? '')
      .split(SEPARADOR)
      .map(parte => parte.replace(/\D+/g, ''))
      .filter(Boolean);
  }

  /** O primeiro grupo com tamanho plausível, ou '' quando não há telefone. */
  function primeiroTelefone(value, minimo, maximo) {
    return gruposDeDigitos(value).find(d => d.length >= minimo && d.length <= maximo) || '';
  }

  /** `tel:` do primeiro número do campo. '' quando não há número discável. */
  function telHref(value) {
    const digitos = primeiroTelefone(value, 8, 13);
    return digitos ? `tel:${digitos}` : '';
  }

  /** `https://wa.me/` do primeiro número com DDD. '' quando não dá para saber. */
  function whatsAppHref(value) {
    const digitos = primeiroTelefone(value, 10, 13);
    if (!digitos) return '';
    return `https://wa.me/${digitos.length <= 11 ? `${DDI_BR}${digitos}` : digitos}`;
  }

  /**
   * `mailto:` quando o campo é um endereço. '' quando não é.
   *
   * NÃO é validação de e-mail — é a pergunta "isto pode virar um mailto:".
   * Um @ com algo dos dois lados, um ponto depois dele e nenhum espaço: o
   * suficiente para que "não temos" e "ver no Instagram" não virem um alvo de
   * toque que abre o cliente de e-mail com lixo no destinatário.
   */
  function mailHref(value) {
    const email = String(value ?? '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : '';
  }

  window.PedeAquiContactLink = { telHref, whatsAppHref, mailHref, primeiroTelefone };
})();
