import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, description: 'null clears the value' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 80, nullable: true, description: 'null clears the value' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category?: string | null;

  @ApiPropertyOptional({
    description: 'Inactive products cannot be ordered and cannot receive new SKUs',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  active?: boolean;
}
