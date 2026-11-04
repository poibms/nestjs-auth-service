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

  async markEmailVerified(userId: string) {
    try {
      const data = await this.transactionHost.tx.user.update({
        where: { id: userId, status: 'pending' },
        data: { status: 'active' },
      });
      return data;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      )
        return false;
      throw e;
    }
  }
}
