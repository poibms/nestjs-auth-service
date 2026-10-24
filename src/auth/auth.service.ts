import { ConflictException, Injectable } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import bcrypt from 'bcrypt';
import { UsersRepository, EmailAlreadyExistsError } from '#users/index.js';
import { User } from '../generated/prisma/client.js';

@Injectable()
export class AuthService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async register(
    registerDto: RegisterDto,
  ): Promise<Pick<User, 'id' | 'email' | 'status'>> {
    try {
      const { email, password } = registerDto;
      const passwordHash = await bcrypt.hash(password, 12);
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
