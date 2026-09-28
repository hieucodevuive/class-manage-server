import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import type { Role } from '../generated/prisma/enums';

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
    res.locals.auth = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Access token không hợp lệ hoặc đã hết hạn',
    });
  }
};

export function requireRole(allowedRoles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const auth: ReturnType<typeof verifyAccessToken> | undefined =
      res.locals.auth;

    if (!auth) {
      res.status(401).json({
        success: false,
        message: 'Chưa xác thực',
      });
      return;
    }

    if (!allowedRoles.includes(auth.role)) {
      res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thực hiện thao tác này',
      });
      return;
    }

    next();
  };
}