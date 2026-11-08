import { Injectable } from '@nestjs/common';
import { Prisma, StockMovement, StockMovementType } from '@prisma/client';
import { MAX_STOCK } from '../common/constants/limits';
import { PrismaService } from '../prisma/prisma.service';
import { StockLevels } from './availability';

const WITH_SKU = {
  sku: {
    select: { id: true, code: true, active: true, product: { select: { id: true, name: true } } },
  },
} satisfies Prisma.InventoryItemInclude;

export type InventoryRecord = Prisma.InventoryItemGetPayload<{ include: typeof WITH_SKU }>;

type Tx = Prisma.TransactionClient;
type LevelRow = { quantityOnHand: number | bigint; quantityReserved: number | bigint };

export interface MovementInput {
  skuId: number;
  type: StockMovementType;
  onHandDelta: number;
  reservedDelta: number;
  levels: StockLevels;
  reason?: string | null;
  note?: string | null;
  reference?: string | null;
  orderId?: number | null;
}

/**
 * The only place that changes `InventoryItem`.
 *
 * Consistency strategy: every stock change is ONE conditional `UPDATE ... WHERE <invariant holds>
 * RETURNING ...` statement. The database evaluates the invariant and applies the change atomically,
 * so two concurrent requests can never both consume the same units (no read-then-write race).
 * `null` means "the invariant would have been violated, nothing was changed". Each change must be
 * followed by `recordMovement` inside the same transaction so the ledger always matches the totals.
 * The migration additionally installs CHECK constraints as a last line of defence.
 */
