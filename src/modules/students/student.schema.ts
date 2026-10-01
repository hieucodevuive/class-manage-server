import { z } from 'zod';

const dateOfBirthSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return value >= '0001-01-01'
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value;
  }, 'Ngày không hợp lệ');

const phoneSchema = z.string().trim().min(7).max(20)
  .regex(/^\+?[0-9][0-9 .()-]*$/, 'Số điện thoại không hợp lệ')
  .refine(value => value.replace(/\D/g, '').length >= 7, 'Số điện thoại cần ít nhất 7 chữ số');

const studentFieldsSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  phone: phoneSchema.nullable().optional(),
  parentName: z.string().trim().min(1).max(150).nullable().optional(),
  parentPhone: phoneSchema.nullable().optional(),
  school: z.string().trim().min(1).max(200).nullable().optional(),
  grade: z.number().int().min(1).max(12).nullable().optional(),
  dateOfBirth: dateOfBirthSchema.nullable().optional(),
  address: z.string().trim().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  note: z.string().trim().nullable().optional(),
});

export const createStudentSchema = studentFieldsSchema.extend({
  status: studentFieldsSchema.shape.status.default('ACTIVE'),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = studentFieldsSchema.partial()
  .refine(data => Object.keys(data).length > 0, 'Cần gửi ít nhất một trường để cập nhật');

export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const studentIdSchema = z.string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
