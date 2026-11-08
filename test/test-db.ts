import { join } from 'node:path';

/** The integration tests always use this file - never prisma/dev.db. */
export const TEST_DATABASE_URL = 'file:./test.db';
export const TEST_DATABASE_FILE = join(__dirname, '..', 'prisma', 'test.db');
