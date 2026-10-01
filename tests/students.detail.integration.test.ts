import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { createAccessToken } from '../src/utils/jwt';

test('GET /api/students/:id chỉ trả hồ sơ thuộc giáo viên đang đăng nhập', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const prefix = `student-detail-test-${randomUUID()}`;

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
        status: 'ACTIVE',
        grade: 10,
        dateOfBirth: new Date('2010-05-06T00:00:00.000Z'),
      },
    });
    const studentB = await prisma.student.create({
      data: { teacherId: userB.id, fullName: 'Học sinh B', status: 'INACTIVE' },
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/students`;

    async function get(id: string, token?: string) {
      const response = await fetch(`${url}/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }

    const ownA = await get(studentA.id, tokenA);
    assert.deepEqual(ownA, {
      status: 200,
      body: {
        success: true,
        data: {
          student: {
            id: studentA.id,
            fullName: 'Học sinh A',
            phone: null,
            parentName: null,
            parentPhone: null,
            school: null,
            grade: 10,
            dateOfBirth: '2010-05-06',
            address: null,
            status: 'ACTIVE',
            note: null,
            createdAt: studentA.createdAt.toISOString(),
            updatedAt: studentA.updatedAt.toISOString(),
          },
        },
      },
    });

    const ownB = await get(studentB.id, tokenB);
    assert.equal(ownB.status, 200);
    assert.equal(ownB.body.data.student.id, studentB.id);
    assert.equal(ownB.body.data.student.teacherId, undefined);

    const missing = await get(randomUUID(), tokenA);
    assert.deepEqual(missing, {
      status: 404,
      body: { success: false, message: 'Không tìm thấy học sinh' },
    });
    assert.deepEqual(await get(studentB.id, tokenA), missing);
    assert.deepEqual(await get(studentA.id, tokenB), missing);

    const invalid = await get('not-a-uuid', tokenA);
    assert.deepEqual(invalid, {
      status: 400,
      body: { success: false, message: 'ID học sinh phải là UUID hợp lệ' },
    });

    for (const token of [undefined, 'abc']) {
      const denied = await get(studentA.id, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }

    console.log('PASS: GET Student chi tiết bảo vệ ownership A/B, UUID và access token');
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
