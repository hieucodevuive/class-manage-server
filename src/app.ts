import express from 'express';
import cors from 'cors';
import type { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { env } from './config/env';

import authRouter from './modules/auth/auth.route';
import classRouter from './modules/classes/class.route';
import studentRouter from './modules/students/student.route';

const app = express();

// Middleware: cho phép đọc JSON body từ request
app.use(express.json());
app.use(cookieParser());

// Middleware: cho phép frontend gọi API (CORS)
app.use(cors({
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
}));

app.use('/api/auth', authRouter);
app.use('/api/classes', classRouter);
app.use('/api/students', studentRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Không tìm thấy API',
  });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: 'Lỗi máy chủ',
  });
};

app.use(errorHandler);

export default app;
