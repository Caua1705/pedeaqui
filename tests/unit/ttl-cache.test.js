import { describe, it, expect } from 'vitest';
import '../../scripts/utils/ttl-cache.js';

const { createTtlCache } = window.RapidexTtlCache;

/** Relógio injetado: o teste manda no tempo, não espera por ele. */
function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    }
  };
}

const make = (options) => {
  const time = clock();
  return { cache: createTtlCache({ now: time.now, ...options }), time };
};

describe('prazo', () => {
  it('entrega o que está dentro do prazo', () => {
    const { cache } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('não entrega o que venceu', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    time.advance(999);
    expect(cache.get('a')).toBe(1);
    time.advance(1);
    expect(cache.get('a')).toBeUndefined();
  });

  it('descarta a entrada vencida na leitura, em vez de só escondê-la', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    time.advance(1000);
    cache.get('a');
    expect(cache.size).toBe(0);
  });

  it('devolve o carimbo de entrada — é dele que sai o updatedAt do serviço', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    time.advance(300);
    expect(cache.getEntry('a')).toEqual({ value: 1, storedAt: 1_000_000 });
  });

  it('reescrever renova o prazo', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    time.advance(900);
    cache.set('a', 2);
    time.advance(900);
    expect(cache.get('a')).toBe(2);
  });

  it('has() respeita o prazo', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    time.advance(1000);
    expect(cache.has('a')).toBe(false);
  });
});

describe('teto', () => {
  it('nunca passa do máximo', () => {
    const { cache } = make({ ttlMs: 10_000, maxEntries: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) cache.set(key, key);
    expect(cache.size).toBe(3);
  });

  it('descarta a menos usada recentemente, não a mais antiga por escrita', () => {
    const { cache } = make({ ttlMs: 10_000, maxEntries: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // 'a' volta a ser a mais recente só por ter sido LIDA.
    cache.get('a');
    cache.set('d', 4);

    expect(cache.keys()).toEqual(['c', 'a', 'd']);
    expect(cache.get('b')).toBeUndefined();
  });

  it('reescrever move a chave para o fim da fila, sem duplicá-la', () => {
    const { cache } = make({ ttlMs: 10_000, maxEntries: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 9);

    expect(cache.keys()).toEqual(['b', 'a']);
    expect(cache.size).toBe(2);
  });

  // O ponto de juntar prazo e teto: o despejo por tamanho só sacrifica dado
  // vivo quando não sobrou lixo para tirar.
  it('a escrita varre o vencido ANTES de despejar por tamanho', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 3 });
    cache.set('velha1', 1);
    cache.set('velha2', 2);
    time.advance(1000); // as duas venceram
    cache.set('nova1', 3);
    cache.set('nova2', 4);
    cache.set('nova3', 5);

    expect(cache.keys()).toEqual(['nova1', 'nova2', 'nova3']);
  });

  it('sem TTL o teto sozinho deixaria dado velho; sem teto o TTL sozinho deixaria lixo', () => {
    const { cache, time } = make({ ttlMs: 1000, maxEntries: 100 });
    for (let i = 0; i < 50; i++) cache.set(`k${i}`, i);
    expect(cache.size).toBe(50);

    time.advance(1000);
    // Nada foi lido: sem a varredura na escrita, as 50 ficariam para sempre.
    cache.set('nova', 1);
    expect(cache.size).toBe(1);
  });
});

describe('remoção', () => {
  it('delete tira uma chave', () => {
    const { cache } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('clear esvazia', () => {
    const { cache } = make({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('configuração', () => {
  it('recusa prazo ou teto ausente — um cache sem os dois é a Map crua de novo', () => {
    expect(() => createTtlCache({ maxEntries: 10 })).toThrow(/ttlMs/);
    expect(() => createTtlCache({ ttlMs: 1000 })).toThrow(/maxEntries/);
    expect(() => createTtlCache({ ttlMs: 0, maxEntries: 10 })).toThrow(/ttlMs/);
    expect(() => createTtlCache({ ttlMs: 1000, maxEntries: 0 })).toThrow(/maxEntries/);
  });
});
