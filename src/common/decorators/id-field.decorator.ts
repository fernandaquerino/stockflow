import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_INT } from '../constants/limits';
import { IsOptionalNotNull } from './optional';

/** Validates (and documents) a reference to another record's integer id. */
export function IdField(options: { optional?: boolean; description?: string } = {}) {
  const docs = { type: Number, minimum: 1, example: 1, description: options.description };
  return applyDecorators(
    options.optional ? ApiPropertyOptional(docs) : ApiProperty(docs),
    ...(options.optional ? [IsOptionalNotNull()] : []),
    IsInt(),
    Min(1),
    Max(MAX_INT),
  );
}
