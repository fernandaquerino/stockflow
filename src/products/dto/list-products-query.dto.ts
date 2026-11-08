import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ToBoolean, Trim } from '../../common/decorators/transforms';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const PRODUCT_SORT_FIELDS = ['createdAt', 'name', 'id'] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(PRODUCT_SORT_FIELDS)
  sortBy: ProductSortField = 'createdAt';

  @ApiPropertyOptional({ description: 'Case-insensitive match on product name or SKU code' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Exact category' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}
