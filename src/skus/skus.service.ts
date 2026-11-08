import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  ResourceNotFoundException,
  UnprocessableException,
} from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { toAvailability } from '../inventory/availability';
import { ProductsRepository } from '../products/products.repository';
import { CreateSkuDto } from './dto/create-sku.dto';
import { ListSkusQueryDto } from './dto/list-skus-query.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { SkuRecord, SkusRepository } from './skus.repository';

export function toSkuView<T extends SkuRecord>(sku: T) {
  const { inventory, ...rest } = sku;
  return { ...rest, inventory: toAvailability(inventory) };
}

@Injectable()
export class SkusService {
  constructor(
    private readonly skus: SkusRepository,
    private readonly products: ProductsRepository,
  ) {}

  async create(productId: number, dto: CreateSkuDto) {
    const product = await this.products.findById(productId);
    if (!product) throw new ResourceNotFoundException('Product', productId);
    if (!product.active) {
      throw new UnprocessableException(
        'PRODUCT_INACTIVE',
        `Product ${productId} is inactive; reactivate it before adding SKUs`,
      );
    }
    if (await this.skus.findByCode(dto.code)) {
      throw new ConflictException('SKU_CODE_TAKEN', `SKU code ${dto.code} is already in use`);
    }
    const sku = await this.skus.createWithInventory({
      productId,
      code: dto.code,
      variantName: dto.variantName ?? null,
      priceCents: dto.priceCents,
    });
    return toSkuView(sku);
  }

  async getById(id: number) {
    const sku = await this.skus.findById(id);
    if (!sku) throw new ResourceNotFoundException('SKU', id);
    return toSkuView(sku);
  }

  async update(id: number, dto: UpdateSkuDto) {
    if (!(await this.skus.findById(id))) throw new ResourceNotFoundException('SKU', id);
    const updated = await this.skus.update(id, {
      variantName: dto.variantName,
      priceCents: dto.priceCents,
      active: dto.active,
    });
    return toSkuView(updated);
  }

  async list(query: ListSkusQueryDto, forcedProductId?: number) {
    const productId = forcedProductId ?? query.productId;
    if (forcedProductId !== undefined && !(await this.products.findById(forcedProductId))) {
      throw new ResourceNotFoundException('Product', forcedProductId);
    }
    const where: Prisma.SkuWhereInput = {
      ...(productId !== undefined ? { productId } : {}),
      ...(query.code ? { code: { contains: query.code.toUpperCase() } } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.skus.list(
      where,
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    const page: Paginated<ReturnType<typeof toSkuView>> = buildPage(
      items.map(toSkuView),
      total,
      query,
    );
    return page;
  }
}
