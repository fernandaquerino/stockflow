import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('accepts a valid configuration and converts PORT to a number', () => {
    const env = validateEnv({ NODE_ENV: 'production', PORT: '8080', DATABASE_URL: 'file:./x.db' });
    expect(env).toMatchObject({ NODE_ENV: 'production', PORT: 8080, DATABASE_URL: 'file:./x.db' });
  });

  it('applies defaults for NODE_ENV and PORT', () => {
    const env = validateEnv({ DATABASE_URL: 'file:./dev.db' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment configuration/);
  });

  it('rejects non-SQLite database URLs', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://localhost/db' })).toThrow(
      /SQLite file URL/,
    );
  });

  it.each([['abc'], ['0'], ['70000'], ['3000.5']])('rejects PORT=%s', (port) => {
    expect(() => validateEnv({ DATABASE_URL: 'file:./dev.db', PORT: port })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects unknown NODE_ENV values', () => {
    expect(() => validateEnv({ DATABASE_URL: 'file:./dev.db', NODE_ENV: 'staging' })).toThrow();
  });
});
