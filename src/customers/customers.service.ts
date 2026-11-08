import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { ConflictException, ResourceNotFoundException } from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { CustomersRepository } from './customers.repository';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    if (await this.customers.findByEmail(dto.email)) {
      throw new ConflictException(
        'CUSTOMER_EMAIL_TAKEN',
        `A customer with e-mail ${dto.email} already exists`,
      );
    }
    return this.customers.create({ name: dto.name, email: dto.email, phone: dto.phone ?? null });
  }

  async getById(id: number): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer) throw new ResourceNotFoundException('Customer', id);
    return customer;
  }

  async list(query: ListCustomersQueryDto): Promise<Paginated<Customer>> {
    const where: Prisma.CustomerWhereInput = query.search
      ? { OR: [{ name: { contains: query.search } }, { email: { contains: query.search } }] }
      : {};
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.customers.list(
      where,
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    return buildPage(items, total, query);
  }
}
