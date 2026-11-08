import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConfirmationSecretService } from '../src/auth/confirmation/confirmation-secret.service.js';
import { EmailConfirmationAttemptsRepository } from '../src/auth/confirmation/email-confirmation-attempts.repository.js';
import { RegistrationConfirmationService } from '../src/auth/confirmation/registration-confirmation.service.js';
import { ConfirmationMethod } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Confirmation races with resend (e2e)', () => {
  const code = '123456';
  const token = 'stale-magic-link-token';
  const emails: string[] = [];

  let app: INestApplication;
  let prisma: PrismaService;
  let attempts: EmailConfirmationAttemptsRepository;
  let secrets: ConfirmationSecretService;
  let service: RegistrationConfirmationService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();

    prisma = app.get(PrismaService);
    attempts = app.get(EmailConfirmationAttemptsRepository);
    secrets = app.get(ConfirmationSecretService);
    service = app.get(RegistrationConfirmationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  const seed = async (method: ConfirmationMethod) => {
    const email = `race-${randomUUID()}@race.test`;
    emails.push(email);
    const user = await prisma.user.create({
      data: { email, passwordHash: 'unused', status: 'pending' },
    });
    const attemptId = randomUUID();
    const secretHash =
      method === 'otp'
        ? secrets.hashOtp(attemptId, code)
        : secrets.hashToken(token);

    await prisma.emailConfirmationAttempt.create({
      data: {
        id: attemptId,
        userId: user.id,
        method,
        secretHash,
        expiresAt: new Date(Date.now() + 600_000),
        sentAt: new Date(Date.now() - 3_600_000),
      },
    });

    return { attemptId, userId: user.id, secretHash };
  };

  const readState = async (attemptId: string, userId: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const attempt = await prisma.emailConfirmationAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    return {
      status: user.status,
      attempts: attempt.attempts,
      consumedAt: attempt.consumedAt,
    };
  };

  it('rejects an old code when resend lands before the reservation', async () => {
    const { attemptId, userId } = await seed('otp');
    const findOneById = attempts.findOneById.bind(attempts);
    vi.spyOn(attempts, 'findOneById').mockImplementationOnce(async (id) => {
      const attempt = await findOneById(id);
      await service.reissueAttempt(userId);
      return attempt;
    });

    await expect(
      service.confirmOtp({ attemptId, code }, new Date()),
    ).rejects.toMatchObject({ status: 400 });

    await expect(readState(attemptId, userId)).resolves.toEqual({
      status: 'pending',
      attempts: 0,
      consumedAt: null,
    });
  });

  it('rejects an old code when resend lands after the reservation', async () => {
    const { attemptId, userId } = await seed('otp');
    const reserve = attempts.reserveOtpAttempt.bind(attempts);
    vi.spyOn(attempts, 'reserveOtpAttempt').mockImplementationOnce(
      async (params) => {
        const reserved = await reserve(params);
        await service.reissueAttempt(userId);
        return reserved;
      },
    );

    await expect(
      service.confirmOtp({ attemptId, code }, new Date()),
    ).rejects.toMatchObject({ status: 400 });

    await expect(readState(attemptId, userId)).resolves.toMatchObject({
      status: 'pending',
      consumedAt: null,
    });
  });

  it('rejects an old magic link when resend lands before activation', async () => {
    const { attemptId, userId } = await seed('magic_link');
    const find = attempts.findOneBySecretHash.bind(attempts);
    vi.spyOn(attempts, 'findOneBySecretHash').mockImplementationOnce(
      async (hash) => {
        const attempt = await find(hash);
        await service.reissueAttempt(userId);
        return attempt;
      },
    );

    await expect(
      service.confirmMagicLink({ token }, new Date()),
    ).rejects.toMatchObject({ status: 400 });

    await expect(readState(attemptId, userId)).resolves.toMatchObject({
      status: 'pending',
      consumedAt: null,
    });
  });

  it('rechecks the secret after waiting for an uncommitted resend', async () => {
    const { attemptId, secretHash } = await seed('otp');
    let settled = false;
    let blocked = false;
    let consumed: Promise<boolean> | undefined;

    await prisma.$transaction(async (tx) => {
      await tx.emailConfirmationAttempt.update({
        where: { id: attemptId },
        data: { secretHash: 'f'.repeat(64) },
      });
      consumed = attempts
        .markConsumed({ id: attemptId, consumedAt: new Date(), secretHash })
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      blocked = !settled;
    });

    expect(blocked).toBe(true);
    await expect(consumed).resolves.toBe(false);
  });

  it('activates the user when no resend interferes', async () => {
    const { attemptId, userId } = await seed('otp');

    await expect(
      service.confirmOtp({ attemptId, code }, new Date()),
    ).resolves.toMatchObject({ id: userId, status: 'active' });

    await expect(readState(attemptId, userId)).resolves.toMatchObject({
      status: 'active',
      attempts: 1,
      consumedAt: expect.any(Date),
    });
  });
});
