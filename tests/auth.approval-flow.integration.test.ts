import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { prisma } from '../src/config/prisma';

test('ADMIN xem và duyệt đăng ký, sau đó giáo viên đăng nhập được', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const prefix = `approval-${randomUUID()}`;
  const emails = {
    admin: `${prefix}-admin@example.test`,
    activeTeacher: `${prefix}-active@example.test`,
    pendingA: `${prefix}-a@example.test`,
    pendingB: `${prefix}-b@example.test`,
  };
  const password = 'Test-password-123!';

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: { email: emails.admin, passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    });
    await prisma.user.create({
      data: { email: emails.activeTeacher, passwordHash, role: 'TEACHER', status: 'ACTIVE' },
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function request(path: string, method = 'GET', body?: unknown, accessToken?: string) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
    }

    const registrationA = await request('/api/auth/register', 'POST', { email: emails.pendingA, password });
    const registrationB = await request('/api/auth/register', 'POST', { email: emails.pendingB, password });
    assert.equal(registrationA.status, 201);
    assert.equal(registrationB.status, 201);
    const idA = registrationA.body.data.user.id as number;
    const idB = registrationB.body.data.user.id as number;

    const beforeApproval = await request('/api/auth/login', 'POST', { email: emails.pendingA, password });
    assert.equal(beforeApproval.status, 403);
    assert.equal(beforeApproval.cookie, null);

    const adminLogin = await request('/api/auth/login', 'POST', { email: emails.admin, password });
    const teacherLogin = await request('/api/auth/login', 'POST', { email: emails.activeTeacher, password });
    assert.equal(adminLogin.status, 200);
    assert.equal(teacherLogin.status, 200);
    const adminToken = adminLogin.body.data.accessToken as string;
    const teacherToken = teacherLogin.body.data.accessToken as string;

    const pendingPath = '/api/auth/registrations/pending';
    const approvePath = `/api/auth/registrations/${idA}/approve`;
    assert.equal((await request(pendingPath)).status, 401);
    assert.equal((await request(pendingPath, 'GET', undefined, teacherToken)).status, 403);
    assert.equal((await request(approvePath, 'PATCH')).status, 401);
    assert.equal((await request(approvePath, 'PATCH', undefined, teacherToken)).status, 403);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: idA } })).status, 'PENDING');

    const pendingList = await request(pendingPath, 'GET', undefined, adminToken);
    assert.equal(pendingList.status, 200);
    const registrations = pendingList.body.data.users as Array<Record<string, unknown>>;
    for (const [id, email] of [[idA, emails.pendingA], [idB, emails.pendingB]] as const) {
      const registration = registrations.find(user => user.id === id);
      assert.ok(registration);
      assert.deepEqual(Object.keys(registration).sort(), ['createdAt', 'email', 'id', 'role', 'status']);
      assert.equal(registration.email, email);
      assert.equal(registration.role, 'TEACHER');
      assert.equal(registration.status, 'PENDING');
      assert.equal(typeof registration.createdAt, 'string');
    }
    assert.equal(registrations.some(user => user.id === admin.id), false);

    assert.equal((await request('/api/auth/registrations/abc/approve', 'PATCH', undefined, adminToken)).status, 400);
    assert.equal((await request('/api/auth/registrations/0/approve', 'PATCH', undefined, adminToken)).status, 400);
    assert.equal((await request('/api/auth/registrations/2147483648/approve', 'PATCH', undefined, adminToken)).status, 400);
    assert.equal((await request('/api/auth/registrations/2147483647/approve', 'PATCH', undefined, adminToken)).status, 404);
    assert.equal((await request(`/api/auth/registrations/${admin.id}/approve`, 'PATCH', undefined, adminToken)).status, 404);

    const approval = await request(approvePath, 'PATCH', undefined, adminToken);
    assert.equal(approval.status, 200);
    assert.deepEqual(approval.body.data.user, {
      id: idA,
      email: emails.pendingA,
      role: 'TEACHER',
      status: 'ACTIVE',
    });
    assert.equal((await request(approvePath, 'PATCH', undefined, adminToken)).status, 409);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: idA } })).status, 'ACTIVE');

    const afterApproval = await request('/api/auth/login', 'POST', { email: ` ${emails.pendingA.toUpperCase()} `, password });
    assert.equal(afterApproval.status, 200);
    assert.equal(typeof afterApproval.body.data.accessToken, 'string');
    assert.ok(afterApproval.cookie?.startsWith('refreshToken='));
    assert.equal((await request('/api/classes', 'GET', undefined, afterApproval.body.data.accessToken)).status, 200);
    assert.equal((await request(pendingPath, 'GET', undefined, afterApproval.body.data.accessToken)).status, 403);

    const [first, second] = await Promise.all([
      request(`/api/auth/registrations/${idB}/approve`, 'PATCH', undefined, adminToken),
      request(`/api/auth/registrations/${idB}/approve`, 'PATCH', undefined, adminToken),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);

    const remaining = await request(pendingPath, 'GET', undefined, adminToken);
    assert.equal(remaining.status, 200);
    assert.equal(remaining.body.data.users.some((user: { id: number }) => user.id === idA || user.id === idB), false);

    console.log('PASS: chỉ ADMIN xem/duyệt PENDING; duyệt xong đăng nhập được; duyệt trùng trả 409');
  } finally {
    try {
      const users = await prisma.user.findMany({
        where: { email: { in: Object.values(emails) } },
        select: { id: true },
      });
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
