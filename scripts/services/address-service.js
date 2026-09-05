(function () {
  const auth = () => window.PedeAquiCustomerAuth;
  const store = () => window.RapidexStorage;
  const STORAGE_ADDRESS = store()?.KEYS.customerAddress || 'rapidex.customerAddress';
  const STORAGE_ADDRESS_LIST = store()?.KEYS.customerAddressList || 'rapidex.customerAddresses.local';
  const readKey = (key) => store()?.readWithMigration
    ? store().readWithMigration(key)
    : localStorage.getItem(key);

  // ==========================================================================
  //  O MONTADOR DA LINHA DE ENDEREÇO, e ele é UM.
  //
  //  Havia dois. Este, que soma com `filter(Boolean)`, e um segundo em
  //  `restaurant-page.js` que interpolava cru:
  //
  //      `${a.street}, ${a.number} - ${a.neighborhood}`
  //
  //  Interpolação crua não devolve string vazia quando falta o campo: devolve a
  //  PALAVRA `undefined`. A tela de Unidades e Operação escrevia
  //  `undefined, 450 - Aldeota` para qualquer endereço gravado sem `street` —
  //  e `street` falta de verdade, tanto que a linha logo abaixo aceita
  //  `street_name` como sinônimo. Quem grava por um caminho lia pelo outro.
  //
  //  É a §3.1 ("existe UM dono") aplicada a texto em vez de dinheiro, e o
  //  desfecho foi o mesmo: com dois donos, o errado é o que ganha nos sítios
  //  que não passam pelo certo.
  //
  //  Recebe o endereço CRU (aceita os dois nomes de rua), então serve tanto o
  //  `normalizeAddress` daqui quanto quem tem um objeto que nunca passou por
  //  ele. Nunca devolve `undefined`/`null` no meio do texto.
  // ==========================================================================
  function formatAddressSummary(address) {
    if (!address) return '';
    const street = address.street || address.street_name || '';
    const number = address.number || '';
    const neighborhood = address.neighborhood || '';
    const inicio = [street, number].filter(Boolean).join(', ');
    if (!inicio) return neighborhood ? String(neighborhood) : '';
    return inicio + (neighborhood ? ` - ${neighborhood}` : '');
  }

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
      postal_code: address.postal_code || address.zipcode || address.zip_code || address.cep || '',
      latitude: address.latitude ?? address.lat ?? null,
      longitude: address.longitude ?? address.lng ?? null,
      place_id: address.place_id || '',
      is_default: address.is_default === true || address.default === true || address.isDefault === true,
      summary: address.summary || formatAddressSummary(address)
    };
  }

  function readSelectedAddress() {
    try {
      return normalizeAddress(JSON.parse(readKey(STORAGE_ADDRESS) || 'null'));
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
      const list = JSON.parse(readKey(STORAGE_ADDRESS_LIST) || '[]');
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
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || !auth()?.getToken?.()) return Promise.resolve({ addresses: [] });
    return auth().importCustomerAddresses(list);
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
    formatAddressSummary,
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
