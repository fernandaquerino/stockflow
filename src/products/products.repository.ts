import { Injectable } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DETAIL_INCLUDE = {
  skus: { orderBy: [{ code: 'asc' }], include: { inventory: true } },
} satisfies Prisma.ProductInclude;
const LIST_INCLUDE = { _count: { select: { skus: true } } } satisfies Prisma.ProductInclude;

export type ProductDetail = Prisma.ProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;
export type ProductListItem = Prisma.ProductGetPayload<{ include: typeof LIST_INCLUDE }>;

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductCreateInput): Promise<Product> {
    return this.prisma.product.create({ data });
  }

  findById(id: number): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findDetailById(id: number): Promise<ProductDetail | null> {
    return this.prisma.product.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  update(id: number, data: Prisma.ProductUpdateInput): Promise<Product> {
    return this.prisma.product.update({ where: { id }, data });
  }

  async list(
    where: Prisma.ProductWhereInput,
    orderBy: Prisma.ProductOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[ProductListItem[], number]> {
    return this.prisma.$transaction([
      this.prisma.product.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
      this.prisma.product.count({ where }),
    ]);
  }
}
