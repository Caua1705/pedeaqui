(function () {
  const key = `${window.APP_CONFIG?.STORAGE_PREFIX || 'pedeaqui'}:customer`;

  function read() {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  }

  function write(nextState) {
    const state = { ...read(), ...nextState };
    localStorage.setItem(key, JSON.stringify(state));
    return state;
  }

  function clear() {
    localStorage.removeItem(key);
  }

  window.PedeAquiCustomerState = {
    getCustomer: read,
    saveCustomer: write,
    clearCustomer: clear,
    getAddress: () => read().address || null,
    saveAddress: address => write({ address })
  };
})();
