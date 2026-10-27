import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersRepository } from './users.repository.js';
import { Mock } from 'vitest';
import { UserStatus } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { EmailAlreadyExistsError } from './errors/email-already-exists.error.js';

describe('UsersRepository', () => {
  let repository: UsersRepository;
  let prismaService: {
    user: { create: Mock<PrismaService['user']['create']> };
  };

  const createData: Parameters<UsersRepository['create']>[0] = {
    email: 'testemail@gmail.com',
    passwordHash: 'passwordHash',
    status: 'active',
  };

  beforeEach(async () => {
    prismaService = { user: { create: vi.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    repository = moduleRef.get(UsersRepository);
  });

  describe('create', () => {
    const userId = 'some-uuid';
    const createdUser = {
      id: userId,
      email: createData.email,
      passwordHash: '$2b$04$hash-from-db',
      status: 'active' as UserStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      prismaService.user.create.mockResolvedValue(createdUser);
    });

    it('returns created user', async () => {
      const result = await repository.create(createData);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: createData,
      });
      expect(result).toBe(createdUser);
    });

    describe('errors', () => {
      it('maps P2002 to EmailAlreadyExistsError', async () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        );

        prismaService.user.create.mockRejectedValue(error);
        await expect(repository.create(createData)).rejects.toBeInstanceOf(
          EmailAlreadyExistsError,
        );
      });

      it('rethrows other Prisma errors unchanged', async () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2003',
            clientVersion: 'test',
          },
        );
        prismaService.user.create.mockRejectedValue(error);
        await expect(repository.create(createData)).rejects.toBe(error);
      });

      it('rethrows non-Prisma errors unchanged', async () => {
        const error = new Error('connection lost');

        prismaService.user.create.mockRejectedValue(error);
        await expect(repository.create(createData)).rejects.toBe(error);
      });
    });
  });
});
