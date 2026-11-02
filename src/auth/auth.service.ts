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
import { TransactionHost } from '@nestjs-cls/transactional';
import { ConfirmationRequiredResponse } from './confirmation/confirmation.types.js';
import { RegistrationConfirmationService } from './confirmation/registration-confirmation.service.js';

export type RegisteredUserResponse = Pick<User, 'id' | 'email' | 'status'>;

@Injectable()
export class AuthService {
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
        return this.registrationConfirmationService.createAttempt(
          user.id,
          method,
        );
      },
    );

    await this.registrationConfirmationService.sendEmail(email, method, secret);

    return this.registrationConfirmationService.toResponse(method, attemptId);
  }
}
