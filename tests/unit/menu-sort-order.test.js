import { describe, it, expect } from 'vitest';
import '../../scripts/services/api-routes.js';
import '../../scripts/services/menu-service.js';

/**
 * `sort_order` é o campo que ordena o cardápio — e o valor PADRÃO dele é 0.
 *
 * `ProductResponse`, `CategoryResponse` e `BannerResponse` declaram, os três,
 * `sort_order: number | null` com `@default 0`. Ou seja: 0 não é ausência, é a
 * resposta normal para todo item que ninguém reordenou no painel.
 *
 * O normalizador lia `Number(x.sort_order || index)`. `||` não distingue 0 de
 * ausente, então o item com a MENOR ordem — o que tem de aparecer primeiro —
 * era justamente o que perdia a própria ordem e herdava a posição de chegada no
 * array. Passou anos invisível porque o backend costuma entregar a lista já
 * ordenada, e aí a posição de chegada e a ordem coincidem. Não é garantia: o
 * contrato não promete ordem de array em lugar nenhum.
 *
 * Os fixtures abaixo entregam a lista FORA de ordem de propósito — se os dois
 * lados concordarem, o teste não prova nada (skill §4, "fixture cujos números
 * coincidem").
 */

const servico = window.PedeAquiMenuService;

const CATEGORIA = { id: 'c1', name: 'Doces', slug: 'doces', sort_order: 0 };
const produto = (id, sortOrder) => ({
  id, name: id, price: 10, category_id: 'c1', sort_order: sortOrder
});
const banner = (id, sortOrder) => ({ id, image_path: `${id}.jpg`, sort_order: sortOrder });

describe('sort_order: 0 é uma ordem, não uma ausência', () => {
  it('o produto de ordem 0 vem primeiro, mesmo chegando por último', () => {
    const menu = servico.normalizeMenuPayload({
      branch_id: 'b-1',
      categories: [CATEGORIA],
      products: [produto('alfa', 1), produto('beta', 2), produto('zero', 0)]
    });
    expect(menu.products.map(item => item.id)).toEqual(['zero', 'alfa', 'beta']);
  });

  it('a categoria de ordem 0 vem primeira, mesmo chegando por último', () => {
    const menu = servico.normalizeMenuPayload({
      branch_id: 'b-1',
      products: [],
      categories: [
        { id: 'alfa', name: 'Alfa', slug: 'alfa', sort_order: 1 },
        { id: 'beta', name: 'Beta', slug: 'beta', sort_order: 2 },
        { id: 'zero', name: 'Zero', slug: 'zero', sort_order: 0 }
      ]
    });
    expect(menu.categories.map(item => item.id)).toEqual(['zero', 'alfa', 'beta']);
  });

  it('o banner de ordem 0 vem primeiro — é ele que abre o carrossel', () => {
    const menu = servico.normalizeMenuPayload({
      branch_id: 'b-1', products: [], categories: [],
      banners: [banner('alfa', 1), banner('beta', 2), banner('zero', 0)]
    });
    expect(menu.banners.map(item => item.id)).toEqual(['zero', 'alfa', 'beta']);
  });

  it('o destaque de ordem 0 vem primeiro', () => {
    const menu = servico.normalizeMenuPayload({
      branch_id: 'b-1', products: [], categories: [],
      highlight_banners: [banner('alfa', 1), banner('beta', 2), banner('zero', 0)]
    });
    expect(menu.highlight_banners.map(item => item.id)).toEqual(['zero', 'alfa', 'beta']);
  });

  it('sem sort_order nenhum, a posição de chegada continua valendo', () => {
    // O `null` do contrato e o campo ausente continuam caindo no índice — é o
    // único comportamento que o `||` acertava, e ele não pode se perder na
    // correção.
    const menu = servico.normalizeMenuPayload({
      branch_id: 'b-1',
      categories: [CATEGORIA],
      products: [
        { id: 'primeiro', name: 'primeiro', price: 10, category_id: 'c1' },
        { id: 'segundo', name: 'segundo', price: 10, category_id: 'c1', sort_order: null }
      ]
    });
    expect(menu.products.map(item => item.id)).toEqual(['primeiro', 'segundo']);
  });
});
