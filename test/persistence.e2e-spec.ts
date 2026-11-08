import { existsSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  cancelOrder,
  createCustomer,
  createStockedSku,
  getInventory,
  placeOrder,
} from './helpers/factories';
import { assertInvariants } from './helpers/invariants';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { TEST_DATABASE_FILE } from './test-db';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Persistence and database-level protections (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app?.close());

  it('uses a real SQLite file that is separate from the development database', () => {
    expect(process.env.DATABASE_URL).toBe('file:./test.db');
    expect(existsSync(TEST_DATABASE_FILE)).toBe(true);
    expect(TEST_DATABASE_FILE.endsWith('dev.db')).toBe(false);
  });

  it('keeps products, stock, orders and reservations after the application restarts', async () => {
    const customer = await createCustomer(app);
    const { sku } = await createStockedSku(app, 20, { code: 'PERSIST-1', priceCents: 1250 });
    const order = await placeOrder(app, customer.id, [
      { skuCode: 'PERSIST-1', quantity: 8 },
    ]).expect(201);

    await app.close();
    ({ app, prisma } = await createTestApp());

    expect(await getInventory(app, sku.id)).toEqual({
      quantityOnHand: 20,
      quantityReserved: 8,
      quantityAvailable: 12,
    });
    const read = await request(app.getHttpServer()).get(`/orders/${order.body.id}`).expect(200);
    expect(read.body).toMatchObject({ status: 'RESERVED', totalCents: 10000 });
    await cancelOrder(app, order.body.id).expect(200);
    expect(await getInventory(app, sku.id)).toMatchObject({ quantityReserved: 0 });
    await assertInvariants(prisma);
  });

  describe('CHECK constraints reject invariant violations even if application code is bypassed', () => {
    it('refuses reserved > on-hand', async () => {
      const { sku } = await createStockedSku(app, 5);
      await expect(
        prisma.inventoryItem.update({ where: { skuId: sku.id }, data: { quantityReserved: 6 } }),
      ).rejects.toThrow(/constraint/i);
    });

    it('refuses negative on-hand and negative reserved', async () => {
      const { sku } = await createStockedSku(app, 5);
      await expect(
        prisma.inventoryItem.update({ where: { skuId: sku.id }, data: { quantityOnHand: -1 } }),
      ).rejects.toThrow(/constraint/i);
      await expect(
        prisma.inventoryItem.update({ where: { skuId: sku.id }, data: { quantityReserved: -1 } }),
      ).rejects.toThrow(/constraint/i);
      expect(await getInventory(app, sku.id)).toMatchObject({
        quantityOnHand: 5,
        quantityReserved: 0,
      });
    });

    it('refuses inconsistent order line totals, non-positive quantities and negative prices', async () => {
      const customer = await createCustomer(app);
      const { sku } = await createStockedSku(app, 5);
      const order = await prisma.order.create({ data: { customerId: customer.id, totalCents: 0 } });
      const base = { orderId: order.id, skuId: sku.id };
      await expect(
        prisma.orderItem.create({
          data: { ...base, quantity: 2, unitPriceCents: 100, lineTotalCents: 199 },
        }),
      ).rejects.toThrow(/constraint/i);
      await expect(
        prisma.orderItem.create({
          data: { ...base, quantity: 0, unitPriceCents: 100, lineTotalCents: 0 },
        }),
      ).rejects.toThrow(/constraint/i);
      await expect(
        prisma.sku.update({ where: { id: sku.id }, data: { priceCents: -1 } }),
      ).rejects.toThrow(/constraint/i);
    });
  });

  it('enforces referential integrity and unique keys at the database level', async () => {
    const customer = await createCustomer(app, { email: 'dup@example.com' });
    const { sku, product } = await createStockedSku(app, 5, { code: 'DB-UNIQUE' });
    await placeOrder(app, customer.id, [{ skuCode: 'DB-UNIQUE', quantity: 1 }]).expect(201);

    await expect(prisma.customer.delete({ where: { id: customer.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.sku.delete({ where: { id: sku.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.product.delete({ where: { id: product.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(
      prisma.sku.create({ data: { code: 'DB-UNIQUE', productId: product.id, priceCents: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.customer.create({ data: { name: 'x', email: 'dup@example.com' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores money and quantities as integers (no floating point storage)', async () => {
    const customer = await createCustomer(app);
    await createStockedSku(app, 100, { code: 'INT-1', priceCents: 1999 });
    const order = await placeOrder(app, customer.id, [{ skuCode: 'INT-1', quantity: 3 }]).expect(
      201,
    );

    const rows = await prisma.$queryRaw<Array<{ a: string; b: string; c: string }>>`
      SELECT typeof(o."totalCents") AS a, typeof(i."unitPriceCents") AS b, typeof(inv."quantityOnHand") AS c
      FROM "Order" o
      JOIN "OrderItem" i ON i."orderId" = o."id"
      JOIN "InventoryItem" inv ON inv."skuId" = i."skuId"
      WHERE o."id" = ${order.body.id}`;
    expect(rows).toEqual([{ a: 'integer', b: 'integer', c: 'integer' }]);
    expect(order.body.totalCents).toBe(5997);
  });
});
