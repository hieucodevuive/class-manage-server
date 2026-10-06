import { Prisma } from '../../generated/prisma/client';
import type { CreateScheduleInput, UpdateScheduleInput } from './schedule.schema';
import {
  deleteScheduleById,
  findClassSchedules,
  findOwnedClass,
  findOwnedSchedule,
  insertSchedule,
  updateScheduleById,
} from './schedule.repository';

export async function createSchedule(classId: number, teacherId: number, data: CreateScheduleInput) {
  if (!await findOwnedClass(classId, teacherId)) {
    return { status: 'class_not_found' } as const;
  }

  try {
    // Prisma dùng DateTime cho TIME; mốc UTC cố định giúp giữ nguyên giờ nhập.
    const schedule = await insertSchedule({
      classRecord: { connect: { id: classId, teacherId } },
      dayOfWeek: data.dayOfWeek,
      startTime: new Date(`1970-01-01T${data.startTime}.000Z`),
      endTime: new Date(`1970-01-01T${data.endTime}.000Z`),
    });

    return { status: 'created', schedule } as const;
  } catch (error) {
    // Lớp có thể bị xóa sau bước kiểm tra; connect và FK vẫn kiểm tra khi lưu.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return { status: 'class_not_found' } as const;
    }

    throw error;
  }
}

export async function listClassSchedules(classId: number, teacherId: number) {
  const classRecord = await findClassSchedules(classId, teacherId);

  return classRecord
    ? { status: 'found', schedules: classRecord.schedules } as const
    : { status: 'not_found' } as const;
}

export async function getScheduleById(classId: number, scheduleId: string, teacherId: number) {
  return findOwnedSchedule(classId, scheduleId, teacherId);
}

export async function updateSchedule(
  classId: number,
  scheduleId: string,
  teacherId: number,
  data: UpdateScheduleInput,
) {
  const existing = await findOwnedSchedule(classId, scheduleId, teacherId);

  if (!existing) {
    return { status: 'not_found' } as const;
  }

  const startTime = data.startTime === undefined
    ? existing.startTime
    : new Date(`1970-01-01T${data.startTime}.000Z`);
  const endTime = data.endTime === undefined
    ? existing.endTime
    : new Date(`1970-01-01T${data.endTime}.000Z`);

  if (endTime <= startTime) {
    return { status: 'invalid_times' } as const;
  }

  try {
    const schedule = await updateScheduleById(classId, scheduleId, teacherId, {
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime === undefined ? undefined : startTime,
      endTime: data.endTime === undefined ? undefined : endTime,
    });

    return schedule
      ? { status: 'success', schedule } as const
      : { status: 'not_found' } as const;
  } catch (error) {
    // CHECK vẫn bảo vệ giờ học nếu bản ghi được cập nhật đồng thời sau lúc đọc.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const adapterError = error.meta?.driverAdapterError as {
        cause?: { originalCode?: string; originalMessage?: string };
      } | undefined;

      if (
        adapterError?.cause?.originalCode === '23514'
        && adapterError.cause.originalMessage?.includes('"ClassSchedule_times_check"')
      ) {
        return { status: 'invalid_times' } as const;
      }
    }

    throw error;
  }
}

export function deleteSchedule(classId: number, scheduleId: string, teacherId: number) {
  return deleteScheduleById(classId, scheduleId, teacherId);
}
