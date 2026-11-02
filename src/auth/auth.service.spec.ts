import { ConfigService } from '@nestjs/config';
import { EmailAlreadyExistsError, UsersRepository } from '#users/index.js';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { Mock } from 'vitest';
import bcrypt from 'bcrypt';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { EmailConfirmationAttemptsRepository } from './confirmation/email-confirmation-attempts.repository.js';
import { ConfirmationSecretService } from './confirmation/confirmation-secret.service.js';
import { TransactionHost } from '@nestjs-cls/transactional';
import { MailerService } from '../mailer/mailer.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: { create: Mock<UsersRepository['create']> };
  let confirmationService: {
    generateOtp: Mock<ConfirmationSecretService['generateOtp']>;
    hashOtp: Mock<ConfirmationSecretService['hashOtp']>;
    generateToken: Mock<ConfirmationSecretService['generateToken']>;
    hashToken: Mock<ConfirmationSecretService['hashToken']>;
  };
  let emailConfirmationRepository: {
    create: Mock<EmailConfirmationAttemptsRepository['create']>;
  };

  let transactionHost: {
    withTransaction: Mock<(fn: () => Promise<unknown>) => Promise<unknown>>;
  };

  let mailerService: { send: Mock<MailerService['send']> };

  let config: Record<string, unknown> = {};

  const userDto: RegisterDto = {
    email: 'testemail@gmail.com',
    password: 'testPassword123',
  };

  beforeEach(async () => {
    config = { BCRYPT_ROUNDS: 4 };
    usersRepository = { create: vi.fn() };
    emailConfirmationRepository = { create: vi.fn() };
    confirmationService = {
      generateOtp: vi.fn(),
      hashOtp: vi.fn(),
      generateToken: vi.fn(),
      hashToken: vi.fn(),
    };
    transactionHost = { withTransaction: vi.fn((fn) => fn()) };
    mailerService = { send: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: ConfirmationSecretService, useValue: confirmationService },
        {
          provide: EmailConfirmationAttemptsRepository,
          useValue: emailConfirmationRepository,
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        { provide: TransactionHost, useValue: transactionHost },
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    const userId = 'some-uuid';
    beforeEach(() => {
      usersRepository.create.mockResolvedValue({
        id: userId,
        email: userDto.email,
        passwordHash: '$2b$04$hash-from-db',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('passes email and active status to repository', async () => {
      await service.register(userDto);
      const invokeArgs = usersRepository.create.mock.calls[0][0];
      expect(usersRepository.create).toHaveBeenCalledTimes(1);
      expect(invokeArgs.email).toEqual(userDto.email);
      expect(invokeArgs.status).toEqual('active');
    });

    it('stores bcrypt hash instead of plain password', async () => {
      await service.register(userDto);
      const invokeArgs = usersRepository.create.mock.calls[0][0];
      expect(invokeArgs.passwordHash).not.toBe(userDto.password);
      expect(
        await bcrypt.compare(userDto.password, invokeArgs.passwordHash),
      ).toBe(true);
    });

    it('uses bcrypt rounds from config', async () => {
      await service.register(userDto);
      const invokeArgs = usersRepository.create.mock.calls[0][0];
      expect(invokeArgs.passwordHash.startsWith('$2b$04$')).toBe(true);
    });

    it('returns only id, email and status', async () => {
      const res = await service.register(userDto);
      expect(res).toEqual({
        id: userId,
        email: userDto.email,
        status: 'active',
      });
    });

    it('does not open transaction or create attempt when confirmation is disabled', async () => {
      await service.register(userDto);
      expect(transactionHost.withTransaction).not.toHaveBeenCalled();
      expect(emailConfirmationRepository.create).not.toHaveBeenCalled();
    });

    it('does not send email when confirmation is disabled', async () => {
      await service.register(userDto);
      expect(mailerService.send).not.toHaveBeenCalled();
    });

    describe('with OTP confirmation enabled', () => {
      const otp = '123456';
      const secretHash = 'a'.repeat(64);
      const now = new Date('2026-01-01T00:00:00.000Z');
      let inTransaction: boolean;
      let calledInTransaction: { user?: boolean; attempt?: boolean };

      beforeEach(() => {
        config.REGISTRATION_CONFIRMATION_ENABLED = true;
        config.REGISTRATION_CONFIRMATION_METHOD = 'otp';
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now);

        inTransaction = false;
        calledInTransaction = {};
        transactionHost.withTransaction.mockImplementation(async (fn) => {
          inTransaction = true;
          try {
            return await fn();
          } finally {
            inTransaction = false;
          }
        });
        usersRepository.create.mockImplementation(async (data) => {
          calledInTransaction.user = inTransaction;
          return {
            id: userId,
            email: data.email,
            passwordHash: data.passwordHash,
            status: data.status,
            createdAt: now,
            updatedAt: now,
          };
        });
        emailConfirmationRepository.create.mockImplementation(async () => {
          calledInTransaction.attempt = inTransaction;
        });
        confirmationService.generateOtp.mockReturnValue(otp);
        confirmationService.hashOtp.mockReturnValue(secretHash);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('creates user with pending status', async () => {
        await service.register(userDto);
        expect(usersRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({ email: userDto.email, status: 'pending' }),
        );
      });

      it('creates user and attempt inside one transaction', async () => {
        await service.register(userDto);
        expect(transactionHost.withTransaction).toHaveBeenCalledTimes(1);
        expect(calledInTransaction).toEqual({ user: true, attempt: true });
      });

      it('stores HMAC of the code computed with the same attemptId', async () => {
        await service.register(userDto);
        const attempt = emailConfirmationRepository.create.mock.calls[0][0];
        expect(confirmationService.hashOtp).toHaveBeenCalledWith(
          attempt.id,
          otp,
        );
        expect(attempt).toMatchObject({
          userId,
          method: 'otp',
          secretHash,
        });
      });

      it('sets sentAt to now and expiresAt to now + 10 minutes', async () => {
        await service.register(userDto);
        const attempt = emailConfirmationRepository.create.mock.calls[0][0];
        expect(attempt.sentAt).toEqual(now);
        expect(attempt.expiresAt).toEqual(new Date(now.getTime() + 600 * 1000));
      });

      it('returns confirmation info without the code or its hash', async () => {
        const res = await service.register(userDto);
        const attempt = emailConfirmationRepository.create.mock.calls[0][0];
        expect(res).toEqual({
          confirmationRequired: true,
          method: 'otp',
          attemptId: attempt.id,
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        });
      });

      it('sends the code to the user email after the transaction', async () => {
        let sentInTransaction: boolean | undefined;
        mailerService.send.mockImplementation(async () => {
          sentInTransaction = inTransaction;
        });

        await service.register(userDto);

        expect(mailerService.send).toHaveBeenCalledTimes(1);
        expect(mailerService.send).toHaveBeenCalledWith({
          to: userDto.email,
          subject: expect.any(String),
          text: expect.stringContaining(otp),
        });
        expect(sentInTransaction).toBe(false);
      });

      it('mentions the code lifetime in the email', async () => {
        await service.register(userDto);
        expect(mailerService.send.mock.calls[0][0].text).toContain(
          'expires in 10 minutes',
        );
      });

      it('does not send email when user creation fails', async () => {
        usersRepository.create.mockRejectedValue(new EmailAlreadyExistsError());

        await expect(service.register(userDto)).rejects.toThrow();
        expect(mailerService.send).not.toHaveBeenCalled();
      });

      it('throws ServiceUnavailableException with cause when email sending fails', async () => {
        const smtpError = new Error('connect ECONNREFUSED 127.0.0.1:1025');
        mailerService.send.mockRejectedValue(smtpError);

        const error = await service.register(userDto).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).cause).toBe(smtpError);
      });

      it('keeps pending user and attempt when email sending fails', async () => {
        mailerService.send.mockRejectedValue(new Error('smtp down'));

        await expect(service.register(userDto)).rejects.toThrow();

        expect(transactionHost.withTransaction).toHaveBeenCalledTimes(1);
        await expect(
          transactionHost.withTransaction.mock.results[0].value,
        ).resolves.toBeDefined();
        expect(usersRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'pending' }),
        );
        expect(emailConfirmationRepository.create).toHaveBeenCalledTimes(1);
      });

      it('rethrows database errors from the transaction unchanged', async () => {
        const dbError = new Error('connection lost');
        emailConfirmationRepository.create.mockRejectedValue(dbError);

        await expect(service.register(userDto)).rejects.toBe(dbError);
        expect(mailerService.send).not.toHaveBeenCalled();
      });

      it('maps EmailAlreadyExistsError to ConflictException without creating attempt', async () => {
        usersRepository.create.mockRejectedValue(new EmailAlreadyExistsError());

        await expect(service.register(userDto)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(emailConfirmationRepository.create).not.toHaveBeenCalled();
      });
    });

    describe('with magic link confirmation enabled', () => {
      const token = 'magic-link-token';
      const confirmUrl = 'http://localhost:5173/confirm-email';
      const secretHash = 'b'.repeat(64);
      const now = new Date('2026-01-01T00:00:00.000Z');
      let inTransaction: boolean;
      let calledInTransaction: { user?: boolean; attempt?: boolean };

      beforeEach(() => {
        config.REGISTRATION_CONFIRMATION_ENABLED = true;
        config.REGISTRATION_CONFIRMATION_METHOD = 'magic_link';
        config.REGISTRATION_CONFIRM_URL = confirmUrl;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now);

        inTransaction = false;
        calledInTransaction = {};
        transactionHost.withTransaction.mockImplementation(async (fn) => {
          inTransaction = true;
          try {
            return await fn();
          } finally {
            inTransaction = false;
          }
        });
        usersRepository.create.mockImplementation(async (data) => {
          calledInTransaction.user = inTransaction;
          return {
            id: userId,
            email: data.email,
            passwordHash: data.passwordHash,
            status: data.status,
            createdAt: now,
            updatedAt: now,
          };
        });
        emailConfirmationRepository.create.mockImplementation(async () => {
          calledInTransaction.attempt = inTransaction;
        });
        confirmationService.generateToken.mockReturnValue(token);
        confirmationService.hashToken.mockReturnValue(secretHash);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('creates pending user with bcrypt hash of the password', async () => {
        await service.register(userDto);
        const user = usersRepository.create.mock.calls[0][0];
        expect(user).toMatchObject({ email: userDto.email, status: 'pending' });
        expect(await bcrypt.compare(userDto.password, user.passwordHash)).toBe(
          true,
        );
      });

      it('creates user and attempt inside one transaction', async () => {
        await service.register(userDto);
        expect(transactionHost.withTransaction).toHaveBeenCalledTimes(1);
        expect(calledInTransaction).toEqual({ user: true, attempt: true });
      });

      it('stores HMAC of the token with magic_link method', async () => {
        await service.register(userDto);
        expect(confirmationService.hashToken).toHaveBeenCalledWith(token);
        expect(confirmationService.generateOtp).not.toHaveBeenCalled();
        expect(confirmationService.hashOtp).not.toHaveBeenCalled();
        expect(
          emailConfirmationRepository.create.mock.calls[0][0],
        ).toMatchObject({ userId, method: 'magic_link', secretHash });
      });

      it('sets sentAt to now and expiresAt to now + 10 minutes', async () => {
        await service.register(userDto);
        const attempt = emailConfirmationRepository.create.mock.calls[0][0];
        expect(attempt.sentAt).toEqual(now);
        expect(attempt.expiresAt).toEqual(new Date(now.getTime() + 600 * 1000));
      });

      it('sends the confirmation link to the user email after the transaction', async () => {
        let sentInTransaction: boolean | undefined;
        mailerService.send.mockImplementation(async () => {
          sentInTransaction = inTransaction;
        });

        await service.register(userDto);

        expect(mailerService.send).toHaveBeenCalledTimes(1);
        expect(mailerService.send).toHaveBeenCalledWith({
          to: userDto.email,
          subject: expect.any(String),
          text: expect.stringContaining(`${confirmUrl}?token=${token}`),
        });
        expect(sentInTransaction).toBe(false);
      });

      it('mentions the link lifetime in the email', async () => {
        await service.register(userDto);
        expect(mailerService.send.mock.calls[0][0].text).toContain(
          'expires in 10 minutes',
        );
      });

      it('keeps existing query params of REGISTRATION_CONFIRM_URL', async () => {
        config.REGISTRATION_CONFIRM_URL = `${confirmUrl}?lang=ru`;

        await service.register(userDto);

        expect(mailerService.send.mock.calls[0][0].text).toContain(
          `${confirmUrl}?lang=ru&token=${token}`,
        );
      });

      it('fails without sending email when REGISTRATION_CONFIRM_URL is unset', async () => {
        delete config.REGISTRATION_CONFIRM_URL;

        await expect(service.register(userDto)).rejects.toThrow(
          'REGISTRATION_CONFIRM_URL',
        );
        expect(mailerService.send).not.toHaveBeenCalled();
      });

      it('returns confirmation info without the token or its hash', async () => {
        const res = await service.register(userDto);
        const attempt = emailConfirmationRepository.create.mock.calls[0][0];
        expect(res).toEqual({
          confirmationRequired: true,
          method: 'magic_link',
          attemptId: attempt.id,
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        });
      });
    });

    describe('errors', () => {
      it('maps EmailAlreadyExistsError to ConflictException', async () => {
        usersRepository.create.mockRejectedValue(new EmailAlreadyExistsError());

        await expect(service.register(userDto)).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('rethrows unknown errors unchanged', async () => {
        const dbError = new Error('connection lost');
        usersRepository.create.mockRejectedValue(dbError);
        await expect(service.register(userDto)).rejects.toBe(dbError);
      });
    });
  });
});
