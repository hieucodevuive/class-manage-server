import type { ClassStudent, Student } from '../../generated/prisma/client';
import { serializeStudent } from '../students/student.response';

export function serializeEnrollment(enrollment: ClassStudent) {
  return {
    id: enrollment.id,
    classId: enrollment.classId,
    studentId: enrollment.studentId,
    joinedAt: enrollment.joinedAt.toISOString().slice(0, 10),
    leftAt: enrollment.leftAt?.toISOString().slice(0, 10) ?? null,
    status: enrollment.status,
    createdAt: enrollment.createdAt.toISOString(),
    updatedAt: enrollment.updatedAt.toISOString(),
  };
}

export function serializeEnrollmentWithStudent(enrollment: ClassStudent & { student: Student }) {
  return {
    ...serializeEnrollment(enrollment),
    student: serializeStudent(enrollment.student),
  };
}
