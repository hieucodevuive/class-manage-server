import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.middleware';
import { createPaymentController, getPaymentByIdController, listPaymentsController, updatePaymentController } from './payment.controller';

const paymentRouter = Router();

paymentRouter.post(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  createPaymentController,
);

paymentRouter.get(
  '/',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  listPaymentsController,
);

paymentRouter.get(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  getPaymentByIdController,
);

paymentRouter.patch(
  '/:id',
  requireAuth,
  requireRole(['TEACHER', 'ADMIN']),
  updatePaymentController,
);

export default paymentRouter;
