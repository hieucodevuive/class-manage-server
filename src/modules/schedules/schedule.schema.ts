import { z } from 'zod';
import { DayOfWeek } from '../../generated/prisma/enums';

const scheduleTimeSchema = z.string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Giờ phải có định dạng HH:mm hoặc HH:mm:ss hợp lệ')
  .transform(value => value.length === 5 ? `${value}:00` : value);

const scheduleFieldsSchema = z.strictObject({
  dayOfWeek: z.enum(DayOfWeek),
  startTime: scheduleTimeSchema,
  endTime: scheduleTimeSchema,
});

export const createScheduleSchema = scheduleFieldsSchema.refine(data => data.endTime > data.startTime, {
  message: 'Giờ kết thúc phải sau giờ bắt đầu',
  path: ['endTime'],
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = scheduleFieldsSchema.partial()
  .refine(data => Object.keys(data).length > 0, 'Cần gửi ít nhất một trường để cập nhật')
  .refine(data => data.startTime === undefined || data.endTime === undefined || data.endTime > data.startTime, {
    message: 'Giờ kết thúc phải sau giờ bắt đầu',
    path: ['endTime'],
  });

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

export const scheduleIdSchema = z.string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
