import type { ClassSchedule } from '../../generated/prisma/client';

export function serializeSchedule(schedule: ClassSchedule) {
  return {
    id: schedule.id,
    classId: schedule.classId,
    dayOfWeek: schedule.dayOfWeek,
    startTime: schedule.startTime.toISOString().slice(11, 19),
    endTime: schedule.endTime.toISOString().slice(11, 19),
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}
