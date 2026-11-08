import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResourceNotFoundException } from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { toAvailability } from '../inventory/availability';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDetail, ProductListItem, ProductsRepository } from './products.repository';

export function toProductView(product: ProductDetail) {
  const { skus, ...rest } = product;
  return {
    ...rest,
    skus: skus.map(({ inventory, ...sku }) => ({ ...sku, inventory: toAvailability(inventory) })),
  };
}

export function toProductListItem(product: ProductListItem) {
  const { _count, ...rest } = product;
  return { ...rest, skuCount: _count.skus };
}

@Injectable()
export class ProductsService {
  constructor(private readonly products: ProductsRepository) {}

  async create(dto: CreateProductDto) {
    const product = await this.products.create({
      name: dto.name,
      description: dto.description ?? null,
      category: dto.category ?? null,
    });
    return this.getById(product.id);
  }

  async getById(id: number) {
    const product = await this.products.findDetailById(id);
    if (!product) throw new ResourceNotFoundException('Product', id);
    return toProductView(product);
  }

  async update(id: number, dto: UpdateProductDto) {
    if (!(await this.products.findById(id))) throw new ResourceNotFoundException('Product', id);
    await this.products.update(id, {
      name: dto.name,
      description: dto.description,
      category: dto.category,
      active: dto.active,
    });
    return this.getById(id);
  }

  async list(query: ListProductsQueryDto) {
    const and: Prisma.ProductWhereInput[] = [];
    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q } },
          { skus: { some: { code: { contains: query.q.toUpperCase() } } } },
        ],
      });
    }
    if (query.category !== undefined) and.push({ category: query.category });
    if (query.active !== undefined) and.push({ active: query.active });

    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.products.list(
      { AND: and },
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    const page: Paginated<ReturnType<typeof toProductListItem>> = buildPage(
      items.map(toProductListItem),
      total,
      query,
    );
    return page;
  }
}
