import { PrismaService } from '../../src/prisma/prisma.service.js';
import { assertTestDatabase } from '../setup/load-test-env.js';

const ALWAYS_KEPT = ['_prisma_migrations'];

export async function resetDatabase(
  prisma: PrismaService,
  options: { exclude?: string[] } = {},
): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL);

  const kept = new Set([...ALWAYS_KEPT, ...(options.exclude ?? [])]);
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const tables = rows
    .map(({ tablename }) => tablename)
    .filter((name) => !kept.has(name));

  if (tables.length === 0) return;

  const list = tables
    .map((name) => `"public"."${name.replaceAll('"', '""')}"`)
    .join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
