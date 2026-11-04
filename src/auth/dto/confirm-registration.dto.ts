import z from 'zod';

const otpConfirmSchema = z.strictObject({
  attemptId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

const magicLinkConfirmSchema = z.strictObject({
  token: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const confirmEmailSchema = z.union([
  otpConfirmSchema,
  magicLinkConfirmSchema,
]);

export type OtpConfirm = z.infer<typeof otpConfirmSchema>;
export type MagicLinkConfirm = z.infer<typeof magicLinkConfirmSchema>;

export type ConfirmDto = OtpConfirm | MagicLinkConfirm;
