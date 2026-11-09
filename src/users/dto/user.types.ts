import z from 'zod';
import { UserStatus } from '../../generated/prisma/enums.js';

export const userSchema = z.object({
  id: z.uuidv7(),
  email: z.email(),
  status: z.enum(UserStatus),
});

export type UserDto = z.infer<typeof userSchema>;
  