import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import type { User } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

test('Đổi name chỉ sửa tài khoản đang xác thực, strict body và các response Auth dùng tên mới', { timeout: 45000 }, async () => {
  let server: Server | undefined;
  const prefix = `auth-profile-${randomUUID()}`;
  const emails = {
    a: `${prefix}-a@example.test`,
    b: `${prefix}-b@example.test`,
    admin: `${prefix}-admin@example.test`,
    pending: `${prefix}-pending@example.test`,
  };
  const password = 'Profile-test-password-123!';

  // Không đưa raw response, token/cookie hoặc hash vào assertion thất bại.
  function assertKeys(value: unknown, expected: string[], message: string): asserts value is Record<string, unknown> {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), message);
    assert.ok(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), message);
  }

  function assertPublicUser(value: unknown, user: User, name: string) {
    assertKeys(value, ['id', 'email', 'name', 'role'], 'User chỉ trả đúng bốn field công khai');
    assert.ok(value.id === user.id && value.email === user.email && value.name === name && value.role === user.role,
      'User phải thuộc đúng tài khoản và trả name hiện tại');
  }

  function assertAccountUnchanged(actual: User, before: User, expectedName = before.name, preserveUpdatedAt = true) {
    assert.ok(actual.id === before.id && actual.email === before.email && actual.role === before.role
      && actual.status === before.status && actual.passwordHash === before.passwordHash,
    'Đổi name không được sửa ID/email/role/status/passwordHash');
    assert.ok(actual.name === expectedName, 'DB phải lưu đúng name của tài khoản');
    assert.ok(actual.createdAt.getTime() === before.createdAt.getTime(), 'Không được đổi thời điểm tạo tài khoản');
    if (preserveUpdatedAt) {
      assert.ok(actual.updatedAt.getTime() === before.updatedAt.getTime(), 'Request bị từ chối hoặc tài khoản khác phải giữ nguyên updatedAt');
    }
  }

  try {
    const passwordHash = await bcrypt.hash(password, 4);
    async function createUser(email: string, role: 'TEACHER' | 'ADMIN' = 'TEACHER', status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
      return prisma.user.create({ data: { email, name: email, passwordHash, role, status } });
    }
    const userA = await createUser(emails.a);
    const userB = await createUser(emails.b);
    const admin = await createUser(emails.admin, 'ADMIN');
    const pending = await createUser(emails.pending, 'TEACHER', 'PENDING');
    const tokenB = createAccessToken(userB);
    const adminToken = createAccessToken(admin);
    const pendingToken = createAccessToken(pending);

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/auth`;

    async function request(path: string, method = 'GET', token?: string, body?: unknown, cookie?: string) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie === undefined ? {} : { Cookie: cookie }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
    }

    async function login(user: User, name: string) {
      const result = await request('/login', 'POST', undefined, { email: user.email, password });
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'message', 'data'], 'Login phải trả đúng envelope');
      assert.ok(result.body.success === true && result.body.message === 'Đăng nhập thành công', 'Login phải thành công');
      assertKeys(result.body.data, ['user', 'accessToken'], 'Login phải trả đúng data');
      assertPublicUser(result.body.data.user, user, name);
      assert.ok(typeof result.body.data.accessToken === 'string' && result.body.data.accessToken.length > 0, 'Login phải cấp access token');
      assert.ok(typeof result.cookie === 'string' && /^refreshToken=[a-f0-9]{64};/.test(result.cookie), 'Login phải cấp refresh cookie hợp lệ');
      return { token: result.body.data.accessToken, cookie: result.cookie.split(';')[0]! };
    }

    async function assertMe(token: string, user: User, name: string) {
      const result = await request('/me', 'GET', token);
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'data'], 'GET /me phải trả đúng envelope');
      assert.ok(result.body.success === true, 'GET /me phải thành công');
      assertKeys(result.body.data, ['user'], 'GET /me phải trả đúng data');
      assertPublicUser(result.body.data.user, user, name);
    }

    async function assertPatch(token: string, user: User, inputName: string, expectedName: string, query = '') {
      const result = await request(`/me${query}`, 'PATCH', token, { name: inputName });
      assert.equal(result.status, 200);
      assertKeys(result.body, ['success', 'message', 'data'], 'PATCH /me phải trả đúng envelope');
      assert.ok(result.body.success === true && result.body.message === 'Cập nhật tên thành công', 'Đổi name phải trả thông báo thành công');
      assertKeys(result.body.data, ['user'], 'PATCH /me phải trả đúng data');
      assertPublicUser(result.body.data.user, user, expectedName);
      assert.ok(result.cookie === null, 'Đổi name không được tạo hoặc thay refresh cookie');
      assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), user, expectedName, false);
    }

    async function assertDenied(token: string | undefined, status: number, message: string) {
      const result = await request('/me', 'PATCH', token, { name: 'Tên không được lưu' });
      assert.equal(result.status, status);
      assertKeys(result.body, ['success', 'message'], 'Lỗi xác thực phải trả đúng envelope');
      assert.ok(result.body.success === false && result.body.message === message, 'Lỗi xác thực phải dùng thông báo cố định');
      assert.ok(result.cookie === null, 'Lỗi xác thực không được cấp cookie');
    }

    // Phiên và JWT được cấp trước đổi tên; name phải được đọc từ DB khi dùng lại.
    const originalSession = await login(userA, emails.a);
    const tokenA: string = originalSession.token;
    await assertDenied(undefined, 401, 'Thiếu access token');
    await assertDenied('invalid-access-token', 401, 'Access token không hợp lệ hoặc đã hết hạn');
    await assertDenied(pendingToken, 403, 'Tài khoản đang chờ duyệt');

    const invalidBodies: Array<{ label: string; body?: unknown; field: string; message?: string }> = [
      { label: 'không gửi body', field: 'body' },
      { label: 'object rỗng', body: {}, field: 'name' },
      { label: 'array body', body: [], field: 'body' },
      { label: 'name rỗng', body: { name: '' }, field: 'name', message: 'Tên không được để trống' },
      { label: 'name chỉ có khoảng trắng', body: { name: ' \t\n ' }, field: 'name', message: 'Tên không được để trống' },
      { label: 'name null', body: { name: null }, field: 'name' },
      { label: 'name number', body: { name: 123 }, field: 'name' },
      { label: 'name array', body: { name: ['Tên'] }, field: 'name' },
      { label: '151 Unicode code points', body: { name: 'a'.repeat(151) }, field: 'name', message: 'Tên không được vượt quá 150 ký tự' },
      { label: '151 emoji là 151 Unicode code points', body: { name: '😀'.repeat(151) }, field: 'name', message: 'Tên không được vượt quá 150 ký tự' },
      { label: 'ID tài khoản khác', body: { name: 'Tên bị chặn', id: userB.id }, field: 'body' },
      { label: 'userId tài khoản khác', body: { name: 'Tên bị chặn', userId: userB.id }, field: 'body' },
      { label: 'email', body: { name: 'Tên bị chặn', email: emails.b }, field: 'body' },
      { label: 'role', body: { name: 'Tên bị chặn', role: 'ADMIN' }, field: 'body' },
      { label: 'status', body: { name: 'Tên bị chặn', status: 'PENDING' }, field: 'body' },
      { label: 'passwordHash', body: { name: 'Tên bị chặn', passwordHash: 'client-value' }, field: 'body' },
      { label: 'avatar', body: { name: 'Tên bị chặn', avatar: 'https://example.test/avatar.png' }, field: 'body' },
    ];
    for (const invalid of invalidBodies) {
      const result = await request('/me', 'PATCH', tokenA, invalid.body);
      assert.equal(result.status, 400, invalid.label);
      assertKeys(result.body, ['success', 'message', 'errors'], 'Validation phải trả đúng envelope');
      assert.ok(result.body.success === false && result.body.message === 'Thông tin tài khoản không hợp lệ', 'Validation phải trả thông báo cố định');
      assert.ok(Array.isArray(result.body.errors) && result.body.errors.length > 0, 'Validation phải chỉ rõ lỗi input');
      for (const issue of result.body.errors) {
        assertKeys(issue, ['field', 'message'], 'Lỗi validation chỉ có field/message');
        assert.ok(typeof issue.field === 'string' && typeof issue.message === 'string', 'Lỗi validation phải có chuỗi field/message');
      }
      assert.ok(result.body.errors.some((issue: { field: string; message: string }) => issue.field === invalid.field
        && (invalid.message === undefined || issue.message === invalid.message)), 'Validation phải chỉ đúng field và quy tắc vi phạm');
      assert.ok(result.cookie === null, 'Validation không được cấp cookie');
    }
    for (const user of [userA, userB, admin, pending]) {
      assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), user);
    }

    const newName = 'Nguyễn Thị Ánh';
    await assertPatch(tokenA, userA, `  ${newName}  `, newName, `?id=${userB.id}&userId=${userB.id}`);
    await assertMe(tokenA, userA, newName);
    await login(userA, newName);
    const refreshed = await request('/refresh', 'POST', undefined, undefined, originalSession.cookie);
    assert.equal(refreshed.status, 200);
    assertKeys(refreshed.body, ['success', 'data'], 'Refresh phải trả đúng envelope');
    assert.ok(refreshed.body.success === true, 'Phiên cấp trước đổi name phải refresh được');
    assertKeys(refreshed.body.data, ['user', 'accessToken'], 'Refresh phải trả đúng data');
    assertPublicUser(refreshed.body.data.user, userA, newName);
    assert.ok(typeof refreshed.body.data.accessToken === 'string' && refreshed.body.data.accessToken.length > 0, 'Refresh phải cấp access token');
    assert.ok(typeof refreshed.cookie === 'string' && /^refreshToken=[a-f0-9]{64};/.test(refreshed.cookie), 'Refresh phải trả cookie mới hợp lệ');
    await assertMe(refreshed.body.data.accessToken, userA, newName);
    for (const user of [userB, admin, pending]) {
      assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), user);
    }

    // B có thể dùng cùng tên hiển thị; quyền vẫn theo ID, không theo name/email payload.
    await assertPatch(tokenB, userB, newName, newName);
    await assertPatch(adminToken, admin, '  Quản trị viên  ', 'Quản trị viên');
    await assertMe(tokenB, userB, newName);
    await assertMe(adminToken, admin, 'Quản trị viên');
    assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: userA.id } }), userA, newName, false);
    assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: pending.id } }), pending);

    // Zod đang cài tính Unicode code points sau trim, gồm emoji ngoài BMP.
    await assertPatch(tokenA, userA, '  A  ', 'A');
    await assertPatch(tokenA, userA, `  ${'a'.repeat(150)}  `, 'a'.repeat(150));
    await assertPatch(tokenA, userA, '😀'.repeat(76), '😀'.repeat(76));
    await assertPatch(tokenA, userA, '😀'.repeat(150), '😀'.repeat(150));
    await assertMe(tokenA, userA, '😀'.repeat(150));
    assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: userB.id } }), userB, newName, false);
    assertAccountUnchanged(await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }), admin, 'Quản trị viên', false);
  } finally {
    try {
      // Exact emails ngẫu nhiên bắt được fixture đã commit ngay cả khi setup/assertion thất bại.
      const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } });
      const userIds = users.map(user => user.id);
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
