import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export function insertClass(data: Prisma.ClassCreateInput) {
  return prisma.class.create({
    data,
  });
}

export function findClasses() {
  return prisma.class.findMany({
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

export function findClassById(id: number) {
  return prisma.class.findUnique({
    where: { id },
  });
}

export async function updateClassById(id: number, data: Prisma.ClassUpdateInput) {
  try {
    return await prisma.class.update({
      where: { id },
      data,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }

    throw error;
  }
}

export async function deleteClassById(id: number) {
  try {
    return await prisma.class.delete({
      where: { id },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }

    throw error;
  }
}
