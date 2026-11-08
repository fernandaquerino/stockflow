import { Injectable } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import {
  ConflictException,
  InvalidRequestException,
  ResourceNotFoundException,
  UnprocessableException,
} from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { Availability, toAvailability } from './availability';
import { AdjustStockDto, AdjustmentReason } from './dto/adjust-stock.dto';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { InventoryRecord, InventoryRepository } from './inventory.repository';

export interface InventoryView extends Availability {
  skuId: number;
  skuCode: string;
  skuActive: boolean;
  productId: number;
  productName: string;
}

export function toInventoryView(record: InventoryRecord): InventoryView {
  return {
    skuId: record.skuId,
    skuCode: record.sku.code,
    skuActive: record.sku.active,
    productId: record.sku.product.id,
    productName: record.sku.product.name,
    ...toAvailability(record),
  };
}

@Injectable()
export class InventoryService {
  constructor(private readonly inventory: InventoryRepository) {}

  async getBySkuId(skuId: number): Promise<InventoryView> {
    const record = await this.inventory.findBySkuId(skuId);
    if (!record) throw new ResourceNotFoundException('SKU', skuId);
    return toInventoryView(record);
  }

  async list(query: ListInventoryQueryDto): Promise<Paginated<InventoryView>> {
    const direction = query.sortOrder;
    const orderBy =
      query.sortBy === 'skuCode'
        ? [{ sku: { code: direction } }, { skuId: direction }]
        : query.sortBy === 'quantityOnHand'
          ? [{ quantityOnHand: direction }, { skuId: direction }]
          : [{ skuId: direction }];
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.inventory.list(
      { productId: query.productId, skuCode: query.skuCode, inStock: query.inStock },
      orderBy,
      skip,
      take,
    );
    return buildPage(items.map(toInventoryView), total, query);
  }

  /** Invariant: onHand only grows through receipts and adjustments; each writes a movement. */
  async receive(skuId: number, dto: ReceiveStockDto) {
    await this.getBySkuId(skuId); // 404 for unknown SKUs
    const result = await this.inventory.receive(skuId, dto.quantity, {
      reference: dto.reference,
      note: dto.note,
    });
    if (!result) {
      throw new ConflictException(
        'STOCK_LIMIT_EXCEEDED',
        `Receiving ${dto.quantity} units would exceed the maximum stock per SKU`,
      );
    }
    return { movement: result.movement, inventory: await this.getBySkuId(skuId) };
  }

  /** Invariant: an adjustment can never take onHand below the quantity already reserved. */
  async adjust(skuId: number, dto: AdjustStockDto) {
    this.assertReasonMatchesDirection(dto);
    if (dto.reason === AdjustmentReason.OTHER && !dto.note) {
      throw new InvalidRequestException('Validation failed', [
        { field: 'note', messages: ['note is required when reason is OTHER'] },
      ]);
    }
    const before = await this.getBySkuId(skuId);

    const result = await this.inventory.adjust(skuId, dto.quantityDelta, {
      reason: dto.reason,
      note: dto.note,
    });
    if (!result) {
      // Re-read to report the state that caused the rejection.
      const now = await this.getBySkuId(skuId);
      if (dto.quantityDelta < 0) {
        throw new ConflictException(
          'INSUFFICIENT_AVAILABLE_STOCK',
          `Cannot remove ${-dto.quantityDelta} units from ${before.skuCode}: only ${now.quantityAvailable} are available (the rest is reserved by open orders)`,
          {
            quantityOnHand: now.quantityOnHand,
            quantityReserved: now.quantityReserved,
            quantityAvailable: now.quantityAvailable,
            requestedDelta: dto.quantityDelta,
          },
        );
      }
      throw new ConflictException(
        'STOCK_LIMIT_EXCEEDED',
        `Adding ${dto.quantityDelta} units would exceed the maximum stock per SKU`,
      );
    }
    return { movement: result.movement, inventory: await this.getBySkuId(skuId) };
  }

  async listMovements(
    skuId: number,
    query: ListMovementsQueryDto,
  ): Promise<Paginated<StockMovement>> {
    await this.getBySkuId(skuId);
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.inventory.listMovements(
      skuId,
      query.type,
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    return buildPage(items, total, query);
  }

  private assertReasonMatchesDirection(dto: AdjustStockDto): void {
    const negativeOnly = [AdjustmentReason.DAMAGED, AdjustmentReason.LOST];
    if (negativeOnly.includes(dto.reason) && dto.quantityDelta > 0) {
      throw new UnprocessableException(
        'ADJUSTMENT_REASON_MISMATCH',
        `Reason ${dto.reason} removes stock and needs a negative quantityDelta`,
      );
    }
    if (dto.reason === AdjustmentReason.FOUND && dto.quantityDelta < 0) {
      throw new UnprocessableException(
        'ADJUSTMENT_REASON_MISMATCH',
        'Reason FOUND adds stock and needs a positive quantityDelta',
      );
    }
  }
}
