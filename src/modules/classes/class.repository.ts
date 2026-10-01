import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export function insertClass(data: Prisma.ClassCreateInput) {
  return prisma.class.create({
    data,
  });
}

export function findClasses(teacherId: number) {
  return prisma.class.findMany({
    where: { teacherId },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

export function findClassById(id: number, teacherId: number) {
  return prisma.class.findFirst({
    where: { id, teacherId },
  });
}

export async function updateClassById(id: number, teacherId: number, data: Prisma.ClassUpdateInput) {
  try {
    return await prisma.class.update({
      where: { id, teacherId },
      data,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }

    throw error;
  }
}

export async function deleteClassById(id: number, teacherId: number) {
  try {
    return await prisma.class.delete({
      where: { id, teacherId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }

    throw error;
  }
}
