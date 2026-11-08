import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { NormalizeEmail, Trim } from '../../common/decorators/transforms';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Harbor Street Coffee', maxLength: 120 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'purchasing@harborstreet.example', description: 'Stored lower-case' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: '+1-555-0142', maxLength: 40 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone?: string;
}
