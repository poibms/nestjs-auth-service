import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema.js';
import { MailerService } from '../../mailer/mailer.service.js';
import { ConfirmationMethod } from '../../generated/prisma/enums.js';
import { EmailConfirmationAttempt } from '../../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { EmailConfirmationAttemptsRepository } from './email-confirmation-attempts.repository.js';
import {
  CONFIRMATION_TTL_SECONDS,
  MAX_OTP_ATTEMPTS_COUNT,
  RESEND_COOLDOWN_SECONDS,
} from './confirmation.constants.js';
import {
  ConfirmationRequiredResponse,
  MailContent,
  RegisteredUserResponse,
} from './confirmation.types.js';
import { ConfirmationSecretService } from './confirmation-secret.service.js';
import {
  generateMagicLinkMail,
  generateOtpMail,
} from './confirmation-mail.builder.js';
import { OtpConfirm } from '../dto/confirm-registration.dto.js';
import { UsersRepository } from '#users/users.repository.js';
import { TransactionHost } from '@nestjs-cls/transactional';

interface SecretStrategy {
  generate(): string;
  hash(attemptId: string, secret: string): string;
  buildMail(secret: string): MailContent;
}

@Injectable()
export class RegistrationConfirmationService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly emailConfirmationAttemptsRepository: EmailConfirmationAttemptsRepository,
    private readonly confirmationSecretService: ConfirmationSecretService,
    private readonly configService: ConfigService<Env, true>,
    private readonly usersRepository: UsersRepository,
    private readonly transactionHost: TransactionHost,
  ) {}

  async createAttempt(
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

  async confirmOtp({ attemptId, code }: OtpConfirm, now: Date) {
    const attempt =
      await this.emailConfirmationAttemptsRepository.findOneById(attemptId);
    if (attempt && this.isExhausted(attempt)) this.throwTooManyRequestsError();
    this.assertPending(attempt, 'otp', now);

    await this.reserveOtpAttempt(attempt.id, now);

    if (
      !this.confirmationSecretService.verifyOtp(
        attempt.id,
        code,
        attempt.secretHash,
      )
    ) {
      this.throwBadRequest();
    }

    return this.activate(attempt.id, attempt.userId, now);
  }

  async sendEmail(
    email: string,
    method: ConfirmationMethod,
    secret: string,
  ): Promise<void> {
    const mail = this.strategies[method].buildMail(secret);

    try {
      await this.mailerService.send({
        to: email,
        ...mail,
      });
    } catch (err) {
      if (err instanceof Error) {
        console.log('Failed to send confirmation email', err.message);
      }

      throw new ServiceUnavailableException(
        'Confirmation email could not be sent',
        { cause: err },
      );
    }
  }

  toResponse(
    method: ConfirmationMethod,
    attemptId: string,
  ): ConfirmationRequiredResponse {
    return {
      confirmationRequired: true,
      method,
      attemptId,
      expiresInSeconds: CONFIRMATION_TTL_SECONDS,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  private readonly strategies: Record<ConfirmationMethod, SecretStrategy> = {
    otp: {
      generate: () => this.confirmationSecretService.generateOtp(),
      hash: (attemptId, otp) =>
        this.confirmationSecretService.hashOtp(attemptId, otp),
      buildMail: (secret) => generateOtpMail(secret),
    },
    magic_link: {
      generate: () => this.confirmationSecretService.generateToken(),
      hash: (_attemptId, token) =>
        this.confirmationSecretService.hashToken(token),
      buildMail: (token) => generateMagicLinkMail(token, this.confirmUrl()),
    },
  };

  private confirmUrl(): string {
    return this.configService.get('REGISTRATION_CONFIRM_URL', {
      infer: true,
    });
  }

  private assertPending(
    attempt: EmailConfirmationAttempt | null,
    method: ConfirmationMethod,
    now: Date,
  ): asserts attempt is EmailConfirmationAttempt {
    if (
      !attempt ||
      attempt.method !== method ||
      attempt.consumedAt ||
      attempt.expiresAt <= now
    ) {
      this.throwBadRequest();
    }
  }

  private isExhausted(attempt: EmailConfirmationAttempt): boolean {
    return !attempt.consumedAt && attempt.attempts >= MAX_OTP_ATTEMPTS_COUNT;
  }

  private async reserveOtpAttempt(attemptId: string, now: Date): Promise<void> {
    const reserved =
      await this.emailConfirmationAttemptsRepository.reserveOtpAttempt(
        attemptId,
        MAX_OTP_ATTEMPTS_COUNT,
        now,
      );
    if (reserved) return;

    const current =
      await this.emailConfirmationAttemptsRepository.findOneById(attemptId);
    if (current && this.isExhausted(current)) this.throwTooManyRequestsError();
    this.throwBadRequest();
  }

  private activate(
    attemptId: string,
    userId: string,
    now: Date,
  ): Promise<RegisteredUserResponse> {
    return this.transactionHost.withTransaction(async () => {
      const isConsumed =
        await this.emailConfirmationAttemptsRepository.markConsumed(
          attemptId,
          now,
        );
      if (!isConsumed) this.throwBadRequest();

      const user = await this.usersRepository.markEmailVerified(userId);
      if (!user) this.throwBadRequest();

      return { id: user.id, email: user.email, status: user.status };
    });
  }

  private throwBadRequest(): never {
    throw new BadRequestException('Invalid or expired confirmation code');
  }

  private throwTooManyRequestsError(): never {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
