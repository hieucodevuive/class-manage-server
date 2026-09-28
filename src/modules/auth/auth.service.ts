import bcrypt from 'bcryptjs';
import { deleteRefreshTokenByHash, findRefreshTokenByHash, findUserByEmail, findUserById, rotateRefreshToken, saveRefreshToken } from './auth.repository';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../../utils/refresh-token';

export async function authenticateUser(email: string, password: string) {
  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    };
}

export function getCurrentUser(userId: number) {
  return findUserById(userId);
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

  if (!record) {
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
    user: record.user,
    refreshToken: newRefreshToken,
    expiresAt,
  };
}

export async function logoutSession(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  await deleteRefreshTokenByHash(tokenHash);
}