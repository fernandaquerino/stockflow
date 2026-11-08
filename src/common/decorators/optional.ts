import { ValidateIf } from 'class-validator';

/**
 * Marks a body property as optional (may be omitted) but, unlike `@IsOptional()`, rejects an
 * explicit `null`. `@IsOptional()` skips all validators for null, which would let `null` reach
 * Prisma for non-nullable columns and surface as a 500. Use `@IsOptional()` only for properties
 * where null is a meaningful value (e.g. "clear this field").
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
