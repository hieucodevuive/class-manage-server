import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export function insertStudent(data: Prisma.StudentCreateInput) {
  return prisma.student.create({ data });
}

export function findStudents(teacherId: number) {
  return prisma.student.findMany({
    where: { teacherId },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

export function findStudentById(id: string, teacherId: number) {
  return prisma.student.findFirst({
    where: { id, teacherId },
  });
}

export async function updateStudentById(id: string, teacherId: number, data: Prisma.StudentUpdateInput) {
  try {
    return await prisma.student.update({
      where: { id, teacherId },
      data,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }

    throw error;
  }
}

export async function deleteStudentById(id: string, teacherId: number) {
  try {
    await prisma.student.delete({
      where: { id, teacherId },
    });

    return { status: 'deleted' } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 'not_found' } as const;
      }

      const adapterError = error.meta?.driverAdapterError as {
        cause?: { originalCode?: string; originalMessage?: string };
      } | undefined;

      // Khóa ngoại RESTRICT bảo vệ lịch sử, kể cả khi Enrollment vừa được tạo đồng thời.
      if (
        error.code === 'P2003'
        || (
          adapterError?.cause?.originalCode === '23503'
          && adapterError.cause.originalMessage?.includes('"ClassStudent_studentId_fkey"')
        )
      ) {
        return { status: 'has_enrollments' } as const;
      }
    }

    throw error;
  }
}
