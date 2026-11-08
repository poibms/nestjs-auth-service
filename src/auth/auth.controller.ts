import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UsePipes,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import { AuthService } from './auth.service.js';
import type { Response } from 'express';
import {
  confirmEmailSchema,
  type ConfirmDto,
} from './dto/confirm-registration.dto.js';
import { ZodValidationPipe } from '#common/pipes/zod-validation.pipe.js';
import { resendSchema, type ResendType } from './dto/resend.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() userRegisterDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(userRegisterDto);
    if ('confirmationRequired' in result) {
      res.status(HttpStatus.ACCEPTED);
    }

    return result;
  }

  @Post('register/confirm')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(confirmEmailSchema))
  async confirm(@Body() dto: ConfirmDto) {
    return this.authService.confirm(dto);
  }

  @Post('register/resend')
  @HttpCode(202)
  @UsePipes(new ZodValidationPipe(resendSchema))
  async resend(@Body() resendDto: ResendType) {
    return this.authService.resend(resendDto);
  }
}
