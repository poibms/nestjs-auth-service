import { ConflictException, Injectable } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import bcrypt from 'bcrypt';
import { UsersRepository, EmailAlreadyExistsError } from '#users/index.js';
import { ConfirmationMethod, User } from '../generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema.js';
import { ConfirmationSecretService } from './confirmation/confirmation-secret.service.js';
import { EmailConfirmationAttemptsRepository } from './confirmation/email-confirmation-attempts.repository.js';
import { randomUUID } from 'node:crypto';
import {
  CONFIRMATION_DELAY_SECONDS,
  OTP_TTL_SECONDS,
} from './confirmation/confirmation.constants.js';
import { TransactionHost } from '@nestjs-cls/transactional';

export type RegisteredUserResponse = Pick<User, 'id' | 'email' | 'status'>;

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
        return await this.registerActive(email, passwordHash);
      }

      const method = this.configService.get(
        'REGISTRATION_CONFIRMATION_METHOD',
        { infer: true },
      );
      if (method === 'otp') {
        return await this.registerWithOtp(email, passwordHash);
      }

      throw new Error(`Unsupported confirmation method: ${method}`);
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
  }

  private async registerActive(
    email: string,
    passwordHash: string,
  ): Promise<RegisteredUserResponse> {
    const user = await this.usersRepository.create({
      email,
      passwordHash,
      status: 'active',
    });

    return { id: user.id, email: user.email, status: user.status };
  }

  private async registerWithOtp(
    email: string,
    passwordHash: string,
  ): Promise<ConfirmationRequiredResponse> {
    const { attemptId } = await this.transactionHost.withTransaction(
      async () => {
        const user = await this.usersRepository.create({
          email,
          passwordHash,
          status: 'pending',
        });
        return this.saveOtp(user.id);
      },
    );
    // TODO: send code

    return {
      confirmationRequired: true,
      method: 'otp',
      attemptId,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: CONFIRMATION_DELAY_SECONDS,
    };
  }

  private async saveOtp(
    userId: string,
  ): Promise<{ attemptId: string; code: string }> {
    const attemptId = randomUUID();

    const otp = this.confirmationSecretService.generateOtp();
    const hashedOtp = this.confirmationSecretService.hashOtp(attemptId, otp);

    const now = Date.now();

    await this.emailConfirmationAttemptsRepository.create({
      id: attemptId,
      secretHash: hashedOtp,
      method: 'otp',
      userId,
      expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
      sentAt: new Date(now),
    });

    return { attemptId, code: otp };
  }
}
