import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { RegisterDto, registerSchema } from './dto/register.dto.js';
import { AuthService } from './auth.service.js';
import type { Response } from 'express';
import {
  confirmEmailSchema,
  type ConfirmDto,
} from './dto/confirm-registration.dto.js';
import { resendSchema, type ResendType } from './dto/resend.dto.js';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  confirmationRequiredSchema,
  registeredUserSchema,
} from './confirmation/confirmation.types.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiCreatedResponse({
    standardSchema: registeredUserSchema,
    description: 'User registered',
  })
  @ApiAcceptedResponse({
    standardSchema: confirmationRequiredSchema,
    description: 'Confirmation email sent',
  })
  @ApiBadRequestResponse({ description: 'Invalid email or password' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many registration requests' })
  @ApiServiceUnavailableResponse({
    description: 'Confirmation email could not be sent',
  })
  @UseGuards(ThrottlerGuard)
  @Post('register')
  async register(
    @Body({ schema: registerSchema }) userRegisterDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(userRegisterDto);
    if ('confirmationRequired' in result) {
      res.status(HttpStatus.ACCEPTED);
    }

    return result;
  }

  @ApiOkResponse({
    standardSchema: registeredUserSchema,
    description: 'Email confirmed, user activated',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid body, wrong code or token, attempt not found, consumed or expired',
  })
  @ApiTooManyRequestsResponse({ description: 'Code attempts exhausted' })
  @Post('register/confirm')
  @HttpCode(200)
  async confirm(@Body({ schema: confirmEmailSchema }) dto: ConfirmDto) {
    return this.authService.confirm(dto);
  }

  @ApiAcceptedResponse({
    standardSchema: confirmationRequiredSchema,
    description: 'New confirmation email sent',
  })
  @ApiBadRequestResponse({
    description: 'Invalid email or account already confirmed',
  })
  @ApiTooManyRequestsResponse({
    description: 'Resend cooldown is active or too many requests',
  })
  @ApiServiceUnavailableResponse({
    description: 'Confirmation email could not be sent',
  })
  @UseGuards(ThrottlerGuard)
  @Post('register/resend')
  @HttpCode(202)
  async resend(@Body({ schema: resendSchema }) resendDto: ResendType) {
    return this.authService.resend(resendDto);
  }
}
