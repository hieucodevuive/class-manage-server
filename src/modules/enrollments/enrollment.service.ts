import { Prisma } from '../../generated/prisma/client';
import type { CreateEnrollmentInput } from './enrollment.schema';
import {
  findClassEnrollments,
  findOwnedClass,
  findOwnedEnrollment,
  findOwnedStudent,
  insertEnrollment,
  markEnrollmentLeft,
} from './enrollment.repository';

export async function createEnrollment(classId: number, teacherId: number, data: CreateEnrollmentInput) {
  if (!await findOwnedClass(classId, teacherId)) {
    return { status: 'class_not_found' } as const;
  }

  if (!await findOwnedStudent(data.studentId, teacherId)) {
    return { status: 'student_not_found' } as const;
  }

  try {
    const enrollment = await insertEnrollment({
      classRecord: { connect: { id: classId, teacherId } },
      student: { connect: { id: data.studentId, teacherId } },
      joinedAt: new Date(`${data.joinedAt}T00:00:00.000Z`),
      leftAt: null,
      status: 'ACTIVE',
    });

    return { status: 'created', enrollment } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return { status: 'already_enrolled' } as const;
      }

      // Class/Student có thể bị xóa sau lúc kiểm tra; connect và FK vẫn bảo vệ dữ liệu.
      if (error.code === 'P2025' || error.code === 'P2003') {
        return { status: 'parent_not_found' } as const;
      }
    }

    throw error;
  }
}

export async function listClassEnrollments(classId: number, teacherId: number) {
  const classRecord = await findClassEnrollments(classId, teacherId);

  return classRecord
    ? { status: 'found', enrollments: classRecord.enrollments } as const
    : { status: 'not_found' } as const;
}

export async function leaveClass(classId: number, studentId: string, teacherId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const leftAt = new Date(`${today}T00:00:00.000Z`);
  const [enrollment] = await markEnrollmentLeft(classId, studentId, teacherId, leftAt);

  if (enrollment) {
    return { status: 'left', enrollment } as const;
  }

  const existing = await findOwnedEnrollment(classId, studentId, teacherId);

  if (!existing) {
    return { status: 'not_found' } as const;
  }

  // Gọi lại hoặc request đồng thời không được ghi đè ngày nghỉ và lịch sử cũ.
  if (existing.status === 'LEFT') {
    return { status: 'left', enrollment: existing } as const;
  }

  if (existing.joinedAt > leftAt) {
    return { status: 'invalid_leave_date' } as const;
  }

  // Ghi danh có thể được tạo sau truy vấn cập nhật; request này chưa tìm thấy nó lúc cập nhật.
  return { status: 'not_found' } as const;
}
