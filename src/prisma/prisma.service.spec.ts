import { ConfigService } from '@nestjs/config';

const mockClientConstructor = jest.fn();
jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      mockClientConstructor(options);
    }
  },
}));

import { PrismaService, withSqliteDefaults } from './prisma.service';

describe('withSqliteDefaults', () => {
  it('limits the pool to one connection so SQLite writers queue instead of timing out', () => {
    expect(withSqliteDefaults('file:./dev.db')).toBe('file:./dev.db?connection_limit=1');
  });

  it('appends to an existing query string', () => {
    expect(withSqliteDefaults('file:./dev.db?socket_timeout=10')).toBe(
      'file:./dev.db?socket_timeout=10&connection_limit=1',
    );
  });

  it('respects an explicit connection_limit', () => {
    expect(withSqliteDefaults('file:./dev.db?connection_limit=4')).toBe(
      'file:./dev.db?connection_limit=4',
    );
    expect(withSqliteDefaults('file:./dev.db?x=1&connection_limit=2')).toBe(
      'file:./dev.db?x=1&connection_limit=2',
    );
  });
});

describe('PrismaService', () => {
  it('creates the Prisma client with a single-connection pool (regression: P1008 under load)', () => {
    const config = { get: () => 'file:./dev.db' } as unknown as ConfigService<never, true>;
    new PrismaService(config);
    expect(mockClientConstructor).toHaveBeenCalledWith({
      datasourceUrl: 'file:./dev.db?connection_limit=1',
    });
  });
});
