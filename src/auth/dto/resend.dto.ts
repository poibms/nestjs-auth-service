import z from 'zod';
import { registerSchema } from './register.dto.js';

export const resendSchema = registerSchema.pick({ email: true });

export type ResendType = z.infer<typeof resendSchema>;
