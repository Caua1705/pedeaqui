import { describe, it, expect, beforeAll } from 'vitest';

// Importing the IIFE for its side effect publishes window.RapidexOrderPayload.
import '../../scripts/services/order-payload.js';

const { buildOrderPayload, validateOrderPayload } = window.RapidexOrderPayload;

const UUID = {
  product: '11111111-1111-4111-8111-111111111111',
  branch: '22222222-2222-4222-8222-222222222222',
  group: '33333333-3333-4333-8333-333333333333',
  option: '44444444-4444-4444-8444-444444444444',
  address: '55555555-5555-4555-8555-555555555555',
  coupon: '66666666-6666-4666-8666-666666666666'
};

describe('buildOrderPayload', () => {
  it('never sends server-authoritative money fields', () => {
    const p = buildOrderPayload({
      cart: [{ id: UUID.product, qty: 1 }],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      paymentMethod: 'pix',
      customer: { name: 'Ana', phone: '85999990000' }
    });
    expect(p).not.toHaveProperty('subtotal');
    expect(p).not.toHaveProperty('total');
    expect(p).not.toHaveProperty('discount');
    expect(p).not.toHaveProperty('delivery_fee');
    expect(p).not.toHaveProperty('cashback');
  });

  it('shapes items with product_id, quantity, observation and selected options', () => {
    const [item] = buildOrderPayload({
      cart: [
        {
          id: UUID.product,
          qty: 2,
          obs: 'sem cebola',
          selected_options: [{ option_group_id: UUID.group, option_id: UUID.option }]
        }
      ],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      paymentMethod: 'pix',
      customer: { name: 'Ana', phone: '85999990000' }
    }).items;

    expect(item).toEqual({
      product_id: UUID.product,
      quantity: 2,
      observation: 'sem cebola',
      selected_options: [{ option_group_id: UUID.group, option_id: UUID.option }]
    });
  });

  it('drops items without a product_id and clamps quantity to >= 1', () => {
    const { items } = buildOrderPayload({
      cart: [
        { id: '', qty: 5 },
        { id: UUID.product, qty: 0 }
      ],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      paymentMethod: 'pix',
      customer: { name: 'Ana', phone: '85999990000' }
    });
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(1);
  });

  it('sends coupon_id OR coupon_code, never both (id wins)', () => {
    const withBoth = buildOrderPayload({
      cart: [{ id: UUID.product, qty: 1 }],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      coupon: { id: UUID.coupon, code: 'SHOULD_BE_IGNORED' },
      paymentMethod: 'pix',
      customer: { name: 'Ana', phone: '85999990000' }
    });
    expect(withBoth.coupon_id).toBe(UUID.coupon);
    expect(withBoth).not.toHaveProperty('coupon_code');

    const codeOnly = buildOrderPayload({
      cart: [{ id: UUID.product, qty: 1 }],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      coupon: { code: 'PROMO10' },
      paymentMethod: 'pix',
      customer: { name: 'Ana', phone: '85999990000' }
    });
    expect(codeOnly.coupon_code).toBe('PROMO10');
    expect(codeOnly).not.toHaveProperty('coupon_id');
  });

  it('passes the backend method_type through unchanged (e.g. credit_card)', () => {
    const p = buildOrderPayload({
      cart: [{ id: UUID.product, qty: 1 }],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      paymentMethod: 'credit_card',
      customer: { name: 'Ana', phone: '85999990000' }
    });
    expect(p.payment_method).toBe('credit_card');
  });

  describe('delivery address: id XOR object', () => {
    it('sends customer_address_id when the address already exists', () => {
      const p = buildOrderPayload({
        cart: [{ id: UUID.product, qty: 1 }],
        operationContext: {
          branch_id: UUID.branch,
          order_type: 'delivery',
          address: { id: UUID.address, street: 'Rua Y', number: '3' }
        },
        paymentMethod: 'pix',
        isAuthenticated: true
      });
      expect(p.customer_address_id).toBe(UUID.address);
      expect(p).not.toHaveProperty('address');
    });

    it('sends a full address object (with postal_code -> zipcode) for a new address', () => {
      const p = buildOrderPayload({
        cart: [{ id: UUID.product, qty: 1 }],
        operationContext: {
          branch_id: UUID.branch,
          order_type: 'delivery',
          address: { street: 'Rua X', number: '10', neighborhood: 'Centro', postal_code: '60000-000' }
        },
        paymentMethod: 'pix',
        customer: { name: 'Ana', phone: '85999990000' }
      });
      expect(p).not.toHaveProperty('customer_address_id');
      expect(p.address).toMatchObject({
        street: 'Rua X',
        number: '10',
        neighborhood: 'Centro',
        zipcode: '60000-000'
      });
      expect(p.address).not.toHaveProperty('postal_code');
    });

    it('sends no address at all for pickup', () => {
      const p = buildOrderPayload({
        cart: [{ id: UUID.product, qty: 1 }],
        operationContext: {
          branch_id: UUID.branch,
          order_type: 'pickup',
          address: { id: UUID.address, street: 'Rua Y' }
        },
        paymentMethod: 'pix',
        customer: { name: 'Ana', phone: '85999990000' }
      });
      expect(p).not.toHaveProperty('customer_address_id');
      expect(p).not.toHaveProperty('address');
    });
  });

  describe('customer identity', () => {
    it('sends {name, phone} for a guest', () => {
      const p = buildOrderPayload({
        cart: [{ id: UUID.product, qty: 1 }],
        operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
        paymentMethod: 'pix',
        customer: { name: 'Ana', phone: '85999990000' },
        isAuthenticated: false
      });
      expect(p.customer).toEqual({ name: 'Ana', phone: '85999990000' });
    });

    it('omits customer entirely when authenticated (identity rides the JWT)', () => {
      const p = buildOrderPayload({
        cart: [{ id: UUID.product, qty: 1 }],
        operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
        paymentMethod: 'pix',
        customer: { name: 'Ana', phone: '85999990000' },
        isAuthenticated: true
      });
      expect(p).not.toHaveProperty('customer');
      expect(p).not.toHaveProperty('customer_id');
    });
  });
});

