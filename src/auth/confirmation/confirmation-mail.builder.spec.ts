import {
  generateMagicLinkMail,
  generateOtpMail,
} from './confirmation-mail.builder.js';

describe('confirmation mail builder', () => {
  describe('generateOtpMail', () => {
    it('contains the code and its lifetime', () => {
      const { subject, text } = generateOtpMail('123456');

      expect(subject).not.toBe('');
      expect(text).toContain('123456');
      expect(text).toContain('expires in 10 minutes');
    });
  });

  describe('generateMagicLinkMail', () => {
    const confirmUrl = 'http://localhost:5173/confirm-email';

    it('contains confirmation url with token and its lifetime', () => {
      const { subject, text } = generateMagicLinkMail('token', confirmUrl);

      expect(subject).not.toBe('');
      expect(text).toContain(`${confirmUrl}?token=token`);
      expect(text).toContain('expires in 10 minutes');
    });

    it('keeps existing query params of confirm url', () => {
      const { text } = generateMagicLinkMail('token', `${confirmUrl}?lang=ru`);

      expect(text).toContain(`${confirmUrl}?lang=ru&token=token`);
    });

    it('url-encodes the token', () => {
      const { text } = generateMagicLinkMail('a+b/c=', confirmUrl);

      expect(text).toContain(`${confirmUrl}?token=a%2Bb%2Fc%3D`);
    });
  });
});
