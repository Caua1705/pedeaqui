(function () {
  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function isValidPhone(value) {
    const digits = onlyDigits(value);
    return digits.length >= 10 && digits.length <= 11;
  }

  function isValidName(value) {
    return String(value || '').trim().length >= 2;
  }

  /**
   * Digitos verificadores do CPF (modulo 11). Recebe SO digitos — a mascara e
   * problema de quem le o input; use onlyDigits() antes.
   *
   * Havia duas copias disto, uma em restaurant-page.js (cadastro) e outra em
   * payment-card-flow.js (titular do cartao). Eram o mesmo algoritmo com nomes
   * de variavel diferentes, o que e o pior tipo de duplicata: nao da para
   * saber, olhando uma, se a outra ja divergiu. Regra de validacao de documento
   * muda por lei, e mudaria num arquivo so.
   *
   * A rejeicao dos 11 digitos repetidos e parte da regra, nao zelo extra:
   * 111.111.111-11 PASSA no modulo 11 e a Receita nao o emite.
   */
  function isValidCpf(digits) {
    const value = String(digits || '');
    if (value.length !== 11 || /^(\d)\1{10}$/.test(value)) return false;
    const check = (upTo, weightStart) => {
      let sum = 0;
      for (let i = 0; i < upTo; i++) sum += Number(value[i]) * (weightStart - i);
      const digit = (sum * 10) % 11;
      return digit === 10 ? 0 : digit;
    };
    if (check(9, 10) !== Number(value[9])) return false;
    return check(10, 11) === Number(value[10]);
  }

  window.PedeAquiValidators = {
    onlyDigits,
    isValidPhone,
    isValidName,
    isValidCpf
  };
})();
