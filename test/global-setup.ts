import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_DATABASE_FILE, TEST_DATABASE_URL } from './test-db';

/**
 * Runs once before the integration suite: recreates prisma/test.db from scratch and applies
 * the committed migrations to it. Development data (prisma/dev.db) is never touched because the
 * DATABASE_URL passed to Prisma is forced to the test database here.
 */
export default function globalSetup(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${TEST_DATABASE_FILE}${suffix}`, { force: true });
  }
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
