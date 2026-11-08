import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exceptions';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Single place that turns every thrown error into the API error contract:
 * `{ statusCode, error, code, message, details?, path, timestamp }`.
 * Unexpected errors are logged and never leak internals to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const normalized = this.normalize(exception);
    if (normalized.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${normalized.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode: normalized.status,
      error: HttpStatus[normalized.status]
        ? toTitle(HttpStatus[normalized.status] as string)
        : 'Error',
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : Array.isArray((payload as { message?: unknown }).message)
            ? (payload as { message: string[] }).message.join('; ')
            : ((payload as { message?: string }).message ?? exception.message);
      return { status, code: defaultCode(status), message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            code: 'UNIQUE_CONSTRAINT_VIOLATION',
            message: 'A record with the same unique value already exists',
            details: { target: exception.meta?.target },
          };
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            code: 'RECORD_NOT_FOUND',
            message: 'The requested record was not found',
          };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'The operation violates a relationship with another record',
          };
        default:
          break;
      }
    }

    // Errors raised by Express middleware (e.g. malformed JSON, payload too large).
    const status = (exception as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        status,
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        message: status === 413 ? 'Request body is too large' : 'Malformed request body',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}

function toTitle(enumName: string): string {
  return enumName
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    default:
      return (HttpStatus[status] as string | undefined) ?? 'ERROR';
  }
}
