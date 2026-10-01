import { Prisma } from '../../generated/prisma/client';
import type { CreateClassInput, UpdateClassInput } from './class.schema';
import {
  deleteClassById,
  findClassById,
  findClasses,
  insertClass,
  updateClassById,
} from './class.repository';

export function createClass(data: CreateClassInput, teacherId: number) {
  return insertClass({
    teacher: { connect: { id: teacherId } },
    name: data.name,
    grade: data.grade,
    schoolYear: data.schoolYear,
    subject: data.subject,
    tuitionFee: new Prisma.Decimal(data.tuitionFee),
    startDate: new Date(`${data.startDate}T00:00:00.000Z`),
    endDate: data.endDate ? new Date(`${data.endDate}T00:00:00.000Z`) : null,
    status: data.status,
    note: data.note ?? null,
  });
}

export function listClasses(teacherId: number) {
  return findClasses(teacherId);
}

export function getClassById(id: number, teacherId: number) {
  return findClassById(id, teacherId);
}

export async function updateClass(id: number, teacherId: number, data: UpdateClassInput) {
  const existingClass = await findClassById(id, teacherId);

  if (!existingClass) {
    return { status: 'not_found' } as const;
  }

  const startDate = data.startDate !== undefined
    ? new Date(`${data.startDate}T00:00:00.000Z`)
    : existingClass.startDate;
  const endDate = data.endDate === undefined
    ? existingClass.endDate
    : data.endDate === null ? null : new Date(`${data.endDate}T00:00:00.000Z`);

  if (endDate && endDate < startDate) {
    return { status: 'invalid_dates' } as const;
  }

  try {
    const classRecord = await updateClassById(id, teacherId, {
      ...data,
      tuitionFee: data.tuitionFee === undefined ? undefined : new Prisma.Decimal(data.tuitionFee),
      startDate: data.startDate === undefined ? undefined : startDate,
      endDate: data.endDate === undefined ? undefined : endDate,
    });

    return classRecord
      ? { status: 'success', classRecord } as const
      : { status: 'not_found' } as const;
  } catch (error) {
    // Database vẫn bảo vệ ràng buộc ngày nếu có cập nhật đồng thời.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const adapterError = error.meta?.driverAdapterError as {
        cause?: { originalCode?: string; originalMessage?: string };
      } | undefined;

      if (
        adapterError?.cause?.originalCode === '23514'
        && adapterError.cause.originalMessage?.includes('"Class_dates_check"')
      ) {
        return { status: 'invalid_dates' } as const;
      }
    }

    throw error;
  }
}

export function deleteClass(id: number, teacherId: number) {
  return deleteClassById(id, teacherId);
}