describe('validateOrderPayload', () => {
  const good = () =>
    buildOrderPayload({
      cart: [{ id: UUID.product, qty: 1 }],
      operationContext: {
        branch_id: UUID.branch,
        order_type: 'delivery',
        address: { id: UUID.address }
      },
      paymentMethod: 'pix',
      isAuthenticated: true
    });

  it('passes a complete delivery order with a settled fee', () => {
    expect(validateOrderPayload(good(), { hasValidDeliveryFee: true, isAuthenticated: true })).toEqual([]);
  });

  it('blocks a delivery order when the delivery fee is not settled', () => {
    const problems = validateOrderPayload(good(), { hasValidDeliveryFee: false, isAuthenticated: true });
    expect(problems.some((m) => /taxa de entrega/i.test(m))).toBe(true);
  });

  it('does not require a fee for pickup', () => {
    const pickup = buildOrderPayload({
      cart: [{ id: UUID.product, qty: 1 }],
      operationContext: { branch_id: UUID.branch, order_type: 'pickup' },
      paymentMethod: 'pix',
      customer: { name: 'Ana', phone: '85999990000' }
    });
    expect(validateOrderPayload(pickup, { hasValidDeliveryFee: false, isAuthenticated: false })).toEqual([]);
  });

  it('flags an empty cart and a missing payment method', () => {
    const problems = validateOrderPayload(
      buildOrderPayload({
        cart: [],
        operationContext: { branch_id: UUID.branch, order_type: 'pickup' }
      }),
      { isAuthenticated: true }
    );
    expect(problems.some((m) => /carrinho/i.test(m))).toBe(true);
    expect(problems.some((m) => /pagamento/i.test(m))).toBe(true);
  });
});
