(function () {
  const state = {
    customer: null,
    selectedAddress: null,
    addresses: null,
    orders: null,
    profileLoaded: false
  };

  function get() {
    return { ...state };
  }

  function set(partial = {}) {
    Object.assign(state, partial);
    return get();
  }

  function setCustomer(customer) {
    state.customer = customer || null;
    return get();
  }

  function setSelectedAddress(address) {
    state.selectedAddress = address || null;
    return get();
  }

  function setAddresses(addresses) {
    state.addresses = Array.isArray(addresses) ? addresses : [];
    return get();
  }

  function setOrders(orders) {
    state.orders = Array.isArray(orders) ? orders : [];
    return get();
  }

  function clear(options = {}) {
    const keepSelectedAddress = options.keepSelectedAddress !== false;
    state.customer = null;
    if (!keepSelectedAddress) state.selectedAddress = null;
    state.addresses = null;
    state.orders = null;
    state.profileLoaded = false;
    return get();
  }

  window.PedeAquiCustomerStore = {
    get,
    set,
    setCustomer,
    setSelectedAddress,
    setAddresses,
    setOrders,
    clear
  };
})();
