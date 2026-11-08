import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export class CancelOrderDto {
  @ApiPropertyOptional({ example: 'Customer changed their mind', maxLength: 500 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}
