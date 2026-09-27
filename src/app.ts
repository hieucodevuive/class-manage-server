import express from 'express';
import cors from 'cors';
import type { ErrorRequestHandler } from 'express';

import authRouter from './modules/auth/auth.route';

const app = express();

// Middleware: cho phép đọc JSON body từ request
app.use(express.json());

// Middleware: cho phép frontend gọi API (CORS)
app.use(cors());

app.use('/api/auth', authRouter);

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