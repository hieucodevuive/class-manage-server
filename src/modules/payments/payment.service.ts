import { Prisma } from '../../generated/prisma/client';
import { findOwnedEnrollment, findPaymentById, findPayments, insertPayment, updatePaymentById } from './payment.repository';
import type { CreatePaymentInput, ListPaymentsQuery, UpdatePaymentInput } from './payment.schema';

export async function createPayment(teacherId: number, data: CreatePaymentInput) {
  const enrollment = await findOwnedEnrollment(data.classStudentId, teacherId);

  if (!enrollment) {
    return { status: 'not_found' } as const;
  }

  const billingPeriod = new Date(`${data.billingPeriod.slice(0, 7)}-01T00:00:00.000Z`);
  const amountDue = data.amountDue === undefined
    ? enrollment.classRecord.tuitionFee
    : new Prisma.Decimal(data.amountDue);

  try {
    const payment = await insertPayment({
      // Kiểm tra quyền sở hữu lại khi connect; không chỉ dựa vào bước đọc trước đó.
      enrollment: {
        connect: { id: enrollment.id, classRecord: { teacherId }, student: { teacherId } },
      },
      billingPeriod,
      amountDue,
      paidAt: null,
      paymentMethod: null,
      note: data.note ?? null,
    });

    return { status: 'created', payment } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique trong DB bảo vệ cả hai request tạo cùng kỳ diễn ra đồng thời.
      if (error.code === 'P2002') {
        return { status: 'already_exists' } as const;
      }

      if (error.code === 'P2025' || error.code === 'P2003') {
        return { status: 'not_found' } as const;
      }
    }

    throw error;
  }
}

export function listPayments(teacherId: number, query: ListPaymentsQuery) {
  return findPayments(teacherId, {
    ...query,
    billingPeriod: query.billingPeriod === undefined
      ? undefined
      : new Date(`${query.billingPeriod.slice(0, 7)}-01T00:00:00.000Z`),
  });
}

export function getPaymentById(id: string, teacherId: number) {
  return findPaymentById(id, teacherId);
}

export async function updatePayment(id: string, teacherId: number, data: UpdatePaymentInput) {
  const existing = await findPaymentById(id, teacherId);

  if (!existing) {
    return { status: 'not_found' } as const;
  }

  const amountDue = data.amountDue === undefined
    ? existing.amountDue
    : new Prisma.Decimal(data.amountDue);
  const amountPaid = data.amountPaid === undefined
    ? existing.amountPaid
    : new Prisma.Decimal(data.amountPaid);
  const paymentMethod = data.paymentMethod === undefined
    ? existing.paymentMethod
    : data.paymentMethod;

  if (amountPaid.gt(0) && paymentMethod === null) {
    return { status: 'missing_payment_method' } as const;
  }

  // Khoản 0/0 là PAID tính được, nhưng chưa có tiền thu nên paidAt vẫn null.
  const paidAt = amountPaid.gt(0) && amountPaid.gte(amountDue)
    ? existing.paidAt ?? new Date()
    : null;
  const payment = await updatePaymentById(existing, teacherId, {
    amountDue: data.amountDue === undefined ? undefined : amountDue,
    amountPaid: data.amountPaid === undefined ? undefined : amountPaid,
    paymentMethod: data.paymentMethod,
    note: data.note,
    paidAt,
  });

  if (payment) {
    return { status: 'success', payment } as const;
  }

  // Phân biệt xung đột dữ liệu với bản ghi đã mất hoặc ngoài quyền truy cập.
  const current = await findPaymentById(id, teacherId);

  if (!current) {
    return { status: 'not_found' } as const;
  }

  return { status: 'conflict' } as const;
}
