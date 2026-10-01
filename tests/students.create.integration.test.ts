import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import type { Student } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

test('POST /api/students tạo hồ sơ đúng giáo viên', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const prefix = `student-test-${randomUUID()}`;

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

    async function post(body?: unknown, token?: string) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      if (response.status === 201) {
        const id = json.data?.student?.id;
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      }
      return { status: response.status, body: json };
    }

    function expectedStudent(row: Student) {
      return {
        id: row.id,
        fullName: row.fullName,
        phone: row.phone,
        parentName: row.parentName,
        parentPhone: row.parentPhone,
        school: row.school,
        grade: row.grade,
        dateOfBirth: row.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        address: row.address,
        status: row.status,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    const minimal = await post({
      fullName: '  Nguyễn Văn An  ',
      id: randomUUID(),
      teacherId: userB.id,
      teacher_id: userB.id,
      classId: 123,
      createdAt: '2000-01-01T00:00:00.000Z',
    }, tokenA);
    assert.equal(minimal.status, 201);
    const studentA = await prisma.student.findUniqueOrThrow({ where: { id: minimal.body.data.student.id } });
    assert.equal(studentA.teacherId, userA.id);
    assert.equal(studentA.fullName, 'Nguyễn Văn An');
    assert.equal(studentA.status, 'ACTIVE');
    assert.equal(studentA.phone, null);
    assert.equal(studentA.grade, null);
    assert.equal(studentA.dateOfBirth, null);
    assert.deepEqual(minimal.body.data.student, expectedStudent(studentA));

    const complete = await post({
      fullName: '  Trần Thị Bình  ',
      phone: ' 0901234567 ',
      parentName: '  Trần Văn C  ',
      parentPhone: '+84 901 234 567',
      school: '  THPT Chu Văn An  ',
      grade: 12,
      dateOfBirth: '2008-02-29',
      address: '  Hà Nội  ',
      status: 'INACTIVE',
      note: '  Ghi chú  ',
      teacherId: userA.id,
    }, tokenB);
    assert.equal(complete.status, 201);
    const studentB = await prisma.student.findUniqueOrThrow({ where: { id: complete.body.data.student.id } });
    assert.equal(studentB.teacherId, userB.id);
    assert.equal(studentB.phone, '0901234567');
    assert.equal(studentB.parentPhone, '+84 901 234 567');
    assert.equal(studentB.grade, 12);
    assert.equal(studentB.dateOfBirth?.toISOString().slice(0, 10), '2008-02-29');
    assert.equal(studentB.status, 'INACTIVE');
    assert.deepEqual(complete.body.data.student, expectedStudent(studentB));

    for (const token of [undefined, 'abc']) {
      const denied = await post({ fullName: 'Không được lưu' }, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }

    const invalidCases: Array<[unknown, string]> = [
      [{}, 'fullName'],
      [{ fullName: '   ' }, 'fullName'],
      [{ fullName: 'x'.repeat(151) }, 'fullName'],
      [{ fullName: 'Hợp lệ', phone: 123 }, 'phone'],
      [{ fullName: 'Hợp lệ', phone: 'abc' }, 'phone'],
      [{ fullName: 'Hợp lệ', parentPhone: '123' }, 'parentPhone'],
      [{ fullName: 'Hợp lệ', grade: 0 }, 'grade'],
      [{ fullName: 'Hợp lệ', grade: 13 }, 'grade'],
      [{ fullName: 'Hợp lệ', grade: '10' }, 'grade'],
      [{ fullName: 'Hợp lệ', dateOfBirth: '2026-02-30' }, 'dateOfBirth'],
      [{ fullName: 'Hợp lệ', dateOfBirth: '2026-09-01T00:00:00Z' }, 'dateOfBirth'],
      [{ fullName: 'Hợp lệ', status: 'UNKNOWN' }, 'status'],
      [{ fullName: 'Hợp lệ', school: 123 }, 'school'],
      [{ fullName: 'Hợp lệ', note: 123 }, 'note'],
    ];
    for (const [body, field] of invalidCases) {
      const rejected = await post(body, tokenA);
      assert.equal(rejected.status, 400, field);
      assert.equal(rejected.body.success, false);
      assert.ok(rejected.body.errors.some((issue: { field: string }) => issue.field === field));
    }
    assert.equal(await prisma.student.count({ where: { teacherId: { in: userIds } } }), 2);
    console.log('PASS: POST Student gán đúng chủ sở hữu A/B, validate dữ liệu và yêu cầu token');
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
