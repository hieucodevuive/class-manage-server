import type { Payment } from '../../generated/prisma/client';

export function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    classStudentId: payment.classStudentId,
    billingPeriod: payment.billingPeriod.toISOString().slice(0, 10),
    amountDue: payment.amountDue.toFixed(2),
    amountPaid: payment.amountPaid.toFixed(2),
    paidAt: payment.paidAt?.toISOString() ?? null,
    paymentMethod: payment.paymentMethod,
    note: payment.note,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export function serializePaymentWithStatus(payment: Payment) {
  const status = payment.amountPaid.gte(payment.amountDue)
    ? 'PAID'
    : payment.amountPaid.isZero() ? 'UNPAID' : 'PARTIAL';

  return { ...serializePayment(payment), status };
}
