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

test('GET /api/classes/:classId/schedules/:scheduleId kiểm tra lịch, lớp cha và giáo viên', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const scheduleIds: string[] = [];
  const prefix = `schedule-detail-test-${randomUUID()}`;

  function expectedDetail(schedule: ClassSchedule, startTime: string, endTime: string) {
    return {
      status: 200,
      body: {
        success: true,
        data: {
          schedule: {
            id: schedule.id,
            classId: schedule.classId,
            dayOfWeek: schedule.dayOfWeek,
            startTime,
            endTime,
            createdAt: '2026-09-01T01:02:03.456Z',
            updatedAt: '2026-09-02T04:05:06.789Z',
          },
        },
      },
    };
  }

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
    const scheduleA = await createSchedule(classA.id, 'MONDAY', '19:05:07', '21:08:09');
    const otherScheduleA = await createSchedule(otherClassA.id, 'SUNDAY', '00:00:00', '00:00:01');
    const scheduleB = await createSchedule(classB.id, 'SATURDAY', '23:59:58', '23:59:59');
    const adminSchedule = await createSchedule(adminClass.id, 'FRIDAY', '15:30:10', '16:30:20');
    const pendingSchedule = await createSchedule(pendingClass.id, 'TUESDAY', '18:00:00', '20:00:00');
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

    async function request(classId: string | number, scheduleId: string, token?: string, query = '') {
      const response = await fetch(`${baseUrl}/${classId}/schedules/${scheduleId}${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(classA.id, scheduleA.id, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(pendingClass.id, pendingSchedule.id, tokenPending);
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);

    const invalidClass = {
      status: 400,
      body: { success: false, message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647' },
    };
    for (const classId of ['abc', '0', '-1', '1.5', '2147483648']) {
      assert.deepEqual(await request(classId, scheduleA.id, tokenA), invalidClass);
    }
    assert.deepEqual(await request('abc', 'not-a-uuid', tokenA), invalidClass);
    for (const scheduleId of ['not-a-uuid', scheduleA.id.replace(/-/g, ''), 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz']) {
      assert.deepEqual(await request(classA.id, scheduleId, tokenA), {
        status: 400,
        body: { success: false, message: 'ID lịch học phải là UUID hợp lệ' },
      });
    }

    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy lịch học' } };
    const hiddenRequests: Array<[number, string, string]> = [
      [classA.id, randomUUID(), tokenA],
      [2147483647, scheduleA.id, tokenA],
      [otherClassA.id, scheduleA.id, tokenA],
      [classA.id, otherScheduleA.id, tokenA],
      [classA.id, scheduleB.id, tokenA],
      [classB.id, scheduleA.id, tokenA],
      [classB.id, scheduleB.id, tokenA],
      [classA.id, scheduleA.id, tokenB],
      [classA.id, scheduleA.id, tokenAdmin],
      [classB.id, scheduleB.id, tokenAdmin],
      [adminClass.id, adminSchedule.id, tokenA],
    ];
    for (const [classId, scheduleId, token] of hiddenRequests) {
      assert.deepEqual(await request(classId, scheduleId, token), notFound);
    }

    const ownA = expectedDetail(scheduleA, '19:05:07', '21:08:09');
    assert.deepEqual(await request(classA.id, scheduleA.id, tokenA), ownA);
    assert.deepEqual(await request(classA.id, scheduleA.id.toUpperCase(), tokenA), ownA);
    assert.deepEqual(await request(otherClassA.id, otherScheduleA.id, tokenA), expectedDetail(otherScheduleA, '00:00:00', '00:00:01'));
    assert.deepEqual(await request(classB.id, scheduleB.id, tokenB), expectedDetail(scheduleB, '23:59:58', '23:59:59'));
    assert.deepEqual(await request(adminClass.id, adminSchedule.id, tokenAdmin), expectedDetail(adminSchedule, '15:30:10', '16:30:20'));
    assert.deepEqual(await request(classA.id, scheduleA.id, tokenA,
      `?teacherId=${userB.id}&teacher_id=${userB.id}&classId=${classB.id}&scheduleId=${scheduleB.id}`), ownA);
    assert.deepEqual(await request(classB.id, scheduleB.id, tokenA,
      `?teacherId=${userA.id}&classId=${classA.id}&scheduleId=${scheduleA.id}`), notFound);
    assert.deepEqual(await request(otherClassA.id, scheduleA.id, tokenA, `?classId=${classA.id}`), notFound);

    assert.deepEqual(await prisma.classSchedule.findMany({ where: { id: { in: scheduleIds } }, orderBy: { id: 'asc' } }), initialSchedules);
    assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
    console.log('PASS: GET chi tiết ClassSchedule đúng ID/lớp/giáo viên, UUID, response/UTC và không thay đổi dữ liệu');
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
