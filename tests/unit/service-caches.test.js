import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../scripts/utils/ttl-cache.js';
import '../../scripts/services/restaurant-info-service.js';
import '../../scripts/services/delivery-service.js';

// Os dois caches de serviço, pelo comportamento observável: quantas vezes a API
// é chamada. É o que importa — o cache existe para poupar chamada, e o prazo
// existe para que poupar não vire servir dado velho.

const info = window.PedeAquiRestaurantInfoService;
const delivery = window.PedeAquiDeliveryService;

let getCalls;
let postCalls;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-25T12:00:00Z'));
  getCalls = [];
  postCalls = [];

  window.PedeAquiApiRoutes = {
    restaurantInfo: (slug, branchId) => `/restaurants/${slug}/info?branch=${branchId || ''}`,
    deliveryEstimate: (slug) => `/restaurants/${slug}/delivery/estimate`
  };
  window.PedeAquiApiClient = {
    get: (url) => {
      getCalls.push(url);
      return Promise.resolve({ data: { url, servedAt: Date.now() } });
    },
    request: (url, options) => {
      postCalls.push(url);
      return Promise.resolve({ data: { url, delivery_fee: postCalls.length, options } });
    }
  };
  window.PedeAquiCustomerAuth = { authHeaders: () => ({}) };

  info.invalidate();
  delivery.invalidate();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('restaurant-info: o cache que não tinha prazo nenhum', () => {
  it('a segunda leitura no prazo não vai à rede', async () => {
    await info.getInfo('junior-da-picanha', 'matriz');
    const segunda = await info.getInfo('junior-da-picanha', 'matriz');

    expect(getCalls).toHaveLength(1);
    expect(segunda.fromCache).toBe(true);
  });

  // A REGRESSÃO. Antes, o payload de /info valia a sessão inteira: formas de
  // pagamento e o dia da semana calculado no servidor nunca eram rebuscados.
  it('depois do prazo, busca de novo', async () => {
    await info.getInfo('junior-da-picanha', 'matriz');
    vi.advanceTimersByTime(info.CACHE_TTL_MS);
    const depois = await info.getInfo('junior-da-picanha', 'matriz');

    expect(getCalls).toHaveLength(2);
    expect(depois.fromCache).toBe(false);
  });

  it('o prazo é curto o bastante para uma virada de dia não sobreviver', () => {
    expect(info.CACHE_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('force ignora o cache', async () => {
    await info.getInfo('junior-da-picanha', 'matriz');
    await info.getInfo('junior-da-picanha', 'matriz', { force: true });
    expect(getCalls).toHaveLength(2);
  });

  // Isolamento: horário, endereço e formas de pagamento são POR LOJA.
  it('tenants diferentes não dividem entrada', async () => {
    const a = await info.getInfo('junior-da-picanha', 'matriz');
    const b = await info.getInfo('fuji', 'matriz');

    expect(getCalls).toHaveLength(2);
    expect(b.data.url).not.toBe(a.data.url);
    expect(b.fromCache).toBe(false);
  });

  it('filiais diferentes da mesma loja também não dividem', async () => {
    await info.getInfo('junior-da-picanha', 'matriz');
    await info.getInfo('junior-da-picanha', 'centro');
    expect(getCalls).toHaveLength(2);
  });

  it('chamadas simultâneas viram UMA requisição', async () => {
    const [um, dois] = await Promise.all([
      info.getInfo('junior-da-picanha', 'matriz'),
      info.getInfo('junior-da-picanha', 'matriz')
    ]);

    expect(getCalls).toHaveLength(1);
    expect(um.data).toEqual(dois.data);
  });

  it('não passa do teto de entradas', async () => {
    for (let i = 0; i < info.CACHE_MAX_ENTRIES + 15; i++) {
      await info.getInfo(`loja-${i}`, 'matriz');
    }
    expect(info.cache.size).toBe(info.CACHE_MAX_ENTRIES);
  });

  it('invalidate derruba só a loja pedida', async () => {
    await info.getInfo('junior-da-picanha', 'matriz');
    await info.getInfo('fuji', 'matriz');
    info.invalidate('junior-da-picanha', 'matriz');

    await info.getInfo('fuji', 'matriz');
    expect(getCalls).toHaveLength(2);

    await info.getInfo('junior-da-picanha', 'matriz');
    expect(getCalls).toHaveLength(3);
  });
});

describe('delivery: o cache que tinha prazo mas não tinha teto', () => {
  const estimate = (key) =>
    delivery.getEstimate('junior-da-picanha', { address: key }, { key });

  it('a segunda leitura no prazo não vai à rede', async () => {
    await estimate('endereco-1');
    const segunda = await estimate('endereco-1');

    expect(postCalls).toHaveLength(1);
    expect(segunda.fromCache).toBe(true);
  });

  it('depois do prazo, busca de novo — taxa de entrega não pode envelhecer', async () => {
    await estimate('endereco-1');
    vi.advanceTimersByTime(delivery.CACHE_TTL_MS);
    const depois = await estimate('endereco-1');

    expect(postCalls).toHaveLength(2);
    expect(depois.fromCache).toBe(false);
  });

  it('o updatedAt é o momento em que o dado entrou no cache', async () => {
    const primeira = await estimate('endereco-1');
    vi.advanceTimersByTime(1000);
    const segunda = await estimate('endereco-1');

    expect(segunda.updatedAt).toBe(primeira.updatedAt);
  });

  // Era esta a metade que faltava: sem teto, endereço vencido que ninguém relê
  // ficava na Map para sempre.
  it('não passa do teto de entradas', async () => {
    for (let i = 0; i < delivery.CACHE_MAX_ENTRIES + 15; i++) {
      await estimate(`endereco-${i}`);
    }
    expect(delivery.cache.size).toBe(delivery.CACHE_MAX_ENTRIES);
  });

  it('entrada vencida some do cache mesmo sem ninguém relê-la', async () => {
    await estimate('endereco-1');
    await estimate('endereco-2');
    expect(delivery.cache.size).toBe(2);

    vi.advanceTimersByTime(delivery.CACHE_TTL_MS);
    await estimate('endereco-3');

    expect(delivery.cache.size).toBe(1);
  });

  it('exige a chave: uma estimativa sem chave se aplicaria ao endereço errado', async () => {
    await expect(
      delivery.getEstimate('junior-da-picanha', {}, {})
    ).rejects.toThrow(/key/i);
  });

  it('force ignora o cache', async () => {
    await estimate('endereco-1');
    await delivery.getEstimate('junior-da-picanha', {}, { key: 'endereco-1', force: true });
    expect(postCalls).toHaveLength(2);
  });
});
