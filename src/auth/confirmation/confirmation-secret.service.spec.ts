import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConfirmationSecretService } from './confirmation-secret.service.js';
import { randomInt } from 'node:crypto';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

describe('ConfirmationSecretService', () => {
  let service: ConfirmationSecretService;
  let config: Record<string, unknown>;

  const attemptId = '019a0000-0000-7000-8000-0000000000a1';
  const code = '123456';

  const createService = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfirmationSecretService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    return moduleRef.get(ConfirmationSecretService);
  };

  beforeEach(async () => {
    config = { CONFIRMATION_HMAC_SECRET: 'x'.repeat(32) };
    service = await createService();
  });

  describe('without CONFIRMATION_HMAC_SECRET', () => {
    beforeEach(() => {
      delete config.CONFIRMATION_HMAC_SECRET;
    });

    it('can be created (secret is checked lazily)', async () => {
      await expect(createService()).resolves.toBeInstanceOf(
        ConfirmationSecretService,
      );
    });

    it('hashOtp throws', () => {
      expect(() => service.hashOtp(attemptId, code)).toThrow(
        'CONFIRMATION_HMAC_SECRET is not configured',
      );
    });
  });

  describe('generateOtp', () => {
    it('always returns 6 digits', () => {
      for (let i = 0; i < 100; i++) {
        expect(service.generateOtp()).toMatch(/^\d{6}$/);
      }
    });

    it('pads OTP with leading zeros', () => {
      vi.mocked(randomInt).mockReturnValueOnce(42 as never);

      expect(service.generateOtp()).toBe('000042');
    });

    it('uses the full 000000-999999 range', () => {
      service.generateOtp();

      expect(randomInt).toHaveBeenLastCalledWith(0, 1_000_000);
    });
  });

  describe('hashOtp', () => {
    it('returns 64-char hex (fits CHAR(64))', () => {
      expect(service.hashOtp(attemptId, code)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
      expect(service.hashOtp(attemptId, code)).toBe(
        service.hashOtp(attemptId, code),
      );
    });

    it('differs for the same code with another attemptId', () => {
      expect(service.hashOtp(attemptId, code)).not.toBe(
        service.hashOtp('019a0000-0000-7000-8000-0000000000a2', code),
      );
    });

    it('differs for another code', () => {
      expect(service.hashOtp(attemptId, code)).not.toBe(
        service.hashOtp(attemptId, '654321'),
      );
    });

    it('differs for another secret', () => {
      const hash = service.hashOtp(attemptId, code);
      config.CONFIRMATION_HMAC_SECRET = 'y'.repeat(32);

      expect(service.hashOtp(attemptId, code)).not.toBe(hash);
    });
  });

  describe('generateToken', () => {
    it('returns base64url of 32 random bytes', () => {
      const token = service.generateToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('returns a different token on each call', () => {
      expect(service.generateToken()).not.toBe(service.generateToken());
    });
  });

  describe('hashToken', () => {
    const token = 'magic-link-token';

    it('returns 64-char hex (fits CHAR(64))', () => {
      expect(service.hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same token', () => {
      expect(service.hashToken(token)).toBe(service.hashToken(token));
    });

    it('differs for another token', () => {
      expect(service.hashToken(token)).not.toBe(
        service.hashToken('another-token'),
      );
    });

    it('differs for another secret', () => {
      const hash = service.hashToken(token);
      config.CONFIRMATION_HMAC_SECRET = 'y'.repeat(32);

      expect(service.hashToken(token)).not.toBe(hash);
    });
  });

  describe('verifyOtp', () => {
    let storedHash: string;

    beforeEach(() => {
      storedHash = service.hashOtp(attemptId, code);
    });

    it('returns true for the correct code', () => {
      expect(service.verifyOtp(attemptId, code, storedHash)).toBe(true);
    });

    it('returns false for a wrong code', () => {
      expect(service.verifyOtp(attemptId, '654321', storedHash)).toBe(false);
    });

    it('returns false for another attemptId', () => {
      expect(
        service.verifyOtp(
          '019a0000-0000-7000-8000-0000000000a2',
          code,
          storedHash,
        ),
      ).toBe(false);
    });

    it('returns false for storedHash of another length', () => {
      expect(service.verifyOtp(attemptId, code, storedHash.slice(0, 62))).toBe(
        false,
      );
    });

    it('returns false for non-hex storedHash', () => {
      expect(service.verifyOtp(attemptId, code, 'é'.repeat(64))).toBe(false);
    });
  });
});
