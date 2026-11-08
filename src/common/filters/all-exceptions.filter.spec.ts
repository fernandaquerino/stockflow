import { ArgumentsHost, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictException, ResourceNotFoundException } from '../exceptions/app.exceptions';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/things/1' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('renders domain exceptions with their code and details', () => {
    const { status, body } = run(new ConflictException('SOME_CODE', 'nope', { a: 1 }));
    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'SOME_CODE',
      message: 'nope',
      details: { a: 1 },
      path: '/things/1',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('renders not-found exceptions', () => {
    const { status, body } = run(new ResourceNotFoundException('Ticket', 5));
    expect(status).toBe(404);
    expect(body).toMatchObject({
      code: 'TICKET_NOT_FOUND',
      message: 'Ticket with id 5 was not found',
    });
    expect(body.details).toBeUndefined();
  });

  it('maps plain Nest HTTP exceptions', () => {
    expect(run(new ForbiddenException('stop')).body).toMatchObject({
      statusCode: 403,
      message: 'stop',
    });
    expect(run(new BadRequestException(['a is bad', 'b is bad'])).body.message).toBe(
      'a is bad; b is bad',
    );
  });

  it('maps known Prisma errors', () => {
    const make = (code: string) =>
      new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });
    expect(run(make('P2002')).status).toBe(409);
    expect(run(make('P2002')).body.code).toBe('UNIQUE_CONSTRAINT_VIOLATION');
    expect(run(make('P2025')).status).toBe(404);
    expect(run(make('P2003')).status).toBe(409);
  });

  it('maps body-parser style errors to 400/413', () => {
    expect(run(Object.assign(new Error('bad json'), { status: 400 })).body.code).toBe(
      'BAD_REQUEST',
    );
    expect(run(Object.assign(new Error('big'), { status: 413 })).body.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('hides the details of unexpected errors', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('secret database password leaked'));
    expect(logSpy).toHaveBeenCalledTimes(1); // the real cause is logged server-side
    logSpy.mockRestore();
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
