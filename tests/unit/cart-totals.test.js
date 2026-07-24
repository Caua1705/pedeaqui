import { describe, it, expect } from 'vitest';

// Publishes window.PedeAquiCartService (pure total math used for the displayed cart total).
import '../../scripts/services/cart-service.js';

const { calculateTotals } = window.PedeAquiCartService;

const items = [
  { visual_unit_price: 7.05, qty: 3 }, // 21.15
  { price: 10, qty: 1 } // 10.00 (falls back to price)
];

describe('calculateTotals (displayed cart total)', () => {
  it('sums unit price * qty, preferring visual_unit_price then price', () => {
    const t = calculateTotals(items, {}, 'pickup', null);
    expect(t.subtotal).toBeCloseTo(31.15, 2);
  });

  it('adds the service fee unless it is disabled', () => {
    const withFee = calculateTotals(items, { service_fee_amount: 0.99 }, 'pickup', null);
    expect(withFee.svc).toBeCloseTo(0.99, 2);
    expect(withFee.total).toBeCloseTo(32.14, 2);

    const disabled = calculateTotals(items, { service_fee_enabled: false, service_fee_amount: 0.99 }, 'pickup', null);
    expect(disabled.svc).toBe(0);
    expect(disabled.total).toBeCloseTo(31.15, 2);
  });

  it('includes the delivery fee only for delivery with a finite estimate', () => {
    const delivery = calculateTotals(items, {}, 'delivery', { delivery_fee: 5 });
    expect(delivery.delivery).toBe(5);
    expect(delivery.total).toBeCloseTo(36.15, 2);

    const pickup = calculateTotals(items, {}, 'pickup', { delivery_fee: 5 });
    expect(pickup.delivery).toBe(0);
  });

  it('treats a missing/empty delivery estimate as zero fee (never NaN)', () => {
    expect(calculateTotals(items, {}, 'delivery', null).delivery).toBe(0);
    expect(calculateTotals(items, {}, 'delivery', { delivery_fee: '' }).delivery).toBe(0);
    expect(calculateTotals(items, {}, 'delivery', { delivery_fee: null }).total).toBeCloseTo(31.15, 2);
  });

  it('returns zeroes for an empty cart', () => {
    expect(calculateTotals([], {}, 'pickup', null)).toEqual({ subtotal: 0, delivery: 0, svc: 0, total: 0 });
  });
});
