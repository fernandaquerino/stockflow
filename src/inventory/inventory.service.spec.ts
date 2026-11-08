import { StockMovement } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exceptions';
import { AdjustmentReason } from './dto/adjust-stock.dto';
import { InventoryRecord, InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

const record = (onHand: number, reserved: number): InventoryRecord => ({
  skuId: 1,
  quantityOnHand: onHand,
  quantityReserved: reserved,
  sku: { id: 1, code: 'SKU-1', active: true, product: { id: 9, name: 'Thing' } },
});
const movement = {} as StockMovement;

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('Expected the promise to reject');
}

describe('InventoryService', () => {
  let repo: jest.Mocked<InventoryRepository>;
  let service: InventoryService;

  beforeEach(() => {
    repo = {
      findBySkuId: jest.fn(),
      receive: jest.fn(),
      adjust: jest.fn(),
      list: jest.fn(),
      listMovements: jest.fn(),
    } as unknown as jest.Mocked<InventoryRepository>;
    service = new InventoryService(repo);
  });

  it('404s for unknown SKUs on every operation', async () => {
    repo.findBySkuId.mockResolvedValue(null);
    expect((await errorOf(service.getBySkuId(1))).code).toBe('SKU_NOT_FOUND');
    expect((await errorOf(service.receive(1, { quantity: 1 }))).getStatus()).toBe(404);
    expect(
      (
        await errorOf(service.adjust(1, { quantityDelta: 1, reason: AdjustmentReason.FOUND }))
      ).getStatus(),
    ).toBe(404);
    expect((await errorOf(service.listMovements(1, baseMovementQuery))).getStatus()).toBe(404);
    expect(repo.receive).not.toHaveBeenCalled();
    expect(repo.adjust).not.toHaveBeenCalled();
  });

  describe('receive', () => {
    it('returns the movement and the refreshed availability', async () => {
      repo.findBySkuId.mockResolvedValueOnce(record(5, 2)).mockResolvedValueOnce(record(15, 2));
      repo.receive.mockResolvedValue({
        movement,
        levels: { quantityOnHand: 15, quantityReserved: 2 },
      });
      const result = await service.receive(1, { quantity: 10, reference: 'PO-1' });
      expect(repo.receive).toHaveBeenCalledWith(1, 10, { reference: 'PO-1', note: undefined });
      expect(result.inventory).toMatchObject({ quantityOnHand: 15, quantityAvailable: 13 });
    });

    it('reports a conflict when the stock cap would be exceeded', async () => {
      repo.findBySkuId.mockResolvedValue(record(5, 0));
      repo.receive.mockResolvedValue(null);
      expect((await errorOf(service.receive(1, { quantity: 10 }))).code).toBe(
        'STOCK_LIMIT_EXCEEDED',
      );
    });
  });

  describe('adjust', () => {
    it.each([
      [AdjustmentReason.DAMAGED, 3],
      [AdjustmentReason.LOST, 1],
      [AdjustmentReason.FOUND, -1],
    ])('rejects reason %s with delta %i as a mismatch (422)', async (reason, delta) => {
      const error = await errorOf(service.adjust(1, { quantityDelta: delta, reason }));
      expect(error.code).toBe('ADJUSTMENT_REASON_MISMATCH');
      expect(error.getStatus()).toBe(422);
      expect(repo.adjust).not.toHaveBeenCalled();
    });

    it('requires a note for reason OTHER', async () => {
      const error = await errorOf(
        service.adjust(1, { quantityDelta: -1, reason: AdjustmentReason.OTHER }),
      );
      expect(error.getStatus()).toBe(400);
      expect(JSON.stringify(error.details)).toContain('note');
    });

    it('explains an insufficient-stock rejection with the current levels', async () => {
      repo.findBySkuId.mockResolvedValue(record(10, 7));
      repo.adjust.mockResolvedValue(null);
      const error = await errorOf(
        service.adjust(1, { quantityDelta: -5, reason: AdjustmentReason.DAMAGED }),
      );
      expect(error.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
      expect(error.details).toEqual({
        quantityOnHand: 10,
        quantityReserved: 7,
        quantityAvailable: 3,
        requestedDelta: -5,
      });
    });

    it('reports the stock cap for rejected positive adjustments', async () => {
      repo.findBySkuId.mockResolvedValue(record(10, 0));
      repo.adjust.mockResolvedValue(null);
      const error = await errorOf(
        service.adjust(1, { quantityDelta: 5, reason: AdjustmentReason.FOUND }),
      );
      expect(error.code).toBe('STOCK_LIMIT_EXCEEDED');
    });

    it('passes reason and note to the repository on success', async () => {
      repo.findBySkuId.mockResolvedValue(record(10, 0));
      repo.adjust.mockResolvedValue({
        movement,
        levels: { quantityOnHand: 8, quantityReserved: 0 },
      });
      await service.adjust(1, { quantityDelta: -2, reason: AdjustmentReason.LOST, note: 'n' });
      expect(repo.adjust).toHaveBeenCalledWith(1, -2, { reason: 'LOST', note: 'n' });
    });
  });

  it('orders inventory lists deterministically with the key as tie-breaker', async () => {
    repo.list.mockResolvedValue([[], 0]);
    const base = { page: 1, pageSize: 20 };
    await service.list({ ...base, sortBy: 'skuCode', sortOrder: 'asc' });
    expect(repo.list).toHaveBeenLastCalledWith(
      {},
      [{ sku: { code: 'asc' } }, { skuId: 'asc' }],
      0,
      20,
    );
    await service.list({ ...base, sortBy: 'quantityOnHand', sortOrder: 'desc', inStock: true });
    expect(repo.list).toHaveBeenLastCalledWith(
      { inStock: true },
      [{ quantityOnHand: 'desc' }, { skuId: 'desc' }],
      0,
      20,
    );
  });
});

const baseMovementQuery = {
  page: 1,
  pageSize: 20,
  sortOrder: 'desc',
  sortBy: 'createdAt',
} as const;
