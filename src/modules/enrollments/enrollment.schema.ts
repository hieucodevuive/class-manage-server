import { z } from 'zod';
import { studentIdSchema } from '../students/student.schema';

const joinedAtSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return value >= '0001-01-01'
      && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value;
  }, 'Ngày không hợp lệ');

export const createEnrollmentSchema = z.strictObject({
  studentId: studentIdSchema,
  joinedAt: joinedAtSchema,
});

export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;
