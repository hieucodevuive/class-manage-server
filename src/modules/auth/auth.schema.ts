import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
});

export const registerSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(12).refine(
    value => Buffer.byteLength(value, 'utf8') <= 72,
    'Mật khẩu không được vượt quá 72 byte',
  ),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const registrationIdSchema = z.string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(value => Number.isSafeInteger(value) && value <= 2147483647);
