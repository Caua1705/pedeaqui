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

  window.PedeAquiValidators = {
    onlyDigits,
    isValidPhone,
    isValidName
  };
})();
