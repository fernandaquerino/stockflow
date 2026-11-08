import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_INT } from '../../common/constants/limits';
import { ToBoolean, Trim } from '../../common/decorators/transforms';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const SKU_SORT_FIELDS = ['code', 'priceCents', 'createdAt', 'id'] as const;
export type SkuSortField = (typeof SKU_SORT_FIELDS)[number];

export class ListSkusQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SKU_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SKU_SORT_FIELDS)
  sortBy: SkuSortField = 'createdAt';

  @ApiPropertyOptional({ description: 'Case-insensitive match on the SKU code' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  productId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}
