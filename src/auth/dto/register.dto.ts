import { createZodDto } from '#common/zod/create-zod-dto.js';
import z from 'zod';

const registerSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z
    .string()
    .min(8)
    .regex(/\p{L}/u, 'Password must contain at least one letter')
    .regex(/\p{Nd}/u, 'Password must contain at least one digit')
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long'),
});

export class RegisterDto extends createZodDto(registerSchema) {}
