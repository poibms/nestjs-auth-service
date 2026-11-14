import { readFileSync } from 'fs';
import dotenv from 'dotenv';

export function loadTestEnv() {
  const testEnv = readFileSync(
    new URL('../../.env.test', import.meta.url),
    'utf-8',
  );

  return dotenv.parse(testEnv);
}

export function assertTestDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error('Refusing to run e2e: DATABASE_URL is not set');
  }

  const database = new URL(url).pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run e2e: database "${database}" does not end with "_test"`,
    );
  }
}
