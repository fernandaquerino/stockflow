import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Re-derives every documented stock/order invariant (docs/INVARIANTS.md) straight from the database
 * and throws a descriptive error for the first violation. Call it after any scenario.
 */
export async function assertInvariants(prisma: PrismaService): Promise<void> {
  const problems: string[] = [];

  for (const item of await prisma.inventoryItem.findMany({ include: { sku: true } })) {
    const code = item.sku.code;
    if (item.quantityOnHand < 0) problems.push(`${code}: onHand ${item.quantityOnHand} < 0`);
    if (item.quantityReserved < 0) problems.push(`${code}: reserved ${item.quantityReserved} < 0`);
    if (item.quantityReserved > item.quantityOnHand) {
      problems.push(`${code}: reserved ${item.quantityReserved} > onHand ${item.quantityOnHand}`);
    }

    const ledger = await prisma.stockMovement.aggregate({
      where: { skuId: item.skuId },
      _sum: { onHandDelta: true, reservedDelta: true },
    });
    if ((ledger._sum.onHandDelta ?? 0) !== item.quantityOnHand) {
      problems.push(
        `${code}: SUM(onHandDelta)=${ledger._sum.onHandDelta} != onHand ${item.quantityOnHand}`,
      );
    }
    if ((ledger._sum.reservedDelta ?? 0) !== item.quantityReserved) {
      problems.push(
        `${code}: SUM(reservedDelta)=${ledger._sum.reservedDelta} != reserved ${item.quantityReserved}`,
      );
    }

    const active = await prisma.stockReservation.aggregate({
      where: { skuId: item.skuId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    if ((active._sum.quantity ?? 0) !== item.quantityReserved) {
      problems.push(
        `${code}: SUM(ACTIVE reservations)=${active._sum.quantity} != reserved ${item.quantityReserved}`,
      );
    }

    // The ledger must be a consistent chain: each row's "after" matches the running totals.
    const movements = await prisma.stockMovement.findMany({
      where: { skuId: item.skuId },
      orderBy: { id: 'asc' },
    });
    let onHand = 0;
    let reserved = 0;
    for (const m of movements) {
      onHand += m.onHandDelta;
      reserved += m.reservedDelta;
      if (m.onHandAfter !== onHand || m.reservedAfter !== reserved) {
        problems.push(
          `${code}: movement ${m.id} balance (${m.onHandAfter}/${m.reservedAfter}) != running (${onHand}/${reserved})`,
        );
      }
    }
  }

  for (const order of await prisma.order.findMany({
    include: { items: { include: { reservation: true } } },
  })) {
    const sum = order.items.reduce((total, item) => total + item.lineTotalCents, 0);
    if (sum !== order.totalCents)
      problems.push(`order ${order.id}: total ${order.totalCents} != lines ${sum}`);
    for (const item of order.items) {
      if (item.lineTotalCents !== item.quantity * item.unitPriceCents) {
        problems.push(`order ${order.id} item ${item.id}: line total is not quantity x unit price`);
      }
      const expected = order.status === 'RESERVED' ? 'ACTIVE' : 'RELEASED';
      if (item.reservation?.status !== expected) {
        problems.push(
          `order ${order.id} item ${item.id}: reservation ${item.reservation?.status} but order is ${order.status}`,
        );
      }
      if (item.reservation?.quantity !== item.quantity) {
        problems.push(
          `order ${order.id} item ${item.id}: reservation quantity differs from item quantity`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invariant violations:\n - ${problems.join('\n - ')}`);
  }
}
