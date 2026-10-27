import z from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
});

export type Env = z.infer<typeof envSchema>;
