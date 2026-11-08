import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for errors raised by business rules. Carries a stable machine-readable `code`
 * (for API clients and tests) next to the human-readable message.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ statusCode: status, code, message, details }, status);
  }
}

/** 404 - the addressed resource does not exist. */
export class ResourceNotFoundException extends AppException {
  constructor(resource: string, id: number | string) {
    super(
      HttpStatus.NOT_FOUND,
      `${resource.toUpperCase()}_NOT_FOUND`,
      `${resource} with id ${id} was not found`,
    );
  }
}

/** 409 - the request is valid but conflicts with the current state of the resource. */
export class ConflictException extends AppException {
  constructor(code: string, message: string, details?: unknown) {
    super(HttpStatus.CONFLICT, code, message, details);
  }
}

/** 422 - the request is well formed but refers to something that is not eligible. */
export class UnprocessableException extends AppException {
  constructor(code: string, message: string, details?: unknown) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
}

/** 400 - semantic validation that cannot be expressed with class-validator decorators. */
export class InvalidRequestException extends AppException {
  constructor(message: string, details?: unknown) {
    super(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, details);
  }
}
