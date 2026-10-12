import type { RequestHandler } from 'express';
import { loginSchema, registerSchema, registrationIdSchema, updateProfileSchema } from './auth.schema';
import { approveRegistration, authenticateUser, getCurrentUser, issueRefreshToken, listPendingRegistrations, logoutSession, refreshSession, registerTeacher, updateCurrentUser } from './auth.service';
import { createAccessToken, verifyAccessToken  } from '../../utils/jwt';
import { env } from '../../config/env';
import { updateCurrentUserAvatar } from './avatar.service';

export const registerController: RequestHandler = async (req, res) => {
  const result = registerSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin đăng ký không hợp lệ',
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const registration = await registerTeacher(result.data);
  if (registration.status === 'email_exists') {
    res.status(409).json({
      success: false,
      message: 'Email đã được sử dụng',
    });
    return;
  }

  res.status(201).json({
    success: true,
    message: 'Đăng ký thành công, tài khoản đang chờ duyệt',
    data: { user: registration.user },
  });
};

export const listPendingRegistrationsController: RequestHandler = async (_req, res) => {
  const users = await listPendingRegistrations();
  res.json({ success: true, data: { users } });
};

export const approveRegistrationController: RequestHandler = async (req, res) => {
  const idResult = registrationIdSchema.safeParse(req.params.id);
  if (!idResult.success) {
    res.status(400).json({
      success: false,
      message: 'ID tài khoản phải là số nguyên dương không vượt quá 2147483647',
    });
    return;
  }

  const result = await approveRegistration(idResult.data);
  if (result.status === 'not_found') {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy tài khoản giáo viên chờ duyệt',
    });
    return;
  }
  if (result.status === 'already_active') {
    res.status(409).json({
      success: false,
      message: 'Tài khoản đã được duyệt',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Đã duyệt tài khoản',
    data: { user: result.user },
  });
};

export const loginController: RequestHandler = async (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Email hoặc mật khẩu không hợp lệ',
    });
    return;
  }

  const account = await authenticateUser(result.data.email, result.data.password);

  if (!account) {
    res.status(401).json({
      success: false,
      message: 'Email hoặc mật khẩu không đúng',
    });
    return;
  }

  if (account.status !== 'ACTIVE') {
    res.status(403).json({
      success: false,
      message: 'Tài khoản đang chờ duyệt',
    });
    return;
  }

  const { user } = account;

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

export const updateMeController: RequestHandler = async (req, res) => {
  const auth: ReturnType<typeof verifyAccessToken> | undefined = res.locals.auth;
  if (!auth) {
    res.status(401).json({ success: false, message: 'Chưa xác thực' });
    return;
  }

  const result = updateProfileSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      success: false,
      message: 'Thông tin tài khoản không hợp lệ',
      errors: result.error.issues.map(issue => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
    return;
  }

  const user = await updateCurrentUser(auth.userId, result.data);
  if (!user) {
    res.status(401).json({ success: false, message: 'Tài khoản không còn tồn tại' });
    return;
  }

  res.json({
    success: true,
    message: 'Cập nhật tên thành công',
    data: { user },
  });
};

export const updateAvatarController: RequestHandler = async (req, res) => {
  const auth: ReturnType<typeof verifyAccessToken> | undefined = res.locals.auth;
  if (!auth) {
    res.status(401).json({ success: false, message: 'Chưa xác thực' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ success: false, message: 'Vui lòng gửi một file avatar' });
    return;
  }
  const result = await updateCurrentUserAvatar(auth.userId, req.file);
  if (result.status === 'updated') {
    res.json({ success: true, message: 'Cập nhật avatar thành công', data: { user: result.user } });
    return;
  }
  const failures = {
    not_found: [401, 'Tài khoản không còn tồn tại'],
    pending: [403, 'Tài khoản đang chờ duyệt'],
    not_configured: [503, 'Dịch vụ avatar chưa được cấu hình'],
    upload_failed: [502, 'Không thể upload avatar, vui lòng thử lại'],
    persistence_failed: [500, 'Không thể lưu avatar'],
    conflict: [409, 'Avatar đã thay đổi, vui lòng tải lại và thử lại'],
    invalid_image: [400, result.status === 'invalid_image' ? result.message : 'File ảnh không hợp lệ'],
  } as const;
  const [status, message] = failures[result.status];
  res.status(status).json({ success: false, message });
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
