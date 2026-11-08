import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { MAX_INT } from '../../common/constants/limits';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const ORDER_SORT_FIELDS = ['createdAt', 'totalCents', 'id'] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ORDER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ORDER_SORT_FIELDS)
  sortBy: OrderSortField = 'createdAt';

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  customerId?: number;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00Z',
    description: 'Created at or after (inclusive)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdFrom?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59Z',
    description: 'Created at or before (inclusive)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdTo?: string;
}
