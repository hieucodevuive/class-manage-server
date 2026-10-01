import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../src/config/prisma';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Thiếu SEED_ADMIN_EMAIL hoặc SEED_ADMIN_PASSWORD');
  }
  if (!z.email().safeParse(email).success || password.length < 12) {
    throw new Error('Email ADMIN không hợp lệ hoặc mật khẩu có dưới 12 ký tự');
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    if (existingUser.role !== 'ADMIN' || existingUser.status !== 'ACTIVE') {
      throw new Error('Email này đã thuộc một tài khoản khác; không tự đổi role hoặc status');
    }
    console.log('Tài khoản ADMIN đã tồn tại');
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  console.log('Đã tạo tài khoản ADMIN');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'Không thể tạo ADMIN');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
