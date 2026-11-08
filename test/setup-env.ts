import { TEST_DATABASE_URL } from './test-db';

// Runs inside every integration test worker before the app modules are imported.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.PORT = '3998';
