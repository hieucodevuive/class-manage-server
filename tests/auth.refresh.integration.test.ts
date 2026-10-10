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
import { createRefreshToken, hashRefreshToken } from '../src/utils/refresh-token';

test('Refresh đổi token, chặn replay/hết hạn và chỉ cho một request đồng thời thành công', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  let userId: number | undefined;
  const email = `auth-refresh-${randomUUID()}@example.test`;
  const password = 'Test-password-123!';
  const invalidMessage = 'Refresh token không hợp lệ hoặc đã hết hạn';

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'TEACHER',
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/auth`;

    function refresh(cookie?: string) {
      return fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: cookie === undefined ? {} : { Cookie: cookie },
      });
    }

    async function assertDenied(response: Response, message = invalidMessage) {
      assert.equal(response.status, 401);
      assert.ok(response.headers.get('set-cookie') === null, 'Refresh bị từ chối không được đặt cookie');
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['message', 'success']);
      assert.ok(body.success === false, 'Response phải báo thất bại');
      assert.ok(body.message === message, 'Response phải dùng thông báo lỗi đã quy định');
    }

    function assertPublicUser(value: { id: number; email: string; role: string }) {
      assert.deepEqual(Object.keys(value).sort(), ['email', 'id', 'role']);
      assert.ok(value.id === user.id && value.email === email && value.role === 'TEACHER',
        'Response chỉ trả public user của tài khoản fixture');
    }

    async function readSession(response: Response, expectedRecordId?: number) {
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.success === true, 'Response phải báo thành công');
      assert.deepEqual(Object.keys(body.data).sort(), ['accessToken', 'user']);
      assertPublicUser(body.data.user);
      assert.equal(typeof body.data.accessToken, 'string');

      const header = response.headers.get('set-cookie');
      assert.ok(header, 'Thành công phải đặt refresh cookie');
      const parts = header.split(';').map(part => part.trim());
      const cookie = parts[0]!;
      assert.ok(/^refreshToken=[a-f0-9]{64}$/.test(cookie), 'Refresh cookie phải chứa token đúng định dạng');
      assert.ok(parts.includes('Path=/api/auth'), 'Cookie phải dùng đúng path');
      assert.ok(parts.includes('HttpOnly'), 'Cookie phải là HttpOnly');
      assert.ok(parts.includes('SameSite=Lax'), 'Cookie phải dùng SameSite=Lax');
      assert.equal(parts.includes('Secure'), env.NODE_ENV === 'production');
      const expires = parts.find(part => part.startsWith('Expires='));
      assert.ok(expires, 'Cookie phải có thời hạn');
      const cookieExpiresAt = new Date(expires.slice('Expires='.length)).getTime();
      assert.ok(Number.isFinite(cookieExpiresAt), 'Thời hạn cookie phải hợp lệ');

      const rawToken = cookie.slice('refreshToken='.length);
      const tokenHash = hashRefreshToken(rawToken);
      const records = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      assert.equal(records.length, 1);
      const record = records[0]!;
      if (expectedRecordId !== undefined) assert.equal(record.id, expectedRecordId);
      // So sánh bằng boolean để assertion thất bại cũng không in token/hash.
      assert.ok(record.tokenHash === tokenHash, 'DB phải lưu hash của refresh cookie hiện tại');
      assert.ok(record.tokenHash !== rawToken, 'DB không được lưu refresh token nguyên bản');
      assert.ok(record.expiresAt.getTime() > Date.now(), 'Phiên mới phải còn hạn');
      assert.ok(Math.abs(record.expiresAt.getTime() - cookieExpiresAt) < 1000, 'Cookie và DB phải cùng thời hạn');

      const me = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${body.data.accessToken}` },
      });
      assert.equal(me.status, 200);
      const meBody = await me.json();
      assert.deepEqual(Object.keys(meBody).sort(), ['data', 'success']);
      assert.deepEqual(Object.keys(meBody.data), ['user']);
      assert.ok(meBody.success === true, 'Access token phải xác thực được qua /me');
      assertPublicUser(meBody.data.user);
      return { cookie, tokenHash, record };
    }

    await assertDenied(await refresh(), 'Thiếu refresh token');
    await assertDenied(await refresh('refreshToken='), 'Thiếu refresh token');
    await assertDenied(await refresh(`refreshToken=${createRefreshToken()}`));
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0);

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const original = await readSession(login);
    const rotated = await readSession(await refresh(original.cookie), original.record.id);
    assert.ok(rotated.cookie !== original.cookie, 'Refresh phải đổi token cookie');
    assert.ok(rotated.tokenHash !== original.tokenHash, 'Refresh phải thay hash cũ');
    assert.equal(rotated.record.createdAt.getTime(), original.record.createdAt.getTime());
    assert.equal(await prisma.refreshToken.count({
      where: { userId: user.id, tokenHash: original.tokenHash },
    }), 0);

    await assertDenied(await refresh(original.cookie));
    assert.equal(await prisma.refreshToken.count({
      where: { userId: user.id, tokenHash: rotated.tokenHash },
    }), 1);

    const concurrent = await Promise.all([refresh(rotated.cookie), refresh(rotated.cookie)]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 401]);
    const winnerResponse = concurrent.find(response => response.status === 200);
    const loserResponse = concurrent.find(response => response.status === 401);
    assert.ok(winnerResponse && loserResponse);
    const winner = await readSession(winnerResponse, original.record.id);
    await assertDenied(loserResponse);
    assert.ok(winner.cookie !== rotated.cookie, 'Request thắng phải đổi refresh cookie');
    await assertDenied(await refresh(rotated.cookie));

    // JWT có thể giống nhau nếu cấp trong cùng giây; kiểm tra sử dụng được qua /me.
    const current = await readSession(await refresh(winner.cookie), original.record.id);
    assert.ok(current.cookie !== winner.cookie, 'Cookie thắng phải dùng được cho lần refresh sau');
    await prisma.refreshToken.update({
      where: { id: current.record.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await assertDenied(await refresh(current.cookie));
    const expired = await prisma.refreshToken.findUniqueOrThrow({ where: { id: current.record.id } });
    assert.ok(expired.tokenHash === current.tokenHash, 'Request hết hạn không được đổi hash');
    assert.ok(expired.expiresAt.getTime() < Date.now(), 'Request hết hạn không được gia hạn phiên');
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1);
  } finally {
    try {
      if (userId !== undefined) {
        await prisma.refreshToken.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
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
