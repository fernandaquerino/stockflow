import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_UNIT_PRICE_CENTS } from '../../common/constants/limits';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export const SKU_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

/** Trims and upper-cases SKU codes so lookups are case-insensitive. */
export const NormalizeSkuCode = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

export class CreateSkuDto {
  @ApiProperty({
    example: 'DRIP-CER-WHT',
    description: '2-40 chars: A-Z, 0-9, "-" and "_". Stored upper-case, unique, immutable.',
  })
  @NormalizeSkuCode()
  @IsString()
  @Matches(SKU_CODE_PATTERN, {
    message:
      'code must be 2-40 characters of A-Z, 0-9, "-" or "_" and start with a letter or digit',
  })
  code!: string;

  @ApiPropertyOptional({ example: 'White', maxLength: 80 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  variantName?: string;

  @ApiProperty({
    example: 2495,
    description: 'Unit price in integer cents (2495 = 24.95)',
    minimum: 0,
    maximum: MAX_UNIT_PRICE_CENTS,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_PRICE_CENTS)
  priceCents!: number;
}
