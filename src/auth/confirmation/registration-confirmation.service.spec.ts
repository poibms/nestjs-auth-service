import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Mock } from 'vitest';
import { RegistrationConfirmationService } from './registration-confirmation.service.js';
import { EmailConfirmationAttemptsRepository } from './email-confirmation-attempts.repository.js';
import { ConfirmationSecretService } from './confirmation-secret.service.js';
import { MailerService } from '../../mailer/mailer.service.js';

describe('RegistrationConfirmationService', () => {
  let service: RegistrationConfirmationService;
  let attemptsRepository: {
    create: Mock<EmailConfirmationAttemptsRepository['create']>;
  };
  let secretService: {
    generateOtp: Mock<ConfirmationSecretService['generateOtp']>;
    hashOtp: Mock<ConfirmationSecretService['hashOtp']>;
    generateToken: Mock<ConfirmationSecretService['generateToken']>;
    hashToken: Mock<ConfirmationSecretService['hashToken']>;
  };
  let mailerService: { send: Mock<MailerService['send']> };
  let config: Record<string, unknown>;

  const userId = 'user-id';
  const email = 'user@test.local';
  const confirmUrl = 'http://localhost:5173/confirm-email';
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(async () => {
    config = { REGISTRATION_CONFIRM_URL: confirmUrl };
    attemptsRepository = { create: vi.fn() };
    secretService = {
      generateOtp: vi.fn().mockReturnValue('123456'),
      hashOtp: vi.fn().mockReturnValue('a'.repeat(64)),
      generateToken: vi.fn().mockReturnValue('magic-link-token'),
      hashToken: vi.fn().mockReturnValue('b'.repeat(64)),
    };
    mailerService = { send: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationConfirmationService,
        {
          provide: EmailConfirmationAttemptsRepository,
          useValue: attemptsRepository,
        },
        { provide: ConfirmationSecretService, useValue: secretService },
        { provide: MailerService, useValue: mailerService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(RegistrationConfirmationService);
  });

  describe('createAttempt', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('stores HMAC of the OTP computed with the same attemptId', async () => {
      const { attemptId, secret } = await service.createAttempt(userId, 'otp');

      expect(secret).toBe('123456');
      expect(secretService.hashOtp).toHaveBeenCalledWith(attemptId, '123456');
      expect(attemptsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: attemptId,
          userId,
          method: 'otp',
          secretHash: 'a'.repeat(64),
        }),
      );
    });

    it('stores HMAC of the token for magic_link without using OTP', async () => {
      const { secret } = await service.createAttempt(userId, 'magic_link');

      expect(secret).toBe('magic-link-token');
      expect(secretService.hashToken).toHaveBeenCalledWith('magic-link-token');
      expect(secretService.generateOtp).not.toHaveBeenCalled();
      expect(secretService.hashOtp).not.toHaveBeenCalled();
      expect(attemptsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          method: 'magic_link',
          secretHash: 'b'.repeat(64),
        }),
      );
    });

    it('generates uuid attemptId', async () => {
      const { attemptId } = await service.createAttempt(userId, 'otp');
      expect(attemptId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('sets sentAt to now and expiresAt to now + 10 minutes', async () => {
      await service.createAttempt(userId, 'otp');
      const attempt = attemptsRepository.create.mock.calls[0][0];
      expect(attempt.sentAt).toEqual(now);
      expect(attempt.expiresAt).toEqual(new Date(now.getTime() + 600 * 1000));
    });

    it('does not store the plain secret', async () => {
      await service.createAttempt(userId, 'otp');
      expect(
        JSON.stringify(attemptsRepository.create.mock.calls[0][0]),
      ).not.toContain('123456');
    });
  });

  describe('sendEmail', () => {
    it('sends OTP email with the code', async () => {
      await service.sendEmail(email, 'otp', '123456');

      expect(mailerService.send).toHaveBeenCalledWith({
        to: email,
        subject: expect.any(String),
        html: expect.any(String),
        text: expect.stringContaining('123456'),
      });
    });

    it('sends magic link email with confirmation url', async () => {
      await service.sendEmail(email, 'magic_link', 'magic-link-token');

      expect(mailerService.send).toHaveBeenCalledWith({
        to: email,
        subject: expect.any(String),
        html: expect.any(String),
        text: expect.stringContaining(`${confirmUrl}?token=magic-link-token`),
      });
    });

    it('throws ServiceUnavailableException with cause when mailer fails', async () => {
      const smtpError = new Error('connect ECONNREFUSED 127.0.0.1:1025');
      mailerService.send.mockRejectedValue(smtpError);

      const error = await service
        .sendEmail(email, 'otp', '123456')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).cause).toBe(smtpError);
    });
  });

  describe('toResponse', () => {
    it('returns attempt info with TTL and resend cooldown', () => {
      expect(service.toResponse('magic_link', 'attempt-id')).toEqual({
        confirmationRequired: true,
        method: 'magic_link',
        attemptId: 'attempt-id',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
    });
  });
});
