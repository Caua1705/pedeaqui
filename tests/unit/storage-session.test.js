import { describe, it, expect, beforeAll } from 'vitest';

// storage-keys.js roda a migração no import, então o localStorage falso precisa
// existir ANTES — e já semeado com as chaves legadas que o piloto tem hoje.
function fakeLocalStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    get size() { return data.size; },
    has: key => data.has(key)
  };
}

const PILOT = { id: 'cus_1', name: 'Cliente Piloto', phone: '85999999999' };

let storage;
let store;

beforeAll(async () => {
  storage = fakeLocalStorage({
    // Estado de um cliente do piloto antes da Fase 3.
    'rapidex_customer_token': 'token-do-piloto',
    'rapidex.customer.local': JSON.stringify(PILOT)
  });
  globalThis.localStorage = storage;
  await import('../../scripts/utils/storage-keys.js');
  store = window.RapidexStorage;
});

describe('migração de sessão (o piloto não pode ser deslogado)', () => {
  it('traz o token legado para a chave nova', () => {
    expect(storage.getItem('rapidex.customer.token')).toBe('token-do-piloto');
    expect(storage.has('rapidex_customer_token')).toBe(false);
  });

  it('traz o perfil legado para a chave única de sessão', () => {
    expect(JSON.parse(storage.getItem('rapidex.customer.profile'))).toEqual(PILOT);
    expect(store.readSessionCustomer()).toEqual(PILOT);
  });

  it('apaga as chaves legadas, para o logout não ser desfeito no boot seguinte', () => {
    ['rapidex.customer.local', 'rapidex_customer', 'pedeaqui.customer', 'pedeaqui:customer']
      .forEach(key => expect(storage.has(key)).toBe(false));
  });
});

describe('sessão é global, carrinho é por slug', () => {
  it('nenhuma chave de sessão/endereço é sufixada por restaurante', () => {
    Object.values(store.KEYS).forEach(key => expect(key).not.toMatch(/\.$/));
    expect(store.KEYS.customerToken).toBe('rapidex.customer.token');
    expect(store.KEYS.customerProfile).toBe('rapidex.customer.profile');
    expect(store.KEYS.customerAddress).toBe('rapidex.customerAddress');
  });

  it('o carrinho é o dado namespaced por restaurante', () => {
    expect(store.PREFIXES.cart + 'junior-da-picanha').toBe('rapidex.cart.junior-da-picanha');
    expect(store.PREFIXES.cart + 'fuji').toBe('rapidex.cart.fuji');
    expect(store.PREFIXES.cart + 'junior-da-picanha').not.toBe(store.PREFIXES.cart + 'fuji');
  });

  it('não existe mais uma segunda chave de perfil', () => {
    expect(Object.values(store.KEYS)).not.toContain('rapidex.customer.local');
  });
});

describe('writeSessionCustomer', () => {
  it('mescla escritas parciais em vez de apagar campos já gravados', () => {
    store.writeSessionCustomer({ ...PILOT, birth_date: '1990-01-01' });
    // O login grava um recorte sem birth_date; ele não pode sumir.
    store.writeSessionCustomer({ id: 'cus_1', name: 'Cliente Piloto', phone: '85999999999' });
    expect(store.readSessionCustomer().birth_date).toBe('1990-01-01');
  });

  it('substitui (não mescla) quando é outro cliente', () => {
    store.writeSessionCustomer({ id: 'cus_1', name: 'Um', birth_date: '1990-01-01' });
    store.writeSessionCustomer({ id: 'cus_2', name: 'Outro' });
    const current = store.readSessionCustomer();
    expect(current.name).toBe('Outro');
    expect(current.birth_date).toBeUndefined();
  });

  it('clearSessionCustomer não deixa resíduo legado para trás', () => {
    store.writeSessionCustomer(PILOT);
    storage.setItem('rapidex.customer.local', JSON.stringify(PILOT));
    store.clearSessionCustomer();
    expect(store.readSessionCustomer()).toBeNull();
    expect(storage.has('rapidex.customer.local')).toBe(false);
  });
});
