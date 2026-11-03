import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema.js';
import { MailerService } from '../../mailer/mailer.service.js';
import { ConfirmationMethod } from '../../generated/prisma/enums.js';
import { randomUUID } from 'node:crypto';
import { EmailConfirmationAttemptsRepository } from './email-confirmation-attempts.repository.js';
import {
  CONFIRMATION_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
} from './confirmation.constants.js';
import {
  ConfirmationRequiredResponse,
  MailContent,
} from './confirmation.types.js';
import { ConfirmationSecretService } from './confirmation-secret.service.js';
import {
  generateMagicLinkMail,
  generateOtpMail,
} from './confirmation-mail.builder.js';

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
}
