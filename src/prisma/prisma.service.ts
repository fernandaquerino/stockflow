import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { EnvironmentVariables } from '../config/env.validation';

/**
 * SQLite allows a single writer. With several pooled connections, concurrent write transactions
 * fight over the file lock and fail with "Socket timeout" (P1008) instead of queueing. Limiting
 * the pool to ONE connection makes Prisma queue transactions in-process: slower in theory,
 * but correct and predictable. Callers can still override it explicitly in DATABASE_URL.
 */
export function withSqliteDefaults(url: string): string {
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({ datasourceUrl: withSqliteDefaults(config.get('DATABASE_URL', { infer: true })) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
