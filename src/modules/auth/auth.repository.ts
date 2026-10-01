import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  });
}

export function findUserByEmailIgnoreCase(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
}

export function insertPendingTeacher(email: string, passwordHash: string) {
  return prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'TEACHER',
      status: 'PENDING',
    },
    select: { id: true, email: true, role: true },
  });
}

export function findPendingRegistrations() {
  return prisma.user.findMany({
    where: { role: 'TEACHER', status: 'PENDING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
}

export async function activatePendingTeacher(id: number) {
  try {
    return await prisma.user.update({
      where: { id, role: 'TEACHER', status: 'PENDING' },
      data: { status: 'ACTIVE' },
      select: { id: true, email: true, role: true, status: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }
}

export function findRegistrationState(id: number) {
  return prisma.user.findUnique({
    where: { id },
    select: { role: true, status: true },
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

export function findUserStatusById(id: number) {
  return prisma.user.findUnique({
    where: { id },
    select: { status: true },
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
          status: true,
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
