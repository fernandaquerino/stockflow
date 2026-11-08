import { MAX_ORDER_TOTAL_CENTS } from '../common/constants/limits';

export interface PricedLine {
  skuId: number;
  skuCode: string;
  quantity: number;
  /** Unit price snapshot in integer cents. */
  unitPriceCents: number;
  lineTotalCents: number;
}

/** line total = quantity x unit price. Integer arithmetic only - never floating point. */
export function priceLine(
  line: Pick<PricedLine, 'skuId' | 'skuCode' | 'quantity' | 'unitPriceCents'>,
): PricedLine {
  return { ...line, lineTotalCents: line.quantity * line.unitPriceCents };
}

/** order total = sum of line totals. */
export function sumLines(lines: Array<Pick<PricedLine, 'lineTotalCents'>>): number {
  return lines.reduce((total, line) => total + line.lineTotalCents, 0);
}

export function exceedsMaxTotal(totalCents: number): boolean {
  return totalCents > MAX_ORDER_TOTAL_CENTS;
}

export function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function formatOrderNumber(id: number): string {
  return `ORD-${String(id).padStart(6, '0')}`;
}
