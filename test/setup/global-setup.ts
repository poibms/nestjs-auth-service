import { execFileSync } from 'child_process';
import { assertTestDatabase, loadTestEnv } from './load-test-env.js';

export const setup = () => {
  const env = loadTestEnv();
  assertTestDatabase(env.DATABASE_URL);

  execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
};
