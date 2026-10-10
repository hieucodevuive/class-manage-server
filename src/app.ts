import express from 'express';
import cors from 'cors';
import type { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { env } from './config/env';

import authRouter from './modules/auth/auth.route';
import classRouter from './modules/classes/class.route';
import studentRouter from './modules/students/student.route';
import paymentRouter from './modules/payments/payment.route';

const app = express();

// CORS chạy trước JSON parser để response lỗi body cũng có CORS headers.
app.use(cors({
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
}));

// Middleware: cho phép đọc JSON body và cookie từ request
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/classes', classRouter);
app.use('/api/students', studentRouter);
app.use('/api/payments', paymentRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Không tìm thấy API',
  });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed' && err.status === 400) {
    res.status(400).json({ success: false, message: 'Body JSON không hợp lệ' });
    return;
  }

  if (err?.type === 'entity.too.large' && err.status === 413) {
    res.status(413).json({ success: false, message: 'Body JSON vượt quá giới hạn cho phép' });
    return;
  }

  if (
    (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported')
    && err.status === 415
  ) {
    res.status(415).json({ success: false, message: 'Charset hoặc encoding của body không được hỗ trợ' });
    return;
  }

  console.error(err);

  res.status(500).json({
    success: false,
    message: 'Lỗi máy chủ',
  });
};

app.use(errorHandler);

export default app;
