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

  async findOneByUserId(userId: string) {
    return await this.transactionHost.tx.emailConfirmationAttempt.findUnique({
      where: { userId },
    });
  }

  async findOneBySecretHash(hashedToken: string) {
    return await this.transactionHost.tx.emailConfirmationAttempt.findUnique({
      where: { secretHash: hashedToken },
    });
  }

  async reserveOtpAttempt({
    attemptId,
    maxAttemptsCount,
    now,
    secretHash,
  }: {
    attemptId: string;
    maxAttemptsCount: number;
    now: Date;
    secretHash: string;
  }): Promise<boolean> {
    const { count } =
      await this.transactionHost.tx.emailConfirmationAttempt.updateMany({
        where: {
          id: attemptId,
          attempts: { lt: maxAttemptsCount },
          expiresAt: { gt: now },
          consumedAt: null,
          secretHash,
        },
        data: { attempts: { increment: 1 } },
      });

    return count === 1;
  }

  async markConsumed({
    id,
    consumedAt,
    secretHash,
  }: {
    id: string;
    consumedAt: Date;
    secretHash: string;
  }): Promise<boolean> {
    const { count } =
      await this.transactionHost.tx.emailConfirmationAttempt.updateMany({
        where: { id, consumedAt: null, secretHash },
        data: { consumedAt },
      });

    return count === 1;
  }

  async replaceSecret({
    expiresAt,
    id,
    secretHash,
    now,
    sentBefore,
  }: {
    id: string;
    secretHash: string;
    expiresAt: Date;
    now: Date;
    sentBefore: Date;
  }): Promise<boolean> {
    const { count } =
      await this.transactionHost.tx.emailConfirmationAttempt.updateMany({
        where: { id, consumedAt: null, sentAt: { lte: sentBefore } },
        data: { secretHash, attempts: 0, expiresAt, sentAt: now },
      });

    return count === 1;
  }
}
