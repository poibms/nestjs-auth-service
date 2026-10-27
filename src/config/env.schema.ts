import z from 'zod';

export const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    REGISTRATION_CONFIRMATION_ENABLED: z.stringbool().default(false),
    REGISTRATION_CONFIRMATION_METHOD: z
      .enum(['otp', 'magic_link'])
      .default('otp'),
    CONFIRMATION_HMAC_SECRET: z.string().min(32).optional(),
    REGISTRATION_CONFIRM_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (
      env.REGISTRATION_CONFIRMATION_ENABLED &&
      !env.CONFIRMATION_HMAC_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CONFIRMATION_HMAC_SECRET'],
        message:
          'CONFIRMATION_HMAC_SECRET is required when REGISTRATION_CONFIRMATION_ENABLED=true',
      });
    }

    if (
      env.REGISTRATION_CONFIRMATION_ENABLED &&
      env.REGISTRATION_CONFIRMATION_METHOD === 'magic_link' &&
      !env.REGISTRATION_CONFIRM_URL
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['REGISTRATION_CONFIRM_URL'],
        message:
          'REGISTRATION_CONFIRM_URL is required when REGISTRATION_CONFIRMATION_ENABLED=true and REGISTRATION_CONFIRMATION_METHOD = magic_link',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
