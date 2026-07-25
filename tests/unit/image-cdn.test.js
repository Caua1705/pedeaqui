import { describe, it, expect } from 'vitest';

// Publishes window.RapidexImageCdn.
import '../../scripts/utils/image-cdn.js';

const { isSupabaseObjectUrl, variant, srcsetByDpr, srcsetByWidth } = window.RapidexImageCdn;

const BUCKET = 'https://mqanpwnrjjqcswzhcplc.supabase.co/storage/v1';
const ORIGINAL = `${BUCKET}/object/public/restaurant-assets/junior-da-picanha/products/arroz-branco.webp`;

describe('image-cdn — reconhece o que é transformável', () => {
  it('aceita o objeto público do Storage', () => {
    expect(isSupabaseObjectUrl(ORIGINAL)).toBe(true);
  });

  it('recusa qualquer outra origem', () => {
    expect(isSupabaseObjectUrl('https://cdn.terceiro.com/foto.webp')).toBe(false);
    expect(isSupabaseObjectUrl('assets/brand/rapi-mascot@1x.webp')).toBe(false);
    expect(isSupabaseObjectUrl('data:image/png;base64,iVBOR')).toBe(false);
  });

  it('não quebra com entrada inválida', () => {
    expect(isSupabaseObjectUrl(null)).toBe(false);
    expect(isSupabaseObjectUrl(undefined)).toBe(false);
    expect(isSupabaseObjectUrl(42)).toBe(false);
  });
});

describe('image-cdn — monta a URL da derivada', () => {
  it('troca /object/ por /render/image/ e anexa width', () => {
    expect(variant(ORIGINAL, 240)).toBe(
      `${BUCKET}/render/image/public/restaurant-assets/junior-da-picanha/products/arroz-branco.webp?width=240&quality=72`
    );
  });

  it('preserva a query que já existia no objeto', () => {
    const withToken = `${ORIGINAL}?t=abc123`;
    expect(variant(withToken, 110)).toContain('?t=abc123&width=110');
  });

  it('arredonda larguras fracionadas (110 * 1.5 de DPR)', () => {
    expect(variant(ORIGINAL, 164.5)).toContain('width=165');
  });
});

describe('image-cdn — na dúvida, devolve o original', () => {
  // Esta é a garantia que sustenta a decisão de manter o ORIGINAL no src: se a
  // reescrita não se aplica, o chamador recebe null/'' e serve a URL de sempre.
  it('devolve null para origem não transformável', () => {
    expect(variant('https://cdn.terceiro.com/foto.webp', 240)).toBeNull();
  });

  it('devolve null para largura sem sentido', () => {
    expect(variant(ORIGINAL, 0)).toBeNull();
    expect(variant(ORIGINAL, -10)).toBeNull();
    expect(variant(ORIGINAL, NaN)).toBeNull();
  });

  it('devolve srcset vazio — não um srcset quebrado — para origem alheia', () => {
    expect(srcsetByDpr('https://cdn.terceiro.com/foto.webp', 110)).toBe('');
    expect(srcsetByWidth('https://cdn.terceiro.com/foto.webp', [360, 640])).toBe('');
  });
});

describe('image-cdn — srcset', () => {
  it('descritores x saem do lado fixo em CSS vezes o DPR', () => {
    const set = srcsetByDpr(ORIGINAL, 110);
    expect(set).toContain('width=110&quality=72 1x');
    expect(set).toContain('width=220&quality=72 2x');
    expect(set).toContain('width=330&quality=72 3x');
    expect(set.split(', ')).toHaveLength(3);
  });

  it('descritores w saem da grade pedida', () => {
    const set = srcsetByWidth(ORIGINAL, [360, 640]);
    expect(set).toContain('width=360&quality=72 360w');
    expect(set).toContain('width=640&quality=72 640w');
    expect(set.split(', ')).toHaveLength(2);
  });

  it('a miniatura de 110px nunca pede a foto inteira', () => {
    // O ponto do bloco: a grade do cardápio parava de baixar 88 kB por item.
    const widths = [...srcsetByDpr(ORIGINAL, 110).matchAll(/width=(\d+)/g)].map(m => Number(m[1]));
    expect(Math.max(...widths)).toBeLessThanOrEqual(330);
  });
});
