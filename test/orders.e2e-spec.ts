import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  adjust,
  cancelOrder,
  createCustomer,
  createProduct,
  createSku,
  createStockedSku,
  getInventory,
  placeOrder,
  receive,
} from './helpers/factories';
import { assertInvariants } from './helpers/invariants';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Orders (e2e)', () => {
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

  const http = () => request(app.getHttpServer());

  describe('placing orders', () => {
    it('reserves stock, snapshots prices and computes totals in integer cents', async () => {
      const dripper = await createStockedSku(app, 10, { code: 'DRIP-WHT', priceCents: 2495 });
      const beans = await createStockedSku(app, 50, { code: 'BEANS-ETH', priceCents: 1650 });

      const res = await placeOrder(
        app,
        customer.id,
        [
          { skuCode: 'DRIP-WHT', quantity: 3 },
          { skuCode: 'beans-eth', quantity: 12 }, // case-insensitive
        ],
        { notes: '  Weekly restock ' },
      ).expect(201);

      expect(res.body).toMatchObject({
        status: 'RESERVED',
        orderNumber: expect.stringMatching(/^ORD-\d{6}$/),
        totalCents: 3 * 2495 + 12 * 1650, // 7485 + 19800 = 27285
        notes: 'Weekly restock',
        customer: { id: customer.id },
        cancelledAt: null,
      });
      expect(res.body.totalCents).toBe(27285);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({
        sku: { code: 'DRIP-WHT' },
        quantity: 3,
        unitPriceCents: 2495,
        lineTotalCents: 7485,
        reservation: { status: 'ACTIVE', quantity: 3 },
        currentAvailability: { quantityOnHand: 10, quantityReserved: 3, quantityAvailable: 7 },
      });

      expect(await getInventory(app, dripper.sku.id)).toEqual({
        quantityOnHand: 10,
        quantityReserved: 3,
        quantityAvailable: 7,
      });
      expect(await getInventory(app, beans.sku.id)).toEqual({
        quantityOnHand: 50,
        quantityReserved: 12,
        quantityAvailable: 38,
      });

      const movements = await http()
        .get(`/inventory/${dripper.sku.id}/movements?type=RESERVATION`)
        .expect(200);
      expect(movements.body.data).toHaveLength(1);
      expect(movements.body.data[0]).toMatchObject({ reservedDelta: 3, orderId: res.body.id });
    });

    it('lets an order take exactly the remaining available stock', async () => {
      const { sku } = await createStockedSku(app, 5, { code: 'EXACT-1' });
      await placeOrder(app, customer.id, [{ skuCode: 'EXACT-1', quantity: 5 }]).expect(201);
      expect(await getInventory(app, sku.id)).toEqual({
        quantityOnHand: 5,
        quantityReserved: 5,
        quantityAvailable: 0,
      });
    });

    it('rejects an order that asks for more than is available and reserves nothing', async () => {
      const { sku } = await createStockedSku(app, 4, { code: 'SCARCE-1' });
      const res = await placeOrder(app, customer.id, [{ skuCode: 'SCARCE-1', quantity: 5 }]).expect(
        409,
      );

      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.details.shortages).toEqual([
        { skuCode: 'SCARCE-1', requested: 5, available: 4 },
      ]);
      expect(await getInventory(app, sku.id)).toEqual({
        quantityOnHand: 4,
        quantityReserved: 0,
        quantityAvailable: 4,
      });
      expect(await prisma.order.count()).toBe(0);
    });

    it('is all-or-nothing: one short line rolls back the reservations of every other line', async () => {
      const plenty = await createStockedSku(app, 100, { code: 'PLENTY-1' });
      const scarce = await createStockedSku(app, 1, { code: 'SCARCE-2' });
      const alsoScarce = await createStockedSku(app, 0, { code: 'EMPTY-1' });

      const res = await placeOrder(app, customer.id, [
        { skuCode: 'PLENTY-1', quantity: 10 },
        { skuCode: 'SCARCE-2', quantity: 2 },
        { skuCode: 'EMPTY-1', quantity: 1 },
      ]).expect(409);

      expect(res.body.details.shortages).toEqual(
        expect.arrayContaining([
          { skuCode: 'SCARCE-2', requested: 2, available: 1 },
          { skuCode: 'EMPTY-1', requested: 1, available: 0 },
        ]),
      );
      expect(
        res.body.details.shortages.find((s: { skuCode: string }) => s.skuCode === 'PLENTY-1'),
      ).toBeUndefined();
      expect(await getInventory(app, plenty.sku.id)).toMatchObject({ quantityReserved: 0 });
      expect(await getInventory(app, scarce.sku.id)).toMatchObject({ quantityReserved: 0 });
      expect(await getInventory(app, alsoScarce.sku.id)).toMatchObject({ quantityReserved: 0 });
      expect(await prisma.stockMovement.count({ where: { type: 'RESERVATION' } })).toBe(0);
      expect(await prisma.stockReservation.count()).toBe(0);
    });

    it('counts stock reserved by earlier orders as unavailable', async () => {
      await createStockedSku(app, 10, { code: 'SHARED-1' });
      await placeOrder(app, customer.id, [{ skuCode: 'SHARED-1', quantity: 6 }]).expect(201);
      const second = await placeOrder(app, customer.id, [
        { skuCode: 'SHARED-1', quantity: 5 },
      ]).expect(409);
      expect(second.body.details.shortages[0]).toEqual({
        skuCode: 'SHARED-1',
        requested: 5,
        available: 4,
      });
      await placeOrder(app, customer.id, [{ skuCode: 'SHARED-1', quantity: 4 }]).expect(201);
    });

    it.each([
      ['no items', { items: [] }, 'items'],
      ['missing items', {}, 'items'],
      ['zero quantity', { items: [{ skuCode: 'ANY-1', quantity: 0 }] }, 'items[0].quantity'],
      ['negative quantity', { items: [{ skuCode: 'ANY-1', quantity: -2 }] }, 'items[0].quantity'],
      [
        'fractional quantity',
        { items: [{ skuCode: 'ANY-1', quantity: 1.5 }] },
        'items[0].quantity',
      ],
      [
        'quantity above line limit',
        { items: [{ skuCode: 'ANY-1', quantity: 10_001 }] },
        'items[0].quantity',
      ],
      ['invalid sku code', { items: [{ skuCode: 'bad code!', quantity: 1 }] }, 'items[0].skuCode'],
      [
        'unknown line property',
        { items: [{ skuCode: 'ANY-1', quantity: 1, price: 1 }] },
        'items[0].price',
      ],
      [
        'client-supplied total',
        { items: [{ skuCode: 'ANY-1', quantity: 1 }], totalCents: 1 },
        'totalCents',
      ],
      ['non-array items', { items: 'ANY-1' }, 'items'],
    ])('rejects %s with 400', async (_label, body, field) => {
      const res = await http()
        .post('/orders')
        .send({ customerId: customer.id, ...body })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
    });

    it('rejects more than 50 lines and a missing/invalid customerId with 400', async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        skuCode: `SKU-${i + 10}`,
        quantity: 1,
      }));
      await http().post('/orders').send({ customerId: customer.id, items }).expect(400);
      await http()
        .post('/orders')
        .send({ items: [{ skuCode: 'ANY-1', quantity: 1 }] })
        .expect(400);
      await http()
        .post('/orders')
        .send({ customerId: 'abc', items: [{ skuCode: 'ANY-1', quantity: 1 }] })
        .expect(400);
    });

    it('rejects the same SKU appearing twice in one order', async () => {
      await createStockedSku(app, 10, { code: 'TWICE-1' });
      const res = await placeOrder(app, customer.id, [
        { skuCode: 'TWICE-1', quantity: 1 },
        { skuCode: 'twice-1', quantity: 2 },
      ]).expect(400);
      expect(res.body.details[0].messages[0]).toContain('TWICE-1');
    });

    it('404s for an unknown customer or unknown SKU codes', async () => {
      await createStockedSku(app, 10, { code: 'KNOWN-1' });
      const noCustomer = await placeOrder(app, 9999, [{ skuCode: 'KNOWN-1', quantity: 1 }]).expect(
        404,
      );
      expect(noCustomer.body.code).toBe('CUSTOMER_NOT_FOUND');
      const noSku = await placeOrder(app, customer.id, [
        { skuCode: 'KNOWN-1', quantity: 1 },
        { skuCode: 'GHOST-1', quantity: 1 },
      ]).expect(404);
      expect(noSku.body).toMatchObject({
        code: 'SKU_NOT_FOUND',
        details: { skuCodes: ['GHOST-1'] },
      });
      expect(await prisma.order.count()).toBe(0);
    });

    it('422s for inactive SKUs and SKUs of inactive products', async () => {
      const a = await createStockedSku(app, 10, { code: 'OFF-SKU' });
      await http().patch(`/skus/${a.sku.id}`).send({ active: false }).expect(200);
      const b = await createStockedSku(app, 10, { code: 'OFF-PROD' });
      await http().patch(`/products/${b.product.id}`).send({ active: false }).expect(200);

      const res = await placeOrder(app, customer.id, [
        { skuCode: 'OFF-SKU', quantity: 1 },
        { skuCode: 'OFF-PROD', quantity: 1 },
      ]).expect(422);
      expect(res.body.code).toBe('SKU_NOT_ORDERABLE');
      expect(res.body.details.skuCodes.sort()).toEqual(['OFF-PROD', 'OFF-SKU']);
      expect(await getInventory(app, a.sku.id)).toMatchObject({ quantityReserved: 0 });
    });

    it('rejects totals beyond the supported maximum with 422', async () => {
      const product = await createProduct(app);
      const sku = await createSku(app, product.id, { code: 'PRICEY-1', priceCents: 100_000_000 });
      await receive(app, sku.id, 100).expect(201);
      const res = await placeOrder(app, customer.id, [
        { skuCode: 'PRICEY-1', quantity: 21 },
      ]).expect(422);
      expect(res.body.code).toBe('ORDER_TOTAL_TOO_LARGE');
      await placeOrder(app, customer.id, [{ skuCode: 'PRICEY-1', quantity: 20 }]).expect(201); // exactly 2,000,000,000
    });

    it('keeps the price an order was placed at when the SKU price changes later', async () => {
      const { sku } = await createStockedSku(app, 10, { code: 'PRICE-1', priceCents: 1000 });
      const order = await placeOrder(app, customer.id, [
        { skuCode: 'PRICE-1', quantity: 2 },
      ]).expect(201);
      await http().patch(`/skus/${sku.id}`).send({ priceCents: 5000 }).expect(200);

      const read = await http().get(`/orders/${order.body.id}`).expect(200);
      expect(read.body.totalCents).toBe(2000);
      expect(read.body.items[0]).toMatchObject({ unitPriceCents: 1000, lineTotalCents: 2000 });
      const next = await placeOrder(app, customer.id, [{ skuCode: 'PRICE-1', quantity: 1 }]).expect(
        201,
      );
      expect(next.body.totalCents).toBe(5000);
    });
  });

  describe('viewing orders', () => {
    it('shows current availability that reflects later activity on the same SKU', async () => {
      const { sku } = await createStockedSku(app, 10, { code: 'LIVE-1' });
      const first = await placeOrder(app, customer.id, [{ skuCode: 'LIVE-1', quantity: 2 }]).expect(
        201,
      );
      expect(first.body.items[0].currentAvailability.quantityAvailable).toBe(8);

      await placeOrder(app, customer.id, [{ skuCode: 'LIVE-1', quantity: 5 }]).expect(201);
      await receive(app, sku.id, 20).expect(201);

      const read = await http().get(`/orders/${first.body.id}`).expect(200);
      expect(read.body.items[0].currentAvailability).toEqual({
        quantityOnHand: 30,
        quantityReserved: 7,
        quantityAvailable: 23,
      });
    });

    it('returns 404 for unknown orders and 400 for malformed ids', async () => {
      const res = await http().get('/orders/9999').expect(404);
      expect(res.body.code).toBe('ORDER_NOT_FOUND');
      await http().get('/orders/xyz').expect(400);
    });
  });

  describe('cancelling orders', () => {
    it('releases the reserved stock, records RELEASE movements and keeps on-hand untouched', async () => {
      const { sku } = await createStockedSku(app, 10, { code: 'CANCEL-1' });
      const order = await placeOrder(app, customer.id, [
        { skuCode: 'CANCEL-1', quantity: 6 },
      ]).expect(201);
      expect(await getInventory(app, sku.id)).toMatchObject({
        quantityReserved: 6,
        quantityAvailable: 4,
      });

      const res = await cancelOrder(app, order.body.id, {
        reason: '  Customer changed their mind ',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Customer changed their mind',
        items: [
          {
            reservation: { status: 'RELEASED', quantity: 6 },
            currentAvailability: { quantityAvailable: 10 },
          },
        ],
      });
      expect(res.body.cancelledAt).not.toBeNull();
      expect(await getInventory(app, sku.id)).toEqual({
        quantityOnHand: 10,
        quantityReserved: 0,
        quantityAvailable: 10,
      });

      const movements = await http().get(`/inventory/${sku.id}/movements?type=RELEASE`).expect(200);
      expect(movements.body.data).toHaveLength(1);
      expect(movements.body.data[0]).toMatchObject({
        reservedDelta: -6,
        onHandDelta: 0,
        orderId: order.body.id,
      });
    });

    it('makes the released stock orderable again', async () => {
      await createStockedSku(app, 3, { code: 'REUSE-1' });
      const first = await placeOrder(app, customer.id, [
        { skuCode: 'REUSE-1', quantity: 3 },
      ]).expect(201);
      await placeOrder(app, customer.id, [{ skuCode: 'REUSE-1', quantity: 1 }]).expect(409);
      await cancelOrder(app, first.body.id).expect(200);
      await placeOrder(app, customer.id, [{ skuCode: 'REUSE-1', quantity: 3 }]).expect(201);
    });

    it('cancels multi-line orders completely', async () => {
      const a = await createStockedSku(app, 10, { code: 'MULTI-A' });
      const b = await createStockedSku(app, 10, { code: 'MULTI-B' });
      const order = await placeOrder(app, customer.id, [
        { skuCode: 'MULTI-A', quantity: 4 },
        { skuCode: 'MULTI-B', quantity: 9 },
      ]).expect(201);
      await cancelOrder(app, order.body.id).expect(200);
      expect(await getInventory(app, a.sku.id)).toMatchObject({ quantityReserved: 0 });
      expect(await getInventory(app, b.sku.id)).toMatchObject({ quantityReserved: 0 });
      expect(await prisma.stockReservation.count({ where: { status: 'ACTIVE' } })).toBe(0);
    });

    it('rejects cancelling twice with 409 and releases stock only once', async () => {
      const { sku } = await createStockedSku(app, 10, { code: 'TWICE-2' });
      const order = await placeOrder(app, customer.id, [
        { skuCode: 'TWICE-2', quantity: 4 },
      ]).expect(201);
      await placeOrder(app, customer.id, [{ skuCode: 'TWICE-2', quantity: 3 }]).expect(201);
      await cancelOrder(app, order.body.id).expect(200);

      const again = await cancelOrder(app, order.body.id).expect(409);
      expect(again.body.code).toBe('ORDER_ALREADY_CANCELLED');
      // The second order's 3 reserved units are untouched: only the first order released its 4.
      expect(await getInventory(app, sku.id)).toEqual({
        quantityOnHand: 10,
        quantityReserved: 3,
        quantityAvailable: 7,
      });
    });

    it('404s for unknown orders and validates the reason', async () => {
      const res = await cancelOrder(app, 9999).expect(404);
      expect(res.body.code).toBe('ORDER_NOT_FOUND');
      const { sku } = await createStockedSku(app, 5, { code: 'REASON-1' });
      const order = await placeOrder(app, customer.id, [
        { skuCode: 'REASON-1', quantity: 1 },
      ]).expect(201);
      await cancelOrder(app, order.body.id, { reason: null }).expect(400);
      await cancelOrder(app, order.body.id, { reason: 'x'.repeat(501) }).expect(400);
      await cancelOrder(app, order.body.id, { extra: true }).expect(400);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityReserved: 1 }); // still reserved
    });

    it('works for orders whose SKU was deactivated or repriced after placement', async () => {
      const { sku } = await createStockedSku(app, 5, { code: 'LATE-1' });
      const order = await placeOrder(app, customer.id, [{ skuCode: 'LATE-1', quantity: 2 }]).expect(
        201,
      );
      await http().patch(`/skus/${sku.id}`).send({ active: false, priceCents: 1 }).expect(200);
      await cancelOrder(app, order.body.id).expect(200);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityReserved: 0 });
    });
  });

  describe('listing orders', () => {
    it('filters by status and customer, and paginates with stable sorting', async () => {
      await createStockedSku(app, 100, { code: 'LIST-1', priceCents: 100 });
      const other = await createCustomer(app);
      const o1 = await placeOrder(app, customer.id, [{ skuCode: 'LIST-1', quantity: 1 }]).expect(
        201,
      );
      const o2 = await placeOrder(app, customer.id, [{ skuCode: 'LIST-1', quantity: 3 }]).expect(
        201,
      );
      const o3 = await placeOrder(app, other.id, [{ skuCode: 'LIST-1', quantity: 2 }]).expect(201);
      await cancelOrder(app, o2.body.id).expect(200);

      const ids = (body: { data: Array<{ id: number }> }) => body.data.map((o) => o.id);

      expect(ids((await http().get('/orders').expect(200)).body)).toEqual([
        o3.body.id,
        o2.body.id,
        o1.body.id,
      ]);
      expect(ids((await http().get('/orders?sortOrder=asc').expect(200)).body)).toEqual([
        o1.body.id,
        o2.body.id,
        o3.body.id,
      ]);
      expect(ids((await http().get('/orders?status=CANCELLED').expect(200)).body)).toEqual([
        o2.body.id,
      ]);
      expect(
        ids((await http().get('/orders?status=RESERVED&sortOrder=asc').expect(200)).body),
      ).toEqual([o1.body.id, o3.body.id]);
      expect(ids((await http().get(`/orders?customerId=${other.id}`).expect(200)).body)).toEqual([
        o3.body.id,
      ]);
      expect(
        ids(
          (await http().get(`/orders?customerId=${customer.id}&status=RESERVED`).expect(200)).body,
        ),
      ).toEqual([o1.body.id]);

      const byTotal = await http().get('/orders?sortBy=totalCents&sortOrder=desc').expect(200);
      expect(byTotal.body.data.map((o: { totalCents: number }) => o.totalCents)).toEqual([
        300, 200, 100,
      ]);

      const page = await http().get('/orders?sortOrder=asc&pageSize=2&page=2').expect(200);
      expect(ids(page.body)).toEqual([o3.body.id]);
      expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
      expect(page.body.data[0]).toMatchObject({
        itemCount: 1,
        customer: { id: other.id },
        orderNumber: expect.any(String),
      });
      expect(page.body.data[0].items).toBeUndefined();
    });

    it('filters by creation date range (inclusive) and validates it', async () => {
      await createStockedSku(app, 100, { code: 'DATE-1' });
      const o1 = await placeOrder(app, customer.id, [{ skuCode: 'DATE-1', quantity: 1 }]).expect(
        201,
      );
      const o2 = await placeOrder(app, customer.id, [{ skuCode: 'DATE-1', quantity: 1 }]).expect(
        201,
      );
      await prisma.order.update({
        where: { id: o1.body.id },
        data: { createdAt: new Date('2026-01-10T12:00:00Z') },
      });
      await prisma.order.update({
        where: { id: o2.body.id },
        data: { createdAt: new Date('2026-02-10T12:00:00Z') },
      });

      const ids = (body: { data: Array<{ id: number }> }) => body.data.map((o) => o.id);
      expect(
        ids((await http().get('/orders?createdFrom=2026-02-01T00:00:00Z').expect(200)).body),
      ).toEqual([o2.body.id]);
      expect(
        ids((await http().get('/orders?createdTo=2026-01-31T23:59:59Z').expect(200)).body),
      ).toEqual([o1.body.id]);
      expect(
        ids(
          (
            await http()
              .get('/orders?createdFrom=2026-01-10T12:00:00Z&createdTo=2026-01-10T12:00:00Z')
              .expect(200)
          ).body,
        ),
      ).toEqual([o1.body.id]);
      await http()
        .get('/orders?createdFrom=2026-03-01T00:00:00Z&createdTo=2026-01-01T00:00:00Z')
        .expect(400);
      await http().get('/orders?createdFrom=yesterday').expect(400);
      await http().get('/orders?status=SHIPPED').expect(400);
      await http().get('/orders?sortBy=notes').expect(400);
    });
  });

  it('keeps every invariant after a mixed sequence of operations', async () => {
    const a = await createStockedSku(app, 50, { code: 'MIX-A', priceCents: 333 });
    const b = await createStockedSku(app, 20, { code: 'MIX-B', priceCents: 777 });
    const o1 = await placeOrder(app, customer.id, [
      { skuCode: 'MIX-A', quantity: 10 },
      { skuCode: 'MIX-B', quantity: 5 },
    ]).expect(201);
    await adjust(app, a.sku.id, { quantityDelta: -5, reason: 'DAMAGED' }).expect(201);
    const o2 = await placeOrder(app, customer.id, [{ skuCode: 'MIX-A', quantity: 35 }]).expect(201);
    await placeOrder(app, customer.id, [{ skuCode: 'MIX-A', quantity: 1 }]).expect(409);
    await cancelOrder(app, o1.body.id).expect(200);
    await receive(app, b.sku.id, 7).expect(201);
    await cancelOrder(app, o2.body.id).expect(200);
    await placeOrder(app, customer.id, [{ skuCode: 'MIX-B', quantity: 27 }]).expect(201);

    expect(await getInventory(app, a.sku.id)).toEqual({
      quantityOnHand: 45,
      quantityReserved: 0,
      quantityAvailable: 45,
    });
    expect(await getInventory(app, b.sku.id)).toEqual({
      quantityOnHand: 27,
      quantityReserved: 27,
      quantityAvailable: 0,
    });
    // afterEach(assertInvariants) re-derives every total from the ledger.
  });
});
