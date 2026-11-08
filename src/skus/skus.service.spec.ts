import { Product } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exceptions';
import { ProductsRepository } from '../products/products.repository';
import { SkusRepository } from './skus.repository';
import { SkusService } from './skus.service';

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('Expected the promise to reject');
}

describe('SkusService', () => {
  let skus: jest.Mocked<SkusRepository>;
  let products: jest.Mocked<ProductsRepository>;
  let service: SkusService;
  const dto = { code: 'NEW-1', priceCents: 500 };

  beforeEach(() => {
    skus = {
      createWithInventory: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<SkusRepository>;
    products = { findById: jest.fn() } as unknown as jest.Mocked<ProductsRepository>;
    service = new SkusService(skus, products);
  });

  it('404s when the product does not exist', async () => {
    products.findById.mockResolvedValue(null);
    expect((await errorOf(service.create(1, dto))).code).toBe('PRODUCT_NOT_FOUND');
  });

  it('refuses to add SKUs to an inactive product (422)', async () => {
    products.findById.mockResolvedValue({ id: 1, active: false } as Product);
    const error = await errorOf(service.create(1, dto));
    expect(error.code).toBe('PRODUCT_INACTIVE');
    expect(error.getStatus()).toBe(422);
  });

  it('refuses duplicate SKU codes (409)', async () => {
    products.findById.mockResolvedValue({ id: 1, active: true } as Product);
    skus.findByCode.mockResolvedValue({} as never);
    const error = await errorOf(service.create(1, dto));
    expect(error.code).toBe('SKU_CODE_TAKEN');
    expect(skus.createWithInventory).not.toHaveBeenCalled();
  });

  it('creates the SKU together with its inventory and exposes availability', async () => {
    products.findById.mockResolvedValue({ id: 1, active: true } as Product);
    skus.findByCode.mockResolvedValue(null);
    skus.createWithInventory.mockResolvedValue({
      id: 4,
      code: 'NEW-1',
      inventory: { skuId: 4, quantityOnHand: 0, quantityReserved: 0 },
    } as never);
    const created = await service.create(1, dto);
    expect(skus.createWithInventory).toHaveBeenCalledWith({
      productId: 1,
      code: 'NEW-1',
      variantName: null,
      priceCents: 500,
    });
    expect(created.inventory).toEqual({
      quantityOnHand: 0,
      quantityReserved: 0,
      quantityAvailable: 0,
    });
  });

  it('404s for unknown SKUs on read and update', async () => {
    skus.findById.mockResolvedValue(null);
    expect((await errorOf(service.getById(1))).code).toBe('SKU_NOT_FOUND');
    expect((await errorOf(service.update(1, { priceCents: 1 }))).getStatus()).toBe(404);
  });

  it('checks the product exists when listing the SKUs of one product', async () => {
    products.findById.mockResolvedValue(null);
    const query = { page: 1, pageSize: 20, sortBy: 'code', sortOrder: 'asc' } as const;
    expect((await errorOf(service.list(query, 9))).code).toBe('PRODUCT_NOT_FOUND');
  });

  it('upper-cases the code filter for case-insensitive search', async () => {
    skus.list.mockResolvedValue([[], 0]);
    await service.list({
      page: 1,
      pageSize: 20,
      sortBy: 'code',
      sortOrder: 'asc',
      code: 'ab',
      active: true,
    });
    expect(skus.list).toHaveBeenCalledWith(
      { code: { contains: 'AB' }, active: true },
      [{ code: 'asc' }, { id: 'asc' }],
      0,
      20,
    );
  });
});
