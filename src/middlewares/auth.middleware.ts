import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import type { Role } from '../generated/prisma/enums';
import { getAccountStatus } from '../modules/auth/auth.service';

export const requireAuth: RequestHandler = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Thiếu access token',
    });
    return;
  }

  const token = authorization.slice(7);

  let auth: ReturnType<typeof verifyAccessToken>;
  try {
    auth = verifyAccessToken(token);
  } catch {
    res.status(401).json({
      success: false,
      message: 'Access token không hợp lệ hoặc đã hết hạn',
    });
    return;
  }

  const accountStatus = await getAccountStatus(auth.userId);
  if (accountStatus === null) {
    res.status(401).json({
      success: false,
      message: 'Tài khoản không còn tồn tại',
    });
    return;
  }
  if (accountStatus !== 'ACTIVE') {
    res.status(403).json({
      success: false,
      message: 'Tài khoản đang chờ duyệt',
    });
    return;
  }

  res.locals.auth = auth;
  next();
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
