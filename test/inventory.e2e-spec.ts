import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  adjust,
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

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterEach(() => assertInvariants(prisma));
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  describe('receiving stock', () => {
    it('increases on-hand, records a RECEIPT movement and returns the new levels', async () => {
      const { sku } = await createStockedSku(app, 0);
      const res = await receive(app, sku.id, 40, {
        reference: 'PO-1001',
        note: 'First delivery',
      }).expect(201);

      expect(res.body.inventory).toMatchObject({
        skuId: sku.id,
        quantityOnHand: 40,
        quantityReserved: 0,
        quantityAvailable: 40,
      });
      expect(res.body.movement).toMatchObject({
        type: 'RECEIPT',
        onHandDelta: 40,
        reservedDelta: 0,
        onHandAfter: 40,
        reservedAfter: 0,
        reference: 'PO-1001',
        note: 'First delivery',
      });

      await receive(app, sku.id, 10).expect(201);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 50 });
    });

    it.each([
      ['zero', { quantity: 0 }],
      ['negative', { quantity: -5 }],
      ['fractional', { quantity: 1.5 }],
      ['string', { quantity: '5' }],
      ['missing', {}],
      ['too large', { quantity: 1_000_001 }],
      ['null reference', { quantity: 1, reference: null }],
      ['unknown property', { quantity: 1, price: 3 }],
    ])('rejects a %s quantity/body with 400 and changes nothing', async (_label, body) => {
      const { sku } = await createStockedSku(app, 10);
      await http().post(`/inventory/${sku.id}/receive`).send(body).expect(400);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 10 });
      expect(await prisma.stockMovement.count({ where: { skuId: sku.id } })).toBe(1);
    });

    it('404s for unknown SKUs and 400s for malformed ids', async () => {
      const res = await receive(app, 9999, 1).expect(404);
      expect(res.body.code).toBe('SKU_NOT_FOUND');
      await http().post('/inventory/abc/receive').send({ quantity: 1 }).expect(400);
    });

    it('refuses receipts that would exceed the per-SKU stock cap', async () => {
      const { sku } = await createStockedSku(app, 0);
      // Seed close to the cap directly; the API cap is 1,000,000,000 units per SKU.
      await prisma.$transaction([
        prisma.inventoryItem.update({
          where: { skuId: sku.id },
          data: { quantityOnHand: 999_999_999 },
        }),
        prisma.stockMovement.create({
          data: {
            skuId: sku.id,
            type: 'RECEIPT',
            onHandDelta: 999_999_999,
            reservedDelta: 0,
            onHandAfter: 999_999_999,
            reservedAfter: 0,
          },
        }),
      ]);
      const res = await receive(app, sku.id, 2).expect(409);
      expect(res.body.code).toBe('STOCK_LIMIT_EXCEEDED');
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 999_999_999 });
    });

    it('allows receiving stock for an inactive SKU (goods may still arrive)', async () => {
      const { sku } = await createStockedSku(app, 0);
      await http().patch(`/skus/${sku.id}`).send({ active: false }).expect(200);
      await receive(app, sku.id, 5).expect(201);
    });
  });

  describe('adjusting stock', () => {
    it('applies a negative adjustment with a reason and records an ADJUSTMENT movement', async () => {
      const { sku } = await createStockedSku(app, 20);
      const res = await adjust(app, sku.id, {
        quantityDelta: -3,
        reason: 'DAMAGED',
        note: 'Dropped pallet',
      }).expect(201);
      expect(res.body.inventory).toMatchObject({ quantityOnHand: 17, quantityAvailable: 17 });
      expect(res.body.movement).toMatchObject({
        type: 'ADJUSTMENT',
        onHandDelta: -3,
        onHandAfter: 17,
        reason: 'DAMAGED',
        note: 'Dropped pallet',
      });
    });

    it('applies a positive adjustment', async () => {
      const { sku } = await createStockedSku(app, 5);
      await adjust(app, sku.id, { quantityDelta: 4, reason: 'FOUND' }).expect(201);
      await adjust(app, sku.id, { quantityDelta: -2, reason: 'COUNT_CORRECTION' }).expect(201);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 7 });
    });

    it.each([
      ['no reason', { quantityDelta: -1 }, 'reason'],
      ['unknown reason', { quantityDelta: -1, reason: 'FUN' }, 'reason'],
      ['zero delta', { quantityDelta: 0, reason: 'LOST' }, 'quantityDelta'],
      ['fractional delta', { quantityDelta: 0.5, reason: 'FOUND' }, 'quantityDelta'],
      ['missing delta', { reason: 'LOST' }, 'quantityDelta'],
      ['OTHER without note', { quantityDelta: -1, reason: 'OTHER' }, 'note'],
    ])('rejects %s with 400', async (_label, body, field) => {
      const { sku } = await createStockedSku(app, 10);
      const res = await adjust(app, sku.id, body).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 10 });
    });

    it('accepts OTHER with a note', async () => {
      const { sku } = await createStockedSku(app, 10);
      await adjust(app, sku.id, {
        quantityDelta: -1,
        reason: 'OTHER',
        note: 'Sample for trade show',
      }).expect(201);
    });

    it('rejects reasons that contradict the direction of the change with 422', async () => {
      const { sku } = await createStockedSku(app, 10);
      const damaged = await adjust(app, sku.id, { quantityDelta: 2, reason: 'DAMAGED' }).expect(
        422,
      );
      expect(damaged.body.code).toBe('ADJUSTMENT_REASON_MISMATCH');
      await adjust(app, sku.id, { quantityDelta: 2, reason: 'LOST' }).expect(422);
      await adjust(app, sku.id, { quantityDelta: -2, reason: 'FOUND' }).expect(422);
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 10 });
    });

    it('cannot remove more than the on-hand quantity', async () => {
      const { sku } = await createStockedSku(app, 5);
      const res = await adjust(app, sku.id, { quantityDelta: -6, reason: 'LOST' }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
      expect(res.body.details).toMatchObject({
        quantityOnHand: 5,
        quantityAvailable: 5,
        requestedDelta: -6,
      });
      expect(await getInventory(app, sku.id)).toMatchObject({ quantityOnHand: 5 });
    });

    it('cannot take on-hand below the quantity reserved by open orders', async () => {
      const { sku } = await createStockedSku(app, 10);
      const customer = await createCustomer(app);
      await placeOrder(app, customer.id, [{ skuCode: sku.code, quantity: 7 }]).expect(201);

      // 10 on hand, 7 reserved -> only 3 may be removed.
      const tooMuch = await adjust(app, sku.id, { quantityDelta: -4, reason: 'DAMAGED' }).expect(
        409,
      );
      expect(tooMuch.body.details).toMatchObject({
        quantityOnHand: 10,
        quantityReserved: 7,
        quantityAvailable: 3,
      });
      await adjust(app, sku.id, { quantityDelta: -3, reason: 'DAMAGED' }).expect(201);
      expect(await getInventory(app, sku.id)).toEqual({
        quantityOnHand: 7,
        quantityReserved: 7,
        quantityAvailable: 0,
      });
    });

    it('404s for unknown SKUs', async () => {
      await adjust(app, 9999, { quantityDelta: 1, reason: 'FOUND' }).expect(404);
    });
  });

  describe('movement history', () => {
    it('lists movements newest first with a running balance and supports filters and paging', async () => {
      const { sku } = await createStockedSku(app, 0);
      await receive(app, sku.id, 100, { reference: 'PO-1' }).expect(201);
      await adjust(app, sku.id, { quantityDelta: -10, reason: 'DAMAGED' }).expect(201);
      const customer = await createCustomer(app);
      await placeOrder(app, customer.id, [{ skuCode: sku.code, quantity: 30 }]).expect(201);

      const all = await http().get(`/inventory/${sku.id}/movements`).expect(200);
      expect(all.body.data.map((m: { type: string }) => m.type)).toEqual([
        'RESERVATION',
        'ADJUSTMENT',
        'RECEIPT',
      ]);
      expect(all.body.data[0]).toMatchObject({
        reservedDelta: 30,
        onHandAfter: 90,
        reservedAfter: 30,
      });
      expect(all.body.data[0].orderId).toEqual(expect.any(Number));
      expect(all.body.meta.total).toBe(3);

      const oldestFirst = await http()
        .get(`/inventory/${sku.id}/movements?sortOrder=asc&pageSize=2`)
        .expect(200);
      expect(oldestFirst.body.data.map((m: { type: string }) => m.type)).toEqual([
        'RECEIPT',
        'ADJUSTMENT',
      ]);
      expect(oldestFirst.body.meta).toMatchObject({ total: 3, totalPages: 2 });

      const onlyReceipts = await http()
        .get(`/inventory/${sku.id}/movements?type=RECEIPT`)
        .expect(200);
      expect(onlyReceipts.body.data).toHaveLength(1);
      await http().get(`/inventory/${sku.id}/movements?type=THEFT`).expect(400);
      await http().get('/inventory/9999/movements').expect(404);
    });
  });

  describe('availability views', () => {
    it('lists inventory with filters for product, SKU code and stock status', async () => {
      const p1 = await createProduct(app, { name: 'Kettles' });
      const p2 = await createProduct(app, { name: 'Filters' });
      const k1 = await createSku(app, p1.id, { code: 'KET-1' });
      const k2 = await createSku(app, p1.id, { code: 'KET-2' });
      const f1 = await createSku(app, p2.id, { code: 'FIL-1' });
      await receive(app, k1.id, 10).expect(201);
      await receive(app, k2.id, 4).expect(201);
      await receive(app, f1.id, 2).expect(201);
      const customer = await createCustomer(app);
      await placeOrder(app, customer.id, [{ skuCode: 'KET-2', quantity: 4 }]).expect(201); // sold out

      const codes = (body: { data: Array<{ skuCode: string }> }) => body.data.map((i) => i.skuCode);

      const all = await http().get('/inventory').expect(200);
      expect(codes(all.body)).toEqual(['FIL-1', 'KET-1', 'KET-2']); // default: by code ascending
      const byProduct = await http().get(`/inventory?productId=${p1.id}`).expect(200);
      expect(codes(byProduct.body)).toEqual(['KET-1', 'KET-2']);
      const byCode = await http().get('/inventory?skuCode=fil').expect(200);
      expect(codes(byCode.body)).toEqual(['FIL-1']);
      const inStock = await http().get('/inventory?inStock=true').expect(200);
      expect(codes(inStock.body)).toEqual(['FIL-1', 'KET-1']);
      const soldOut = await http().get('/inventory?inStock=false').expect(200);
      expect(codes(soldOut.body)).toEqual(['KET-2']);
      expect(soldOut.body.data[0]).toMatchObject({
        quantityOnHand: 4,
        quantityReserved: 4,
        quantityAvailable: 0,
      });

      const byQty = await http()
        .get('/inventory?sortBy=quantityOnHand&sortOrder=desc&pageSize=2')
        .expect(200);
      expect(codes(byQty.body)).toEqual(['KET-1', 'KET-2']);
      expect(byQty.body.meta).toMatchObject({ total: 3, totalPages: 2 });
      await http().get('/inventory?inStock=perhaps').expect(400);
      await http().get('/inventory?sortBy=price').expect(400);
    });

    it('returns the availability of a single SKU and 404s for unknown ones', async () => {
      const { sku } = await createStockedSku(app, 12);
      const res = await http().get(`/inventory/${sku.id}`).expect(200);
      expect(res.body).toMatchObject({
        skuId: sku.id,
        skuCode: sku.code,
        quantityOnHand: 12,
        quantityReserved: 0,
        quantityAvailable: 12,
      });
      const missing = await http().get('/inventory/9999').expect(404);
      expect(missing.body.code).toBe('SKU_NOT_FOUND');
    });
  });
});
