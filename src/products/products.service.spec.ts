import { Product } from '@prisma/client';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let repo: jest.Mocked<ProductsRepository>;
  let service: ProductsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findDetailById: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<ProductsRepository>;
    service = new ProductsService(repo);
  });

  it('404s for unknown products on read and update', async () => {
    repo.findDetailById.mockResolvedValue(null);
    repo.findById.mockResolvedValue(null);
    await expect(service.getById(1)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    await expect(service.update(1, { name: 'x' })).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('passes undefined for untouched fields and null for cleared ones', async () => {
    repo.findById.mockResolvedValue({ id: 1 } as Product);
    repo.findDetailById.mockResolvedValue({ id: 1, skus: [] } as never);
    await service.update(1, { description: null });
    expect(repo.update).toHaveBeenCalledWith(1, {
      name: undefined,
      description: null,
      category: undefined,
      active: undefined,
    });
  });

  it('combines list filters with AND and searches name or upper-cased SKU code', async () => {
    repo.list.mockResolvedValue([[], 0]);
    await service.list({
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      q: 'drip',
      category: 'Brewing',
      active: true,
    });
    expect(repo.list).toHaveBeenCalledWith(
      {
        AND: [
          {
            OR: [
              { name: { contains: 'drip' } },
              { skus: { some: { code: { contains: 'DRIP' } } } },
            ],
          },
          { category: 'Brewing' },
          { active: true },
        ],
      },
      [{ name: 'asc' }, { id: 'asc' }],
      0,
      20,
    );
  });

  it('maps SKU inventory to availability in product details', async () => {
    repo.findDetailById.mockResolvedValue({
      id: 1,
      skus: [
        { id: 5, code: 'A-1', inventory: { skuId: 5, quantityOnHand: 9, quantityReserved: 4 } },
        { id: 6, code: 'B-1', inventory: null },
      ],
    } as never);
    const product = await service.getById(1);
    expect(product.skus[0].inventory).toEqual({
      quantityOnHand: 9,
      quantityReserved: 4,
      quantityAvailable: 5,
    });
    expect(product.skus[1].inventory.quantityAvailable).toBe(0);
  });
});
