// Namespace único de localStorage: rapidex.*
//
// ---------------------------------------------------------------------------
// O QUE É GLOBAL E O QUE É POR RESTAURANTE
// ---------------------------------------------------------------------------
// A conta é do RAPIDEX, não do restaurante — o backend é assim (customers.phone
// é Unique na tabela inteira, customers não tem restaurant_id, e é orders que
// carrega restaurant_id). O front segue o mesmo modelo:
//
//   GLOBAL (vale em todos os slugs)
//     rapidex.customer.token      sessão/JWT
//     rapidex.customer.profile    perfil do cliente — FONTE ÚNICA
//     rapidex.customerAddress     endereço selecionado
//     rapidex.customerAddresses.local  endereços ainda não sincronizados
//     rapidex.orders              pedidos feitos neste dispositivo
//
//   POR RESTAURANTE (sufixadas com o slug)
//     rapidex.cart.<slug>              carrinho — o ÚNICO dado que não pode vazar
//     rapidex.operationContext.<slug>  entrega/retirada + unidade escolhida
//     rapidex.addressImportSignature.<slug>
//     rapidex.orderTracking.<slug>     tracking_token dos pedidos feitos aqui
//
// orderTracking é por restaurante porque o token só vale na rota daquele slug
// (GET /restaurants/<slug>/orders/track/<token>). Guardar tudo numa lista só
// obrigaria a carregar o token de uma loja para descobrir que ele é de outra.
//
// Quem logou em /junior-da-picanha continua logado em /fuji: mesma conta
// Rapidex. O que NÃO atravessa é o carrinho — o do Júnior não aparece no Fuji.
//
// Na topologia de subdomínio (<slug>.rapidex.com) o localStorage passa a ser por
// origem, então cada subdomínio teria sua própria sessão. O carrinho continua
// isolado de graça (é outra origem), mas a sessão global exige mover token e
// perfil para um cookie de domínio (Domain=.rapidex.com), servido pelo backend.
// Por isso o acesso à sessão está concentrado em readSession/writeSession/
// clearSession: trocar o backing store é mexer só nestas três funções.
//
// ---------------------------------------------------------------------------
// MIGRAÇÃO
// ---------------------------------------------------------------------------
// O piloto tem clientes com dados sob nomes antigos. Leituras passam por
// readWithMigration(), que copia o valor legado para a chave nova no primeiro
// acesso e apaga o legado. Apagar importa: se o antigo sobrevivesse, o logout
// (que limpa só a chave nova) seria desfeito no boot seguinte.
//
// Precisa ser carregado antes de qualquer script que toque em storage.
(function () {
  const KEYS = {
    customerToken: 'rapidex.customer.token',
    // Perfil do cliente. ÚNICA fonte de sessão: antes coexistiam
    // rapidex.customer.profile (auth) e rapidex.customer.local (página), com o
    // mesmo cliente gravado em duas chaves que podiam divergir.
    customerProfile: 'rapidex.customer.profile',
    customerAddress: 'rapidex.customerAddress',
    customerAddressList: 'rapidex.customerAddresses.local',
    orders: 'rapidex.orders'
  };

  const PREFIXES = {
    operationContext: 'rapidex.operationContext.',
    addressImportSignature: 'rapidex.addressImportSignature.',
    cart: 'rapidex.cart.',
    orderTracking: 'rapidex.orderTracking.'
  };

  // chave nova -> nomes legados que ela substitui, do mais recente para o mais antigo
  const LEGACY = {
    [KEYS.customerToken]: ['rapidex_customer_token'],
    [KEYS.customerProfile]: [
      'rapidex.customer.local',
      'rapidex_customer',
      'pedeaqui.customer',
      'pedeaqui:customer'
    ],
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
    // Chave com prefixo: reconstrói o nome legado trocando o prefixo.
    for (const prefix of Object.keys(LEGACY_PREFIXES)) {
      if (key.startsWith(prefix)) {
        const suffix = key.slice(prefix.length);
        return LEGACY_PREFIXES[prefix].map(legacyPrefix => legacyPrefix + suffix);
      }
    }
    return [];
  }

  function readRaw(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeRaw(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }

  function removeRaw(key) {
    try { localStorage.removeItem(key); } catch { /* modo privativo */ }
  }

  // Devolve a string sob `key`, migrando um valor legado se preciso.
  function readWithMigration(key) {
    const current = readRaw(key);
    if (current !== null) return current;

    for (const legacyKey of legacyNamesFor(key)) {
      const value = readRaw(legacyKey);
      if (value === null) continue;
      writeRaw(key, value);
      removeRaw(legacyKey);
      return value;
    }
    return null;
  }

  function readJson(key, fallbackValue = null) {
    const raw = readWithMigration(key);
    if (raw === null) return fallbackValue;
    try { return JSON.parse(raw); } catch { return fallbackValue; }
  }

  /* ---------- Sessão do cliente (global, fonte única) ---------- */

  function readSessionCustomer() {
    const value = readJson(KEYS.customerProfile, null);
    return value && typeof value === 'object' ? value : null;
  }

  // Grava mesclando com o que já está lá: o app escreve o perfil de dois pontos
  // com recortes diferentes (o login não traz birth_date, /customers/me traz), e
  // sem mesclar a escrita mais pobre apagaria campos válidos. Cliente diferente
  // substitui em vez de mesclar — senão sobrariam campos do cliente anterior.
  function writeSessionCustomer(customer) {
    if (!customer || typeof customer !== 'object') return null;
    const current = readSessionCustomer();
    const sameCustomer = !current?.id || !customer.id || String(current.id) === String(customer.id);
    const merged = sameCustomer ? { ...current, ...customer } : { ...customer };
    writeRaw(KEYS.customerProfile, JSON.stringify(merged));
    return merged;
  }

  // Logout: some com a chave nova E com todos os nomes legados, para que o boot
  // seguinte não ressuscite a sessão a partir de um resíduo.
  function clearSessionCustomer() {
    removeRaw(KEYS.customerProfile);
    legacyNamesFor(KEYS.customerProfile).forEach(removeRaw);
  }

  // Consolida as chaves de sessão duplicadas UMA vez, no boot, sem depender de
  // alguém ler a chave certa primeiro. O piloto não é deslogado: se a chave nova
  // não existir, o primeiro valor legado válido vira a sessão.
  function migrateSessionKeys() {
    readWithMigration(KEYS.customerToken);
    if (readRaw(KEYS.customerProfile) === null) readWithMigration(KEYS.customerProfile);
    // A partir daqui a chave nova manda; os resíduos legados só confundiriam.
    legacyNamesFor(KEYS.customerProfile).forEach(removeRaw);
  }

  migrateSessionKeys();

  window.RapidexStorage = {
    KEYS,
    PREFIXES,
    readWithMigration,
    readJson,
    readSessionCustomer,
    writeSessionCustomer,
    clearSessionCustomer
  };
})();
