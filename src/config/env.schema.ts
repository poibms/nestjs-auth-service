import z from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  REGISTRATION_CONFIRMATION_ENABLED: z.stringbool().default(false),
  REGISTRATION_CONFIRMATION_METHOD: z
    .enum(['otp', 'magic_link'])
    .default('otp'),
  CONFIRMATION_HMAC_SECRET: z.string().min(32),
  REGISTRATION_CONFIRM_URL: z.url(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.email(),
});

export type Env = z.infer<typeof envSchema>;
