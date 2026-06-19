(function () {
  const auth = () => window.PedeAquiCustomerAuth;
  const STORAGE_ADDRESS = 'pedeaqui.customerAddress';
  const STORAGE_ADDRESS_LIST = 'pedeaqui.customerAddresses.local';

  function normalizeAddress(address = {}) {
    if (!address) return null;
    const street = address.street || address.street_name || '';
    const number = address.number || '';
    const neighborhood = address.neighborhood || '';
    return {
      ...address,
      id: address.id || address.address_id || null,
      street,
      number,
      neighborhood,
      city: address.city || '',
      state: address.state || '',
      complement: address.complement || '',
      reference: address.reference || '',
      summary: address.summary || [street, number].filter(Boolean).join(', ') + (neighborhood ? ` - ${neighborhood}` : '')
    };
  }

  function readSelectedAddress() {
    try {
      return normalizeAddress(JSON.parse(localStorage.getItem(STORAGE_ADDRESS) || 'null'));
    } catch {
      return null;
    }
  }

  function saveSelectedAddress(address) {
    const normalized = normalizeAddress(address);
    if (normalized) localStorage.setItem(STORAGE_ADDRESS, JSON.stringify(normalized));
    return normalized;
  }

  function readLocalAddressList() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_ADDRESS_LIST) || '[]');
      return Array.isArray(list) ? list.map(normalizeAddress).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writeLocalAddressList(list) {
    const normalized = Array.isArray(list) ? list.map(normalizeAddress).filter(Boolean) : [];
    localStorage.setItem(STORAGE_ADDRESS_LIST, JSON.stringify(normalized));
    return normalized;
  }

  async function getCustomerAddresses() {
    const result = await auth()?.getCustomerAddresses?.();
    const list = Array.isArray(result) ? result : (result?.addresses || result?.items || result?.data || []);
    return Array.isArray(list) ? list.map(normalizeAddress).filter(Boolean) : [];
  }

  function createCustomerAddress(payload) {
    return auth()?.createCustomerAddress?.(payload);
  }

  function updateCustomerAddress(addressId, payload) {
    return auth()?.updateCustomerAddress?.(addressId, payload);
  }

  function deleteCustomerAddress(addressId) {
    return auth()?.deleteCustomerAddress?.(addressId);
  }

  function setDefaultCustomerAddress(addressId) {
    return auth()?.setDefaultCustomerAddress?.(addressId);
  }

  window.PedeAquiAddressService = {
    STORAGE_ADDRESS,
    STORAGE_ADDRESS_LIST,
    normalizeAddress,
    readSelectedAddress,
    saveSelectedAddress,
    readLocalAddressList,
    writeLocalAddressList,
    getCustomerAddresses,
    createCustomerAddress,
    updateCustomerAddress,
    deleteCustomerAddress,
    setDefaultCustomerAddress
  };
})();
