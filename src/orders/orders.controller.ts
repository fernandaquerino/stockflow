import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IdParamPipe } from '../common/pipes/id-param.pipe';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Place an order and reserve its stock',
    description:
      'All lines are reserved atomically or the order is rejected (no partial reservation). ' +
      'Prices are snapshotted from the SKUs at this moment. Amounts are integer cents.',
  })
  @ApiCreatedResponse({
    description: 'The RESERVED order with lines, reservations and availability',
  })
  @ApiNotFoundResponse({ description: 'CUSTOMER_NOT_FOUND or SKU_NOT_FOUND' })
  @ApiConflictResponse({ description: 'INSUFFICIENT_STOCK with per-SKU shortages' })
  @ApiUnprocessableEntityResponse({ description: 'SKU_NOT_ORDERABLE or ORDER_TOTAL_TOO_LARGE' })
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List orders',
    description: 'Filter by status, customerId, createdFrom, createdTo; paginated and sortable.',
  })
  @ApiOkResponse({ description: 'A page of orders: { data, meta }' })
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order details including current inventory availability per line' })
  @ApiOkResponse({ description: 'The order' })
  @ApiNotFoundResponse({ description: 'ORDER_NOT_FOUND' })
  getById(@Param('id', IdParamPipe) id: number) {
    return this.orders.getById(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an order and release its reserved stock' })
  @ApiOkResponse({ description: 'The CANCELLED order' })
  @ApiNotFoundResponse({ description: 'ORDER_NOT_FOUND' })
  @ApiConflictResponse({ description: 'ORDER_ALREADY_CANCELLED' })
  cancel(@Param('id', IdParamPipe) id: number, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(id, dto);
  }
}
