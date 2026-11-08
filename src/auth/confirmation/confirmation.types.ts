import { MailMessage } from '../../mailer/mail-message.js';
import { ConfirmationMethod } from '../../generated/prisma/enums.js';
import { User } from '../../generated/prisma/client.js';

export type ConfirmationRequiredResponse = {
  confirmationRequired: true;
  method: ConfirmationMethod;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export type MailContent = Omit<MailMessage, 'to'>;

export type RegisteredUserResponse = Pick<User, 'id' | 'email' | 'status'>;

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
  | 'expired'
  | 'wrong_code'
  | 'exhausted'
  | 'resend_cooldown';
