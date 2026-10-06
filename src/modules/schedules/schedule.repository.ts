import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export function findOwnedClass(classId: number, teacherId: number) {
  return prisma.class.findFirst({
    where: { id: classId, teacherId },
    select: { id: true },
  });
}

export function insertSchedule(data: Prisma.ClassScheduleCreateInput) {
  return prisma.classSchedule.create({ data });
}

export function findClassSchedules(classId: number, teacherId: number) {
  return prisma.class.findFirst({
    where: { id: classId, teacherId },
    select: {
      schedules: {
        orderBy: [
          { dayOfWeek: 'asc' },
          { startTime: 'asc' },
          { endTime: 'asc' },
          { id: 'asc' },
        ],
      },
    },
  });
}

export function findOwnedSchedule(classId: number, scheduleId: string, teacherId: number) {
  return prisma.classSchedule.findFirst({
    where: {
      id: scheduleId,
      classId,
      classRecord: { teacherId },
    },
  });
}

export async function updateScheduleById(
  classId: number,
  scheduleId: string,
  teacherId: number,
  data: Pick<Prisma.ClassScheduleUpdateInput, 'dayOfWeek' | 'startTime' | 'endTime'>,
) {
  try {
    return await prisma.classSchedule.update({
      where: { id: scheduleId, classId, classRecord: { teacherId } },
      data,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }

    throw error;
  }
}

export async function deleteScheduleById(classId: number, scheduleId: string, teacherId: number) {
  try {
    await prisma.classSchedule.delete({
      where: { id: scheduleId, classId, classRecord: { teacherId } },
    });

    return { status: 'deleted' } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { status: 'not_found' } as const;
    }

    throw error;
  }
}
