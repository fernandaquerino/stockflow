import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_ORDER_LINE_QUANTITY } from '../../common/constants/limits';
import { IdField } from '../../common/decorators/id-field.decorator';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';
import { NormalizeSkuCode, SKU_CODE_PATTERN } from '../../skus/dto/create-sku.dto';

export class CreateOrderItemDto {
  @ApiProperty({ example: 'DRIP-CER-WHT', description: 'SKU code (case-insensitive)' })
  @NormalizeSkuCode()
  @IsString()
  @Matches(SKU_CODE_PATTERN, { message: 'skuCode is not a valid SKU code' })
  skuCode!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: MAX_ORDER_LINE_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_LINE_QUANTITY)
  quantity!: number;
}

export class CreateOrderDto {
  @IdField({ description: 'The customer placing the order' })
  customerId!: number;

  @ApiProperty({
    type: [CreateOrderItemDto],
    description: '1-50 lines; each SKU may appear only once',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  notes?: string;
}
