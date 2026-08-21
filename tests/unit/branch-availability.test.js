import { describe, it, expect, beforeEach } from 'vitest';
import '../../scripts/services/api-routes.js';
import '../../scripts/services/branch-availability-service.js';

const service = window.PedeAquiBranchAvailabilityService;

beforeEach(() => {
  window.PedeAquiCustomerAuth = { authHeaders: () => ({ Authorization: 'Bearer teste' }) };
});

describe('contrato de disponibilidade das filiais', () => {
  it('monta a rota sem colocar o endereço na URL', () => {
    expect(window.PedeAquiApiRoutes.branchAvailability('loja/a'))
      .toBe('/restaurants/loja%2Fa/branches/availability');
  });

  it('preserva delivery null como não consultado', () => {
    const result = service.normalizeAvailability({
      address_provided: false,
      branches: [{ id: 'b-1', name: 'Matriz', is_open_now: true, delivery: null }]
    });

    expect(result.address_provided).toBe(false);
    expect(result.branches[0].delivery).toBeNull();
    expect(result.branches[0].is_open).toBe(true);
  });

  it('normaliza os números da entrega e mantém nulos sem inventar valores', () => {
    const result = service.normalizeAvailability({
      address_provided: true,
      branches: [{
        id: 'b-1',
        name: 'Matriz',
        display_name: 'Beira Mar',
        address: { street: 'Av. Beira Mar', number: '1200', full_address: 'Av. Beira Mar, 1200' },
        is_open_now: false,
        delivery: {
          delivers_to_address: false,
          reason: 'outside_delivery_area',
          distance_km: null,
          delivery_fee: 11.3
        }
      }]
    });

    expect(result.branches[0]).toMatchObject({
      name: 'Beira Mar',
      full_address: 'Av. Beira Mar, 1200',
      is_open: false,
      delivery: {
        delivers_to_address: false,
        distance_km: null,
        delivery_fee: 11.3
      }
    });
  });

  it('envia POST com Bearer e o corpo exatamente como recebido', async () => {
    let request;
    window.PedeAquiApiClient = {
      request: async (path, options) => {
        request = { path, options };
        return { address_provided: false, branches: [] };
      }
    };

    await service.getAvailability('minha-loja', {});

    expect(request.path).toBe('/restaurants/minha-loja/branches/availability');
    expect(request.options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer teste' }, body: '{}' });
  });
});
