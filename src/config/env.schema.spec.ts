import z from 'zod';
import { envSchema } from './env.schema.js';

type RawEnv = z.input<typeof envSchema>;

describe('envSchema', () => {
  const base: RawEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  };
  const secret = 'x'.repeat(32);

  const issuePaths = (input: RawEnv) =>
    envSchema.safeParse(input).error?.issues.map((issue) => issue.path);

  describe('confirmation disabled', () => {
    it('applies defaults when only DATABASE_URL is set', () => {
      const result = envSchema.safeParse(base);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        BCRYPT_ROUNDS: 12,
        REGISTRATION_CONFIRMATION_ENABLED: false,
        REGISTRATION_CONFIRMATION_METHOD: 'otp',
      });
    });

    it('parses "false" as false', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_ENABLED: 'false',
      });

      expect(result.success).toBe(true);
      expect(result.data?.REGISTRATION_CONFIRMATION_ENABLED).toBe(false);
    });

    it('does not require secret and url for magic_link', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_METHOD: 'magic_link',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('confirmation enabled', () => {
    it('parses "true" as true', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_ENABLED: 'true',
        CONFIRMATION_HMAC_SECRET: secret,
      });

      expect(result.success).toBe(true);
      expect(result.data?.REGISTRATION_CONFIRMATION_ENABLED).toBe(true);
    });

    it('requires CONFIRMATION_HMAC_SECRET', () => {
      expect(
        issuePaths({ ...base, REGISTRATION_CONFIRMATION_ENABLED: 'true' }),
      ).toEqual([['CONFIRMATION_HMAC_SECRET']]);
    });

    it('rejects CONFIRMATION_HMAC_SECRET shorter than 32 chars', () => {
      expect(
        issuePaths({
          ...base,
          REGISTRATION_CONFIRMATION_ENABLED: 'true',
          CONFIRMATION_HMAC_SECRET: 'x'.repeat(31),
        }),
      ).toEqual([['CONFIRMATION_HMAC_SECRET']]);
    });

    it('does not require REGISTRATION_CONFIRM_URL for otp', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_ENABLED: 'true',
        REGISTRATION_CONFIRMATION_METHOD: 'otp',
        CONFIRMATION_HMAC_SECRET: secret,
      });

      expect(result.success).toBe(true);
    });

    it('requires REGISTRATION_CONFIRM_URL for magic_link', () => {
      expect(
        issuePaths({
          ...base,
          REGISTRATION_CONFIRMATION_ENABLED: 'true',
          REGISTRATION_CONFIRMATION_METHOD: 'magic_link',
          CONFIRMATION_HMAC_SECRET: secret,
        }),
      ).toEqual([['REGISTRATION_CONFIRM_URL']]);
    });

    it('accepts magic_link with REGISTRATION_CONFIRM_URL', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_ENABLED: 'true',
        REGISTRATION_CONFIRMATION_METHOD: 'magic_link',
        CONFIRMATION_HMAC_SECRET: secret,
        REGISTRATION_CONFIRM_URL: 'http://localhost:3000/auth/confirm',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('invalid values', () => {
    it('rejects non-boolean REGISTRATION_CONFIRMATION_ENABLED', () => {
      expect(
        issuePaths({ ...base, REGISTRATION_CONFIRMATION_ENABLED: 'abc' }),
      ).toEqual([['REGISTRATION_CONFIRMATION_ENABLED']]);
    });

    it('rejects unknown REGISTRATION_CONFIRMATION_METHOD', () => {
      expect(
        issuePaths({
          ...base,
          REGISTRATION_CONFIRMATION_METHOD:
            'sms' as RawEnv['REGISTRATION_CONFIRMATION_METHOD'],
        }),
      ).toEqual([['REGISTRATION_CONFIRMATION_METHOD']]);
    });

    it('rejects invalid REGISTRATION_CONFIRM_URL', () => {
      expect(
        issuePaths({ ...base, REGISTRATION_CONFIRM_URL: 'not-a-url' }),
      ).toEqual([['REGISTRATION_CONFIRM_URL']]);
    });
  });
});
