import { MailMessage } from '../../mailer/mail-message.js';
import { ConfirmationMethod } from '../../generated/prisma/enums.js';
import z from 'zod';
import { userSchema } from '#users/dto/user.types.js';

export const confirmationRequiredSchema = z.object({
  confirmationRequired: z.literal(true),
  method: z.enum(ConfirmationMethod),
  attemptId: z.uuid(),
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
});

export type ConfirmationRequiredResponse = z.infer<
  typeof confirmationRequiredSchema
>;

export type MailContent = Omit<MailMessage, 'to'>;

export const registeredUserSchema = userSchema;

export type RegisteredUserResponse = z.infer<typeof registeredUserSchema>;

export type SendConfirmationEmailParams = {
  email: string;
  method: ConfirmationMethod;
  secret: string;
  attemptId: string;
};

export type ConfirmationFailureReason =
  | 'not_found'
  | 'method_mismatch'
  | 'consumed'
  | 'secret_replaced'
  | 'expired'
  | 'wrong_code'
  | 'exhausted'
  | 'resend_cooldown';
