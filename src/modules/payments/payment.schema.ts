import { z } from 'zod';
import { classIdSchema } from '../classes/class.schema';
import { studentIdSchema } from '../students/student.schema';

const billingPeriodSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return value >= '0001-01-01'
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value;
  }, 'Ngày không hợp lệ');

const amountDueSchema = z.union([
  z.string().trim(),
  z.number().nonnegative().transform(String),
]).pipe(z.string().regex(
  /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
  'Số tiền phải từ 0 đến 9999999999.99 và có tối đa 2 chữ số thập phân',
));

export const createPaymentSchema = z.strictObject({
  classStudentId: z.string().length(36, 'ID ghi danh phải là UUID hợp lệ').regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'ID ghi danh phải là UUID hợp lệ',
  ),
  billingPeriod: billingPeriodSchema,
  amountDue: amountDueSchema.optional(),
  note: z.string().trim().nullable().optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const listPaymentsQuerySchema = z.strictObject({
  classId: z.string()
    .refine(value => value.trim() === value, 'ID lớp không được có khoảng trắng')
    .pipe(classIdSchema)
    .optional(),
  studentId: studentIdSchema.length(36, 'ID học sinh phải là UUID hợp lệ').optional(),
  billingPeriod: billingPeriodSchema.optional(),
  status: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

export const paymentIdSchema = z.string()
  .length(36, 'ID học phí phải là UUID hợp lệ')
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'ID học phí phải là UUID hợp lệ',
  );

export const updatePaymentSchema = z.strictObject({
  amountDue: amountDueSchema.optional(),
  amountPaid: amountDueSchema.optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']).nullable().optional(),
  note: z.string().trim().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, 'Cần gửi ít nhất một trường để cập nhật');

export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