@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- atomic primitives (call inside a transaction) -------------------------------------

  /** onHand += qty, unless the per-SKU cap would be exceeded. */
  increaseOnHand(tx: Tx, skuId: number, quantity: number): Promise<StockLevels | null> {
    return this.first(
      tx.$queryRaw<LevelRow[]>`
        UPDATE "InventoryItem"
        SET "quantityOnHand" = "quantityOnHand" + ${quantity}
        WHERE "skuId" = ${skuId} AND "quantityOnHand" + ${quantity} <= ${MAX_STOCK}
        RETURNING "quantityOnHand", "quantityReserved"`,
    );
  }

  /** onHand += delta (may be negative), unless it would drop below reserved or exceed the cap. */
  adjustOnHand(tx: Tx, skuId: number, delta: number): Promise<StockLevels | null> {
    return this.first(
      tx.$queryRaw<LevelRow[]>`
        UPDATE "InventoryItem"
        SET "quantityOnHand" = "quantityOnHand" + ${delta}
        WHERE "skuId" = ${skuId}
          AND "quantityOnHand" + ${delta} >= "quantityReserved"
          AND "quantityOnHand" + ${delta} <= ${MAX_STOCK}
        RETURNING "quantityOnHand", "quantityReserved"`,
    );
  }

  /** reserved += qty, only if enough *available* stock (onHand - reserved) exists. */
  reserve(tx: Tx, skuId: number, quantity: number): Promise<StockLevels | null> {
    return this.first(
      tx.$queryRaw<LevelRow[]>`
        UPDATE "InventoryItem"
        SET "quantityReserved" = "quantityReserved" + ${quantity}
        WHERE "skuId" = ${skuId} AND "quantityOnHand" - "quantityReserved" >= ${quantity}
        RETURNING "quantityOnHand", "quantityReserved"`,
    );
  }

  /** reserved -= qty, only if that much is actually reserved. */
  release(tx: Tx, skuId: number, quantity: number): Promise<StockLevels | null> {
    return this.first(
      tx.$queryRaw<LevelRow[]>`
        UPDATE "InventoryItem"
        SET "quantityReserved" = "quantityReserved" - ${quantity}
        WHERE "skuId" = ${skuId} AND "quantityReserved" >= ${quantity}
        RETURNING "quantityOnHand", "quantityReserved"`,
    );
  }

  recordMovement(tx: Tx, input: MovementInput): Promise<StockMovement> {
    return tx.stockMovement.create({
      data: {
        skuId: input.skuId,
        type: input.type,
        onHandDelta: input.onHandDelta,
        reservedDelta: input.reservedDelta,
        onHandAfter: input.levels.quantityOnHand,
        reservedAfter: input.levels.quantityReserved,
        reason: input.reason ?? null,
        note: input.note ?? null,
        reference: input.reference ?? null,
        orderId: input.orderId ?? null,
      },
    });
  }

  // ---- complete operations ---------------------------------------------------------------

  async receive(
    skuId: number,
    quantity: number,
    meta: { reference?: string; note?: string },
  ): Promise<{ movement: StockMovement; levels: StockLevels } | null> {
    return this.prisma.$transaction(async (tx) => {
      const levels = await this.increaseOnHand(tx, skuId, quantity);
      if (!levels) return null;
      const movement = await this.recordMovement(tx, {
        skuId,
        type: 'RECEIPT',
        onHandDelta: quantity,
        reservedDelta: 0,
        levels,
        reference: meta.reference,
        note: meta.note,
      });
      return { movement, levels };
    });
  }

  async adjust(
    skuId: number,
    delta: number,
    meta: { reason: string; note?: string },
  ): Promise<{ movement: StockMovement; levels: StockLevels } | null> {
    return this.prisma.$transaction(async (tx) => {
      const levels = await this.adjustOnHand(tx, skuId, delta);
      if (!levels) return null;
      const movement = await this.recordMovement(tx, {
        skuId,
        type: 'ADJUSTMENT',
        onHandDelta: delta,
        reservedDelta: 0,
        levels,
        reason: meta.reason,
        note: meta.note,
      });
      return { movement, levels };
    });
  }

  // ---- reads -----------------------------------------------------------------------------

  findBySkuId(skuId: number): Promise<InventoryRecord | null> {
    return this.prisma.inventoryItem.findUnique({ where: { skuId }, include: WITH_SKU });
  }

  findManyBySkuIds(skuIds: number[]): Promise<Array<StockLevels & { skuId: number }>> {
    return this.prisma.inventoryItem.findMany({
      where: { skuId: { in: skuIds } },
      select: { skuId: true, quantityOnHand: true, quantityReserved: true },
    });
  }

  async list(
    filter: { productId?: number; skuCode?: string; inStock?: boolean },
    orderBy: Prisma.InventoryItemOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[InventoryRecord[], number]> {
    const fields = this.prisma.inventoryItem.fields;
    const where: Prisma.InventoryItemWhereInput = {
      ...(filter.productId !== undefined || filter.skuCode
        ? {
            sku: {
              ...(filter.productId !== undefined ? { productId: filter.productId } : {}),
              ...(filter.skuCode ? { code: { contains: filter.skuCode.toUpperCase() } } : {}),
            },
          }
        : {}),
      // available > 0  <=>  reserved < onHand (column-to-column comparison)
      ...(filter.inStock === true ? { quantityReserved: { lt: fields.quantityOnHand } } : {}),
      ...(filter.inStock === false ? { quantityReserved: { gte: fields.quantityOnHand } } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({ where, orderBy, skip, take, include: WITH_SKU }),
      this.prisma.inventoryItem.count({ where }),
    ]);
  }

  async listMovements(
    skuId: number,
    type: StockMovementType | undefined,
    orderBy: Prisma.StockMovementOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[StockMovement[], number]> {
    const where: Prisma.StockMovementWhereInput = { skuId, ...(type ? { type } : {}) };
    return this.prisma.$transaction([
      this.prisma.stockMovement.findMany({ where, orderBy, skip, take }),
      this.prisma.stockMovement.count({ where }),
    ]);
  }

  private async first(rows: Promise<LevelRow[]>): Promise<StockLevels | null> {
    const row = (await rows)[0];
    return row
      ? {
          quantityOnHand: Number(row.quantityOnHand),
          quantityReserved: Number(row.quantityReserved),
        }
      : null;
  }
}
