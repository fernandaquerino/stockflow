import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IdParamPipe } from '../common/pipes/id-param.pipe';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a customer' })
  @ApiCreatedResponse({ description: 'The created customer' })
  @ApiConflictResponse({ description: 'E-mail already registered (CUSTOMER_EMAIL_TAKEN)' })
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List customers (paginated, sortable, searchable)' })
  @ApiOkResponse({ description: 'A page of customers: { data, meta }' })
  list(@Query() query: ListCustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by id' })
  @ApiOkResponse({ description: 'The customer' })
  @ApiNotFoundResponse({ description: 'CUSTOMER_NOT_FOUND' })
  getById(@Param('id', IdParamPipe) id: number) {
    return this.customers.getById(id);
  }
}
