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
import type { RefreshToken } from '../src/generated/prisma/client';
import { hashRefreshToken } from '../src/utils/refresh-token';

test('Logout chỉ xóa phiên được gửi, xóa cookie đúng và giữ các phiên A/B độc lập', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const prefix = `auth-logout-test-${randomUUID()}`;
  const password = 'Test-password-123!';

  function assertKeys(value: unknown, expected: string[], message: string): asserts value is Record<string, unknown> {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), message);
    assert.ok(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), message);
  }

  function assertPublicUser(actual: unknown, expected: { id: number; email: string; role: string }) {
    assertKeys(actual, ['id', 'email', 'role'], 'User chỉ được chứa các field công khai');
    assert.ok(actual.id === expected.id && actual.email === expected.email && actual.role === expected.role,
      'User phải đúng tài khoản đang được xác thực');
  }

  function refreshCookie(header: string | null) {
    assert.ok(typeof header === 'string' && header.startsWith('refreshToken='), 'Phải có cookie refresh token');
    const cookie = header.split(';')[0]!;
    const token = cookie.slice('refreshToken='.length);
    assert.ok(/^[0-9a-f]{64}$/i.test(token), 'Cookie phải chứa refresh token ngẫu nhiên');
    return { cookie, token };
  }

  function assertClearedCookie(header: string | null) {
    assert.ok(typeof header === 'string', 'Logout phải gửi Set-Cookie để xóa cookie');
    const parts = header.split(';').map(part => part.trim());
    assert.ok(parts[0] === 'refreshToken=', 'Giá trị cookie sau logout phải rỗng');
    const attributes = new Map(parts.slice(1).map(part => {
      const separator = part.indexOf('=');
      return separator === -1
        ? [part.toLowerCase(), '']
        : [part.slice(0, separator).toLowerCase(), part.slice(separator + 1)];
    }));
    assert.ok(attributes.get('path') === '/api/auth', 'Cookie được xóa tại đúng Path của phiên đăng nhập');
    assert.ok(attributes.has('httponly'), 'Cookie xóa vẫn phải có HttpOnly');
    assert.ok(attributes.get('samesite')?.toLowerCase() === 'lax', 'Cookie xóa vẫn phải có SameSite=Lax');
    assert.ok(attributes.has('secure') === (env.NODE_ENV === 'production'), 'Secure phải theo NODE_ENV');
    const expiresAt = Date.parse(attributes.get('expires') ?? '');
    assert.ok(Number.isFinite(expiresAt) && expiresAt < Date.now(), 'Cookie xóa phải hết hạn trong quá khứ');
  }

  function sameSession(actual: RefreshToken | null | undefined, expected: RefreshToken) {
    return !!actual && actual.id === expected.id && actual.userId === expected.userId
      && actual.tokenHash === expected.tokenHash
      && actual.createdAt.getTime() === expected.createdAt.getTime()
      && actual.expiresAt.getTime() === expected.expiresAt.getTime();
  }

  try {
    const passwordHash = await bcrypt.hash(password, 4);
    async function createTeacher(suffix: string) {
      const user = await prisma.user.create({ data: {
        email: `${prefix}-${suffix}@example.test`, passwordHash, role: 'TEACHER', status: 'ACTIVE',
      } });
      userIds.push(user.id);
      return { id: user.id, email: user.email, role: 'TEACHER' as const };
    }
    const userA = await createTeacher('a');
    const userB = await createTeacher('b');

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/auth`;

    async function login(user: typeof userA) {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assertKeys(body, ['success', 'message', 'data'], 'Login phải trả đúng cấu trúc response');
      assert.ok(body.success === true, 'Login phải thành công');
      assertKeys(body.data, ['user', 'accessToken'], 'Login phải trả đúng cấu trúc data');
      assertPublicUser(body.data.user, user);
      assert.ok(typeof body.data.accessToken === 'string' && body.data.accessToken.length > 0, 'Login phải cấp access token');
      return { ...refreshCookie(response.headers.get('set-cookie')), accessToken: body.data.accessToken as string };
    }
    async function post(path: 'logout' | 'refresh', cookie?: string) {
      const response = await fetch(`${baseUrl}/${path}`, {
        method: 'POST', headers: cookie === undefined ? {} : { Cookie: cookie },
      });
      return { status: response.status, body: await response.json(), setCookie: response.headers.get('set-cookie') };
    }

    const a1 = await login(userA);
    const a2 = await login(userA);
    const b = await login(userB);
    assert.ok(new Set([a1.token, a2.token, b.token]).size === 3, 'Ba lần login phải tạo ba refresh token riêng');
    const initialSessions = await prisma.refreshToken.findMany({ where: { userId: { in: userIds } } });
    assert.equal(initialSessions.length, 3);
    function storedSession(token: string) {
      const row = initialSessions.find(session => session.tokenHash === hashRefreshToken(token));
      assert.ok(row, 'Mỗi cookie phải có một RefreshToken lưu bằng hash trong DB');
      return row;
    }
    const rowA1 = storedSession(a1.token);
    const rowA2 = storedSession(a2.token);
    const rowB = storedSession(b.token);
    assert.ok(rowA1.userId === userA.id && rowA2.userId === userA.id && rowB.userId === userB.id, 'Phiên phải thuộc đúng tài khoản');
    assert.ok(new Set([rowA1.id, rowA2.id, rowB.id]).size === 3, 'Ba phiên phải có ba bản ghi DB riêng');

    async function assertRemainingSessions() {
      const rows = await prisma.refreshToken.findMany({ where: { userId: { in: userIds } } });
      assert.equal(rows.length, 2);
      assert.ok(!rows.some(row => row.id === rowA1.id), 'Phiên A1 đã logout phải bị xóa');
      assert.ok(sameSession(rows.find(row => row.id === rowA2.id), rowA2), 'Phiên A2 phải giữ nguyên sau logout');
      assert.ok(sameSession(rows.find(row => row.id === rowB.id), rowB), 'Phiên B phải giữ nguyên sau logout');
    }
    async function assertLogout(cookie?: string) {
      const result = await post('logout', cookie);
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'message'], 'Logout phải trả đúng cấu trúc response');
      assert.ok(result.body.success === true && result.body.message === 'Đã đăng xuất', 'Logout phải trả thông báo thành công');
      assertClearedCookie(result.setCookie);
      await assertRemainingSessions();
    }

    await assertLogout(a1.cookie);
    const deniedRefresh = await post('refresh', a1.cookie);
    assert.equal(deniedRefresh.status, 401);
    assertKeys(deniedRefresh.body, ['success', 'message'], 'Refresh bị từ chối phải trả đúng cấu trúc response');
    assert.ok(deniedRefresh.body.success === false, 'Phiên đã logout không được refresh');
    assert.ok(deniedRefresh.setCookie === null, 'Refresh phiên đã logout không được cấp cookie mới');
    await assertRemainingSessions();
    for (const cookie of [a1.cookie, undefined, 'refreshToken=', 'refreshToken=invalid-cookie-value']) {
      await assertLogout(cookie);
    }

    // Logout chỉ xóa refresh token; JWT access token còn hạn vẫn dùng được theo thiết kế hiện tại.
    const me = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${a1.accessToken}` } });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assertKeys(meBody, ['success', 'data'], '/me phải trả đúng cấu trúc response');
    assert.ok(meBody.success === true, 'Access token còn hạn phải xác thực được sau logout');
    assertKeys(meBody.data, ['user'], '/me phải trả đúng cấu trúc data');
    assertPublicUser(meBody.data.user, userA);
    await assertRemainingSessions();

    async function assertRefresh(session: typeof a1, user: typeof userA, before: RefreshToken) {
      const result = await post('refresh', session.cookie);
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'data'], 'Refresh phải trả đúng cấu trúc response');
      assert.ok(result.body.success === true, 'Phiên độc lập còn lại phải refresh được');
      assertKeys(result.body.data, ['user', 'accessToken'], 'Refresh phải trả đúng cấu trúc data');
      assertPublicUser(result.body.data.user, user);
      assert.ok(typeof result.body.data.accessToken === 'string' && result.body.data.accessToken.length > 0, 'Refresh phải cấp access token');
      const next = refreshCookie(result.setCookie);
      assert.ok(next.token !== session.token, 'Refresh thành công phải đổi refresh token');
      const after = await prisma.refreshToken.findUnique({ where: { id: before.id } });
      assert.ok(after && after.userId === user.id, 'Phiên hợp lệ phải còn thuộc đúng tài khoản');
      assert.ok(after.tokenHash === hashRefreshToken(next.token) && after.tokenHash !== before.tokenHash, 'DB phải lưu hash của cookie mới');
      assert.ok(after.createdAt.getTime() === before.createdAt.getTime(), 'Rotation không tạo thêm bản ghi phiên');
      assert.ok(after.expiresAt.getTime() > Date.now(), 'Phiên sau refresh phải còn hạn');
      // JWT tạo trong cùng một giây có thể giống nhau, nên không so sánh hai access token.
      return after;
    }
    const rotatedA2 = await assertRefresh(a2, userA, rowA2);
    assert.ok(sameSession(await prisma.refreshToken.findUnique({ where: { id: rowB.id } }), rowB), 'Refresh A2 không được sửa phiên B');
    const rotatedB = await assertRefresh(b, userB, rowB);
    const finalSessions = await prisma.refreshToken.findMany({ where: { userId: { in: userIds } } });
    assert.equal(finalSessions.length, 2);
    assert.ok(sameSession(finalSessions.find(row => row.id === rowA2.id), rotatedA2), 'Phiên A2 phải còn nguyên sau refresh B');
    assert.ok(sameSession(finalSessions.find(row => row.id === rowB.id), rotatedB), 'Phiên B phải còn nguyên sau refresh');
    assert.ok(!finalSessions.some(row => row.id === rowA1.id), 'Phiên đã logout không được khôi phục');
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
