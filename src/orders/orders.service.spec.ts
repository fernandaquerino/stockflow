import { Customer } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exceptions';
import { CustomersRepository } from '../customers/customers.repository';
import { InventoryRepository } from '../inventory/inventory.repository';
import { SkusRepository, SkuWithProduct } from '../skus/skus.repository';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

const sku = (
  overrides: Partial<{
    id: number;
    code: string;
    priceCents: number;
    active: boolean;
    productActive: boolean;
  }> = {},
) => {
  const {
    id = 1,
    code = 'SKU-1',
    priceCents = 1000,
    active = true,
    productActive = true,
  } = overrides;
  return {
    id,
    code,
    priceCents,
    active,
    inventory: null,
    product: { id: 10, name: 'P', active: productActive },
  } as unknown as SkuWithProduct;
};

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('Expected the promise to reject');
}

describe('OrdersService', () => {
  let orders: jest.Mocked<OrdersRepository>;
  let customers: jest.Mocked<CustomersRepository>;
  let skus: jest.Mocked<SkusRepository>;
  let inventory: jest.Mocked<InventoryRepository>;
  let service: OrdersService;

  beforeEach(() => {
    orders = {
      placeOrder: jest.fn(),
      cancelOrder: jest.fn(),
      findDetailById: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<OrdersRepository>;
    customers = { findById: jest.fn() } as unknown as jest.Mocked<CustomersRepository>;
    skus = { findManyByCodes: jest.fn() } as unknown as jest.Mocked<SkusRepository>;
    inventory = {
      findManyBySkuIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<InventoryRepository>;
    service = new OrdersService(orders, customers, skus, inventory);

    customers.findById.mockResolvedValue({ id: 5 } as Customer);
    orders.findDetailById.mockResolvedValue({
      id: 77,
      status: 'RESERVED',
      customer: { id: 5 },
      items: [],
    } as never);
  });

  describe('create', () => {
    it('rejects repeated SKU codes before touching the database', async () => {
      const error = await errorOf(
        service.create({
          customerId: 5,
          items: [
            { skuCode: 'A-1', quantity: 1 },
            { skuCode: 'A-1', quantity: 2 },
          ],
        }),
      );
      expect(error.getStatus()).toBe(400);
      expect(customers.findById).not.toHaveBeenCalled();
      expect(orders.placeOrder).not.toHaveBeenCalled();
    });

    it('404s for an unknown customer', async () => {
      customers.findById.mockResolvedValue(null);
      const error = await errorOf(
        service.create({ customerId: 5, items: [{ skuCode: 'SKU-1', quantity: 1 }] }),
      );
      expect(error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('404s and lists every unknown SKU code', async () => {
      skus.findManyByCodes.mockResolvedValue([sku()]);
      const error = await errorOf(
        service.create({
          customerId: 5,
          items: [
            { skuCode: 'SKU-1', quantity: 1 },
            { skuCode: 'NOPE-1', quantity: 1 },
            { skuCode: 'NOPE-2', quantity: 1 },
          ],
        }),
      );
      expect(error.code).toBe('SKU_NOT_FOUND');
      expect(error.details).toEqual({ skuCodes: ['NOPE-1', 'NOPE-2'] });
    });

    it('422s for inactive SKUs or inactive products', async () => {
      skus.findManyByCodes.mockResolvedValue([
        sku({ id: 1, code: 'OFF-1', active: false }),
        sku({ id: 2, code: 'OFF-2', productActive: false }),
        sku({ id: 3, code: 'ON-1' }),
      ]);
      const error = await errorOf(
        service.create({
          customerId: 5,
          items: ['OFF-1', 'OFF-2', 'ON-1'].map((skuCode) => ({ skuCode, quantity: 1 })),
        }),
      );
      expect(error.getStatus()).toBe(422);
      expect(error.details).toEqual({ skuCodes: ['OFF-1', 'OFF-2'] });
      expect(orders.placeOrder).not.toHaveBeenCalled();
    });

    it('rejects totals above the maximum', async () => {
      skus.findManyByCodes.mockResolvedValue([sku({ priceCents: 100_000_000 })]);
      const error = await errorOf(
        service.create({ customerId: 5, items: [{ skuCode: 'SKU-1', quantity: 21 }] }),
      );
      expect(error.code).toBe('ORDER_TOTAL_TOO_LARGE');
    });

    it('prices lines from the SKU price snapshot and passes integer totals to the repository', async () => {
      skus.findManyByCodes.mockResolvedValue([
        sku({ id: 1, code: 'A-1', priceCents: 2495 }),
        sku({ id: 2, code: 'B-1', priceCents: 1650 }),
      ]);
      orders.placeOrder.mockResolvedValue({ placed: true, orderId: 77 });
      await service.create({
        customerId: 5,
        items: [
          { skuCode: 'A-1', quantity: 3 },
          { skuCode: 'B-1', quantity: 12 },
        ],
        notes: 'hello',
      });
      expect(orders.placeOrder).toHaveBeenCalledWith({
        customerId: 5,
        notes: 'hello',
        totalCents: 27285,
        lines: [
          { skuId: 1, skuCode: 'A-1', quantity: 3, unitPriceCents: 2495, lineTotalCents: 7485 },
          { skuId: 2, skuCode: 'B-1', quantity: 12, unitPriceCents: 1650, lineTotalCents: 19800 },
        ],
      });
    });

    it('turns a stock shortage into a 409 carrying the shortages', async () => {
      skus.findManyByCodes.mockResolvedValue([sku()]);
      orders.placeOrder.mockResolvedValue({
        placed: false,
        shortages: [{ skuCode: 'SKU-1', requested: 5, available: 2 }],
      });
      const error = await errorOf(
        service.create({ customerId: 5, items: [{ skuCode: 'SKU-1', quantity: 5 }] }),
      );
      expect(error.code).toBe('INSUFFICIENT_STOCK');
      expect(error.getStatus()).toBe(409);
      expect(error.details).toEqual({
        shortages: [{ skuCode: 'SKU-1', requested: 5, available: 2 }],
      });
    });
  });

  describe('cancel', () => {
    it('maps repository results to HTTP semantics', async () => {
      orders.cancelOrder.mockResolvedValueOnce('not_found');
      expect((await errorOf(service.cancel(77, {}))).code).toBe('ORDER_NOT_FOUND');

      orders.cancelOrder.mockResolvedValueOnce('already_cancelled');
      const conflict = await errorOf(service.cancel(77, {}));
      expect(conflict.code).toBe('ORDER_ALREADY_CANCELLED');
      expect(conflict.getStatus()).toBe(409);

      orders.cancelOrder.mockResolvedValueOnce('cancelled');
      await expect(service.cancel(77, { reason: 'because' })).resolves.toMatchObject({ id: 77 });
      expect(orders.cancelOrder).toHaveBeenLastCalledWith(77, 'because');
    });
  });

  describe('list', () => {
    it('rejects an inverted date range', async () => {
      const error = await errorOf(
        service.list({
          page: 1,
          pageSize: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          createdFrom: '2026-03-01T00:00:00Z',
          createdTo: '2026-01-01T00:00:00Z',
        }),
      );
      expect(error.getStatus()).toBe(400);
    });

    it('builds the where clause and a deterministic order', async () => {
      orders.list.mockResolvedValue([[], 0]);
      await service.list({
        page: 2,
        pageSize: 10,
        sortBy: 'totalCents',
        sortOrder: 'desc',
        status: 'CANCELLED',
        customerId: 3,
        createdFrom: '2026-01-01T00:00:00Z',
      });
      expect(orders.list).toHaveBeenCalledWith(
        {
          status: 'CANCELLED',
          customerId: 3,
          createdAt: { gte: new Date('2026-01-01T00:00:00Z') },
        },
        [{ totalCents: 'desc' }, { id: 'desc' }],
        10,
        10,
      );
    });
  });
});
