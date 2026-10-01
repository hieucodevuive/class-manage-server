import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { createAccessToken } from '../src/utils/jwt';

test('PATCH và DELETE /api/students/:id giới hạn theo giáo viên', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const prefix = `student-edit-test-${randomUUID()}`;

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

    const studentA = await prisma.student.create({
      data: {
        teacherId: userA.id,
        fullName: 'Học sinh A',
        parentName: 'Phụ huynh A',
        grade: 10,
        status: 'ACTIVE',
      },
    });
    const studentB = await prisma.student.create({
      data: { teacherId: userB.id, fullName: 'Học sinh B', status: 'ACTIVE' },
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/students`;

    async function request(method: 'PATCH' | 'DELETE', id: string, token?: string, body?: unknown) {
      const response = await fetch(`${url}/${id}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy học sinh' } };
    assert.deepEqual(await request('PATCH', studentB.id, tokenA, { fullName: 'Không được sửa' }), notFound);
    assert.deepEqual(await request('DELETE', studentB.id, tokenA), notFound);
    assert.deepEqual(await request('PATCH', studentA.id, tokenB, { fullName: 'Không được sửa' }), notFound);
    assert.deepEqual(await request('DELETE', studentA.id, tokenB), notFound);
    assert.deepEqual(await request('PATCH', randomUUID(), tokenA, { fullName: 'Không có' }), notFound);
    assert.deepEqual(await request('DELETE', randomUUID(), tokenA), notFound);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: studentB.id } })).fullName, 'Học sinh B');

    for (const method of ['PATCH', 'DELETE'] as const) {
      const invalidId = await request(method, 'not-a-uuid', tokenA, method === 'PATCH' ? { fullName: 'A' } : undefined);
      assert.deepEqual(invalidId, {
        status: 400,
        body: { success: false, message: 'ID học sinh phải là UUID hợp lệ' },
      });
      for (const token of [undefined, 'abc']) {
        const denied = await request(method, studentA.id, token, method === 'PATCH' ? { fullName: 'A' } : undefined);
        assert.equal(denied.status, 401);
        assert.equal(denied.body.success, false);
      }
    }

    const invalidCases: Array<[unknown, string]> = [
      [{}, 'body'],
      [{ teacherId: userB.id }, 'body'],
      [{ fullName: '   ' }, 'fullName'],
      [{ grade: 13 }, 'grade'],
      [{ phone: 'abc' }, 'phone'],
      [{ dateOfBirth: '2026-02-30' }, 'dateOfBirth'],
      [{ status: 'UNKNOWN' }, 'status'],
    ];
    for (const [body, field] of invalidCases) {
      const rejected = await request('PATCH', studentA.id, tokenA, body);
      assert.equal(rejected.status, 400, field);
      assert.equal(rejected.body.success, false);
      assert.ok(rejected.body.errors.some((issue: { field: string }) => issue.field === field));
    }

    const updated = await request('PATCH', studentA.id, tokenA, {
      fullName: '  Học sinh A mới  ',
      grade: 11,
      dateOfBirth: '2010-05-06',
      status: 'INACTIVE',
      teacherId: userB.id,
      teacher_id: userB.id,
      id: studentB.id,
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.success, true);
    assert.equal(updated.body.message, 'Cập nhật học sinh thành công');
    assert.equal(updated.body.data.student.id, studentA.id);
    assert.equal(updated.body.data.student.fullName, 'Học sinh A mới');
    assert.equal(updated.body.data.student.dateOfBirth, '2010-05-06');
    assert.equal(updated.body.data.student.parentName, 'Phụ huynh A');
    assert.equal(updated.body.data.student.status, 'INACTIVE');
    assert.equal(updated.body.data.student.teacherId, undefined);
    const persisted = await prisma.student.findUniqueOrThrow({ where: { id: studentA.id } });
    assert.equal(persisted.teacherId, userA.id);
    assert.equal(persisted.createdAt.toISOString(), studentA.createdAt.toISOString());

    const cleared = await request('PATCH', studentA.id, tokenA, {
      grade: null,
      dateOfBirth: null,
      parentName: null,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.student.grade, null);
    assert.equal(cleared.body.data.student.dateOfBirth, null);
    assert.equal(cleared.body.data.student.parentName, null);
    assert.equal(cleared.body.data.student.fullName, 'Học sinh A mới');
    assert.equal(cleared.body.data.student.status, 'INACTIVE');

    const deleted = await request('DELETE', studentA.id, tokenA);
    assert.deepEqual(deleted, {
      status: 200,
      body: { success: true, message: 'Xóa học sinh thành công' },
    });
    assert.equal(await prisma.student.findUnique({ where: { id: studentA.id } }), null);
    assert.deepEqual(await request('DELETE', studentA.id, tokenA), notFound);
    assert.ok(await prisma.student.findUnique({ where: { id: studentB.id } }));

    console.log('PASS: PATCH/DELETE Student chặn truy cập chéo, giữ ownership và validate dữ liệu');
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
