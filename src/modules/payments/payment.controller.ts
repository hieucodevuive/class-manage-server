import type { RequestHandler } from 'express';
import { serializePayment, serializePaymentWithStatus } from './payment.response';
import { createPaymentSchema, listPaymentsQuerySchema, paymentIdSchema, updatePaymentSchema } from './payment.schema';
import { createPayment, getPaymentById, listPayments, updatePayment } from './payment.service';

export const createPaymentController: RequestHandler = async (req, res) => {
  const bodyResult = createPaymentSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin học phí không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const result = await createPayment(res.locals.auth.userId, bodyResult.data);

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy ghi danh' });
    return;
  }

  if (result.status === 'already_exists') {
    res.status(409).json({ success: false, message: 'Học phí của ghi danh trong tháng này đã tồn tại' });
    return;
  }

  res.status(201).json({
    success: true,
    message: 'Tạo học phí thành công',
    data: { payment: serializePayment(result.payment) },
  });
};

export const listPaymentsController: RequestHandler = async (req, res) => {
  const queryResult = listPaymentsQuerySchema.safeParse(req.query);

  if (!queryResult.success) {
    res.status(400).json({
      success: false,
      message: 'Bộ lọc học phí không hợp lệ',
      errors: queryResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'query',
        message: issue.message,
      })),
    });
    return;
  }

  const payments = await listPayments(res.locals.auth.userId, queryResult.data);
  res.status(200).json({
    success: true,
    data: { payments: payments.map(serializePaymentWithStatus) },
  });
};

export const getPaymentByIdController: RequestHandler = async (req, res) => {
  const idResult = paymentIdSchema.safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({ success: false, message: 'ID học phí phải là UUID hợp lệ' });
    return;
  }

  const payment = await getPaymentById(idResult.data, res.locals.auth.userId);

  if (!payment) {
    res.status(404).json({ success: false, message: 'Không tìm thấy học phí' });
    return;
  }

  res.status(200).json({
    success: true,
    data: { payment: serializePaymentWithStatus(payment) },
  });
};

export const updatePaymentController: RequestHandler = async (req, res) => {
  const idResult = paymentIdSchema.safeParse(req.params.id);

  if (!idResult.success) {
    res.status(400).json({ success: false, message: 'ID học phí phải là UUID hợp lệ' });
    return;
  }

  const bodyResult = updatePaymentSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin học phí không hợp lệ',
      errors: bodyResult.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const result = await updatePayment(idResult.data, res.locals.auth.userId, bodyResult.data);

  if (result.status === 'not_found') {
    res.status(404).json({ success: false, message: 'Không tìm thấy học phí' });
    return;
  }

  if (result.status === 'missing_payment_method') {
    res.status(400).json({ success: false, message: 'Cần có phương thức thanh toán khi đã thu tiền' });
    return;
  }

  if (result.status === 'conflict') {
    res.status(409).json({ success: false, message: 'Học phí đã thay đổi, vui lòng tải lại và thử lại' });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Cập nhật học phí thành công',
    data: { payment: serializePaymentWithStatus(result.payment) },
  });
};
