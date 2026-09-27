import type { RequestHandler } from 'express';
import { loginSchema } from './auth.schema';
import { authenticateUser } from './auth.service';
import { createAccessToken } from '../../utils/jwt';

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

  res.json({
    success: true,
    message: 'Đăng nhập thành công',
    data: { user, accessToken },
  });
};