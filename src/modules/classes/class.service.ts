import { Prisma } from '../../generated/prisma/client';
import type { CreateClassInput, UpdateClassInput } from './class.schema';
import {
  deleteClassById,
  findClassById,
  findClasses,
  insertClass,
  updateClassById,
} from './class.repository';

export function createClass(data: CreateClassInput) {
  return insertClass({
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

export function listClasses() {
  return findClasses();
}

export function getClassById(id: number) {
  return findClassById(id);
}

export async function updateClass(id: number, data: UpdateClassInput) {
  const existingClass = await findClassById(id);

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
    const classRecord = await updateClassById(id, {
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

export function deleteClass(id: number) {
  return deleteClassById(id);
}
