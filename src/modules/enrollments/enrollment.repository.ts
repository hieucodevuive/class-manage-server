import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export function findOwnedClass(classId: number, teacherId: number) {
  return prisma.class.findFirst({
    where: { id: classId, teacherId },
    select: { id: true },
  });
}

export function findOwnedStudent(studentId: string, teacherId: number) {
  return prisma.student.findFirst({
    where: { id: studentId, teacherId },
    select: { id: true },
  });
}

export function insertEnrollment(data: Prisma.ClassStudentCreateInput) {
  return prisma.classStudent.create({ data });
}

export function findClassEnrollments(classId: number, teacherId: number) {
  return prisma.class.findFirst({
    where: { id: classId, teacherId },
    select: {
      enrollments: {
        where: { student: { teacherId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { student: true },
      },
    },
  });
}

export function findOwnedEnrollment(classId: number, studentId: string, teacherId: number) {
  return prisma.classStudent.findFirst({
    where: {
      classId,
      studentId,
      classRecord: { teacherId },
      student: { teacherId },
    },
  });
}

export function markEnrollmentLeft(classId: number, studentId: string, teacherId: number, leftAt: Date) {
  return prisma.classStudent.updateManyAndReturn({
    where: {
      classId,
      studentId,
      classRecord: { teacherId },
      student: { teacherId },
      status: 'ACTIVE',
      joinedAt: { lte: leftAt },
    },
    data: { status: 'LEFT', leftAt },
  });
}
