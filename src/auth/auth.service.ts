import { ConflictException, Injectable } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import bcrypt from 'bcrypt';
import { UsersRepository, EmailAlreadyExistsError } from '#users/index.js';
import { User } from '../generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async register(
    registerDto: RegisterDto,
  ): Promise<Pick<User, 'id' | 'email' | 'status'>> {
    try {
      const { email, password } = registerDto;
      const rounds = this.configService.get('BCRYPT_ROUNDS', { infer: true });
      const passwordHash = await bcrypt.hash(password, rounds);
      const registeredUser = await this.usersRepository.create({
        email,
        passwordHash,
        status: 'active',
      });

      return { id: registeredUser.id, email, status: registeredUser.status };
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ConflictException('Email is already registered');
      }
      throw err;
    }
  }
}
