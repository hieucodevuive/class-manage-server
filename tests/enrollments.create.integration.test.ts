import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { createAccessToken } from '../src/utils/jwt';

test('POST /api/classes/:classId/students ghi danh đúng quyền sở hữu', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const prefix = `enrollment-create-test-${randomUUID()}`;

  try {
    async function createUser(suffix: string) {
      const user = await prisma.user.create({
        data: {
          email: `${prefix}-${suffix}@example.test`,
          passwordHash: 'test-fixture-no-login',
          role: 'TEACHER',
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    async function createClass(teacherId: number, suffix: string) {
      const classRecord = await prisma.class.create({
        data: {
          teacherId,
          name: `${prefix}-${suffix}`,
          grade: 10,
          schoolYear: '2026-2027',
          subject: 'Ngữ Văn',
          tuitionFee: '500000.00',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });
      classIds.push(classRecord.id);
      return classRecord;
    }

    async function createStudent(teacherId: number, suffix: string) {
      const student = await prisma.student.create({
        data: { teacherId, fullName: `${prefix}-${suffix}`, status: 'ACTIVE' },
      });
      studentIds.push(student.id);
      return student;
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const classA = await createClass(userA.id, 'class-a');
    const classA2 = await createClass(userA.id, 'class-a2');
    const classB = await createClass(userB.id, 'class-b');
    const studentA = await createStudent(userA.id, 'student-a');
    const studentB = await createStudent(userB.id, 'student-b');
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(classId: string | number, token?: string, body?: unknown) {
      const response = await fetch(`${baseUrl}/${classId}/students`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    const valid = { studentId: studentA.id, joinedAt: '2026-09-03' };
    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(classA.id, token, valid);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }

    for (const classId of ['abc', '0', '-1', '2147483648']) {
      assert.equal((await request(classId, tokenA, valid)).status, 400);
    }

    const invalidBodies: Array<[unknown, string]> = [
      [{}, 'studentId'],
      [{ studentId: 'not-a-uuid', joinedAt: valid.joinedAt }, 'studentId'],
      [{ studentId: studentA.id }, 'joinedAt'],
      [{ ...valid, joinedAt: '2026-02-30' }, 'joinedAt'],
      [{ ...valid, joinedAt: '2026-09-03T00:00:00Z' }, 'joinedAt'],
      [{ ...valid, status: 'LEFT' }, 'body'],
      [{ ...valid, leftAt: '2026-09-04' }, 'body'],
      [{ ...valid, teacherId: userB.id }, 'body'],
    ];
    for (const [body, field] of invalidBodies) {
      const result = await request(classA.id, tokenA, body);
      assert.equal(result.status, 400, field);
      assert.equal(result.body.success, false);
      assert.ok(result.body.errors.some((issue: { field: string }) => issue.field === field));
    }

    const classNotFound = { status: 404, body: { success: false, message: 'Không tìm thấy lớp' } };
    const studentNotFound = { status: 404, body: { success: false, message: 'Không tìm thấy học sinh' } };
    assert.deepEqual(await request(classB.id, tokenA, valid), classNotFound);
    assert.deepEqual(await request(classA.id, tokenB, { ...valid, studentId: studentB.id }), classNotFound);
    assert.deepEqual(await request(2147483647, tokenA, valid), classNotFound);
    assert.deepEqual(await request(classA.id, tokenA, { ...valid, studentId: studentB.id }), studentNotFound);
    assert.deepEqual(await request(classB.id, tokenB, valid), studentNotFound);
    assert.deepEqual(await request(classA.id, tokenA, { ...valid, studentId: randomUUID() }), studentNotFound);
    assert.equal(await prisma.classStudent.count({ where: { classId: { in: classIds } } }), 0);

    const concurrent = await Promise.all([
      request(classA.id, tokenA, valid),
      request(classA.id, tokenA, valid),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
    const created = concurrent.find(result => result.status === 201);
    assert.ok(created);
    assert.equal(created.body.success, true);
    assert.equal(created.body.message, 'Ghi danh học sinh thành công');
    const responseEnrollment = created.body.data.enrollment;
    assert.match(responseEnrollment.id, /^[0-9a-f-]{36}$/i);
    assert.equal(responseEnrollment.classId, classA.id);
    assert.equal(responseEnrollment.studentId, studentA.id);
    assert.equal(responseEnrollment.joinedAt, valid.joinedAt);
    assert.equal(responseEnrollment.leftAt, null);
    assert.equal(responseEnrollment.status, 'ACTIVE');
    assert.equal(responseEnrollment.teacherId, undefined);
    assert.match(responseEnrollment.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(responseEnrollment.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    const persisted = await prisma.classStudent.findUniqueOrThrow({ where: { id: responseEnrollment.id } });
    assert.equal(persisted.classId, classA.id);
    assert.equal(persisted.studentId, studentA.id);
    assert.equal(persisted.joinedAt.toISOString().slice(0, 10), valid.joinedAt);
    assert.equal(persisted.status, 'ACTIVE');
    assert.equal(persisted.leftAt, null);
    assert.equal(await prisma.classStudent.count({ where: { classId: classA.id, studentId: studentA.id } }), 1);

    const conflict = { status: 409, body: { success: false, message: 'Học sinh đã từng được ghi danh vào lớp này' } };
    assert.deepEqual(await request(classA.id, tokenA, valid), conflict);
    const leftEnrollment = await prisma.classStudent.update({
      where: { id: persisted.id },
      data: { status: 'LEFT', leftAt: new Date('2026-10-01T00:00:00.000Z') },
    });
    assert.deepEqual(await request(classA.id, tokenA, valid), conflict);
    assert.equal(await prisma.classStudent.count({ where: { classId: classA.id, studentId: studentA.id } }), 1);
    assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: persisted.id } }), leftEnrollment);

    assert.equal((await request(classA2.id, tokenA, valid)).status, 201);
    assert.equal((await request(classB.id, tokenB, { studentId: studentB.id, joinedAt: '2026-09-05' })).status, 201);
    assert.equal(await prisma.classStudent.count({ where: { studentId: studentA.id } }), 2);
    console.log('PASS: ghi danh đúng giáo viên, nhiều lớp, validate input, unique ACTIVE/LEFT và chống request đồng thời');
  } finally {
    try {
      if (classIds.length) {
        await prisma.classStudent.deleteMany({ where: { classId: { in: classIds } } });
        await prisma.class.deleteMany({ where: { id: { in: classIds } } });
      }
      if (studentIds.length) {
        await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
      }
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
});
