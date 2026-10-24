import z from 'zod';

export const envSchema = z.object({ DATABASE_URL: z.url() });

export type Env = z.infer<typeof envSchema>;
