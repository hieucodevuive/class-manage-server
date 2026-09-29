import type { Class } from '../../generated/prisma/client';

export function serializeClass(classRecord: Class) {
  return {
    id: classRecord.id,
    name: classRecord.name,
    grade: classRecord.grade,
    schoolYear: classRecord.schoolYear,
    subject: classRecord.subject,
    tuitionFee: classRecord.tuitionFee.toFixed(2),
    startDate: classRecord.startDate.toISOString().slice(0, 10),
    endDate: classRecord.endDate?.toISOString().slice(0, 10) ?? null,
    status: classRecord.status,
    note: classRecord.note,
    createdAt: classRecord.createdAt.toISOString(),
    updatedAt: classRecord.updatedAt.toISOString(),
  };
}
