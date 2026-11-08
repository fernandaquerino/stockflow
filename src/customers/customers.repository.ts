import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.CustomerCreateInput): Promise<Customer> {
    return this.prisma.customer.create({ data });
  }

  findById(id: number): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { email } });
  }

  async list(
    where: Prisma.CustomerWhereInput,
    orderBy: Prisma.CustomerOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[Customer[], number]> {
    return this.prisma.$transaction([
      this.prisma.customer.findMany({ where, orderBy, skip, take }),
      this.prisma.customer.count({ where }),
    ]);
  }
}
