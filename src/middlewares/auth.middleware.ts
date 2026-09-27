import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../utils/jwt';

export const requireAuth: RequestHandler = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Thiếu access token',
    });
    return;
  }

  const token = authorization.slice(7);

  try {
    verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Access token không hợp lệ hoặc đã hết hạn',
    });
  }
};