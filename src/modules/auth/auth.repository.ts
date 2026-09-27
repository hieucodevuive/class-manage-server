import { prisma } from '../../config/prisma';

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  });
}