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
}
