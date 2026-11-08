import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/decorators/transforms';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const CUSTOMER_SORT_FIELDS = ['createdAt', 'name', 'id'] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(CUSTOMER_SORT_FIELDS)
  sortBy: CustomerSortField = 'createdAt';

  @ApiPropertyOptional({ description: 'Case-insensitive match on name or e-mail' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  search?: string;
}
