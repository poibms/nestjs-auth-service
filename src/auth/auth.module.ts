import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UsersModule } from '../users/users.module.js';
import { ConfirmationSecretService } from './confirmation/confirmation-secret.service.js';
import { EmailConfirmationAttemptsRepository } from './confirmation/email-confirmation-attempts.repository.js';

@Module({
  controllers: [AuthController],
  imports: [UsersModule],
  providers: [
    AuthService,
    ConfirmationSecretService,
    EmailConfirmationAttemptsRepository,
  ],
})
export class AuthModule {}
