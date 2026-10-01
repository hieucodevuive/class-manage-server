import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { createAccessToken } from '../src/utils/jwt';

test('GET /api/students chỉ liệt kê học sinh của giáo viên đang đăng nhập', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const prefix = `student-list-test-${randomUUID()}`;

  try {
    const userA = await prisma.user.create({
      data: { email: `${prefix}-a@example.test`, passwordHash: 'test-fixture-no-login', role: 'TEACHER', status: 'ACTIVE' },
    });
    userIds.push(userA.id);
    const userB = await prisma.user.create({
      data: { email: `${prefix}-b@example.test`, passwordHash: 'test-fixture-no-login', role: 'TEACHER', status: 'ACTIVE' },
    });
    userIds.push(userB.id);
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/students`;

    async function get(token?: string) {
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }

    assert.deepEqual(await get(tokenA), {
      status: 200,
      body: { success: true, data: { students: [] } },
    });

    const firstA = await prisma.student.create({
      data: {
        teacherId: userA.id,
        fullName: 'Học sinh A cũ',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const secondA = await prisma.student.create({
      data: {
        teacherId: userA.id,
        fullName: 'Học sinh A mới',
        status: 'INACTIVE',
        dateOfBirth: new Date('2012-02-29T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });
    const studentB = await prisma.student.create({
      data: {
        teacherId: userB.id,
        fullName: 'Học sinh B',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    });

    const listA = await get(tokenA);
    assert.equal(listA.status, 200);
    assert.equal(listA.body.success, true);
    assert.deepEqual(listA.body.data.students.map((student: { id: string }) => student.id), [secondA.id, firstA.id]);
    assert.equal(listA.body.data.students[0].dateOfBirth, '2012-02-29');
    assert.equal(listA.body.data.students[0].status, 'INACTIVE');
    assert.equal(listA.body.data.students[0].teacherId, undefined);
    assert.equal(listA.body.data.students[0].teacher_id, undefined);

    const listB = await get(tokenB);
    assert.equal(listB.status, 200);
    assert.equal(listB.body.success, true);
    assert.deepEqual(listB.body.data.students.map((student: { id: string }) => student.id), [studentB.id]);

    for (const token of [undefined, 'abc']) {
      const denied = await get(token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }

    console.log('PASS: GET Student trả danh sách riêng A/B, đúng thứ tự và yêu cầu token');
  } finally {
    try {
      if (userIds.length) {
        await prisma.student.deleteMany({ where: { teacherId: { in: userIds } } });
      }
    } finally {
      try {
        if (userIds.length) {
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
  }
});
