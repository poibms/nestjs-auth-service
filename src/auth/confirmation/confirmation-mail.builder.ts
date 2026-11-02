import { CONFIRMATION_TTL_SECONDS } from './confirmation.constants.js';
import { MailContent } from './confirmation.types.js';

const CONFIRMATION_TTL_MINUTES = CONFIRMATION_TTL_SECONDS / 60;

export function generateOtpMail(code: string): MailContent {
  return {
    text: `Hello! Here is your code for confirm account: ${code}. It expires in ${CONFIRMATION_TTL_MINUTES} minutes.`,
    subject: 'Code for account verification',
  };
}

export function generateMagicLinkMail(
  token: string,
  confirmUrl: string,
): MailContent {
  const url = new URL(confirmUrl);
  url.searchParams.set('token', token);

  return {
    text: `Hello, please visit ${url} to verify your account. The link expires in ${CONFIRMATION_TTL_MINUTES} minutes.`,
    subject: 'Magic url for account verification',
  };
}
