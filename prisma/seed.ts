import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { env } from '../src/config/env';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SEED_TEACHER_EMAIL;
  const password = process.env.SEED_TEACHER_PASSWORD;

  if (!email || !password) {
    throw new Error('Thiếu SEED_TEACHER_EMAIL hoặc SEED_TEACHER_PASSWORD');
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    console.log('Tài khoản giáo viên đã tồn tại');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'TEACHER',
      status: 'ACTIVE',
    },
  });

  console.log('Đã tạo tài khoản giáo viên');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
