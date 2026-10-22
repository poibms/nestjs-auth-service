import { Body, Controller, Post } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';

@Controller('auth')
export class AuthController {
  @Post('register')
  register(@Body() userRegisterDto: RegisterDto): void {
    return;
  }
}
