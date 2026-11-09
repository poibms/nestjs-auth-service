import { createZodDto } from '#common/zod/create-zod-dto.js';
import z from 'zod';

export const registerSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).meta({
    format: 'email',
    maxLength: 254,
    example: 'user@example.com',
  }),
  password: z
    .string()
    .min(8)
    .regex(/\p{L}/u, 'Password must contain at least one letter')
    .regex(/\p{Nd}/u, 'Password must contain at least one digit')
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long')
    .meta({
      description:
        'At least 8 characters, one letter and one digit, at most 72 bytes in UTF-8',
      example: 'secret123',
    }),
});

export class RegisterDto extends createZodDto(registerSchema) {}
