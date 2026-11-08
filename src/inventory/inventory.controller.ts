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
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Current stock per SKU',
    description:
      'quantityAvailable = quantityOnHand - quantityReserved. Filter by productId, skuCode, inStock.',
  })
  @ApiOkResponse({ description: 'A page of inventory levels: { data, meta }' })
  list(@Query() query: ListInventoryQueryDto) {
    return this.inventory.list(query);
  }

  @Get(':skuId')
  @ApiOperation({ summary: 'Current on-hand, reserved and available quantity of one SKU' })
  @ApiOkResponse({ description: 'The inventory level' })
  @ApiNotFoundResponse({ description: 'SKU_NOT_FOUND' })
  get(@Param('skuId', IdParamPipe) skuId: number) {
    return this.inventory.getBySkuId(skuId);
  }

  @Post(':skuId/receive')
  @HttpCode(201)
  @ApiOperation({ summary: 'Receive stock (increases on-hand, writes a RECEIPT movement)' })
  @ApiCreatedResponse({ description: 'The movement and the updated inventory level' })
  @ApiNotFoundResponse({ description: 'SKU_NOT_FOUND' })
  @ApiConflictResponse({ description: 'STOCK_LIMIT_EXCEEDED' })
  receive(@Param('skuId', IdParamPipe) skuId: number, @Body() dto: ReceiveStockDto) {
    return this.inventory.receive(skuId, dto);
  }

  @Post(':skuId/adjust')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Adjust on-hand stock with a mandatory reason (writes an ADJUSTMENT movement)',
    description: 'Cannot reduce on-hand below the quantity reserved by open orders.',
  })
  @ApiCreatedResponse({ description: 'The movement and the updated inventory level' })
  @ApiNotFoundResponse({ description: 'SKU_NOT_FOUND' })
  @ApiConflictResponse({ description: 'INSUFFICIENT_AVAILABLE_STOCK or STOCK_LIMIT_EXCEEDED' })
  @ApiUnprocessableEntityResponse({ description: 'ADJUSTMENT_REASON_MISMATCH' })
  adjust(@Param('skuId', IdParamPipe) skuId: number, @Body() dto: AdjustStockDto) {
    return this.inventory.adjust(skuId, dto);
  }

  @Get(':skuId/movements')
  @ApiOperation({ summary: 'Stock movement history of a SKU (newest first by default)' })
  @ApiOkResponse({ description: 'A page of movements: { data, meta }' })
  @ApiNotFoundResponse({ description: 'SKU_NOT_FOUND' })
  movements(@Param('skuId', IdParamPipe) skuId: number, @Query() query: ListMovementsQueryDto) {
    return this.inventory.listMovements(skuId, query);
  }
}
