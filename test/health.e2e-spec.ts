import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';

describe('Health, docs and error contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(() => app.close());

  it('GET /health reports the API and database as up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('serves an OpenAPI document that covers the main resources', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.info.title).toBe('StockFlow API');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/products',
        '/products/{productId}/skus',
        '/skus/{id}',
        '/inventory/{skuId}/receive',
        '/inventory/{skuId}/adjust',
        '/inventory/{skuId}/movements',
        '/orders',
        '/orders/{id}/cancel',
        '/customers',
      ]),
    );
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      path: '/nope',
    });
  });

  it('returns 400 (not 500) for malformed JSON bodies', async () => {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });
});
