import bcrypt from 'bcryptjs';
import { Prisma } from '../../generated/prisma/client';
import type { RegisterInput } from './auth.schema';
import { activatePendingTeacher, deleteRefreshTokenByHash, findPendingRegistrations, findRefreshTokenByHash, findRegistrationState, findUserByEmail, findUserByEmailIgnoreCase, findUserById, findUserStatusById, insertPendingTeacher, rotateRefreshToken, saveRefreshToken } from './auth.repository';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../../utils/refresh-token';

export async function registerTeacher(data: RegisterInput) {
  if (await findUserByEmailIgnoreCase(data.email)) {
    return { status: 'email_exists' } as const;
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  try {
    const user = await insertPendingTeacher(data.email, passwordHash);
    return { status: 'created', user } as const;
  } catch (error) {
    // Unique constraint vẫn bảo vệ email nếu hai request đăng ký chạy cùng lúc.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { status: 'email_exists' } as const;
    }
    throw error;
  }
}

export function listPendingRegistrations() {
  return findPendingRegistrations();
}

export async function approveRegistration(id: number) {
  const user = await activatePendingTeacher(id);
  if (user) {
    return { status: 'approved', user } as const;
  }

  const current = await findRegistrationState(id);
  return current?.role === 'TEACHER' && current.status === 'ACTIVE'
    ? { status: 'already_active' } as const
    : { status: 'not_found' } as const;
}

export async function authenticateUser(email: string, password: string) {
  // Tài khoản cũ vẫn tra đúng email đã lưu; email đăng ký mới được chuẩn hóa chữ thường.
  const user = await findUserByEmail(email)
    ?? (email.toLowerCase() === email ? null : await findUserByEmail(email.toLowerCase()));

  if (!user) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return {
    status: user.status,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
}

export function getCurrentUser(userId: number) {
  return findUserById(userId);
}

export async function getAccountStatus(userId: number) {
  const user = await findUserStatusById(userId);
  return user?.status ?? null;
}

export async function issueRefreshToken(userId: number) {
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await saveRefreshToken(
    userId,
    hashRefreshToken(refreshToken),
    expiresAt,
  );

  return { refreshToken, expiresAt };
}

export async function validateRefreshToken(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  const record = await findRefreshTokenByHash(tokenHash);

  if (!record || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return record;
}

export async function refreshSession(refreshToken: string) {
  const record = await validateRefreshToken(refreshToken);

  if (!record || record.user.status !== 'ACTIVE') {
    return null;
  }

  const newRefreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await rotateRefreshToken(
    record.id,
    hashRefreshToken(refreshToken),
    hashRefreshToken(newRefreshToken),
    expiresAt,
  );

  if (result.count !== 1) {
    return null;
  }

  return {
    user: {
      id: record.user.id,
      email: record.user.email,
      role: record.user.role,
    },
    refreshToken: newRefreshToken,
    expiresAt,
  };
}

export async function logoutSession(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  await deleteRefreshTokenByHash(tokenHash);
}
