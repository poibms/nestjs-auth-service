import { ConfigService } from '@nestjs/config';
import { EmailAlreadyExistsError, UsersRepository } from '#users/index.js';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { Mock } from 'vitest';
import bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { RegistrationConfirmationService } from './confirmation/registration-confirmation.service.js';
import { ConfirmationRequiredResponse } from './confirmation/confirmation.types.js';
import { User } from '../generated/prisma/client.js';

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: {
    create: Mock<UsersRepository['create']>;
    getUserByEmail: Mock<UsersRepository['getUserByEmail']>;
  };
  let confirmationService: {
    createAttempt: Mock<RegistrationConfirmationService['createAttempt']>;
    sendEmail: Mock<RegistrationConfirmationService['sendEmail']>;
    toResponse: Mock<RegistrationConfirmationService['toResponse']>;
  };
  let transactionHost: {
    withTransaction: Mock<(fn: () => Promise<unknown>) => Promise<unknown>>;
  };

  let config: Record<string, unknown> = {};

  const userDto: RegisterDto = {
    email: 'testemail@gmail.com',
    password: 'testPassword123',
  };
  const userId = 'some-uuid';

  beforeEach(async () => {
    config = { BCRYPT_ROUNDS: 4 };
    usersRepository = { create: vi.fn(), getUserByEmail: vi.fn() };
    confirmationService = {
      createAttempt: vi.fn(),
      sendEmail: vi.fn(),
      toResponse: vi.fn(),
    };
    transactionHost = { withTransaction: vi.fn((fn) => fn()) };

    usersRepository.create.mockImplementation(async (data) => ({
      id: userId,
      email: data.email,
      passwordHash: data.passwordHash,
      status: data.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: usersRepository },
        {
          provide: RegistrationConfirmationService,
          useValue: confirmationService,
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        { provide: TransactionHost, useValue: transactionHost },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('resend', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ['not_found', null, undefined],
      ['not_pending', { id: userId, status: 'active' } as User, userId],
    ])(
      'rejects with 400 and logs %s without the email',
      async (reason, user, loggedUserId) => {
        const warnSpy = vi
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => {});
        usersRepository.getUserByEmail.mockResolvedValue(user);

        await expect(service.resend({ email: userDto.email })).rejects.toThrow(
          BadRequestException,
        );

        expect(warnSpy).toHaveBeenCalledWith({
          event: 'resend.failed',
          reason,
          userId: loggedUserId,
        });
        expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(userDto.email);
      },
    );
  });

  describe('register', () => {
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

    it('does not open transaction or start confirmation when confirmation is disabled', async () => {
      await service.register(userDto);
      expect(transactionHost.withTransaction).not.toHaveBeenCalled();
      expect(confirmationService.createAttempt).not.toHaveBeenCalled();
      expect(confirmationService.sendEmail).not.toHaveBeenCalled();
    });

    describe.each(['otp', 'magic_link'] as const)(
      'with %s confirmation enabled',
      (method) => {
        const secret = 'plain-secret';
        const attemptId = 'attempt-id';
        const response: ConfirmationRequiredResponse = {
          confirmationRequired: true,
          method,
          attemptId,
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        };
        let inTransaction: boolean;
        let calledInTransaction: {
          user?: boolean;
          attempt?: boolean;
          email?: boolean;
        };

        beforeEach(() => {
          config.REGISTRATION_CONFIRMATION_ENABLED = true;
          config.REGISTRATION_CONFIRMATION_METHOD = method;

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
          const createUser = usersRepository.create.getMockImplementation()!;
          usersRepository.create.mockImplementation(async (data) => {
            calledInTransaction.user = inTransaction;
            return createUser(data);
          });
          confirmationService.createAttempt.mockImplementation(async () => {
            calledInTransaction.attempt = inTransaction;
            return { attemptId, secret };
          });
          confirmationService.sendEmail.mockImplementation(async () => {
            calledInTransaction.email = inTransaction;
          });
          confirmationService.toResponse.mockReturnValue(response);
        });

        it('creates pending user with bcrypt hash of the password', async () => {
          await service.register(userDto);
          const user = usersRepository.create.mock.calls[0][0];
          expect(user).toMatchObject({
            email: userDto.email,
            status: 'pending',
          });
          expect(
            await bcrypt.compare(userDto.password, user.passwordHash),
          ).toBe(true);
        });

        it('creates attempt for the new user with configured method', async () => {
          await service.register(userDto);
          expect(confirmationService.createAttempt).toHaveBeenCalledWith(
            userId,
            method,
          );
        });

        it('creates user and attempt inside one transaction, sends email after it', async () => {
          await service.register(userDto);
          expect(transactionHost.withTransaction).toHaveBeenCalledTimes(1);
          expect(calledInTransaction).toEqual({
            user: true,
            attempt: true,
            email: false,
          });
        });

        it('sends the secret to the user email', async () => {
          await service.register(userDto);
          expect(confirmationService.sendEmail).toHaveBeenCalledWith({
            email: userDto.email,
            method,
            secret,
            attemptId,
          });
        });

        it('returns confirmation info for the attempt', async () => {
          const res = await service.register(userDto);
          expect(confirmationService.toResponse).toHaveBeenCalledWith(
            method,
            attemptId,
          );
          expect(res).toBe(response);
        });

        it('keeps committed user and attempt when email sending fails', async () => {
          const unavailable = new ServiceUnavailableException();
          confirmationService.sendEmail.mockRejectedValue(unavailable);

          await expect(service.register(userDto)).rejects.toBe(unavailable);
          await expect(
            transactionHost.withTransaction.mock.results[0].value,
          ).resolves.toBeDefined();
          expect(confirmationService.createAttempt).toHaveBeenCalledTimes(1);
        });

        it('maps EmailAlreadyExistsError to ConflictException without creating attempt', async () => {
          usersRepository.create.mockRejectedValue(
            new EmailAlreadyExistsError(),
          );

          await expect(service.register(userDto)).rejects.toBeInstanceOf(
            ConflictException,
          );
          expect(confirmationService.createAttempt).not.toHaveBeenCalled();
          expect(confirmationService.sendEmail).not.toHaveBeenCalled();
        });

        it('rethrows errors from the transaction unchanged without sending email', async () => {
          const dbError = new Error('connection lost');
          confirmationService.createAttempt.mockRejectedValue(dbError);

          await expect(service.register(userDto)).rejects.toBe(dbError);
          expect(confirmationService.sendEmail).not.toHaveBeenCalled();
        });
      },
    );

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
