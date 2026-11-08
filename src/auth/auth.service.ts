import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
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
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  ConfirmationRequiredResponse,
  RegisteredUserResponse,
} from './confirmation/confirmation.types.js';
import { RegistrationConfirmationService } from './confirmation/registration-confirmation.service.js';
import { ConfirmDto } from './dto/confirm-registration.dto.js';
import { ResendType } from './dto/resend.dto.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly configService: ConfigService<Env, true>,
    private readonly registrationConfirmationService: RegistrationConfirmationService,
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
        const user = await this.createUser(email, passwordHash, 'active');
        this.logger.log({
          event: 'registration.succeeded',
          userId: user.id,
          status: user.status,
        });

        return { id: user.id, email: user.email, status: user.status };
      }

      const method = this.configService.get(
        'REGISTRATION_CONFIRMATION_METHOD',
        { infer: true },
      );
      return await this.registerWithConfirmation(email, passwordHash, method);
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        this.logger.warn({
          event: 'registration.failed',
          reason: 'email_taken',
        });
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
    const { attemptId, secret, userId } =
      await this.transactionHost.withTransaction(async () => {
        const user = await this.createUser(email, passwordHash, 'pending');
        const attempt =
          await this.registrationConfirmationService.createAttempt(
            user.id,
            method,
          );
        return { ...attempt, userId: user.id };
      });

    this.logger.log({
      event: 'registration.succeeded',
      userId: userId,
      status: 'pending',
    });

    await this.registrationConfirmationService.sendEmail({
      email,
      method,
      secret,
      attemptId,
    });

    return this.registrationConfirmationService.toResponse(method, attemptId);
  }

  async confirm(payload: ConfirmDto) {
    const now = new Date();
    if ('attemptId' in payload) {
      return await this.registrationConfirmationService.confirmOtp(
        payload,
        now,
      );
    } else {
      return await this.registrationConfirmationService.confirmMagicLink(
        payload,
        now,
      );
    }
  }

  async resend(resendDto: ResendType) {
    const user = await this.usersRepository.getUserByEmail(resendDto.email);
    if (user?.status !== 'pending') {
      this.logger.warn({
        event: 'resend.failed',
        reason: user ? 'not_pending' : 'not_found',
        userId: user?.id,
      });
      throw new BadRequestException(
        'Invalid email or account already confirmed',
      );
    }

    const { attemptId, method, secret } =
      await this.registrationConfirmationService.reissueAttempt(user.id);

    await this.registrationConfirmationService.sendEmail({
      email: user.email,
      method,
      secret,
      attemptId,
    });

    return this.registrationConfirmationService.toResponse(method, attemptId);
  }
}
