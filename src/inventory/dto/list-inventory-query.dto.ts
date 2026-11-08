import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_INT } from '../../common/constants/limits';
import { ToBoolean, Trim } from '../../common/decorators/transforms';
import { PaginationQueryDto, SortOrder } from '../../common/pagination/pagination.dto';

export const INVENTORY_SORT_FIELDS = ['skuCode', 'quantityOnHand', 'skuId'] as const;
export type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];

export class ListInventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVENTORY_SORT_FIELDS, default: 'skuCode' })
  @IsOptional()
  @IsIn(INVENTORY_SORT_FIELDS)
  sortBy: InventorySortField = 'skuCode';

  // Inventory reads best alphabetically by default.
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder: SortOrder = 'asc';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  productId?: number;

  @ApiPropertyOptional({ description: 'Case-insensitive match on the SKU code' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  skuCode?: string;

  @ApiPropertyOptional({
    description: 'true: only SKUs with available stock; false: only sold-out SKUs',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  inStock?: boolean;
}
