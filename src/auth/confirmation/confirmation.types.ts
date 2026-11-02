import { MailMessage } from '../../mailer/mail-message.js';
import { ConfirmationMethod } from '../../generated/prisma/enums.js';

export type ConfirmationRequiredResponse = {
  confirmationRequired: true;
  method: ConfirmationMethod;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export type MailContent = Omit<MailMessage, 'to'>;
