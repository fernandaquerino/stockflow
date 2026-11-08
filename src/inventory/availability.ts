export interface StockLevels {
  quantityOnHand: number;
  quantityReserved: number;
}

export interface Availability extends StockLevels {
  /** onHand - reserved: what can still be promised to new orders. Never negative. */
  quantityAvailable: number;
}

export function toAvailability(levels: StockLevels | null | undefined): Availability {
  const quantityOnHand = levels?.quantityOnHand ?? 0;
  const quantityReserved = levels?.quantityReserved ?? 0;
  return {
    quantityOnHand,
    quantityReserved,
    quantityAvailable: Math.max(quantityOnHand - quantityReserved, 0),
  };
}
