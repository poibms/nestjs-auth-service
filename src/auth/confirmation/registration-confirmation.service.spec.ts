import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Mock, MockInstance } from 'vitest';
import { RegistrationConfirmationService } from './registration-confirmation.service.js';
import { EmailConfirmationAttemptsRepository } from './email-confirmation-attempts.repository.js';
import { ConfirmationSecretService } from './confirmation-secret.service.js';
import { MailerService } from '../../mailer/mailer.service.js';
import { UsersRepository } from '#users/users.repository.js';
import {
  EmailConfirmationAttempt,
  User,
} from '../../generated/prisma/client.js';

describe('RegistrationConfirmationService', () => {
  let service: RegistrationConfirmationService;
  let attemptsRepository: {
    create: Mock<EmailConfirmationAttemptsRepository['create']>;
    findOneById: Mock<EmailConfirmationAttemptsRepository['findOneById']>;
    findOneBySecretHash: Mock<
      EmailConfirmationAttemptsRepository['findOneBySecretHash']
    >;
    reserveOtpAttempt: Mock<
      EmailConfirmationAttemptsRepository['reserveOtpAttempt']
    >;
    markConsumed: Mock<EmailConfirmationAttemptsRepository['markConsumed']>;
  };
  let usersRepository: {
    markEmailVerified: Mock<UsersRepository['markEmailVerified']>;
  };
  let transactionHost: { withTransaction: Mock };
  let inTransaction: boolean;
  let secretService: {
    generateOtp: Mock<ConfirmationSecretService['generateOtp']>;
    hashOtp: Mock<ConfirmationSecretService['hashOtp']>;
    generateToken: Mock<ConfirmationSecretService['generateToken']>;
    hashToken: Mock<ConfirmationSecretService['hashToken']>;
    verifyOtp: Mock<ConfirmationSecretService['verifyOtp']>;
  };
  let mailerService: { send: Mock<MailerService['send']> };
  let config: Record<string, unknown>;

  const userId = 'user-id';
  const email = 'user@test.local';
  const confirmUrl = 'http://localhost:5173/confirm-email';
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(async () => {
    config = { REGISTRATION_CONFIRM_URL: confirmUrl };
    attemptsRepository = {
      create: vi.fn(),
      findOneById: vi.fn(),
      findOneBySecretHash: vi.fn(),
      reserveOtpAttempt: vi.fn().mockResolvedValue(true),
      markConsumed: vi.fn().mockResolvedValue(true),
    };
    usersRepository = { markEmailVerified: vi.fn() };
    inTransaction = false;
    transactionHost = {
      withTransaction: vi.fn(async (fn: () => Promise<unknown>) => {
        inTransaction = true;
        try {
          return await fn();
        } finally {
          inTransaction = false;
        }
      }),
    };
    secretService = {
      generateOtp: vi.fn().mockReturnValue('123456'),
      hashOtp: vi.fn().mockReturnValue('a'.repeat(64)),
      generateToken: vi.fn().mockReturnValue('magic-link-token'),
      hashToken: vi.fn().mockReturnValue('b'.repeat(64)),
      verifyOtp: vi.fn().mockReturnValue(true),
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
        { provide: UsersRepository, useValue: usersRepository },
        { provide: TransactionHost, useValue: transactionHost },
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
    let logSpy: MockInstance<Logger['log']>;
    let errorSpy: MockInstance<Logger['error']>;

    beforeEach(() => {
      logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      errorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sends OTP email with the code', async () => {
      await service.sendEmail({
        email,
        method: 'otp',
        secret: '123456',
        attemptId: 'attempt-id',
      });

      expect(mailerService.send).toHaveBeenCalledWith({
        to: email,
        subject: expect.any(String),
        html: expect.any(String),
        text: expect.stringContaining('123456'),
      });
    });

    it('sends magic link email with confirmation url', async () => {
      await service.sendEmail({
        email,
        method: 'magic_link',
        secret: 'magic-link-token',
        attemptId: 'attempt-id',
      });

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
        .sendEmail({
          email,
          method: 'otp',
          secret: '123456',
          attemptId: 'attempt-id',
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).cause).toBe(smtpError);
    });

    it('logs the sent event with attempt context', async () => {
      await service.sendEmail({
        email,
        method: 'otp',
        secret: '123456',
        attemptId: 'attempt-id',
      });

      expect(logSpy).toHaveBeenCalledWith({
        event: 'confirmation.email_sent',
        attemptId: 'attempt-id',
        method: 'otp',
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs the failed event with stack when mailer fails', async () => {
      const smtpError = new Error('connect ECONNREFUSED 127.0.0.1:1025');
      mailerService.send.mockRejectedValue(smtpError);

      await service
        .sendEmail({
          email,
          method: 'otp',
          secret: '123456',
          attemptId: 'attempt-id',
        })
        .catch(() => undefined);

      expect(errorSpy).toHaveBeenCalledWith(
        {
          event: 'confirmation.email_failed',
          attemptId: 'attempt-id',
          method: 'otp',
        },
        smtpError.stack,
      );
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('never logs the secret or the email', async () => {
      const params = {
        email,
        method: 'otp' as const,
        secret: '123456',
        attemptId: 'attempt-id',
      };

      await service.sendEmail(params);
      mailerService.send.mockRejectedValue(new Error('smtp down'));
      await service.sendEmail(params).catch(() => undefined);

      const logged = JSON.stringify([
        ...logSpy.mock.calls,
        ...errorSpy.mock.calls,
      ]);
      expect(logged).toContain('confirmation.email_failed');
      expect(logged).not.toContain('123456');
      expect(logged).not.toContain(email);
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

  describe('confirm', () => {
    const attemptId = '01a1a891-fdd9-717b-bc4b-cd50296069b5';
    const code = '123456';
    const token = 'm'.repeat(43);
    const activeUser = {
      id: userId,
      email,
      status: 'active',
      passwordHash: 'hash',
    } as User;

    const makeAttempt = (
      overrides: Partial<EmailConfirmationAttempt> = {},
    ): EmailConfirmationAttempt => ({
      id: attemptId,
      userId,
      method: 'otp',
      attempts: 0,
      secretHash: 'a'.repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
      sentAt: now,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

    const expectStatus = async (promise: Promise<unknown>, status: number) => {
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(status);
    };

    beforeEach(() => {
      usersRepository.markEmailVerified.mockResolvedValue(activeUser);
    });

    describe('confirmOtp', () => {
      const confirm = () => service.confirmOtp({ attemptId, code }, now);

      beforeEach(() => {
        attemptsRepository.findOneById.mockResolvedValue(makeAttempt());
      });

      it('returns activated user without sensitive fields', async () => {
        await expect(confirm()).resolves.toEqual({
          id: userId,
          email,
          status: 'active',
        });
      });

      it('reserves the attempt before comparing the code', async () => {
        await confirm();

        expect(attemptsRepository.reserveOtpAttempt).toHaveBeenCalledWith(
          attemptId,
          5,
          now,
        );
        expect(
          attemptsRepository.reserveOtpAttempt.mock.invocationCallOrder[0],
        ).toBeLessThan(secretService.verifyOtp.mock.invocationCallOrder[0]);
        expect(secretService.verifyOtp).toHaveBeenCalledWith(
          attemptId,
          code,
          'a'.repeat(64),
        );
      });

      it('reserves the attempt outside the activation transaction', async () => {
        let reservedInTransaction: boolean | undefined;
        attemptsRepository.reserveOtpAttempt.mockImplementation(() => {
          reservedInTransaction = inTransaction;
          return Promise.resolve(true);
        });

        await confirm();

        expect(reservedInTransaction).toBe(false);
      });

      it('consumes the attempt and activates the user in one transaction', async () => {
        const calledInTransaction: boolean[] = [];
        attemptsRepository.markConsumed.mockImplementation(() => {
          calledInTransaction.push(inTransaction);
          return Promise.resolve(true);
        });
        usersRepository.markEmailVerified.mockImplementation(() => {
          calledInTransaction.push(inTransaction);
          return Promise.resolve(activeUser);
        });

        await confirm();

        expect(attemptsRepository.markConsumed).toHaveBeenCalledWith(
          attemptId,
          now,
        );
        expect(usersRepository.markEmailVerified).toHaveBeenCalledWith(userId);
        expect(calledInTransaction).toEqual([true, true]);
      });

      it.each([
        ['not found', null],
        ['issued for magic_link', makeAttempt({ method: 'magic_link' })],
        ['already consumed', makeAttempt({ consumedAt: now })],
        [
          'consumed on the last allowed attempt',
          makeAttempt({ consumedAt: now, attempts: 5 }),
        ],
        ['expired', makeAttempt({ expiresAt: new Date(now.getTime() - 1) })],
        ['expiring exactly now', makeAttempt({ expiresAt: now })],
      ])(
        'rejects with 400 without spending an attempt when %s',
        async (_case, attempt) => {
          attemptsRepository.findOneById.mockResolvedValue(attempt);

          await expect(confirm()).rejects.toThrow(BadRequestException);
          expect(attemptsRepository.reserveOtpAttempt).not.toHaveBeenCalled();
          expect(secretService.verifyOtp).not.toHaveBeenCalled();
        },
      );

      it('rejects with 429 when attempts are exhausted, even for a correct code', async () => {
        attemptsRepository.findOneById.mockResolvedValue(
          makeAttempt({ attempts: 5 }),
        );

        await expectStatus(confirm(), HttpStatus.TOO_MANY_REQUESTS);
        expect(attemptsRepository.reserveOtpAttempt).not.toHaveBeenCalled();
        expect(secretService.verifyOtp).not.toHaveBeenCalled();
      });

      it('rejects with 429 when attempts are exhausted and the attempt is expired', async () => {
        attemptsRepository.findOneById.mockResolvedValue(
          makeAttempt({ attempts: 5, expiresAt: new Date(now.getTime() - 1) }),
        );

        await expectStatus(confirm(), HttpStatus.TOO_MANY_REQUESTS);
      });

      it('allows the 5th attempt', async () => {
        attemptsRepository.findOneById.mockResolvedValue(
          makeAttempt({ attempts: 4 }),
        );

        await expect(confirm()).resolves.toMatchObject({ status: 'active' });
      });

      it('rejects a wrong code with 400 after spending the attempt', async () => {
        secretService.verifyOtp.mockReturnValue(false);

        await expect(confirm()).rejects.toThrow(BadRequestException);
        expect(attemptsRepository.reserveOtpAttempt).toHaveBeenCalled();
        expect(attemptsRepository.markConsumed).not.toHaveBeenCalled();
        expect(usersRepository.markEmailVerified).not.toHaveBeenCalled();
      });

      describe('when a concurrent request wins the reservation', () => {
        beforeEach(() => {
          attemptsRepository.reserveOtpAttempt.mockResolvedValue(false);
        });

        it('rejects with 429 if the limit got exhausted', async () => {
          attemptsRepository.findOneById
            .mockResolvedValueOnce(makeAttempt({ attempts: 4 }))
            .mockResolvedValueOnce(makeAttempt({ attempts: 5 }));

          await expectStatus(confirm(), HttpStatus.TOO_MANY_REQUESTS);
          expect(secretService.verifyOtp).not.toHaveBeenCalled();
        });

        it.each([
          ['consumed', makeAttempt({ consumedAt: now })],
          [
            'consumed on the last attempt',
            makeAttempt({ attempts: 5, consumedAt: now }),
          ],
          ['gone', null],
        ])('rejects with 400 if the attempt got %s', async (_case, current) => {
          attemptsRepository.findOneById
            .mockResolvedValueOnce(makeAttempt())
            .mockResolvedValueOnce(current);

          await expect(confirm()).rejects.toThrow(BadRequestException);
          expect(secretService.verifyOtp).not.toHaveBeenCalled();
        });
      });

      it('rejects with 400 if the attempt was consumed concurrently', async () => {
        attemptsRepository.markConsumed.mockResolvedValue(false);

        await expect(confirm()).rejects.toThrow(BadRequestException);
        expect(usersRepository.markEmailVerified).not.toHaveBeenCalled();
      });

      it('rejects with 400 if the user is no longer pending', async () => {
        usersRepository.markEmailVerified.mockResolvedValue(false);

        await expect(confirm()).rejects.toThrow(BadRequestException);
      });
    });

    describe('confirmMagicLink', () => {
      const confirm = () => service.confirmMagicLink({ token }, now);

      beforeEach(() => {
        attemptsRepository.findOneBySecretHash.mockResolvedValue(
          makeAttempt({ method: 'magic_link', secretHash: 'b'.repeat(64) }),
        );
      });

      it('finds the attempt by token hash and activates the user', async () => {
        await expect(confirm()).resolves.toEqual({
          id: userId,
          email,
          status: 'active',
        });
        expect(secretService.hashToken).toHaveBeenCalledWith(token);
        expect(attemptsRepository.findOneBySecretHash).toHaveBeenCalledWith(
          'b'.repeat(64),
        );
        expect(attemptsRepository.markConsumed).toHaveBeenCalledWith(
          attemptId,
          now,
        );
        expect(usersRepository.markEmailVerified).toHaveBeenCalledWith(userId);
      });

      it('does not count attempts', async () => {
        await confirm();

        expect(attemptsRepository.reserveOtpAttempt).not.toHaveBeenCalled();
        expect(secretService.verifyOtp).not.toHaveBeenCalled();
      });

      it.each([
        ['not found', null],
        ['issued for otp', makeAttempt({ method: 'otp' })],
        [
          'already consumed',
          makeAttempt({ method: 'magic_link', consumedAt: now }),
        ],
        [
          'expired',
          makeAttempt({
            method: 'magic_link',
            expiresAt: new Date(now.getTime() - 1),
          }),
        ],
      ])('rejects with 400 when %s', async (_case, attempt) => {
        attemptsRepository.findOneBySecretHash.mockResolvedValue(attempt);

        await expect(confirm()).rejects.toThrow(BadRequestException);
        expect(attemptsRepository.markConsumed).not.toHaveBeenCalled();
        expect(usersRepository.markEmailVerified).not.toHaveBeenCalled();
      });

      it('rejects with 400 on a concurrent second click', async () => {
        attemptsRepository.markConsumed.mockResolvedValue(false);

        await expect(confirm()).rejects.toThrow(BadRequestException);
        expect(usersRepository.markEmailVerified).not.toHaveBeenCalled();
      });
    });
  });
});
