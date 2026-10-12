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

export const updateProfileSchema = z.strictObject({
  name: z.string().trim()
    .min(1, 'Tên không được để trống')
    .max(150, 'Tên không được vượt quá 150 ký tự'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const registrationIdSchema = z.string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(value => Number.isSafeInteger(value) && value <= 2147483647);
