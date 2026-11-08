/** Largest value we accept for integer ids coming from clients (signed 32-bit). */
export const MAX_INT = 2_147_483_647;

/** Hard cap for stock on hand per SKU, enforced inside the atomic UPDATE statements. */
export const MAX_STOCK = 1_000_000_000;

/** Largest quantity accepted in a single receipt / adjustment / order line. */
export const MAX_MOVEMENT_QUANTITY = 1_000_000;
export const MAX_ORDER_LINE_QUANTITY = 10_000;

/** Largest order total (cents) we store: keeps sums safely inside a signed 32-bit integer. */
export const MAX_ORDER_TOTAL_CENTS = 2_000_000_000;
export const MAX_UNIT_PRICE_CENTS = 100_000_000;
