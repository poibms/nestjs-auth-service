import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import { AuthService } from './auth.service.js';
import type { Response } from 'express';

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
}
