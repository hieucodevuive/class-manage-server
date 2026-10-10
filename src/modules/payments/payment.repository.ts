import { prisma } from '../../config/prisma';
import type { Payment, Prisma } from '../../generated/prisma/client';
import type { ListPaymentsQuery } from './payment.schema';

export function findOwnedEnrollment(classStudentId: string, teacherId: number) {
  return prisma.classStudent.findFirst({
    where: {
      id: classStudentId,
      classRecord: { teacherId },
      student: { teacherId },
    },
    select: {
      id: true,
      classRecord: { select: { tuitionFee: true } },
    },
  });
}

export function insertPayment(data: Prisma.PaymentCreateInput) {
  return prisma.payment.create({ data });
}

type PaymentListFilters = Omit<ListPaymentsQuery, 'billingPeriod'> & { billingPeriod?: Date };

export function findPayments(teacherId: number, filters: PaymentListFilters) {
  const where: Prisma.PaymentWhereInput = {
    enrollment: {
      classRecord: { teacherId },
      student: { teacherId },
      classId: filters.classId,
      studentId: filters.studentId,
    },
    billingPeriod: filters.billingPeriod,
  };

  // So sánh hai cột Decimal ngay trong DB; khoản 0/0 thuộc PAID.
  switch (filters.status) {
    case 'UNPAID':
      where.amountPaid = { equals: 0 };
      where.amountDue = { gt: 0 };
      break;
    case 'PARTIAL':
      where.amountPaid = { gt: 0, lt: prisma.payment.fields.amountDue };
      break;
    case 'PAID':
      where.amountPaid = { gte: prisma.payment.fields.amountDue };
      break;
  }

  return prisma.payment.findMany({
    where,
    orderBy: [{ billingPeriod: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
}

export function findPaymentById(id: string, teacherId: number) {
  return prisma.payment.findFirst({
    where: {
      id,
      enrollment: {
        classRecord: { teacherId },
        student: { teacherId },
      },
    },
  });
}

export async function updatePaymentById(
  existing: Payment,
  teacherId: number,
  data: Pick<Prisma.PaymentUpdateManyMutationInput, 'amountDue' | 'amountPaid' | 'paidAt' | 'paymentMethod' | 'note'>,
) {
  // Đối chiếu toàn bộ bản ghi đã đọc, gồm null và Decimal; chỉ ghi nếu chưa thay đổi.
  const payments = await prisma.payment.updateManyAndReturn({
    where: {
      id: existing.id,
      classStudentId: existing.classStudentId,
      billingPeriod: existing.billingPeriod,
      amountDue: existing.amountDue,
      amountPaid: existing.amountPaid,
      paidAt: existing.paidAt,
      paymentMethod: existing.paymentMethod,
      note: existing.note,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      enrollment: {
        classRecord: { teacherId },
        student: { teacherId },
      },
    },
    data,
  });

  return payments[0] ?? null;
}
