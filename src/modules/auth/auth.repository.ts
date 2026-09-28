import { prisma } from '../../config/prisma';

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  });
}

export function findUserById(id: number) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });
}

export function saveRefreshToken(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
) {
  return prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
        },
      },
    },
  });
}

export function rotateRefreshToken(
  id: number,
  oldTokenHash: string,
  newTokenHash: string,
  expiresAt: Date,
) {
  return prisma.refreshToken.updateMany({
    where: {
      id,
      tokenHash: oldTokenHash,
      expiresAt: { gt: new Date() },
    },
    data: {
      tokenHash: newTokenHash,
      expiresAt,
    },
  });
}

export function deleteRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.deleteMany({
    where: { tokenHash },
  });
}