import {
  exceedsMaxTotal,
  findDuplicates,
  formatOrderNumber,
  priceLine,
  sumLines,
} from './order-calculator';

describe('order calculator', () => {
  it('prices a line with integer arithmetic', () => {
    expect(priceLine({ skuId: 1, skuCode: 'A', quantity: 3, unitPriceCents: 2495 })).toEqual({
      skuId: 1,
      skuCode: 'A',
      quantity: 3,
      unitPriceCents: 2495,
      lineTotalCents: 7485,
    });
  });

  it('avoids the classic floating point drift (0.1 + 0.2 style) by never leaving cents', () => {
    // 3 x 0.10 + 3 x 0.20 would give 0.9000000000000001 with floats.
    const lines = [
      priceLine({ skuId: 1, skuCode: 'A', quantity: 3, unitPriceCents: 10 }),
      priceLine({ skuId: 2, skuCode: 'B', quantity: 3, unitPriceCents: 20 }),
    ];
    expect(sumLines(lines)).toBe(90);
    expect(Number.isInteger(sumLines(lines))).toBe(true);
  });

  it('sums an empty order to zero', () => {
    expect(sumLines([])).toBe(0);
  });

  it('flags totals above the supported maximum (2,000,000,000 cents)', () => {
    expect(exceedsMaxTotal(2_000_000_000)).toBe(false);
    expect(exceedsMaxTotal(2_000_000_001)).toBe(true);
  });

  it('finds repeated values once each', () => {
    expect(findDuplicates(['A', 'B', 'A', 'C', 'B', 'A'])).toEqual(['A', 'B']);
    expect(findDuplicates(['A', 'B'])).toEqual([]);
  });

  it('formats order numbers with zero padding', () => {
    expect(formatOrderNumber(7)).toBe('ORD-000007');
    expect(formatOrderNumber(1234567)).toBe('ORD-1234567');
  });
});
