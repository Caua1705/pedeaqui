(function () {
  const auth = () => window.PedeAquiCustomerAuth;

  function normalizeCustomer(customer = {}) {
    if (!customer) return null;
    return {
      id: customer.id || null,
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      birth_date: customer.birth_date || ''
    };
  }

  async function getCurrentCustomer() {
    const current = await auth()?.getCurrentCustomer?.();
    return normalizeCustomer(current);
  }

  async function updateCurrentCustomer(payload) {
    const current = await auth()?.updateCurrentCustomer?.(payload);
    return normalizeCustomer(current);
  }

  function getStoredCustomer() {
    return normalizeCustomer(auth()?.getStoredCustomer?.());
  }

  function isLoggedIn() {
    return Boolean(auth()?.isLoggedIn?.());
  }

  function loginCustomer(payload) {
    return auth()?.loginCustomer?.(payload);
  }

  function registerCustomer(payload) {
    return auth()?.registerCustomer?.(payload);
  }

  function logout() {
    return auth()?.logout?.();
  }

  window.PedeAquiCustomerService = {
    normalizeCustomer,
    getCurrentCustomer,
    updateCurrentCustomer,
    getStoredCustomer,
    isLoggedIn,
    loginCustomer,
    registerCustomer,
    logout
  };
})();
