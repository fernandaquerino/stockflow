import { toAvailability } from './availability';

describe('toAvailability', () => {
  it('computes available = onHand - reserved', () => {
    expect(toAvailability({ quantityOnHand: 10, quantityReserved: 3 })).toEqual({
      quantityOnHand: 10,
      quantityReserved: 3,
      quantityAvailable: 7,
    });
  });

  it('treats a missing inventory row as zero stock', () => {
    expect(toAvailability(null)).toEqual({
      quantityOnHand: 0,
      quantityReserved: 0,
      quantityAvailable: 0,
    });
    expect(toAvailability(undefined).quantityAvailable).toBe(0);
  });

  it('never reports negative availability, even for corrupted rows', () => {
    expect(toAvailability({ quantityOnHand: 2, quantityReserved: 5 }).quantityAvailable).toBe(0);
  });
});
