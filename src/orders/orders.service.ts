import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ConflictException,
  InvalidRequestException,
  ResourceNotFoundException,
  UnprocessableException,
} from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { CustomersRepository } from '../customers/customers.repository';
import { toAvailability } from '../inventory/availability';
import { InventoryRepository } from '../inventory/inventory.repository';
import { SkusRepository } from '../skus/skus.repository';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import {
  exceedsMaxTotal,
  findDuplicates,
  formatOrderNumber,
  priceLine,
  sumLines,
} from './order-calculator';
import { OrderDetail, OrderListItem, OrdersRepository } from './orders.repository';

export function toOrderListItem(order: OrderListItem) {
  const { _count, ...rest } = order;
  return { ...rest, orderNumber: formatOrderNumber(order.id), itemCount: _count.items };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersRepository,
    private readonly skus: SkusRepository,
    private readonly inventory: InventoryRepository,
  ) {}

  async create(dto: CreateOrderDto) {
    const codes = dto.items.map((item) => item.skuCode);
    const duplicates = findDuplicates(codes);
    if (duplicates.length > 0) {
      throw new InvalidRequestException('Validation failed', [
        {
          field: 'items',
          messages: [
            `Each SKU may appear only once per order (repeated: ${duplicates.join(', ')})`,
          ],
        },
      ]);
    }

    const customer = await this.customers.findById(dto.customerId);
    if (!customer) throw new ResourceNotFoundException('Customer', dto.customerId);

    const found = await this.skus.findManyByCodes(codes);
    const byCode = new Map(found.map((sku) => [sku.code, sku]));
    const unknown = codes.filter((code) => !byCode.has(code));
    if (unknown.length > 0) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'SKU_NOT_FOUND',
        `Unknown SKU code(s): ${unknown.join(', ')}`,
        { skuCodes: unknown },
      );
    }
    const notOrderable = found.filter((sku) => !sku.active || !sku.product.active);
    if (notOrderable.length > 0) {
      throw new UnprocessableException(
        'SKU_NOT_ORDERABLE',
        `These SKUs are inactive (or belong to an inactive product): ${notOrderable.map((s) => s.code).join(', ')}`,
        { skuCodes: notOrderable.map((s) => s.code) },
      );
    }

    const lines = dto.items.map((item) => {
      const sku = byCode.get(item.skuCode)!;
      return priceLine({
        skuId: sku.id,
        skuCode: sku.code,
        quantity: item.quantity,
        unitPriceCents: sku.priceCents,
      });
    });
    const totalCents = sumLines(lines);
    if (exceedsMaxTotal(totalCents)) {
      throw new UnprocessableException(
        'ORDER_TOTAL_TOO_LARGE',
        'The order total exceeds the maximum supported amount; split it into several orders',
      );
    }

    const result = await this.orders.placeOrder({
      customerId: customer.id,
      notes: dto.notes ?? null,
      totalCents,
      lines,
    });
    if (!result.placed) {
      throw new ConflictException(
        'INSUFFICIENT_STOCK',
        `Not enough available stock for: ${result.shortages.map((s) => s.skuCode).join(', ')}`,
        { shortages: result.shortages },
      );
    }
    return this.getById(result.orderId);
  }

  /** Order with its lines, reservations and the *current* availability of every SKU ordered. */
  async getById(id: number) {
    const order = await this.orders.findDetailById(id);
    if (!order) throw new ResourceNotFoundException('Order', id);
    return this.toOrderView(order);
  }

  async cancel(id: number, dto: CancelOrderDto) {
    const result = await this.orders.cancelOrder(id, dto.reason ?? null);
    if (result === 'not_found') throw new ResourceNotFoundException('Order', id);
    if (result === 'already_cancelled') {
      throw new ConflictException(
        'ORDER_ALREADY_CANCELLED',
        `Order ${formatOrderNumber(id)} is already cancelled`,
      );
    }
    return this.getById(id);
  }

  async list(query: ListOrdersQueryDto): Promise<Paginated<ReturnType<typeof toOrderListItem>>> {
    if (
      query.createdFrom &&
      query.createdTo &&
      new Date(query.createdFrom) > new Date(query.createdTo)
    ) {
      throw new InvalidRequestException('Validation failed', [
        { field: 'createdFrom', messages: ['createdFrom must not be after createdTo'] },
      ]);
    }
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.orders.list(
      where,
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    return buildPage(items.map(toOrderListItem), total, query);
  }

  private async toOrderView(order: OrderDetail) {
    const levels = await this.inventory.findManyBySkuIds(order.items.map((item) => item.skuId));
    const bySku = new Map(levels.map((level) => [level.skuId, level]));
    return {
      id: order.id,
      orderNumber: formatOrderNumber(order.id),
      status: order.status,
      customer: order.customer,
      totalCents: order.totalCents,
      notes: order.notes,
      cancelReason: order.cancelReason,
      cancelledAt: order.cancelledAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items.map((item) => ({
        id: item.id,
        sku: {
          id: item.sku.id,
          code: item.sku.code,
          variantName: item.sku.variantName,
          productId: item.sku.product.id,
          productName: item.sku.product.name,
        },
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
        reservation: item.reservation && {
          status: item.reservation.status,
          quantity: item.reservation.quantity,
          releasedAt: item.reservation.releasedAt,
        },
        currentAvailability: toAvailability(bySku.get(item.skuId)),
      })),
    };
  }
}
