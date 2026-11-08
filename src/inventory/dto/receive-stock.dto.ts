import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_MOVEMENT_QUANTITY } from '../../common/constants/limits';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export class ReceiveStockDto {
  @ApiProperty({ example: 120, minimum: 1, maximum: MAX_MOVEMENT_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_MOVEMENT_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({
    example: 'PO-2026-0412',
    description: 'Purchase order / delivery note',
    maxLength: 80,
  })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}
