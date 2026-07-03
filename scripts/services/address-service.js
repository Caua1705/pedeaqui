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
      postal_code: address.postal_code || address.zip_code || address.cep || '',
      latitude: address.latitude ?? address.lat ?? null,
      longitude: address.longitude ?? address.lng ?? null,
      place_id: address.place_id || '',
      is_default: address.is_default === true || address.default === true || address.isDefault === true,
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
    const payload = result?.data ?? result;
    const list = Array.isArray(payload) ? payload : (payload?.addresses || payload?.items || payload?.data || []);
    return Array.isArray(list) ? list.map(normalizeAddress).filter(Boolean) : [];
  }

  function createCustomerAddress(payload) {
    return auth()?.createCustomerAddress?.(payload);
  }

  function importCustomerAddresses(addresses) {
    return auth()?.importCustomerAddresses?.(addresses);
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
    importCustomerAddresses,
    updateCustomerAddress,
    deleteCustomerAddress,
    setDefaultCustomerAddress
  };
})();
