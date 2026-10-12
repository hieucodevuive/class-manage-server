import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';

test('Đăng ký công khai chỉ tạo TEACHER/PENDING và không cấp token', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const email = `register-${randomUUID()}@example.test`;
  const raceEmail = `register-${randomUUID()}@example.test`;
  const legacyEmail = `register-${randomUUID()}@example.test`;
  const password = 'Test-password-123!';
  const defaultAvatar = env.DEFAULT_AVATAR_URL ?? new URL('/api/assets/default-avatar.svg',
    env.PUBLIC_API_ORIGIN ?? `http://localhost:${env.PORT}`).href;

  try {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function register(body: unknown) {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie'),
      };
    }

    const invalidEmail = await register({ email: 'invalid', password });
    assert.equal(invalidEmail.status, 400);
    const shortPassword = await register({ email, password: 'short' });
    assert.equal(shortPassword.status, 400);
    const oversizedPassword = await register({ email, password: 'á'.repeat(37) });
    assert.equal(oversizedPassword.status, 400);

    const privilegeAttempt = await register({ email, password, role: 'ADMIN', status: 'ACTIVE' });
    assert.equal(privilegeAttempt.status, 400);
    assert.equal((await register({ email, password, name: 'Tên client tự chọn' })).status, 400);
    assert.equal(await prisma.user.count({ where: { email } }), 0);

    const created = await register({ email: email.toUpperCase(), password });
    assert.equal(created.status, 201);
    assert.ok(created.cookie === null, 'Register không được cấp refresh cookie');
    assert.equal(created.body.success, true);
    assert.ok(Object.keys(created.body.data.user).sort().join('|') === 'avatar|email|id|name|role',
      'Đăng ký chỉ trả năm field User công khai');
    assert.ok(created.body.data.user.email === email && created.body.data.user.name === email
      && created.body.data.user.role === 'TEACHER', 'User mới phải có name bằng email đã chuẩn hóa');
    assert.ok(created.body.data.user.avatar === defaultAvatar, 'Tài khoản chưa có ảnh phải trả URL avatar mặc định');
    assert.equal(typeof created.body.data.user.id, 'number');
    assert.equal(Object.hasOwn(created.body.data, 'accessToken'), false);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(stored.status, 'PENDING');
    assert.equal(stored.role, 'TEACHER');
    assert.ok(stored.name === email, 'DB phải lưu name bằng email đã chuẩn hóa');
    assert.ok(stored.avatar === null, 'Ảnh mặc định chỉ ở response; User mới lưu avatar null');
    assert.ok(stored.passwordHash !== password, 'DB phải lưu hash thay vì mật khẩu fixture');
    assert.ok(await bcrypt.compare(password, stored.passwordHash), 'Hash phải xác minh được mật khẩu fixture');

    const duplicate = await register({ email, password });
    assert.equal(duplicate.status, 409);
    assert.equal(await prisma.user.count({ where: { email } }), 1);

    await prisma.user.create({
      data: {
        email: legacyEmail.toUpperCase(),
        name: legacyEmail.toUpperCase(),
        passwordHash: stored.passwordHash,
        role: 'TEACHER',
        status: 'ACTIVE',
      },
    });
    assert.equal((await register({ email: legacyEmail, password })).status, 409);

    const concurrent = await Promise.all([
      register({ email: raceEmail, password }),
      register({ email: raceEmail, password }),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
    assert.equal(await prisma.user.count({ where: { email: raceEmail } }), 1);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 403);
    assert.ok(login.headers.get('set-cookie') === null, 'Login PENDING không được cấp cookie');

    console.log('PASS: đăng ký TEACHER/PENDING, không cấp token, chặn email trùng và quyền client');
  } finally {
    try {
      await prisma.user.deleteMany({ where: { email: { in: [email, raceEmail, legacyEmail.toUpperCase()] } } });
    } finally {
      try {
        if (server) {
          await new Promise<void>((resolve, reject) => {
            server!.close(error => error ? reject(error) : resolve());
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  }
});
