import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StockLevels } from '../inventory/availability';
import { InventoryRepository } from '../inventory/inventory.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PricedLine } from './order-calculator';

const PERSON = { select: { id: true, name: true, email: true } } as const;

const LIST_INCLUDE = {
  customer: PERSON,
  _count: { select: { items: true } },
} satisfies Prisma.OrderInclude;

const DETAIL_INCLUDE = {
  customer: PERSON,
  items: {
    orderBy: [{ id: 'asc' }],
    include: {
      sku: {
        select: {
          id: true,
          code: true,
          variantName: true,
          active: true,
          product: { select: { id: true, name: true } },
        },
      },
      reservation: true,
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderListItem = Prisma.OrderGetPayload<{ include: typeof LIST_INCLUDE }>;
export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export interface PlannedOrder {
  customerId: number;
  notes: string | null;
  totalCents: number;
  lines: PricedLine[];
}

export interface Shortage {
  skuCode: string;
  requested: number;
  available: number;
}

export type PlaceOrderResult =
  { placed: true; orderId: number } | { placed: false; shortages: Shortage[] };

export type CancelOrderResult = 'cancelled' | 'not_found' | 'already_cancelled';

/** Thrown inside the transaction to roll everything back when a line cannot be reserved. */
class InsufficientStockSignal extends Error {
  constructor(readonly skuId: number) {
    super(`Insufficient stock for SKU ${skuId}`);
  }
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

@Injectable()
export class OrdersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryRepository,
  ) {}

  /**
   * Places an order and reserves its stock in ONE transaction:
   *   1. for every line (in ascending SKU id order) run the atomic conditional reserve;
   *      the first line that cannot be satisfied aborts and rolls back everything,
   *   2. insert order, items and ACTIVE reservations,
   *   3. write one RESERVATION movement per line.
   * Either all lines are reserved or nothing changes - there is no partial reservation.
   */
  async placeOrder(plan: PlannedOrder): Promise<PlaceOrderResult> {
    try {
      const orderId = await this.prisma.$transaction(async (tx) => {
        const lines = [...plan.lines].sort((a, b) => a.skuId - b.skuId);
        const levelsAfter = new Map<number, StockLevels>();

        // First statement of the transaction is a write: SQLite takes the write lock up front
        // instead of upgrading a read lock later (which could fail with SQLITE_BUSY).
        for (const line of lines) {
          const levels = await this.inventory.reserve(tx, line.skuId, line.quantity);
          if (!levels) throw new InsufficientStockSignal(line.skuId);
          levelsAfter.set(line.skuId, levels);
        }

        const order = await tx.order.create({
          data: {
            customerId: plan.customerId,
            notes: plan.notes,
            totalCents: plan.totalCents,
            items: {
              create: plan.lines.map((line) => ({
                skuId: line.skuId,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                lineTotalCents: line.lineTotalCents,
                reservation: { create: { skuId: line.skuId, quantity: line.quantity } },
              })),
            },
          },
        });

        for (const line of lines) {
          await this.inventory.recordMovement(tx, {
            skuId: line.skuId,
            type: 'RESERVATION',
            onHandDelta: 0,
            reservedDelta: line.quantity,
            levels: levelsAfter.get(line.skuId) as StockLevels,
            orderId: order.id,
          });
        }
        return order.id;
      }, TX_OPTIONS);
      return { placed: true, orderId };
    } catch (error) {
      if (error instanceof InsufficientStockSignal) {
        return { placed: false, shortages: await this.findShortages(plan.lines, error.skuId) };
      }
      throw error;
    }
  }

  /**
   * Cancels a RESERVED order and releases every ACTIVE reservation in ONE transaction.
   * The status flip RESERVED -> CANCELLED is a guarded update, so a double cancel (even two
   * concurrent requests) releases stock exactly once.
   */
  async cancelOrder(orderId: number, reason: string | null): Promise<CancelOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'RESERVED' },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: now },
      });
      if (count === 0) {
        const exists = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
        return exists ? 'already_cancelled' : 'not_found';
      }

      const reservations = await tx.stockReservation.findMany({
        where: { orderItem: { orderId }, status: 'ACTIVE' },
        orderBy: { skuId: 'asc' },
      });
      for (const reservation of reservations) {
        const levels = await this.inventory.release(tx, reservation.skuId, reservation.quantity);
        if (!levels) {
          // Would mean reserved < an active reservation: the stock invariant is already broken.
          // Throwing rolls the cancellation back instead of hiding the corruption.
          throw new Error(
            `Invariant violated: cannot release ${reservation.quantity} units of SKU ${reservation.skuId} for order ${orderId}`,
          );
        }
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'RELEASED', releasedAt: now },
        });
        await this.inventory.recordMovement(tx, {
          skuId: reservation.skuId,
          type: 'RELEASE',
          onHandDelta: 0,
          reservedDelta: -reservation.quantity,
          levels,
          orderId,
          reason: reason ?? 'ORDER_CANCELLED',
        });
      }
      return 'cancelled';
    }, TX_OPTIONS);
  }

  findDetailById(id: number): Promise<OrderDetail | null> {
    return this.prisma.order.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  async list(
    where: Prisma.OrderWhereInput,
    orderBy: Prisma.OrderOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[OrderListItem[], number]> {
    return this.prisma.$transaction([
      this.prisma.order.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
      this.prisma.order.count({ where }),
    ]);
  }

  private async findShortages(lines: PricedLine[], failedSkuId: number): Promise<Shortage[]> {
    const levels = await this.inventory.findManyBySkuIds(lines.map((line) => line.skuId));
    const bySku = new Map(levels.map((level) => [level.skuId, level]));
    return lines
      .map((line) => {
        const level = bySku.get(line.skuId);
        const available = level ? Math.max(level.quantityOnHand - level.quantityReserved, 0) : 0;
        return { skuId: line.skuId, skuCode: line.skuCode, requested: line.quantity, available };
      })
      .filter((line) => line.available < line.requested || line.skuId === failedSkuId)
      .map(({ skuCode, requested, available }) => ({ skuCode, requested, available }));
  }
}
