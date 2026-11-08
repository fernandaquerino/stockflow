import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createCustomer } from './helpers/factories';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  it('creates a customer, normalises the e-mail and reads it back', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .send({
        name: '  Harbor Street Coffee ',
        email: ' Buyer@Harbor.EXAMPLE ',
        phone: '+1-555-0142',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Harbor Street Coffee',
      email: 'buyer@harbor.example',
      phone: '+1-555-0142',
    });
    const read = await request(app.getHttpServer()).get(`/customers/${res.body.id}`).expect(200);
    expect(read.body.id).toBe(res.body.id);
  });

  it.each([
    ['missing name', { email: 'a@b.example' }, 'name'],
    ['invalid e-mail', { name: 'A', email: 'nope' }, 'email'],
    ['null phone', { name: 'A', email: 'a@b.example', phone: null }, 'phone'],
    ['unknown property', { name: 'A', email: 'a@b.example', vip: true }, 'vip'],
  ])('rejects %s with 400', async (_label, body, field) => {
    const res = await request(app.getHttpServer()).post('/customers').send(body).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects duplicate e-mails (case-insensitive) with 409', async () => {
    await createCustomer(app, { email: 'same@example.com' });
    const res = await request(app.getHttpServer())
      .post('/customers')
      .send({ name: 'Other', email: 'SAME@example.com' })
      .expect(409);
    expect(res.body.code).toBe('CUSTOMER_EMAIL_TAKEN');
  });

  it('returns 404 / 400 for unknown or malformed ids', async () => {
    const res = await request(app.getHttpServer()).get('/customers/9999').expect(404);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
    await request(app.getHttpServer()).get('/customers/abc').expect(400);
  });

  it('lists with pagination, sorting and search', async () => {
    for (const name of ['Charlie', 'Alice', 'Bob', 'Alicia']) {
      await createCustomer(app, { name, email: `${name.toLowerCase()}@example.com` });
    }
    const page = await request(app.getHttpServer())
      .get('/customers?sortBy=name&sortOrder=asc&pageSize=2&page=2')
      .expect(200);
    expect(page.body.data.map((c: { name: string }) => c.name)).toEqual(['Bob', 'Charlie']);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 4, totalPages: 2 });

    const search = await request(app.getHttpServer())
      .get('/customers?search=ALI&sortBy=name&sortOrder=asc')
      .expect(200);
    expect(search.body.data.map((c: { name: string }) => c.name)).toEqual(['Alice', 'Alicia']);
    await request(app.getHttpServer()).get('/customers?pageSize=500').expect(400);
  });
});
