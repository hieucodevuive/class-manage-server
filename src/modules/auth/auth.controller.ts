import type { RequestHandler } from 'express';
import { loginSchema } from './auth.schema';
import { authenticateUser, getCurrentUser, issueRefreshToken, logoutSession, refreshSession } from './auth.service';
import { createAccessToken, verifyAccessToken  } from '../../utils/jwt';
import { env } from '../../config/env';

export const loginController: RequestHandler = async (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Email hoặc mật khẩu không hợp lệ',
    });
    return;
  }

  const user = await authenticateUser(result.data.email, result.data.password);

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Email hoặc mật khẩu không đúng',
    });
    return;
  }

  const accessToken = createAccessToken(user);

  const { refreshToken, expiresAt } = await issueRefreshToken(user.id);

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/api/auth',
  });

  res.json({
    success: true,
    message: 'Đăng nhập thành công',
    data: { user, accessToken },
  });
};

export const meController: RequestHandler = async (_req, res) => {
  const auth: ReturnType<typeof verifyAccessToken> | undefined =
    res.locals.auth;

  if (!auth) {
    res.status(401).json({
      success: false,
      message: 'Chưa xác thực',
    });
    return;
  }

  const user = await getCurrentUser(auth.userId);

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'Tài khoản không còn tồn tại',
    });
    return;
  }

  res.json({
    success: true,
    data: { user },
  });
};

export const refreshController: RequestHandler = async (req, res) => {
  const refreshToken: unknown = req.cookies?.refreshToken;

  if (typeof refreshToken !== 'string' || !refreshToken) {
    res.status(401).json({
      success: false,
      message: 'Thiếu refresh token',
    });
    return;
  }

  const session = await refreshSession(refreshToken);

  if (!session) {
    res.status(401).json({
      success: false,
      message: 'Refresh token không hợp lệ hoặc đã hết hạn',
    });
    return;
  }

  const accessToken = createAccessToken(session.user);

  res.cookie('refreshToken', session.refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: session.expiresAt,
    path: '/api/auth',
  });

  res.json({
    success: true,
    data: { user: session.user, accessToken },
  });
};

export const logoutController: RequestHandler = async (req, res) => {
  const refreshToken: unknown = req.cookies?.refreshToken;

  if (typeof refreshToken === 'string' && refreshToken) {
    await logoutSession(refreshToken);
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });

  res.json({
    success: true,
    message: 'Đã đăng xuất',
  });
};