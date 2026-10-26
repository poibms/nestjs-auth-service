import { ConfigService } from '@nestjs/config';
import { EmailAlreadyExistsError, UsersRepository } from '#users/index.js';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { Mock } from 'vitest';
import bcrypt from 'bcrypt';
import { ConflictException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: { create: Mock<UsersRepository['create']> };

  const config: Record<string, unknown> = { BCRYPT_ROUNDS: 4 };

  const userDto: RegisterDto = {
    email: 'testemail@gmail.com',
    password: 'testPassword123',
  };

  beforeEach(async () => {
    usersRepository = { create: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: usersRepository },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    const userId = 'some-uuid';
    beforeEach(() => {
      usersRepository.create.mockResolvedValue({
        id: userId,
        email: userDto.email,
        passwordHash: '$2b$04$hash-from-db',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('passes email and active status to repository', async () => {
      await service.register(userDto);
      const invokeArgs = usersRepository.create.mock.calls[0][0];
      expect(usersRepository.create).toHaveBeenCalledTimes(1);
      expect(invokeArgs.email).toEqual(userDto.email);
      expect(invokeArgs.status).toEqual('active');
    });

    it('stores bcrypt hash instead of plain password', async () => {
      await service.register(userDto);
      const invokeArgs = usersRepository.create.mock.calls[0][0];
      expect(invokeArgs.passwordHash).not.toBe(userDto.password);
      expect(
        await bcrypt.compare(userDto.password, invokeArgs.passwordHash),
      ).toBe(true);
    });

    it('uses bcrypt rounds from config', async () => {
      await service.register(userDto);
      const invokeArgs = usersRepository.create.mock.calls[0][0];
      expect(invokeArgs.passwordHash.startsWith('$2b$04$')).toBe(true);
    });

    it('returns only id, email and status', async () => {
      const res = await service.register(userDto);
      expect(res).toEqual({
        id: userId,
        email: userDto.email,
        status: 'active',
      });
    });

    describe('errors', () => {
      it('maps EmailAlreadyExistsError to ConflictException', async () => {
        usersRepository.create.mockRejectedValue(new EmailAlreadyExistsError());

        await expect(service.register(userDto)).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('rethrows unknown errors unchanged', async () => {
        const dbError = new Error('connection lost');
        usersRepository.create.mockRejectedValue(dbError);
        await expect(service.register(userDto)).rejects.toBe(dbError);
      });
    });
  });
});
