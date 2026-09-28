import jwt from 'jsonwebtoken';
import type { Role } from '../generated/prisma/enums';
import { env } from '../config/env';

export function createAccessToken(user: { id: number; role: Role }) {
  return jwt.sign(
    { role: user.role },
    env.JWT_SECRET,
    {
      subject: String(user.id),
      expiresIn: '15m',
      algorithm: 'HS256',
    },
  );
}

export function verifyAccessToken(
  token: string,
): { userId: number; role: Role } {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
  });

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    (payload.role !== 'TEACHER' && payload.role !== 'ADMIN')
  ) {
    throw new Error('Dữ liệu token không hợp lệ');
  }

  const userId = Number(payload.sub);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('User ID trong token không hợp lệ');
  }

  return { userId, role: payload.role };
}