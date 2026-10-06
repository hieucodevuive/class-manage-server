import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import type { ClassSchedule } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

test('PATCH /api/classes/:classId/schedules/:scheduleId sửa đúng trường và bảo vệ giờ khi đồng thời', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const scheduleIds: string[] = [];
  const prefix = `schedule-update-test-${randomUUID()}`;

  function expectedSuccess(schedule: ClassSchedule, dayOfWeek: string, startTime: string, endTime: string) {
    return {
      status: 200,
      body: {
        success: true,
        message: 'Cập nhật lịch học thành công',
        data: {
          schedule: {
            id: schedule.id,
            classId: schedule.classId,
            dayOfWeek,
            startTime,
            endTime,
            createdAt: '2026-09-01T01:02:03.456Z',
            updatedAt: schedule.updatedAt.toISOString(),
          },
        },
      },
    };
  }

  const invalidHours = {
    status: 400,
    body: {
      success: false,
      message: 'Thông tin lịch học không hợp lệ',
      errors: [{ field: 'endTime', message: 'Giờ kết thúc phải sau giờ bắt đầu' }],
    },
  };

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

    async function createSchedule(classId: number, dayOfWeek: ClassSchedule['dayOfWeek'], startTime: string, endTime: string) {
      const schedule = await prisma.classSchedule.create({
        data: {
          classId,
          dayOfWeek,
          startTime: new Date(`1970-01-01T${startTime}.000Z`),
          endTime: new Date(`1970-01-01T${endTime}.000Z`),
          createdAt: new Date('2026-09-01T01:02:03.456Z'),
          updatedAt: new Date('2026-09-02T04:05:06.789Z'),
        },
      });
      scheduleIds.push(schedule.id);
      return schedule;
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const classA = await createClass(userA.id, 'class-a', 'INACTIVE');
    const otherClassA = await createClass(userA.id, 'class-a-other');
    const classB = await createClass(userB.id, 'class-b', 'COMPLETED');
    const adminClass = await createClass(admin.id, 'class-admin');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const scheduleA = await createSchedule(classA.id, 'MONDAY', '19:00:00', '21:00:00');
    const otherScheduleA = await createSchedule(otherClassA.id, 'SUNDAY', '00:00:00', '00:00:01');
    const scheduleB = await createSchedule(classB.id, 'SATURDAY', '09:00:00', '11:00:00');
    const adminSchedule = await createSchedule(adminClass.id, 'FRIDAY', '14:00:00', '16:00:00');
    const pendingSchedule = await createSchedule(pendingClass.id, 'TUESDAY', '17:00:00', '18:00:00');
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const initialSchedules = await prisma.classSchedule.findMany({ where: { id: { in: scheduleIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(classId: string | number, scheduleId: string, token?: string, body?: unknown, query = '') {
      const response = await fetch(`${baseUrl}/${classId}/schedules/${scheduleId}${query}`, {
        method: 'PATCH',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(classA.id, scheduleA.id, token, { dayOfWeek: 'TUESDAY' });
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(pendingClass.id, pendingSchedule.id, tokenPending, { dayOfWeek: 'WEDNESDAY' });
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);

    const invalidClass = {
      status: 400,
      body: { success: false, message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647' },
    };
    for (const classId of ['abc', '0', '-1', '1.5', '2147483648']) {
      assert.deepEqual(await request(classId, scheduleA.id, tokenA, {}), invalidClass);
    }
    assert.deepEqual(await request('abc', 'not-a-uuid', tokenA, {}), invalidClass);
    assert.deepEqual(await request(classA.id, 'not-a-uuid', tokenA, {}), {
      status: 400,
      body: { success: false, message: 'ID lịch học phải là UUID hợp lệ' },
    });

    const invalidBodies: Array<[unknown, string]> = [
      [undefined, 'body'], [{}, 'body'], [[], 'body'],
      [{ dayOfWeek: null }, 'dayOfWeek'], [{ dayOfWeek: 'monday' }, 'dayOfWeek'],
      [{ startTime: null }, 'startTime'], [{ startTime: 19 }, 'startTime'],
      [{ endTime: null }, 'endTime'], [{ endTime: '' }, 'endTime'],
      [{ endTime: '24:00' }, 'endTime'], [{ endTime: '21:00Z' }, 'endTime'],
      [{ endTime: '21:00\n' }, 'endTime'], [{ endTime: '21:00:00\r\n' }, 'endTime'],
    ];
    for (const startTime of ['9:00', '19:60', '19:00:60', ' 19:00', '19:00:00.001', '19:00Z', '2026-10-06T19:00:00Z', '19:00\n']) {
      invalidBodies.push([{ startTime }, 'startTime']);
    }
    const forbiddenFields: Record<string, unknown> = {
      teacherId: userB.id, teacher_id: userB.id, classId: classB.id, id: randomUUID(),
      classRecord: { connect: { id: classB.id } },
      createdAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z',
      status: 'ACTIVE', note: 'Không được lưu',
    };
    for (const [field, value] of Object.entries(forbiddenFields)) {
      invalidBodies.push([{ dayOfWeek: 'TUESDAY', [field]: value }, 'body']);
    }
    for (const [body, field] of invalidBodies) {
      const invalid = await request(classA.id, scheduleA.id, tokenA, body);
      assert.equal(invalid.status, 400, field);
      assert.equal(invalid.body.success, false);
      assert.equal(invalid.body.message, 'Thông tin lịch học không hợp lệ');
      assert.ok(invalid.body.errors.some((issue: { field: string; message: string }) => (
        issue.field === field && typeof issue.message === 'string' && issue.message.length > 0
      )), field);
    }
    assert.deepEqual(await request(classA.id, scheduleA.id, tokenA, null), {
      status: 400,
      body: { success: false, message: 'Body JSON không hợp lệ' },
    });
    for (const body of [
      { startTime: '21:00' }, { startTime: '22:00' },
      { endTime: '19:00' }, { endTime: '18:00' },
      { startTime: '19:00', endTime: '19:00:00' },
      { startTime: '23:00', endTime: '01:00' },
      { startTime: '19:00:20', endTime: '19:00:19' },
    ]) {
      assert.deepEqual(await request(classA.id, scheduleA.id, tokenA, body), invalidHours);
    }

    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy lịch học' } };
    const hiddenRequests: Array<[number, string, string]> = [
      [classA.id, randomUUID(), tokenA], [2147483647, scheduleA.id, tokenA],
      [otherClassA.id, scheduleA.id, tokenA], [classA.id, otherScheduleA.id, tokenA],
      [classB.id, scheduleB.id, tokenA], [classA.id, scheduleA.id, tokenB],
      [classA.id, scheduleB.id, tokenA], [classB.id, scheduleA.id, tokenA],
      [classA.id, scheduleA.id, tokenAdmin], [classB.id, scheduleB.id, tokenAdmin],
    ];
    for (const [classId, scheduleId, token] of hiddenRequests) {
      assert.deepEqual(await request(classId, scheduleId, token, { dayOfWeek: 'TUESDAY' }), notFound);
    }
    assert.deepEqual(await request(classB.id, scheduleB.id, tokenA, { dayOfWeek: 'TUESDAY' },
      `?teacherId=${userA.id}&classId=${classA.id}&scheduleId=${scheduleA.id}`), notFound);
    assert.deepEqual(await prisma.classSchedule.findMany({ where: { id: { in: scheduleIds } }, orderBy: { id: 'asc' } }), initialSchedules);

    async function patchAndAssert(
      schedule: ClassSchedule,
      token: string,
      body: Record<string, string>,
      expectedDay: string,
      expectedStart: string,
      expectedEnd: string,
      query = '',
      scheduleId = schedule.id,
    ) {
      const before = await prisma.classSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      const result = await request(schedule.classId, scheduleId, token, body, query);
      const after = await prisma.classSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      assert.equal(after.id, before.id);
      assert.equal(after.classId, before.classId);
      assert.deepEqual(after.createdAt, before.createdAt);
      if (!('dayOfWeek' in body)) assert.equal(after.dayOfWeek, before.dayOfWeek);
      if (!('startTime' in body)) assert.deepEqual(after.startTime, before.startTime);
      if (!('endTime' in body)) assert.deepEqual(after.endTime, before.endTime);
      assert.ok(after.updatedAt.getTime() >= before.updatedAt.getTime());
      assert.equal(after.dayOfWeek, expectedDay);
      assert.equal(after.startTime.toISOString(), `1970-01-01T${expectedStart}.000Z`);
      assert.equal(after.endTime.toISOString(), `1970-01-01T${expectedEnd}.000Z`);
      assert.deepEqual(result, expectedSuccess(after, expectedDay, expectedStart, expectedEnd));
      return after;
    }

    const firstUpdated = await patchAndAssert(scheduleA, tokenA, { dayOfWeek: 'THURSDAY' }, 'THURSDAY', '19:00:00', '21:00:00');
    assert.ok(firstUpdated.updatedAt.getTime() > scheduleA.updatedAt.getTime());
    await patchAndAssert(scheduleA, tokenA, { startTime: '19:30:15' }, 'THURSDAY', '19:30:15', '21:00:00');
    await patchAndAssert(scheduleA, tokenA, { endTime: '22:00' }, 'THURSDAY', '19:30:15', '22:00:00');
    await patchAndAssert(scheduleA, tokenA, { dayOfWeek: 'SUNDAY', startTime: '23:59:58', endTime: '23:59:59' }, 'SUNDAY', '23:59:58', '23:59:59');
    await patchAndAssert(scheduleA, tokenA, { dayOfWeek: 'WEDNESDAY' }, 'WEDNESDAY', '23:59:58', '23:59:59',
      `?teacherId=${userB.id}&classId=${classB.id}&scheduleId=${scheduleB.id}`);
    await patchAndAssert(scheduleA, tokenA, { dayOfWeek: 'MONDAY' }, 'MONDAY', '23:59:58', '23:59:59', '', scheduleA.id.toUpperCase());
    await patchAndAssert(scheduleB, tokenB, { startTime: '09:00:01' }, 'SATURDAY', '09:00:01', '11:00:00');
    await patchAndAssert(adminSchedule, tokenAdmin, { endTime: '17:00' }, 'FRIDAY', '14:00:00', '17:00:00');

    // Hai PATCH riêng hợp lệ với trạng thái cũ, nhưng kết hợp sẽ đảo thứ tự giờ.
    for (let attempt = 0; attempt < 3; attempt++) {
      const baseline = await prisma.classSchedule.update({
        where: { id: scheduleA.id },
        data: { startTime: new Date('1970-01-01T19:00:00.000Z'), endTime: new Date('1970-01-01T21:00:00.000Z') },
      });
      const concurrent = await Promise.all([
        request(classA.id, scheduleA.id, tokenA, { startTime: '20:00' }),
        request(classA.id, scheduleA.id, tokenA, { endTime: '19:30' }),
      ]);
      assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 400]);
      assert.deepEqual(concurrent.find(result => result.status === 400), invalidHours);
      const after = await prisma.classSchedule.findUniqueOrThrow({ where: { id: scheduleA.id } });
      const startWon = concurrent[0].status === 200;
      const expectedStart = startWon ? '20:00:00' : '19:00:00';
      const expectedEnd = startWon ? '21:00:00' : '19:30:00';
      assert.ok(after.endTime > after.startTime);
      assert.deepEqual({ ...after, startTime: baseline.startTime, endTime: baseline.endTime, updatedAt: baseline.updatedAt }, baseline);
      assert.equal(after.startTime.toISOString(), `1970-01-01T${expectedStart}.000Z`);
      assert.equal(after.endTime.toISOString(), `1970-01-01T${expectedEnd}.000Z`);
      assert.deepEqual(concurrent.find(result => result.status === 200), expectedSuccess(after, baseline.dayOfWeek, expectedStart, expectedEnd));
    }

    assert.deepEqual(await prisma.classSchedule.findUniqueOrThrow({ where: { id: otherScheduleA.id } }), otherScheduleA);
    assert.deepEqual(await prisma.classSchedule.findUniqueOrThrow({ where: { id: pendingSchedule.id } }), pendingSchedule);
    assert.equal(await prisma.classSchedule.count({ where: { classId: { in: classIds } } }), scheduleIds.length);
    assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
    console.log('PASS: PATCH ClassSchedule đúng trường/ownership, validate giờ gộp, giữ trường không gửi và chống cập nhật đồng thời');
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
