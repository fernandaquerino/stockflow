import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IdParamPipe } from '../common/pipes/id-param.pipe';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a product (add SKUs afterwards with POST /products/:id/skus)' })
  @ApiCreatedResponse({ description: 'The created product (with an empty SKU list)' })
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List products',
    description: 'Filter by q (name or SKU code), category and active; paginated and sortable.',
  })
  @ApiOkResponse({ description: 'A page of products with skuCount: { data, meta }' })
  list(@Query() query: ListProductsQueryDto) {
    return this.products.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product with its SKUs and their stock availability' })
  @ApiOkResponse({ description: 'The product and its SKUs' })
  @ApiNotFoundResponse({ description: 'PRODUCT_NOT_FOUND' })
  getById(@Param('id', IdParamPipe) id: number) {
    return this.products.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update product details or (de)activate it' })
  @ApiOkResponse({ description: 'The updated product' })
  @ApiNotFoundResponse({ description: 'PRODUCT_NOT_FOUND' })
  update(@Param('id', IdParamPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }
}
