import { INestApplication } from '@nestjs/common';
import request from 'supertest';

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`.toUpperCase();

export async function createCustomer(
  app: INestApplication,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .send({ name: 'Test Customer', email: `customer-${unique()}@example.com`, ...overrides })
    .expect(201);
  return res.body as { id: number; name: string; email: string };
}

export async function createProduct(
  app: INestApplication,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/products')
    .send({ name: `Product ${unique()}`, category: 'Test', ...overrides })
    .expect(201);
  return res.body as { id: number; name: string; active: boolean };
}

export async function createSku(
  app: INestApplication,
  productId: number,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post(`/products/${productId}/skus`)
    .send({ code: `SKU-${unique()}`, priceCents: 1000, ...overrides })
    .expect(201);
  return res.body as { id: number; code: string; priceCents: number; active: boolean };
}

export function receive(app: INestApplication, skuId: number, quantity: number, extra = {}) {
  return request(app.getHttpServer())
    .post(`/inventory/${skuId}/receive`)
    .send({ quantity, ...extra });
}

export function adjust(app: INestApplication, skuId: number, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post(`/inventory/${skuId}/adjust`).send(body);
}

export function placeOrder(
  app: INestApplication,
  customerId: number,
  items: Array<{ skuCode: string; quantity: number }>,
  extra: Record<string, unknown> = {},
) {
  return request(app.getHttpServer())
    .post('/orders')
    .send({ customerId, items, ...extra });
}

export function cancelOrder(
  app: INestApplication,
  orderId: number,
  body: Record<string, unknown> = {},
) {
  return request(app.getHttpServer()).post(`/orders/${orderId}/cancel`).send(body);
}

/** The three quantities of a SKU (the full view also carries identifying fields). */
export async function getInventory(app: INestApplication, skuId: number) {
  const res = await request(app.getHttpServer()).get(`/inventory/${skuId}`).expect(200);
  const { quantityOnHand, quantityReserved, quantityAvailable } = res.body as {
    quantityOnHand: number;
    quantityReserved: number;
    quantityAvailable: number;
  };
  return { quantityOnHand, quantityReserved, quantityAvailable };
}

/** Product + SKU with stock on hand, ready to be ordered. */
export async function createStockedSku(
  app: INestApplication,
  stock: number,
  sku: Record<string, unknown> = {},
) {
  const product = await createProduct(app);
  const created = await createSku(app, product.id, sku);
  if (stock > 0) await receive(app, created.id, stock).expect(201);
  return { product, sku: created };
}
