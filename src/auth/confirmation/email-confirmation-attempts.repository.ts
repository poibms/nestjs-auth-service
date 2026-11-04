import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfirmationMethod } from '../../generated/prisma/enums.js';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { TransactionHost } from '@nestjs-cls/transactional';

@Injectable()
export class EmailConfirmationAttemptsRepository {
  constructor(
    private readonly transactionHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  async create(data: {
    id: string;
    userId: string;
    method: ConfirmationMethod;
    secretHash: string;
    expiresAt: Date;
    sentAt: Date;
  }) {
    await this.transactionHost.tx.emailConfirmationAttempt.create({ data });
  }

  async findOneById(id: string) {
    return await this.transactionHost.tx.emailConfirmationAttempt.findUnique({
      where: { id },
    });
  }

  async reserveOtpAttempt(
    attemptId: string,
    maxAttemptsCount: number,
    now: Date,
  ): Promise<boolean> {
    const { count } =
      await this.transactionHost.tx.emailConfirmationAttempt.updateMany({
        where: {
          id: attemptId,
          attempts: { lt: maxAttemptsCount },
          expiresAt: { gt: now },
          consumedAt: null,
        },
        data: { attempts: { increment: 1 } },
      });

    return count === 1;
  }

  async markConsumed(id: string, consumedAt: Date): Promise<boolean> {
    const { count } =
      await this.transactionHost.tx.emailConfirmationAttempt.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt },
      });

    return count === 1;
  }
}
