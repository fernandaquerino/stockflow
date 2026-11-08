import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, Max, Min, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @Matches(/^file:.+/, {
    message: 'DATABASE_URL must be a SQLite file URL such as "file:./dev.db"',
  })
  DATABASE_URL!: string;
}

/** Validates raw environment variables at startup. Throws a readable error when invalid. */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, raw);
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    const lines = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}).map((message) => `  - ${message}`),
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return config;
}
