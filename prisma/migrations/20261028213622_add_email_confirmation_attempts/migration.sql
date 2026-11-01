-- CreateEnum
CREATE TYPE "ConfirmationMethod" AS ENUM ('otp', 'magic_link');

-- CreateTable
CREATE TABLE "EmailConfirmationAttempt" (
    "id" UUID NOT NULL,
    "method" "ConfirmationMethod" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "secretHash" CHAR(64) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "userId" UUID NOT NULL,

    CONSTRAINT "EmailConfirmationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailConfirmationAttempt_secretHash_key" ON "EmailConfirmationAttempt"("secretHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConfirmationAttempt_userId_key" ON "EmailConfirmationAttempt"("userId");

-- AddForeignKey
ALTER TABLE "EmailConfirmationAttempt" ADD CONSTRAINT "EmailConfirmationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
