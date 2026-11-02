import { ConflictException, Injectable } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import bcrypt from 'bcrypt';
import { UsersRepository, EmailAlreadyExistsError } from '#users/index.js';
import {
  ConfirmationMethod,
  User,
  UserStatus,
} from '../generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema.js';
import { ConfirmationSecretService } from './confirmation/confirmation-secret.service.js';
import { EmailConfirmationAttemptsRepository } from './confirmation/email-confirmation-attempts.repository.js';
import { randomUUID } from 'node:crypto';
import {
  CONFIRMATION_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
} from './confirmation/confirmation.constants.js';
import { TransactionHost } from '@nestjs-cls/transactional';
import { MailerService } from '../mailer/mailer.service.js';

export type RegisteredUserResponse = Pick<User, 'id' | 'email' | 'status'>;

interface SecretStrategy {
  generate(): string;
  hash(attemptId: string, secret: string): string;
}

export type ConfirmationRequiredResponse = {
  confirmationRequired: true;
  method: ConfirmationMethod;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly configService: ConfigService<Env, true>,
    private readonly confirmationSecretService: ConfirmationSecretService,
    private readonly emailConfirmationAttemptsRepository: EmailConfirmationAttemptsRepository,
    private readonly transactionHost: TransactionHost,
    private readonly mailerService: MailerService,
  ) {}

  async register(
    registerDto: RegisterDto,
  ): Promise<RegisteredUserResponse | ConfirmationRequiredResponse> {
    try {
      const { email, password } = registerDto;
      const rounds = this.configService.get('BCRYPT_ROUNDS', { infer: true });
      const passwordHash = await bcrypt.hash(password, rounds);

      if (
        !this.configService.get('REGISTRATION_CONFIRMATION_ENABLED', {
          infer: true,
        })
      ) {
        const user = await this.createUser(email, passwordHash, 'active');
        return { id: user.id, email: user.email, status: user.status };
      }

      const method = this.configService.get(
        'REGISTRATION_CONFIRMATION_METHOD',
        { infer: true },
      );
      return await this.registerWithConfirmation(email, passwordHash, method);
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
  }

  private createUser(
    email: string,
    passwordHash: string,
    status: UserStatus,
  ): Promise<User> {
    return this.usersRepository.create({ email, passwordHash, status });
  }

  private async registerWithConfirmation(
    email: string,
    passwordHash: string,
    method: ConfirmationMethod,
  ): Promise<ConfirmationRequiredResponse> {
    const { attemptId, secret } = await this.transactionHost.withTransaction(
      async () => {
        const user = await this.createUser(email, passwordHash, 'pending');
        return this.createConfirmationAttempt(user.id, method);
      },
    );

    await this.mailerService.send({
      subject: 'Email Confirmation',
      text: secret,
      to: email,
    });

    return {
      confirmationRequired: true,
      method,
      attemptId,
      expiresInSeconds: CONFIRMATION_TTL_SECONDS,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  private async createConfirmationAttempt(
    userId: string,
    method: ConfirmationMethod,
  ): Promise<{ attemptId: string; secret: string }> {
    const strategy = this.strategies[method];
    const attemptId = randomUUID();
    const secret = strategy.generate();
    const now = Date.now();

    await this.emailConfirmationAttemptsRepository.create({
      id: attemptId,
      secretHash: strategy.hash(attemptId, secret),
      method,
      userId,
      expiresAt: new Date(now + CONFIRMATION_TTL_SECONDS * 1000),
      sentAt: new Date(now),
    });

    return { attemptId, secret };
  }

  private readonly strategies: Record<ConfirmationMethod, SecretStrategy> = {
    otp: {
      generate: () => this.confirmationSecretService.generateOtp(),
      hash: (attemptId, otp) =>
        this.confirmationSecretService.hashOtp(attemptId, otp),
    },
    magic_link: {
      generate: () => this.confirmationSecretService.generateToken(),
      hash: (_attemptId, token) =>
        this.confirmationSecretService.hashToken(token),
    },
  };
}
