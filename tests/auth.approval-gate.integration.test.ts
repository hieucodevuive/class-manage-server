import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { createAccessToken } from '../src/utils/jwt';
import { hashRefreshToken } from '../src/utils/refresh-token';

test('Tài khoản PENDING không thể đăng nhập, refresh hoặc dùng access token', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const prefix = `auth-gate-test-${randomUUID()}`;
  const password = 'Test-password-123!';

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const active = await prisma.user.create({
      data: {
        email: `${prefix}-active@example.test`,
        passwordHash,
        role: 'TEACHER',
        status: 'ACTIVE',
      },
    });
    userIds.push(active.id);
    const pending = await prisma.user.create({
      data: {
        email: `${prefix}-pending@example.test`,
        passwordHash,
        role: 'TEACHER',
      },
    });
    userIds.push(pending.id);
    assert.equal(pending.status, 'PENDING');

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function login(email: string, loginPassword: string) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: loginPassword }),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie'),
      };
    }

    const wrongPassword = await login(pending.email, 'wrong-password');
    assert.equal(wrongPassword.status, 401);
    const deniedLogin = await login(pending.email, password);
    assert.deepEqual(deniedLogin, {
      status: 403,
      body: { success: false, message: 'Tài khoản đang chờ duyệt' },
      cookie: null,
    });

    const pendingAccessToken = createAccessToken({ id: pending.id, role: 'TEACHER' });
    for (const path of ['/api/auth/me', '/api/classes', '/api/students']) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${pendingAccessToken}` },
      });
      assert.equal(response.status, 403, path);
      assert.deepEqual(await response.json(), {
        success: false,
        message: 'Tài khoản đang chờ duyệt',
      });
    }

    const pendingRefreshToken = randomUUID();
    await prisma.refreshToken.create({
      data: {
        userId: pending.id,
        tokenHash: hashRefreshToken(pendingRefreshToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const deniedRefresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refreshToken=${pendingRefreshToken}` },
    });
    assert.equal(deniedRefresh.status, 401);
    assert.equal((await deniedRefresh.json()).success, false);
    assert.equal(deniedRefresh.headers.get('set-cookie'), null);

    const activeLogin = await login(active.email, password);
    assert.equal(activeLogin.status, 200);
    assert.deepEqual(activeLogin.body.data.user, {
      id: active.id,
      email: active.email,
      role: 'TEACHER',
    });
    assert.equal(typeof activeLogin.body.data.accessToken, 'string');
    assert.ok(activeLogin.cookie?.startsWith('refreshToken='));

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${activeLogin.body.data.accessToken}` },
    });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).data.user, activeLogin.body.data.user);

    const activeCookie = activeLogin.cookie!.split(';')[0];
    const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: activeCookie },
    });
    assert.equal(refreshed.status, 200);
    const refreshedBody = await refreshed.json();
    assert.deepEqual(refreshedBody.data.user, activeLogin.body.data.user);
    assert.equal(typeof refreshedBody.data.accessToken, 'string');
    assert.ok(refreshed.headers.get('set-cookie')?.startsWith('refreshToken='));

    const approved = await prisma.user.update({
      where: { id: pending.id },
      data: { status: 'ACTIVE' },
    });
    assert.equal(approved.status, 'ACTIVE');
    const approvedLogin = await login(pending.email, password);
    assert.equal(approvedLogin.status, 200);
    assert.equal(approvedLogin.body.data.user.id, pending.id);

    console.log('PASS: PENDING bị chặn ở login/refresh/JWT; ACTIVE dùng auth như cũ');
  } finally {
    try {
      if (userIds.length) {
        await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
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
