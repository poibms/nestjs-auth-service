import { CONFIRMATION_TTL_SECONDS } from './confirmation.constants.js';
import { MailContent } from './confirmation.types.js';
import { escapeHtml, renderLayout } from '../../mailer/templates/layout.js';

const CONFIRMATION_TTL_MINUTES = CONFIRMATION_TTL_SECONDS / 60;

const EXPIRES_TEXT = `It expires in ${CONFIRMATION_TTL_MINUTES} minutes.`;
const IGNORE_TEXT = "If you didn't sign up, you can safely ignore this email.";

const paragraph = (text: string, color = '#374151') =>
  `<p style="margin:0 0 16px;color:${color};">${escapeHtml(text)}</p>`;

export function generateOtpMail(code: string): MailContent {
  const subject = 'Your confirmation code';
  const intro = 'Use this code to confirm your email address:';

  const content = [
    paragraph(intro),
    `<p style="margin:0 0 16px;padding:16px;background-color:#f3f4f6;border-radius:8px;text-align:center;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:40px;font-weight:bold;letter-spacing:8px;color:#111827;">${escapeHtml(code)}</p>`,
    paragraph(EXPIRES_TEXT),
    paragraph(IGNORE_TEXT, '#6b7280'),
  ].join('\n');

  return {
    subject,
    text: `${intro} ${code}\n\n${EXPIRES_TEXT}\n\n${IGNORE_TEXT}`,
    html: renderLayout({
      title: 'Confirm your email',
      preheader: `Your confirmation code: ${code}`,
      content,
    }),
  };
}

export function generateMagicLinkMail(
  token: string,
  confirmUrl: string,
): MailContent {
  const url = new URL(confirmUrl);
  url.searchParams.set('token', token);
  const href = escapeHtml(url.toString());

  const subject = 'Confirm your email';
  const intro = 'Click the button below to confirm your email address.';
  const linkExpiresText = `The link expires in ${CONFIRMATION_TTL_MINUTES} minutes.`;

  const content = [
    paragraph(intro),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
      <tr>
        <td style="border-radius:6px;background-color:#2563eb;">
          <a href="${href}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Confirm email</a>
        </td>
      </tr>
    </table>`,
    paragraph(linkExpiresText),
    paragraph(
      "If the button doesn't work, copy this link into your browser:",
      '#6b7280',
    ),
    `<p style="margin:0 0 16px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${href}" target="_blank" style="color:#2563eb;">${href}</a></p>`,
    paragraph(IGNORE_TEXT, '#6b7280'),
  ].join('\n');

  return {
    subject,
    text: `${intro}\n\n${url.toString()}\n\n${linkExpiresText}\n\n${IGNORE_TEXT}`,
    html: renderLayout({
      title: 'Confirm your email',
      preheader: 'Confirm your email to finish signing up.',
      content,
    }),
  };
}
