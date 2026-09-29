import { z } from 'zod';

const classDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return value >= '0001-01-01'
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value;
  }, 'Ngày không hợp lệ');

const tuitionFeeSchema = z.union([
  z.string().trim(),
  z.number().nonnegative().transform(String),
]).pipe(z.string().regex(
  /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
  'Học phí phải từ 0 đến 9999999999.99 và có tối đa 2 chữ số thập phân',
));

const classFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  grade: z.number().int().min(1).max(12),
  schoolYear: z.string().trim()
    .regex(/^\d{4}-\d{4}$/, 'Năm học phải có định dạng YYYY-YYYY')
    .refine(value => {
      const startYear = Number(value.slice(0, 4));
      const endYear = Number(value.slice(5));
      return startYear >= 1 && endYear === startYear + 1;
    }, 'Năm kết thúc phải bằng năm bắt đầu cộng 1'),
  subject: z.string().trim().min(1).max(100),
  tuitionFee: tuitionFeeSchema,
  startDate: classDateSchema,
  endDate: classDateSchema.nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'COMPLETED']),
  note: z.string().trim().nullable().optional(),
});

export const createClassSchema = classFieldsSchema.extend({
  status: classFieldsSchema.shape.status.default('ACTIVE'),
}).refine(data => !data.endDate || data.endDate >= data.startDate, {
  message: 'Ngày kết thúc không được trước ngày bắt đầu',
  path: ['endDate'],
});

export type CreateClassInput = z.infer<typeof createClassSchema>;

export const updateClassSchema = classFieldsSchema.partial()
  .refine(data => Object.keys(data).length > 0, 'Cần gửi ít nhất một trường để cập nhật')
  .refine(data => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    message: 'Ngày kết thúc không được trước ngày bắt đầu',
    path: ['endDate'],
  });

export type UpdateClassInput = z.infer<typeof updateClassSchema>;

export const classIdSchema = z.string()
  .regex(/^[0-9]+$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(2147483647));
