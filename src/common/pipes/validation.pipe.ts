import { ValidationError, ValidationPipe } from '@nestjs/common';
import { InvalidRequestException } from '../exceptions/app.exceptions';

export interface FieldError {
  field: string;
  messages: string[];
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent
      ? /^\d+$/.test(error.property)
        ? `${parent}[${error.property}]`
        : `${parent}.${error.property}`
      : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/** Global validation: strips nothing silently - unknown properties are rejected. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new InvalidRequestException('Validation failed', flattenValidationErrors(errors)),
  });
}
