import z from 'zod';
import { envSchema } from './env.schema.js';

type RawEnv = z.input<typeof envSchema>;

describe('envSchema', () => {
  const base: RawEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    CONFIRMATION_HMAC_SECRET: 'x'.repeat(32),
    REGISTRATION_CONFIRM_URL: 'http://localhost:5173/confirm-email',
    SMTP_HOST: 'localhost',
    MAIL_FROM: 'no-reply@auth-service.local',
  };

  const issuePaths = (input: RawEnv) =>
    envSchema.safeParse(input).error?.issues.map((issue) => issue.path);

  it('applies defaults when only required vars are set', () => {
    const result = envSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      BCRYPT_ROUNDS: 12,
      REGISTRATION_CONFIRMATION_ENABLED: false,
      REGISTRATION_CONFIRMATION_METHOD: 'otp',
      SMTP_PORT: 1025,
    });
  });

  describe('REGISTRATION_CONFIRMATION_ENABLED', () => {
    it('parses "true" as true', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_ENABLED: 'true',
      });

      expect(result.success).toBe(true);
      expect(result.data?.REGISTRATION_CONFIRMATION_ENABLED).toBe(true);
    });

    it('parses "false" as false', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_ENABLED: 'false',
      });

      expect(result.success).toBe(true);
      expect(result.data?.REGISTRATION_CONFIRMATION_ENABLED).toBe(false);
    });

    it('rejects non-boolean value', () => {
      expect(
        issuePaths({ ...base, REGISTRATION_CONFIRMATION_ENABLED: 'abc' }),
      ).toEqual([['REGISTRATION_CONFIRMATION_ENABLED']]);
    });
  });

  describe('REGISTRATION_CONFIRMATION_METHOD', () => {
    it('accepts magic_link', () => {
      const result = envSchema.safeParse({
        ...base,
        REGISTRATION_CONFIRMATION_METHOD: 'magic_link',
      });

      expect(result.success).toBe(true);
      expect(result.data?.REGISTRATION_CONFIRMATION_METHOD).toBe('magic_link');
    });

    it('rejects unknown method', () => {
      expect(
        issuePaths({
          ...base,
          REGISTRATION_CONFIRMATION_METHOD:
            'sms' as RawEnv['REGISTRATION_CONFIRMATION_METHOD'],
        }),
      ).toEqual([['REGISTRATION_CONFIRMATION_METHOD']]);
    });
  });

  // Confirm/resend of issued attempts work regardless of the current flag,
  // so the secret and the URL are required even when confirmation is disabled.
  describe('CONFIRMATION_HMAC_SECRET', () => {
    it('is required even when confirmation is disabled', () => {
      const { CONFIRMATION_HMAC_SECRET: _secret, ...rest } = base;
      expect(
        issuePaths({
          ...rest,
          REGISTRATION_CONFIRMATION_ENABLED: 'false',
        } as RawEnv),
      ).toEqual([['CONFIRMATION_HMAC_SECRET']]);
    });

    it('rejects secret shorter than 32 chars', () => {
      expect(
        issuePaths({ ...base, CONFIRMATION_HMAC_SECRET: 'x'.repeat(31) }),
      ).toEqual([['CONFIRMATION_HMAC_SECRET']]);
    });
  });

  describe('REGISTRATION_CONFIRM_URL', () => {
    it('is required even when confirmation is disabled and method is otp', () => {
      const { REGISTRATION_CONFIRM_URL: _url, ...rest } = base;
      expect(
        issuePaths({
          ...rest,
          REGISTRATION_CONFIRMATION_ENABLED: 'false',
          REGISTRATION_CONFIRMATION_METHOD: 'otp',
        } as RawEnv),
      ).toEqual([['REGISTRATION_CONFIRM_URL']]);
    });

    it('rejects invalid url', () => {
      expect(
        issuePaths({ ...base, REGISTRATION_CONFIRM_URL: 'not-a-url' }),
      ).toEqual([['REGISTRATION_CONFIRM_URL']]);
    });
  });

  describe('mail', () => {
    it('requires SMTP_HOST and MAIL_FROM', () => {
      const { SMTP_HOST: _host, MAIL_FROM: _from, ...rest } = base;
      expect(issuePaths(rest as RawEnv)).toEqual([
        ['SMTP_HOST'],
        ['MAIL_FROM'],
      ]);
    });

    it('rejects invalid MAIL_FROM', () => {
      expect(issuePaths({ ...base, MAIL_FROM: 'not-an-email' })).toEqual([
        ['MAIL_FROM'],
      ]);
    });

    it('coerces SMTP_PORT to number', () => {
      const result = envSchema.safeParse({ ...base, SMTP_PORT: '2525' });

      expect(result.success).toBe(true);
      expect(result.data?.SMTP_PORT).toBe(2525);
    });

    it('rejects non-integer SMTP_PORT', () => {
      expect(issuePaths({ ...base, SMTP_PORT: '25.5' })).toEqual([
        ['SMTP_PORT'],
      ]);
    });
  });
});
