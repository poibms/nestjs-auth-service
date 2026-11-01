import { Prisma, User, UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Injectable } from '@nestjs/common';
import { EmailAlreadyExistsError } from './errors/email-already-exists.error.js';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';

@Injectable()
export class UsersRepository {
  constructor(
    private readonly transactionHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  async create(data: {
    email: string;
    passwordHash: string;
    status: UserStatus;
  }): Promise<User> {
    try {
      return await this.transactionHost.tx.user.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new EmailAlreadyExistsError();
        }
      }
      throw error;
    }
  }
}
