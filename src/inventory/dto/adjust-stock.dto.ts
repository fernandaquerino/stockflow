import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { MAX_MOVEMENT_QUANTITY } from '../../common/constants/limits';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export enum AdjustmentReason {
  COUNT_CORRECTION = 'COUNT_CORRECTION',
  DAMAGED = 'DAMAGED',
  LOST = 'LOST',
  FOUND = 'FOUND',
  OTHER = 'OTHER',
}

export class AdjustStockDto {
  @ApiProperty({
    example: -3,
    description: 'Signed change of the on-hand quantity; must not be 0',
    minimum: -MAX_MOVEMENT_QUANTITY,
    maximum: MAX_MOVEMENT_QUANTITY,
  })
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_MOVEMENT_QUANTITY)
  @Max(MAX_MOVEMENT_QUANTITY)
  quantityDelta!: number;

  @ApiProperty({
    enum: AdjustmentReason,
    description:
      'DAMAGED and LOST need a negative delta, FOUND a positive one. OTHER requires a note.',
  })
  @IsEnum(AdjustmentReason)
  reason!: AdjustmentReason;

  @ApiPropertyOptional({ maxLength: 500, description: 'Required when reason is OTHER' })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}
