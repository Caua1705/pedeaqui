import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// O tracking_token é a ÚNICA porta do visitante para o próprio pedido depois que
// a API removeu a consulta por telefone. Perder o token = perder o pedido, então
// o que este arquivo protege é bem específico: que ele seja gravado, que não
// vaze entre restaurantes e que expire.

function fakeLocalStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    keys: () => [...data.keys()],
    get size() { return data.size; }
  };
}

const SLUG = 'junior-da-picanha';
const OTHER_SLUG = 'fuji-sushi';
const KEY = `rapidex.orderTracking.${SLUG}`;

const orderResponse = (n = 1, overrides = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  order_number: 4200 + n,
  tracking_token: `trk_${n}`,
  status: 'pending',
  payment_flow: 'online',
  payment_status: 'pending',
  total: 22.14,
  message: 'Pedido criado com sucesso',
  ...overrides
});

let storage;
let tracking;

beforeAll(async () => {
  storage = fakeLocalStorage();
  globalThis.localStorage = storage;
  await import('../../scripts/utils/storage-keys.js');
  await import('../../scripts/state/order-tracking.js');
  tracking = window.RapidexOrderTracking;
});

beforeEach(() => {
  storage.keys().forEach(key => storage.removeItem(key));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('remember', () => {
  it('guarda o tracking_token da resposta de criação sob o slug', () => {
    const entry = tracking.remember(SLUG, orderResponse(1));

    expect(entry.tracking_token).toBe('trk_1');
    expect(storage.getItem(KEY)).toBeTruthy();
    expect(tracking.latest(SLUG)).toMatchObject({
      tracking_token: 'trk_1',
      order_number: 4201,
      payment_flow: 'online',
      payment_status: 'pending'
    });
  });

  it('devolve null quando a resposta vem SEM tracking_token', () => {
    // Sem token o visitante fica sem acesso ao pedido — quem chama precisa
    // conseguir perceber isso em vez de gravar uma entrada inútil.
    expect(tracking.remember(SLUG, orderResponse(1, { tracking_token: '' }))).toBeNull();
    expect(tracking.latest(SLUG)).toBeNull();
  });

  it('não deixa o pedido de um restaurante aparecer no outro', () => {
    tracking.remember(SLUG, orderResponse(1));
    tracking.remember(OTHER_SLUG, orderResponse(2));

    expect(tracking.list(SLUG).map(e => e.tracking_token)).toEqual(['trk_1']);
    expect(tracking.list(OTHER_SLUG).map(e => e.tracking_token)).toEqual(['trk_2']);
  });

  it('atualiza em vez de duplicar quando o MESMO token volta', () => {
    // É o que uma retentativa idempotente produz: a API devolve o pedido
    // original, com o token original.
    tracking.remember(SLUG, orderResponse(1));
    tracking.remember(SLUG, orderResponse(1, { status: 'confirmed' }));

    expect(tracking.list(SLUG)).toHaveLength(1);
    expect(tracking.latest(SLUG).status).toBe('confirmed');
  });

  it('guarda a foto dos itens, que nenhuma rota do ciclo devolve de volta', () => {
    // O carrinho é esvaziado no instante em que o pedido é criado. Esta cópia é
    // a única fonte de "Ver itens do pedido" para quem recarrega a página
    // durante a cobrança.
    tracking.remember(SLUG, orderResponse(1), {
      items: [{ name: 'Água 500ml', qty: 3, total: 21.15 }]
    });

    expect(tracking.latest(SLUG).items).toEqual([
      { name: 'Água 500ml', qty: 3, total: 21.15 }
    ]);
  });

  it('normaliza a foto dos itens e devolve null quando não sobra nada', () => {
    tracking.remember(SLUG, orderResponse(1), {
      items: [
        { name: '  Coca 350ml  ', qty: '2', total: '11.00' },
        { name: 'Sem quantidade', qty: 0, total: null },
        { name: '', qty: 9, total: 3 } // sem nome não vira linha na tela
      ]
    });
    expect(tracking.latest(SLUG).items).toEqual([
      { name: 'Coca 350ml', qty: 2, total: 11 },
      { name: 'Sem quantidade', qty: 1, total: null }
    ]);

    // Nada aproveitável => null, para a tela não abrir uma gaveta vazia.
    tracking.remember(SLUG, orderResponse(2), { items: [{ name: '  ' }] });
    expect(tracking.find(SLUG, 'trk_2').items).toBeNull();
    tracking.remember(SLUG, orderResponse(3));
    expect(tracking.find(SLUG, 'trk_3').items).toBeNull();
  });

  it('corta a foto dos itens no teto, para não estourar a cota do storage', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}`, qty: 1, total: 1 }));
    tracking.remember(SLUG, orderResponse(1), { items });

    const saved = tracking.latest(SLUG).items;
    expect(saved).toHaveLength(20);
    expect(saved.at(-1).name).toBe('Item 20');
  });

  it('o update do polling não apaga a foto dos itens', () => {
    tracking.remember(SLUG, orderResponse(1), { items: [{ name: 'Água 500ml', qty: 1, total: 7.05 }] });
    tracking.update(SLUG, 'trk_1', { payment_status: 'paid' });

    expect(tracking.latest(SLUG).items).toHaveLength(1);
  });

  it('mantém no máximo 10 pedidos por loja, descartando os mais antigos', () => {
    for (let n = 1; n <= 13; n++) tracking.remember(SLUG, orderResponse(n));
    const tokens = tracking.list(SLUG).map(e => e.tracking_token);

    expect(tokens).toHaveLength(10);
    expect(tokens[0]).toBe('trk_13');
    expect(tokens).not.toContain('trk_1');
  });
});

describe('update', () => {
  it('grava o pagamento confirmado sem renovar o prazo da entrada', () => {
    tracking.remember(SLUG, orderResponse(1));
    const savedAt = tracking.latest(SLUG).saved_at;

    const updated = tracking.update(SLUG, 'trk_1', { payment_status: 'paid', status: 'confirmed' });

    expect(updated).toMatchObject({ payment_status: 'paid', status: 'confirmed', saved_at: savedAt });
    expect(tracking.latest(SLUG).payment_status).toBe('paid');
  });

  it('ignora um token que não está guardado', () => {
    tracking.remember(SLUG, orderResponse(1));
    expect(tracking.update(SLUG, 'trk_desconhecido', { payment_status: 'paid' })).toBeNull();
    expect(tracking.latest(SLUG).payment_status).toBe('pending');
  });
});

describe('prazo de validade', () => {
  it('esquece o pedido depois de 7 dias', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    tracking.remember(SLUG, orderResponse(1));
    expect(tracking.latest(SLUG)).not.toBeNull();

    vi.setSystemTime(new Date('2026-08-09T12:00:01Z')); // 7 dias + 1s
    expect(tracking.list(SLUG)).toEqual([]);
    expect(tracking.latest(SLUG)).toBeNull();
  });
});

describe('find / forget', () => {
  it('acha pelo token e some quando pedido', () => {
    tracking.remember(SLUG, orderResponse(1));
    tracking.remember(SLUG, orderResponse(2));

    expect(tracking.find(SLUG, 'trk_1').order_number).toBe(4201);
    tracking.forget(SLUG, 'trk_1');
    expect(tracking.find(SLUG, 'trk_1')).toBeNull();
    expect(tracking.find(SLUG, 'trk_2')).not.toBeNull();
  });

  it('sobrevive a um localStorage com lixo na chave', () => {
    storage.setItem(KEY, '{isto nao e json}');
    expect(tracking.list(SLUG)).toEqual([]);
    expect(tracking.remember(SLUG, orderResponse(1)).tracking_token).toBe('trk_1');
  });
});
