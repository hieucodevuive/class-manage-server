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

test('GET /api/classes/:classId/schedules trả lịch đúng thứ tự và đúng chủ sở hữu lớp', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const scheduleIds: string[] = [];
  const prefix = `schedule-list-test-${randomUUID()}`;

  function expectedList(schedules: ClassSchedule[]) {
    return {
      status: 200,
      body: {
        success: true,
        data: {
          schedules: schedules.map(schedule => ({
            id: schedule.id,
            classId: schedule.classId,
            dayOfWeek: schedule.dayOfWeek,
            startTime: schedule.startTime.toISOString().slice(11, 19),
            endTime: schedule.endTime.toISOString().slice(11, 19),
            createdAt: schedule.createdAt.toISOString(),
            updatedAt: schedule.updatedAt.toISOString(),
          })),
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

    async function createSchedule(
      classId: number,
      dayOfWeek: ClassSchedule['dayOfWeek'],
      startTime = '19:00:00',
      endTime = '21:00:00',
      id: string = randomUUID(),
    ) {
      const schedule = await prisma.classSchedule.create({
        data: {
          id,
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
    const emptyClassA = await createClass(userA.id, 'class-a-empty');
    const classB = await createClass(userB.id, 'class-b', 'COMPLETED');
    const emptyClassB = await createClass(userB.id, 'class-b-empty');
    const adminClass = await createClass(admin.id, 'class-admin');
    const emptyAdminClass = await createClass(admin.id, 'class-admin-empty');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });

    const [lowId, highId] = [randomUUID(), randomUUID()].sort();
    assert.ok(lowId && highId);
    const byDay = new Map<ClassSchedule['dayOfWeek'], ClassSchedule>();
    // Cố ý tạo khác thứ tự tuần và tạo ID lớn trước trong cặp giờ giống nhau.
    const scrambledDays: ClassSchedule['dayOfWeek'][] = ['SUNDAY', 'THURSDAY', 'TUESDAY', 'SATURDAY', 'WEDNESDAY', 'MONDAY', 'FRIDAY'];
    for (const day of scrambledDays) {
      const schedule = day === 'SUNDAY'
        ? await createSchedule(classA.id, day, '00:00:00', '00:00:01')
        : day === 'WEDNESDAY'
          ? await createSchedule(classA.id, day, '23:59:58', '23:59:59')
          : await createSchedule(classA.id, day, '19:00:00', '21:00:00', day === 'MONDAY' ? highId : randomUUID());
      byDay.set(day, schedule);
    }
    const mondayLowerId = await createSchedule(classA.id, 'MONDAY', '19:00:00', '21:00:00', lowId);
    const mondayEarlierEnd = await createSchedule(classA.id, 'MONDAY', '19:00:00', '20:00:00');
    const mondayEarlierStart = await createSchedule(classA.id, 'MONDAY', '08:00:01', '09:00:02');
    const otherA = await createSchedule(otherClassA.id, 'MONDAY', '00:00:00', '00:00:01');
    const scheduleB = await createSchedule(classB.id, 'TUESDAY', '07:00:01', '08:00:02');
    const adminSchedule = await createSchedule(adminClass.id, 'FRIDAY', '15:30:10', '16:30:20');
    await createSchedule(pendingClass.id, 'SATURDAY');
    const orderedWeekdays: ClassSchedule['dayOfWeek'][] = ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const expectedSchedulesA = [mondayEarlierStart, mondayEarlierEnd, mondayLowerId, byDay.get('MONDAY')!];
    for (const day of orderedWeekdays) expectedSchedulesA.push(byDay.get(day)!);
    const initialSchedules = await prisma.classSchedule.findMany({ where: { id: { in: scheduleIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(classId: string | number, token?: string, query = '') {
      const response = await fetch(`${baseUrl}/${classId}/schedules${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(classA.id, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(pendingClass.id, tokenPending);
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);

    for (const classId of ['abc', '0', '-1', '1.5', '2147483648']) {
      assert.deepEqual(await request(classId, tokenA), {
        status: 400,
        body: { success: false, message: 'ID lớp phải là số nguyên dương không vượt quá 2147483647' },
      });
    }
    const classNotFound = { status: 404, body: { success: false, message: 'Không tìm thấy lớp' } };
    assert.deepEqual(await request(2147483647, tokenA), classNotFound);
    assert.deepEqual(await request(classB.id, tokenA), classNotFound);
    assert.deepEqual(await request(emptyClassB.id, tokenA), classNotFound);
    assert.deepEqual(await request(classA.id, tokenB), classNotFound);
    assert.deepEqual(await request(classA.id, tokenAdmin), classNotFound);
    assert.deepEqual(await request(classB.id, tokenAdmin), classNotFound);
    assert.deepEqual(await request(emptyClassA.id, tokenAdmin), classNotFound);
    assert.deepEqual(await request(classB.id, tokenA, `?teacherId=${userB.id}&teacher_id=${userB.id}`), classNotFound);
    assert.deepEqual(await request(classA.id, tokenB, `?teacherId=${userA.id}`), classNotFound);

    assert.deepEqual(await request(emptyClassA.id, tokenA), expectedList([]));
    assert.deepEqual(await request(emptyClassB.id, tokenB), expectedList([]));
    assert.deepEqual(await request(emptyAdminClass.id, tokenAdmin), expectedList([]));
    const listA = await request(classA.id, tokenA);
    assert.deepEqual(listA, expectedList(expectedSchedulesA));
    assert.deepEqual(await request(classA.id, tokenA, `?teacherId=${userB.id}&classId=${classB.id}`), listA);
    assert.deepEqual(await request(classA.id, tokenA), listA);
    assert.deepEqual(await request(otherClassA.id, tokenA), expectedList([otherA]));
    assert.deepEqual(await request(classB.id, tokenB), expectedList([scheduleB]));
    assert.deepEqual(await request(adminClass.id, tokenAdmin), expectedList([adminSchedule]));

    for (const schedule of listA.body.data.schedules) {
      assert.equal(schedule.classId, classA.id);
      assert.match(schedule.startTime, /^\d{2}:\d{2}:\d{2}$/);
      assert.match(schedule.endTime, /^\d{2}:\d{2}:\d{2}$/);
      assert.match(schedule.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.match(schedule.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    assert.deepEqual(await prisma.classSchedule.findMany({ where: { id: { in: scheduleIds } }, orderBy: { id: 'asc' } }), initialSchedules);
    assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
    console.log('PASS: GET ClassSchedule đúng thứ/giờ/ID, response, lớp rỗng, ownership A/B/ADMIN và không thay đổi dữ liệu');
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
