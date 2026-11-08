import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createProduct, createSku, createStockedSku, receive } from './helpers/factories';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Products and SKUs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  describe('products', () => {
    it('creates a product (active, no SKUs yet) and reads it back', async () => {
      const res = await http()
        .post('/products')
        .send({ name: '  Ceramic Dripper ', description: 'Cone dripper', category: 'Brewing' })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Ceramic Dripper',
        description: 'Cone dripper',
        category: 'Brewing',
        active: true,
        skus: [],
      });
      const read = await http().get(`/products/${res.body.id}`).expect(200);
      expect(read.body.name).toBe('Ceramic Dripper');
    });

    it.each([
      ['missing name', {}, 'name'],
      ['blank name', { name: '  ' }, 'name'],
      ['name too long', { name: 'x'.repeat(151) }, 'name'],
      ['null description', { name: 'N', description: null }, 'description'],
      ['unknown property', { name: 'N', price: 5 }, 'price'],
    ])('rejects %s with 400', async (_label, body, field) => {
      const res = await http().post('/products').send(body).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
    });

    it('updates fields, clears nullable ones and toggles active', async () => {
      const product = await createProduct(app, { description: 'old', category: 'Old' });
      const res = await http()
        .patch(`/products/${product.id}`)
        .send({ name: 'New name', description: null, category: 'New', active: false })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'New name',
        description: null,
        category: 'New',
        active: false,
      });
    });

    it('rejects null/blank for non-nullable product fields without a 500', async () => {
      const product = await createProduct(app);
      await http().patch(`/products/${product.id}`).send({ name: null }).expect(400);
      await http().patch(`/products/${product.id}`).send({ active: null }).expect(400);
      await http().patch(`/products/${product.id}`).send({ name: '' }).expect(400);
    });

    it('returns 404 for unknown products', async () => {
      const res = await http().get('/products/9999').expect(404);
      expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
      await http().patch('/products/9999').send({ name: 'x' }).expect(404);
    });

    it('lists with filters, search (name or SKU code), pagination and stable sorting', async () => {
      const a = await createProduct(app, { name: 'Alpha Kettle', category: 'Brewing' });
      const b = await createProduct(app, { name: 'Beta Grinder', category: 'Grinders' });
      await createProduct(app, { name: 'Gamma Filter', category: 'Brewing' });
      await createSku(app, a.id, { code: 'KETTLE-X1' });
      await http().patch(`/products/${b.id}`).send({ active: false }).expect(200);

      const byCategory = await http()
        .get('/products?category=Brewing&sortBy=name&sortOrder=asc')
        .expect(200);
      expect(byCategory.body.data.map((p: { name: string }) => p.name)).toEqual([
        'Alpha Kettle',
        'Gamma Filter',
      ]);
      expect(byCategory.body.data[0].skuCount).toBe(1);

      const inactive = await http().get('/products?active=false').expect(200);
      expect(inactive.body.data.map((p: { id: number }) => p.id)).toEqual([b.id]);

      const byName = await http().get('/products?q=grind').expect(200);
      expect(byName.body.meta.total).toBe(1);
      const bySkuCode = await http().get('/products?q=kettle-x').expect(200);
      expect(bySkuCode.body.data.map((p: { id: number }) => p.id)).toEqual([a.id]);

      const page = await http()
        .get('/products?sortBy=name&sortOrder=asc&pageSize=2&page=2')
        .expect(200);
      expect(page.body.data.map((p: { name: string }) => p.name)).toEqual(['Gamma Filter']);
      expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });

      await http().get('/products?active=maybe').expect(400);
      await http().get('/products?sortBy=secret').expect(400);
    });

    it('shows SKUs with live stock availability in product details', async () => {
      const { product, sku } = await createStockedSku(app, 25, { code: 'DRIP-WHT' });
      const res = await http().get(`/products/${product.id}`).expect(200);
      expect(res.body.skus).toHaveLength(1);
      expect(res.body.skus[0]).toMatchObject({
        id: sku.id,
        code: 'DRIP-WHT',
        inventory: { quantityOnHand: 25, quantityReserved: 0, quantityAvailable: 25 },
      });
    });
  });

  describe('SKUs', () => {
    it('creates a SKU with an empty inventory record and normalises the code', async () => {
      const product = await createProduct(app);
      const res = await http()
        .post(`/products/${product.id}/skus`)
        .send({ code: '  drip-cer-wht ', variantName: 'White', priceCents: 2495 })
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'DRIP-CER-WHT',
        variantName: 'White',
        priceCents: 2495,
        active: true,
        inventory: { quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0 },
      });
      expect(await prisma.inventoryItem.count({ where: { skuId: res.body.id } })).toBe(1);
    });

    it.each([
      ['float price', { code: 'AB-1', priceCents: 24.95 }, 'priceCents'],
      ['negative price', { code: 'AB-1', priceCents: -1 }, 'priceCents'],
      ['string price', { code: 'AB-1', priceCents: '2495' }, 'priceCents'],
      ['absurd price', { code: 'AB-1', priceCents: 1_000_000_000 }, 'priceCents'],
      ['missing price', { code: 'AB-1' }, 'priceCents'],
      ['code with spaces', { code: 'AB 1', priceCents: 100 }, 'code'],
      ['too-short code', { code: 'A', priceCents: 100 }, 'code'],
      ['missing code', { priceCents: 100 }, 'code'],
    ])('rejects %s with 400', async (_label, body, field) => {
      const product = await createProduct(app);
      const res = await http().post(`/products/${product.id}/skus`).send(body).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
    });

    it('rejects duplicate codes (case-insensitively) with 409', async () => {
      const product = await createProduct(app);
      await createSku(app, product.id, { code: 'DUP-1' });
      const other = await createProduct(app);
      const res = await http()
        .post(`/products/${other.id}/skus`)
        .send({ code: 'dup-1', priceCents: 5 })
        .expect(409);
      expect(res.body.code).toBe('SKU_CODE_TAKEN');
    });

    it('404s for unknown products and 422s for inactive ones', async () => {
      await http().post('/products/9999/skus').send({ code: 'NEW-1', priceCents: 5 }).expect(404);
      const product = await createProduct(app);
      await http().patch(`/products/${product.id}`).send({ active: false }).expect(200);
      const res = await http()
        .post(`/products/${product.id}/skus`)
        .send({ code: 'NEW-2', priceCents: 5 })
        .expect(422);
      expect(res.body.code).toBe('PRODUCT_INACTIVE');
    });

    it('updates price, variant and active flag but never the code', async () => {
      const product = await createProduct(app);
      const sku = await createSku(app, product.id, { code: 'KEEP-ME', variantName: 'Old' });
      const res = await http()
        .patch(`/skus/${sku.id}`)
        .send({ priceCents: 1999, variantName: null, active: false })
        .expect(200);
      expect(res.body).toMatchObject({
        code: 'KEEP-ME',
        priceCents: 1999,
        variantName: null,
        active: false,
      });

      const codeChange = await http().patch(`/skus/${sku.id}`).send({ code: 'OTHER' }).expect(400);
      expect(codeChange.body.details[0].field).toBe('code');
      await http().patch(`/skus/${sku.id}`).send({ priceCents: null }).expect(400);
      await http().patch(`/skus/${sku.id}`).send({ priceCents: 9.99 }).expect(400);
      await http().patch('/skus/9999').send({ priceCents: 1 }).expect(404);
    });

    it('lists SKUs globally and per product with filters', async () => {
      const p1 = await createProduct(app);
      const p2 = await createProduct(app);
      const a = await createSku(app, p1.id, { code: 'AAA-1', priceCents: 300 });
      await createSku(app, p1.id, { code: 'AAA-2', priceCents: 100 });
      await createSku(app, p2.id, { code: 'BBB-1', priceCents: 200 });
      await http().patch(`/skus/${a.id}`).send({ active: false }).expect(200);

      const all = await http().get('/skus?sortBy=priceCents&sortOrder=asc').expect(200);
      expect(all.body.data.map((s: { code: string }) => s.code)).toEqual([
        'AAA-2',
        'BBB-1',
        'AAA-1',
      ]);
      const forProduct = await http()
        .get(`/products/${p1.id}/skus?sortBy=code&sortOrder=asc`)
        .expect(200);
      expect(forProduct.body.data.map((s: { code: string }) => s.code)).toEqual(['AAA-1', 'AAA-2']);
      const active = await http().get('/skus?active=true&code=aaa').expect(200);
      expect(active.body.data.map((s: { code: string }) => s.code)).toEqual(['AAA-2']);
      await http().get('/products/9999/skus').expect(404);
      const one = await http().get(`/skus/${a.id}`).expect(200);
      expect(one.body.code).toBe('AAA-1');
      await http().get('/skus/9999').expect(404);
    });

    it('reports the stock levels of a SKU', async () => {
      const { sku } = await createStockedSku(app, 5);
      await receive(app, sku.id, 3).expect(201);
      const res = await http().get(`/skus/${sku.id}`).expect(200);
      expect(res.body.inventory).toEqual({
        quantityOnHand: 8,
        quantityReserved: 0,
        quantityAvailable: 8,
      });
    });
  });
});
