/**
 * Seeds realistic sample data for local development.
 *
 *   npm run db:seed          -> only seeds when the database is empty (safe to re-run)
 *   npm run db:seed:reset    -> wipes all StockFlow tables first, then seeds
 *
 * Stock and orders are created through the same steps the API performs (receipt movements,
 * reservations, release movements), so the seeded ledger satisfies every invariant in
 * docs/INVARIANTS.md: onHand = SUM(onHandDelta), reserved = SUM(reservedDelta) = SUM(ACTIVE reservations).
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const products = [
  {
    name: 'Ceramic Pour-Over Dripper',
    category: 'Brewing',
    description: 'Hand-glazed ceramic cone dripper, fits size 02 filters.',
    skus: [
      { code: 'DRIP-CER-WHT', variantName: 'White', priceCents: 2495 },
      { code: 'DRIP-CER-BLK', variantName: 'Matte black', priceCents: 2495 },
    ],
  },
  {
    name: 'Gooseneck Kettle 0.8L',
    category: 'Brewing',
    description: 'Variable-temperature electric gooseneck kettle.',
    skus: [
      { code: 'KETTLE-08-SS', variantName: 'Stainless steel', priceCents: 4900 },
      { code: 'KETTLE-08-MBK', variantName: 'Matte black', priceCents: 5400 },
    ],
  },
  {
    name: 'Burr Grinder Pro',
    category: 'Grinders',
    description: 'Conical burr grinder with 40 grind settings.',
    skus: [{ code: 'GRIND-PRO-01', variantName: null, priceCents: 12900 }],
  },
  {
    name: 'Single-Origin Beans 250g',
    category: 'Coffee',
    description: 'Freshly roasted whole beans, 250 g bag.',
    skus: [
      { code: 'BEANS-ETH-250', variantName: 'Ethiopia Guji', priceCents: 1650 },
      { code: 'BEANS-COL-250', variantName: 'Colombia Huila', priceCents: 1475 },
      { code: 'BEANS-KEN-250', variantName: 'Kenya AA', priceCents: 1725 },
    ],
  },
  {
    name: 'Paper Filters V60 (100 pack)',
    category: 'Brewing',
    description: 'Bleached paper filters, size 02.',
    skus: [{ code: 'FILT-V60-100', variantName: null, priceCents: 650 }],
  },
  {
    name: 'Travel Tumbler 350ml',
    category: 'Drinkware',
    description: 'Discontinued insulated tumbler - remaining stock only.',
    active: false,
    skus: [{ code: 'TUMB-350-GRN', variantName: 'Forest green', priceCents: 2200, active: false }],
  },
];

const customers = [
  { name: 'Harbor Street Coffee', email: 'purchasing@harborstreet.example', phone: '+1-555-0142' },
  { name: 'Lumen Roasters', email: 'orders@lumenroasters.example', phone: '+1-555-0187' },
  { name: 'The Daily Grind Cafe', email: 'buyer@dailygrind.example', phone: null },
  { name: 'Parkside Bakehouse', email: 'hello@parksidebakehouse.example', phone: '+1-555-0110' },
];

const receipts: Array<[code: string, quantity: number, reference: string]> = [
  ['DRIP-CER-WHT', 60, 'PO-2026-0101'],
  ['DRIP-CER-BLK', 40, 'PO-2026-0101'],
  ['KETTLE-08-SS', 25, 'PO-2026-0102'],
  ['KETTLE-08-MBK', 15, 'PO-2026-0102'],
  ['GRIND-PRO-01', 5, 'PO-2026-0103'],
  ['BEANS-ETH-250', 200, 'PO-2026-0104'],
  ['BEANS-COL-250', 150, 'PO-2026-0104'],
  ['BEANS-KEN-250', 80, 'PO-2026-0104'],
  ['FILT-V60-100', 500, 'PO-2026-0105'],
  ['TUMB-350-GRN', 12, 'PO-2025-0877'],
  ['BEANS-ETH-250', 100, 'PO-2026-0131'],
];

type Tx = Prisma.TransactionClient;

async function wipe(): Promise<void> {
  await prisma.stockReservation.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.sku.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany(); // Restart AUTOINCREMENT counters so a reset database always hands out ids 1..n again.
  await prisma.$executeRawUnsafe('DELETE FROM sqlite_sequence');
}

async function change(
  tx: Tx,
  skuId: number,
  onHandDelta: number,
  reservedDelta: number,
  movement: Omit<
    Prisma.StockMovementUncheckedCreateInput,
    'skuId' | 'onHandDelta' | 'reservedDelta' | 'onHandAfter' | 'reservedAfter'
  >,
): Promise<void> {
  const item = await tx.inventoryItem.update({
    where: { skuId },
    data: {
      quantityOnHand: { increment: onHandDelta },
      quantityReserved: { increment: reservedDelta },
    },
  });
  await tx.stockMovement.create({
    data: {
      ...movement,
      skuId,
      onHandDelta,
      reservedDelta,
      onHandAfter: item.quantityOnHand,
      reservedAfter: item.quantityReserved,
    },
  });
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  if (reset) {
    await wipe();
    console.log('Existing StockFlow data removed (--reset).');
  } else if ((await prisma.product.count()) > 0 || (await prisma.customer.count()) > 0) {
    console.log(
      'Database already contains data - skipping seed. Use `npm run db:seed:reset` to start over.',
    );
    return;
  }

  const skuIds = new Map<string, number>();
  const skuPrices = new Map<string, number>();
  for (const { skus, ...product } of products) {
    const created = await prisma.product.create({ data: product });
    for (const sku of skus) {
      const row = await prisma.sku.create({
        data: { ...sku, productId: created.id, inventory: { create: {} } },
      });
      skuIds.set(sku.code, row.id);
      skuPrices.set(sku.code, sku.priceCents);
    }
  }

  const customerIds = new Map<string, number>();
  for (const customer of customers) {
    customerIds.set(customer.email, (await prisma.customer.create({ data: customer })).id);
  }

  const idOf = (code: string) => skuIds.get(code) as number;

  for (const [code, quantity, reference] of receipts) {
    await prisma.$transaction((tx) =>
      change(tx, idOf(code), quantity, 0, { type: 'RECEIPT', reference }),
    );
  }

  // A damaged shipment found during put-away.
  await prisma.$transaction((tx) =>
    change(tx, idOf('DRIP-CER-WHT'), -2, 0, {
      type: 'ADJUSTMENT',
      reason: 'DAMAGED',
      note: 'Two drippers cracked in transit',
    }),
  );

  async function placeOrder(email: string, lines: Array<[string, number]>, notes?: string) {
    return prisma.$transaction(async (tx) => {
      const priced = lines.map(([code, quantity]) => ({
        code,
        quantity,
        unit: skuPrices.get(code) as number,
      }));
      const order = await tx.order.create({
        data: {
          customerId: customerIds.get(email) as number,
          notes: notes ?? null,
          totalCents: priced.reduce((sum, l) => sum + l.quantity * l.unit, 0),
          items: {
            create: priced.map((l) => ({
              skuId: idOf(l.code),
              quantity: l.quantity,
              unitPriceCents: l.unit,
              lineTotalCents: l.quantity * l.unit,
              reservation: { create: { skuId: idOf(l.code), quantity: l.quantity } },
            })),
          },
        },
      });
      for (const l of priced) {
        await change(tx, idOf(l.code), 0, l.quantity, { type: 'RESERVATION', orderId: order.id });
      }
      return order.id;
    });
  }

  async function cancelOrder(orderId: number, reason: string) {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: now },
      });
      const reservations = await tx.stockReservation.findMany({
        where: { orderItem: { orderId }, status: 'ACTIVE' },
      });
      for (const r of reservations) {
        await tx.stockReservation.update({
          where: { id: r.id },
          data: { status: 'RELEASED', releasedAt: now },
        });
        await change(tx, r.skuId, 0, -r.quantity, { type: 'RELEASE', orderId, reason });
      }
    });
  }

  await placeOrder(
    'purchasing@harborstreet.example',
    [
      ['BEANS-ETH-250', 24],
      ['BEANS-COL-250', 12],
      ['FILT-V60-100', 6],
    ],
    'Weekly restock',
  );
  await placeOrder('orders@lumenroasters.example', [
    ['KETTLE-08-SS', 4],
    ['GRIND-PRO-01', 3],
  ]);
  const cancelled = await placeOrder('buyer@dailygrind.example', [
    ['DRIP-CER-WHT', 10],
    ['DRIP-CER-BLK', 10],
  ]);
  await cancelOrder(cancelled, 'Customer changed their mind');
  // Reserves the last two grinders: GRIND-PRO-01 is now sold out (available = 0).
  await placeOrder('hello@parksidebakehouse.example', [['GRIND-PRO-01', 2]], 'Pick-up on Friday');

  console.log(
    `Seeded ${products.length} products, ${skuIds.size} SKUs, ${customers.length} customers, 4 orders (1 cancelled).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
