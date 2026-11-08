import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  adjust,
  cancelOrder,
  createCustomer,
  createStockedSku,
  getInventory,
  placeOrder,
} from './helpers/factories';
import { assertInvariants } from './helpers/invariants';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Stock consistency under concurrent requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: { id: number };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    customer = await createCustomer(app);
  });
  afterEach(() => assertInvariants(prisma));
  afterAll(() => app.close());

  it('never oversells: 40 racing orders for 7 units yield exactly 7 successes and no 5xx', async () => {
    const { sku } = await createStockedSku(app, 7, { code: 'RACE-1' });

    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        placeOrder(app, customer.id, [{ skuCode: 'RACE-1', quantity: 1 }]),
      ),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
    expect(statuses.filter((s) => s === 201)).toHaveLength(7);
    expect(statuses.filter((s) => s === 409)).toHaveLength(33);
    expect(await getInventory(app, sku.id)).toEqual({
      quantityOnHand: 7,
      quantityReserved: 7,
      quantityAvailable: 0,
    });
    expect(await prisma.order.count()).toBe(7);
  });

  it('never oversells across multi-line orders competing for the same SKUs', async () => {
    const a = await createStockedSku(app, 10, { code: 'RACE-A' });
    const b = await createStockedSku(app, 10, { code: 'RACE-B' });

    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        placeOrder(
          app,
          customer.id,
          i % 2 === 0
            ? [
                { skuCode: 'RACE-A', quantity: 2 },
                { skuCode: 'RACE-B', quantity: 1 },
              ]
            : [
                { skuCode: 'RACE-B', quantity: 2 },
                { skuCode: 'RACE-A', quantity: 1 },
              ],
        ),
      ),
    );

    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
    const ok = responses.filter((r) => r.status === 201).length;
    expect(ok).toBeGreaterThan(0);
    const invA = await getInventory(app, a.sku.id);
    const invB = await getInventory(app, b.sku.id);
    expect(invA.quantityReserved).toBeLessThanOrEqual(10);
    expect(invB.quantityReserved).toBeLessThanOrEqual(10);
    // 3 units are reserved per successful order across the two SKUs.
    expect(invA.quantityReserved + invB.quantityReserved).toBe(ok * 3);
  });

  it('releases stock exactly once when the same order is cancelled concurrently', async () => {
    const { sku } = await createStockedSku(app, 10, { code: 'RACE-2' });
    const keep = await placeOrder(app, customer.id, [{ skuCode: 'RACE-2', quantity: 3 }]).expect(
      201,
    );
    const order = await placeOrder(app, customer.id, [{ skuCode: 'RACE-2', quantity: 4 }]).expect(
      201,
    );

    const responses = await Promise.all(
      Array.from({ length: 15 }, () => cancelOrder(app, order.body.id)),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(14);
    expect(await getInventory(app, sku.id)).toEqual({
      quantityOnHand: 10,
      quantityReserved: 3,
      quantityAvailable: 7,
    });
    expect(keep.body.status).toBe('RESERVED');
  });

  it('keeps reserved <= on-hand when adjustments race with new orders', async () => {
    const { sku } = await createStockedSku(app, 20, { code: 'RACE-3' });

    const requests = [
      ...Array.from({ length: 15 }, () =>
        placeOrder(app, customer.id, [{ skuCode: 'RACE-3', quantity: 1 }]),
      ),
      ...Array.from({ length: 15 }, () =>
        adjust(app, sku.id, { quantityDelta: -1, reason: 'LOST' }),
      ),
    ];
    const responses = await Promise.all(requests);

    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
    const inv = await getInventory(app, sku.id);
    expect(inv.quantityReserved).toBeLessThanOrEqual(inv.quantityOnHand);
    expect(inv.quantityAvailable).toBeGreaterThanOrEqual(0);
    const orders = responses.slice(0, 15).filter((r) => r.status === 201).length;
    const removed = responses.slice(15).filter((r) => r.status === 201).length;
    expect(inv.quantityReserved).toBe(orders);
    expect(inv.quantityOnHand).toBe(20 - removed);
  });

  it('serves reads while writes are in flight', async () => {
    const { sku } = await createStockedSku(app, 50, { code: 'RACE-4' });
    const responses = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        placeOrder(app, customer.id, [{ skuCode: 'RACE-4', quantity: 1 }]),
      ),
      ...Array.from({ length: 10 }, () => request(app.getHttpServer()).get(`/inventory/${sku.id}`)),
      ...Array.from({ length: 5 }, () => request(app.getHttpServer()).get('/orders')),
    ]);
    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
  });
});
