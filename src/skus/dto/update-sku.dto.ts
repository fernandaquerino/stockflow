import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_UNIT_PRICE_CENTS } from '../../common/constants/limits';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export class UpdateSkuDto {
  @ApiPropertyOptional({ maxLength: 80, nullable: true, description: 'null clears the value' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  variantName?: string | null;

  @ApiPropertyOptional({
    description: 'New unit price in cents. Existing orders keep the price they were placed at.',
    minimum: 0,
    maximum: MAX_UNIT_PRICE_CENTS,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_PRICE_CENTS)
  priceCents?: number;

  @ApiPropertyOptional({
    description: 'Inactive SKUs cannot be ordered; stock can still be received',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  active?: boolean;
}
