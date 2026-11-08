import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import { CreateSkuDto } from './dto/create-sku.dto';
import { ListSkusQueryDto } from './dto/list-skus-query.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { SkusService } from './skus.service';

@ApiTags('SKUs')
@Controller()
export class SkusController {
  constructor(private readonly skus: SkusService) {}

  @Post('products/:productId/skus')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a SKU to a product (creates an empty inventory record)' })
  @ApiCreatedResponse({ description: 'The created SKU with zero stock' })
  @ApiNotFoundResponse({ description: 'PRODUCT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'SKU code already used (SKU_CODE_TAKEN)' })
  @ApiUnprocessableEntityResponse({ description: 'Product is inactive (PRODUCT_INACTIVE)' })
  create(@Param('productId', IdParamPipe) productId: number, @Body() dto: CreateSkuDto) {
    return this.skus.create(productId, dto);
  }

  @Get('products/:productId/skus')
  @ApiOperation({ summary: 'List the SKUs of one product' })
  @ApiOkResponse({ description: 'A page of SKUs with stock availability: { data, meta }' })
  @ApiNotFoundResponse({ description: 'PRODUCT_NOT_FOUND' })
  listForProduct(
    @Param('productId', IdParamPipe) productId: number,
    @Query() query: ListSkusQueryDto,
  ) {
    return this.skus.list(query, productId);
  }

  @Get('skus')
  @ApiOperation({ summary: 'List SKUs across all products (filter by code, productId, active)' })
  @ApiOkResponse({ description: 'A page of SKUs with stock availability: { data, meta }' })
  list(@Query() query: ListSkusQueryDto) {
    return this.skus.list(query);
  }

  @Get('skus/:id')
  @ApiOperation({ summary: 'Get a SKU with its stock availability' })
  @ApiOkResponse({ description: 'The SKU' })
  @ApiNotFoundResponse({ description: 'SKU_NOT_FOUND' })
  getById(@Param('id', IdParamPipe) id: number) {
    return this.skus.getById(id);
  }

  @Patch('skus/:id')
  @ApiOperation({
    summary: 'Update price, variant name or active flag (the code is immutable)',
  })
  @ApiOkResponse({ description: 'The updated SKU' })
  @ApiNotFoundResponse({ description: 'SKU_NOT_FOUND' })
  update(@Param('id', IdParamPipe) id: number, @Body() dto: UpdateSkuDto) {
    return this.skus.update(id, dto);
  }
}
