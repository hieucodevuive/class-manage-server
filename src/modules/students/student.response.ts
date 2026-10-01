import type { Student } from '../../generated/prisma/client';

export function serializeStudent(student: Student) {
  return {
    id: student.id,
    fullName: student.fullName,
    phone: student.phone,
    parentName: student.parentName,
    parentPhone: student.parentPhone,
    school: student.school,
    grade: student.grade,
    dateOfBirth: student.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    address: student.address,
    status: student.status,
    note: student.note,
    createdAt: student.createdAt.toISOString(),
    updatedAt: student.updatedAt.toISOString(),
  };
}
