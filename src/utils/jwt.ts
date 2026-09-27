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

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
  });
}