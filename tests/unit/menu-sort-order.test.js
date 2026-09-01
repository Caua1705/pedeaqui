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

/**
 * OS DOIS SÍTIOS QUE FICARAM DE FORA DA REDE, e a varredura de 01/09/2026 achou.
 *
 * A correção de 31/08/2026 tratou quatro sítios — produto, categoria, banner e
 * destaque — e a rede nasceu com exatamente esses quatro. Mas `sort_order` vale
 * `@default 0` em SEIS schemas: `ProductOptionGroupResponse` e
 * `ProductOptionResponse` declaram o mesmo `integer | null` com `@default 0`, e
 * `normalizeMenuPayload` também os ordena (as duas chamadas de `.sort()` dentro
 * do laço de produtos).
 *
 * Os dois já usam `??` e estão CERTOS hoje. O que faltava era a rede: um `||` de
 * volta ali passaria por lint, por typecheck e pelos 296 unitários sem uma
 * palavra, e o cliente veria o adicional de menor ordem — que costuma ser o
 * "sem nada", o mais barato, o que abre a lista — cair para o fim dela.
 *
 * `node tools/falsy-do-contrato.mjs` é a varredura que apontou o buraco.
 */
describe('sort_order dentro do produto: grupos de opção e opções', () => {
  const produtoComGrupos = (grupos) => ({
    branch_id: 'b-1',
    categories: [CATEGORIA],
    products: [{ id: 'p1', name: 'p1', price: 10, category_id: 'c1', option_groups: grupos }]
  });
  const grupos = (menu) => menu.products[0].option_groups;

  it('o grupo de ordem 0 vem primeiro, mesmo chegando por último', () => {
    // A lista chega FORA de ordem de propósito: se ela já viesse ordenada, o
    // teste passaria com `||` também e não provaria nada.
    const menu = servico.normalizeMenuPayload(produtoComGrupos([
      { id: 'ponto', name: 'Ponto da carne', sort_order: 1, options: [] },
      { id: 'bebida', name: 'Bebida', sort_order: 2, options: [] },
      { id: 'tamanho', name: 'Tamanho', sort_order: 0, options: [] }
    ]));
    expect(grupos(menu).map(grupo => grupo.id)).toEqual(['tamanho', 'ponto', 'bebida']);
  });

  it('a opção de ordem 0 vem primeira — é ela que abre a lista de adicionais', () => {
    const menu = servico.normalizeMenuPayload(produtoComGrupos([{
      id: 'g1', name: 'Acompanhamento', options: [
        { id: 'farofa', name: 'Farofa', additional_price: 4.3, sort_order: 1 },
        { id: 'vinagrete', name: 'Vinagrete', additional_price: 3, sort_order: 2 },
        { id: 'nada', name: 'Sem acompanhamento', additional_price: 0, sort_order: 0 }
      ]
    }]));
    expect(grupos(menu)[0].options.map(opcao => opcao.id))
      .toEqual(['nada', 'farofa', 'vinagrete']);
  });

  it('sem sort_order nenhum, a posição de chegada continua valendo nos dois', () => {
    const menu = servico.normalizeMenuPayload(produtoComGrupos([
      { id: 'primeiro', name: 'primeiro', options: [
        { id: 'op-a', name: 'a' },
        { id: 'op-b', name: 'b', sort_order: null }
      ] },
      { id: 'segundo', name: 'segundo', sort_order: null, options: [] }
    ]));
    expect(grupos(menu).map(grupo => grupo.id)).toEqual(['primeiro', 'segundo']);
    expect(grupos(menu)[0].options.map(opcao => opcao.id)).toEqual(['op-a', 'op-b']);
  });
});
