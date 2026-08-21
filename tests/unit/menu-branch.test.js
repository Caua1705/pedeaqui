import { describe, it, expect, vi, afterEach } from 'vitest';
import '../../scripts/services/api-routes.js';
import '../../scripts/services/menu-service.js';

// O cardápio é da FILIAL desde 20/08/2026.
//
// Duas coisas que o e2e não alcança bem e que doem em silêncio quando quebram:
// como a filial entra na URL, e o que a tela faz quando a resposta vem com
// produtos de DUAS lojas — que é o modo de falha do rollback de imagem sem
// descer o banco (200, JSON válido, nenhum log).

const rotas = window.PedeAquiApiRoutes;
const servico = window.PedeAquiMenuService;

afterEach(() => vi.restoreAllMocks());

describe('a filial na URL do cardápio', () => {
  it('vai como query quando há filial escolhida', () => {
    expect(rotas.menu('junior-da-picanha', '6a1f0000-0000-4000-8000-000000000001'))
      .toBe('/restaurants/junior-da-picanha/menu?branch_id=6a1f0000-0000-4000-8000-000000000001');
  });

  it('fica de fora quando não há — é a vitrine, e vale a filial padrão', () => {
    expect(rotas.menu('junior-da-picanha')).toBe('/restaurants/junior-da-picanha/menu');
    expect(rotas.menu('junior-da-picanha', null)).toBe('/restaurants/junior-da-picanha/menu');
    expect(rotas.menu('junior-da-picanha', '')).toBe('/restaurants/junior-da-picanha/menu');
  });

  it('escapa o slug e a filial, que entram na URL', () => {
    expect(rotas.menu('a/b', 'x y')).toBe('/restaurants/a%2Fb/menu?branch_id=x%20y');
  });
});

describe('de qual filial é a resposta', () => {
  it('sai do branch_id da raiz', () => {
    const menu = servico.normalizeMenuPayload({ branch_id: 'b-1', products: [], categories: [] });
    expect(menu.branch_id).toBe('b-1');
  });

  it('NÃO cai para settings_branch_id, que está obsoleto', () => {
    // Os dois trazem o mesmo valor hoje. Ler o obsoleto faria o app continuar
    // funcionando no dia em que ele sair — e parar de funcionar sem aviso.
    const menu = servico.normalizeMenuPayload({ settings_branch_id: 'b-1', products: [] });
    expect(menu.branch_id).toBeNull();
  });

  it('nulo é resposta legítima: restaurante sem nenhuma filial ativa', () => {
    const menu = servico.normalizeMenuPayload({ products: [], categories: [], branches: [] });
    expect(menu.branch_id).toBeNull();
    expect(menu.products).toEqual([]);
  });
});

describe('resposta com duas lojas misturadas', () => {
  const misturado = {
    branch_id: 'b-1',
    categories: [{ id: 'c1', name: 'Carnes', slug: 'carnes', branch_id: 'b-1' }],
    products: [
      { id: 'p1', name: 'Picanha', price: 10, category_slug: 'carnes', branch_id: 'b-1' },
      { id: 'p2', name: 'Picanha', price: 12, category_slug: 'carnes', branch_id: 'b-2' }
    ]
  };

  it('grita no console — é 200 com JSON válido, e ninguém veria de outro jeito', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    servico.normalizeMenuPayload(misturado);
    expect(erro).toHaveBeenCalledOnce();
    expect(String(erro.mock.calls[0][0])).toMatch(/MAIS DE UMA filial/);
  });

  it('não grita quando todos são da mesma filial', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    servico.normalizeMenuPayload({
      ...misturado,
      products: misturado.products.map(product => ({ ...product, branch_id: 'b-1' }))
    });
    expect(erro).not.toHaveBeenCalled();
  });

  it('não grita quando o backend não carimba os itens', () => {
    // `branch_id` por produto é conferência, não requisito: sem ele não há o
    // que comparar, e inventar um alarme aqui seria ruído em toda resposta.
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    servico.normalizeMenuPayload({
      branch_id: 'b-1',
      categories: [],
      products: [{ id: 'p1', name: 'Picanha', price: 10 }]
    });
    expect(erro).not.toHaveBeenCalled();
  });
});
