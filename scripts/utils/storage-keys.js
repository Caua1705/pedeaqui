// Single namespace for localStorage keys: rapidex.*
//
// The pilot has live customers whose data still sits under the old
// pedeaqui.* / rapidex_* names. Reads go through readWithMigration(), which
// copies a legacy value to the new key on first access and then removes the
// legacy one. Removing it matters: if the old key survived, logging out
// (which clears only the new key) would be undone by the next boot.
//
// Must be loaded before any script that touches storage.
(function () {
  const KEYS = {
    customerToken: 'rapidex.customer.token',
    customerProfile: 'rapidex.customer.profile',
    customerLocal: 'rapidex.customer.local',
    customerAddress: 'rapidex.customerAddress',
    customerAddressList: 'rapidex.customerAddresses.local',
    orders: 'rapidex.orders'
  };

  const PREFIXES = {
    operationContext: 'rapidex.operationContext.',
    addressImportSignature: 'rapidex.addressImportSignature.'
  };

  // new key -> legacy names it replaces, most recent first
  const LEGACY = {
    [KEYS.customerToken]: ['rapidex_customer_token'],
    [KEYS.customerProfile]: ['rapidex_customer'],
    [KEYS.customerLocal]: ['pedeaqui.customer'],
    [KEYS.customerAddress]: ['pedeaqui.customerAddress'],
    [KEYS.customerAddressList]: ['pedeaqui.customerAddresses.local'],
    [KEYS.orders]: ['pedeaqui.orders']
  };

  const LEGACY_PREFIXES = {
    [PREFIXES.operationContext]: ['rapidex_operation_context_'],
    [PREFIXES.addressImportSignature]: ['rapidex_address_import_signature_']
  };

  function legacyNamesFor(key) {
    if (LEGACY[key]) return LEGACY[key];
    // Prefixed key: rebuild the legacy name by swapping the prefix.
    for (const prefix of Object.keys(LEGACY_PREFIXES)) {
      if (key.startsWith(prefix)) {
        const suffix = key.slice(prefix.length);
        return LEGACY_PREFIXES[prefix].map(legacyPrefix => legacyPrefix + suffix);
      }
    }
    return [];
  }

  // Returns the raw string under `key`, migrating a legacy value in if needed.
  function readWithMigration(key) {
    let current = null;
    try { current = localStorage.getItem(key); } catch { return null; }
    if (current !== null) return current;

    for (const legacyKey of legacyNamesFor(key)) {
      let value = null;
      try { value = localStorage.getItem(legacyKey); } catch { continue; }
      if (value === null) continue;
      try {
        localStorage.setItem(key, value);
        localStorage.removeItem(legacyKey);
      } catch {
        // Quota or private-mode failure: still return the value we found.
      }
      return value;
    }
    return null;
  }

  function readJson(key, fallbackValue = null) {
    const raw = readWithMigration(key);
    if (raw === null) return fallbackValue;
    try { return JSON.parse(raw); } catch { return fallbackValue; }
  }

  window.RapidexStorage = { KEYS, PREFIXES, readWithMigration, readJson };
})();
