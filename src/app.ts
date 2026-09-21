import express from 'express';
import cors from 'cors';

const app = express();

// Middleware: cho phép đọc JSON body từ request
app.use(express.json());

// Middleware: cho phép frontend gọi API (CORS)
app.use(cors());

// Route test đầu tiên
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server đang chạy OK' });
});

export default app;