import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const MOVEMENT_SORT_FIELDS = ['createdAt', 'id'] as const;
export type MovementSortField = (typeof MOVEMENT_SORT_FIELDS)[number];

export class ListMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MOVEMENT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(MOVEMENT_SORT_FIELDS)
  sortBy: MovementSortField = 'createdAt';

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;
}
