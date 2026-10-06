import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { createAccessToken } from '../src/utils/jwt';

test('POST /api/classes/:classId/schedules kiểm tra giờ học và quyền sở hữu lớp', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const scheduleIds: string[] = [];
  const prefix = `schedule-create-test-${randomUUID()}`;

  try {
    async function createUser(suffix: string, role: 'TEACHER' | 'ADMIN' = 'TEACHER', status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
      const user = await prisma.user.create({
        data: { email: `${prefix}-${suffix}@example.test`, passwordHash: 'test-fixture-no-login', role, status },
      });
      userIds.push(user.id);
      return user;
    }

    async function createClass(teacherId: number, suffix: string, status: 'ACTIVE' | 'INACTIVE' | 'COMPLETED' = 'ACTIVE') {
      const classRecord = await prisma.class.create({
        data: {
          teacherId,
          name: `${prefix}-${suffix}`,
          grade: 10,
          schoolYear: '2026-2027',
          subject: 'Ngữ Văn',
          tuitionFee: '500000.00',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          status,
        },
      });
      classIds.push(classRecord.id);
      return classRecord;
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const classA = await createClass(userA.id, 'class-a', 'INACTIVE');
    const classB = await createClass(userB.id, 'class-b', 'COMPLETED');
    const adminClass = await createClass(admin.id, 'class-admin');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(classId: string | number, token?: string, body?: unknown) {
      const response = await fetch(`${baseUrl}/${classId}/schedules`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    const valid = { dayOfWeek: 'MONDAY', startTime: '19:00', endTime: '21:00' };
    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(classA.id, token, valid);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(pendingClass.id, tokenPending, valid);
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);

    for (const classId of ['abc', '0', '-1', '1.5', '2147483648']) {
      assert.deepEqual(await request(classId, tokenA, valid), {
        status: 400,
        body: { success: false, message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647' },
      });
    }

    const invalidBodies: Array<[unknown, string]> = [
      [undefined, 'body'],
      [[], 'body'],
      [{}, 'dayOfWeek'],
      [{ startTime: valid.startTime, endTime: valid.endTime }, 'dayOfWeek'],
      [{ dayOfWeek: valid.dayOfWeek, endTime: valid.endTime }, 'startTime'],
      [{ dayOfWeek: valid.dayOfWeek, startTime: valid.startTime }, 'endTime'],
      [{ ...valid, dayOfWeek: 'monday' }, 'dayOfWeek'],
      [{ ...valid, dayOfWeek: 'FUNDAY' }, 'dayOfWeek'],
      [{ ...valid, dayOfWeek: 1 }, 'dayOfWeek'],
      [{ ...valid, startTime: 19 }, 'startTime'],
      [{ ...valid, endTime: null }, 'endTime'],
      [{ ...valid, endTime: '24:00' }, 'endTime'],
      [{ ...valid, endTime: '21:00Z' }, 'endTime'],
      [{ ...valid, endTime: '21:00\n' }, 'endTime'],
      [{ ...valid, endTime: '21:00:00\n' }, 'endTime'],
      [{ ...valid, endTime: '21:00:00\r\n' }, 'endTime'],
      [{ ...valid, endTime: '19:00:00' }, 'endTime'],
      [{ ...valid, endTime: '18:00' }, 'endTime'],
      [{ ...valid, startTime: '23:00', endTime: '01:00' }, 'endTime'],
      [{ ...valid, startTime: '19:00:20', endTime: '19:00:19' }, 'endTime'],
      [{ ...valid, startTime: '19:00:01', endTime: '19:00' }, 'endTime'],
      [{ ...valid, teacherId: userB.id }, 'body'],
      [{ ...valid, classId: classB.id, classRecord: { connect: { id: classB.id } } }, 'body'],
      [{ ...valid, teacher_id: userB.id, id: randomUUID(), createdAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z' }, 'body'],
    ];
    for (const startTime of [
      '9:00', '19:0', '19:00:0', '24:00', '19:60', '19:00:60',
      ' 19:00', '19:00 ', '19:00:00.001', '19:00Z', '2026-10-06T19:00:00Z',
      '19:00\n', '19:00:00\n', '19:00:00\r\n',
    ]) {
      invalidBodies.push([{ ...valid, startTime }, 'startTime']);
    }
    for (const [body, field] of invalidBodies) {
      const invalid = await request(classA.id, tokenA, body);
      assert.equal(invalid.status, 400, field);
      assert.equal(invalid.body.success, false);
      assert.equal(invalid.body.message, 'Thông tin lịch học không hợp lệ');
      assert.ok(invalid.body.errors.some((issue: { field: string; message: string }) => (
        issue.field === field && typeof issue.message === 'string' && issue.message.length > 0
      )), field);
    }

    const invalidJson = { status: 400, body: { success: false, message: 'Body JSON không hợp lệ' } };
    assert.deepEqual(await request(classA.id, tokenA, null), invalidJson);
    const malformedJson = await fetch(`${baseUrl}/${classA.id}/schedules`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: '{"dayOfWeek":"MONDAY",}',
    });
    assert.deepEqual({ status: malformedJson.status, body: await malformedJson.json() }, invalidJson);

    const classNotFound = { status: 404, body: { success: false, message: 'Không tìm thấy lớp' } };
    assert.deepEqual(await request(classB.id, tokenA, valid), classNotFound);
    assert.deepEqual(await request(classA.id, tokenB, valid), classNotFound);
    assert.deepEqual(await request(classA.id, tokenAdmin, valid), classNotFound);
    assert.deepEqual(await request(classB.id, tokenAdmin, valid), classNotFound);
    assert.deepEqual(await request(2147483647, tokenA, valid), classNotFound);
    assert.equal(await prisma.classSchedule.count({ where: { classId: { in: classIds } } }), 0);

    async function createAndAssert(
      classId: number,
      token: string,
      body: { dayOfWeek: string; startTime: string; endTime: string },
      expectedStart: string,
      expectedEnd: string,
    ) {
      const created = await request(classId, token, body);
      assert.equal(created.status, 201);
      const schedule = created.body.data.schedule;
      assert.match(schedule.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.ok(!scheduleIds.includes(schedule.id), 'Mỗi lần tạo lịch trả một ID mới');
      scheduleIds.push(schedule.id);
      const persisted = await prisma.classSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      assert.equal(persisted.classId, classId);
      assert.equal(persisted.dayOfWeek, body.dayOfWeek);
      assert.equal(persisted.startTime.toISOString(), `1970-01-01T${expectedStart}.000Z`);
      assert.equal(persisted.endTime.toISOString(), `1970-01-01T${expectedEnd}.000Z`);
      assert.deepEqual(created, {
        status: 201,
        body: {
          success: true,
          message: 'Tạo lịch học thành công',
          data: {
            schedule: {
              id: persisted.id,
              classId,
              dayOfWeek: body.dayOfWeek,
              startTime: expectedStart,
              endTime: expectedEnd,
              createdAt: persisted.createdAt.toISOString(),
              updatedAt: persisted.updatedAt.toISOString(),
            },
          },
        },
      });
      return schedule;
    }

    for (const dayOfWeek of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']) {
      await createAndAssert(classA.id, tokenA, { ...valid, dayOfWeek }, '19:00:00', '21:00:00');
    }
    const timeCases = [
      ['19:05:07', '21:08:09', '19:05:07', '21:08:09'],
      ['19:00', '19:00:01', '19:00:00', '19:00:01'],
      ['19:00:01', '19:01', '19:00:01', '19:01:00'],
      ['00:00', '00:00:01', '00:00:00', '00:00:01'],
      ['23:59:58', '23:59:59', '23:59:58', '23:59:59'],
    ];
    for (const [startTime, endTime, expectedStart, expectedEnd] of timeCases) {
      await createAndAssert(classA.id, tokenA, { dayOfWeek: 'MONDAY', startTime, endTime }, expectedStart, expectedEnd);
    }

    // Thiết kế hiện tại cho phép thêm lịch giống nhau hoặc giao nhau cùng ngày.
    await createAndAssert(classA.id, tokenA, valid, '19:00:00', '21:00:00');
    await createAndAssert(classA.id, tokenA, { ...valid, startTime: '20:00', endTime: '22:00' }, '20:00:00', '22:00:00');
    await createAndAssert(classB.id, tokenB, { ...valid, dayOfWeek: 'SATURDAY', startTime: '00:00', endTime: '23:59:59' }, '00:00:00', '23:59:59');
    await createAndAssert(adminClass.id, tokenAdmin, { ...valid, dayOfWeek: 'SUNDAY' }, '19:00:00', '21:00:00');
    assert.equal(await prisma.classSchedule.count({ where: { classId: { in: classIds } } }), scheduleIds.length);
    assert.equal(await prisma.classSchedule.count({ where: { classId: pendingClass.id } }), 0);
    assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
    console.log('PASS: tạo ClassSchedule đúng quyền A/B/ADMIN, auth, validation, 7 thứ, giờ UTC/chuẩn hóa và lịch trùng/giao nhau');
  } finally {
    try {
      if (classIds.length) {
        await prisma.classSchedule.deleteMany({ where: { classId: { in: classIds } } });
        await prisma.class.deleteMany({ where: { id: { in: classIds } } });
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
