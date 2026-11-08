import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SKU_INCLUDE = { inventory: true } satisfies Prisma.SkuInclude;
const SKU_WITH_PRODUCT_INCLUDE = {
  inventory: true,
  product: { select: { id: true, name: true, active: true } },
} satisfies Prisma.SkuInclude;

export type SkuRecord = Prisma.SkuGetPayload<{ include: typeof SKU_INCLUDE }>;
export type SkuWithProduct = Prisma.SkuGetPayload<{ include: typeof SKU_WITH_PRODUCT_INCLUDE }>;

@Injectable()
export class SkusRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the SKU and its (empty) inventory row atomically. */
  createWithInventory(data: {
    productId: number;
    code: string;
    variantName: string | null;
    priceCents: number;
  }): Promise<SkuRecord> {
    return this.prisma.sku.create({
      data: { ...data, inventory: { create: {} } },
      include: SKU_INCLUDE,
    });
  }

  findById(id: number): Promise<SkuWithProduct | null> {
    return this.prisma.sku.findUnique({ where: { id }, include: SKU_WITH_PRODUCT_INCLUDE });
  }

  findByCode(code: string): Promise<SkuRecord | null> {
    return this.prisma.sku.findUnique({ where: { code }, include: SKU_INCLUDE });
  }

  findManyByCodes(codes: string[]): Promise<SkuWithProduct[]> {
    return this.prisma.sku.findMany({
      where: { code: { in: codes } },
      include: SKU_WITH_PRODUCT_INCLUDE,
    });
  }

  update(id: number, data: Prisma.SkuUpdateInput): Promise<SkuRecord> {
    return this.prisma.sku.update({ where: { id }, data, include: SKU_INCLUDE });
  }

  async list(
    where: Prisma.SkuWhereInput,
    orderBy: Prisma.SkuOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[SkuRecord[], number]> {
    return this.prisma.$transaction([
      this.prisma.sku.findMany({ where, orderBy, skip, take, include: SKU_INCLUDE }),
      this.prisma.sku.count({ where }),
    ]);
  }
}
