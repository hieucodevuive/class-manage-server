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

test('DELETE /api/classes/:classId/schedules/:scheduleId chỉ xóa lịch đúng chủ sở hữu và giữ lịch sử', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const prefix = `schedule-delete-test-${randomUUID()}`;
  const deletedIds = new Set<string>();
  const success = { status: 200, body: { success: true, message: 'Xóa lịch học thành công' } };
  const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy lịch học' } };

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

    async function createSchedule(classId: number, dayOfWeek: ClassSchedule['dayOfWeek']) {
      return prisma.classSchedule.create({
        data: {
          classId,
          dayOfWeek,
          startTime: new Date('1970-01-01T19:05:07.000Z'),
          endTime: new Date('1970-01-01T21:08:09.000Z'),
          createdAt: new Date('2026-09-01T01:02:03.456Z'),
          updatedAt: new Date('2026-09-02T04:05:06.789Z'),
        },
      });
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
    const scheduleA = await createSchedule(classA.id, 'MONDAY');
    const siblingA = await createSchedule(classA.id, 'WEDNESDAY');
    const concurrentSchedule = await createSchedule(classA.id, 'FRIDAY');
    const otherScheduleA = await createSchedule(otherClassA.id, 'SUNDAY');
    const scheduleB = await createSchedule(classB.id, 'SATURDAY');
    const adminSchedule = await createSchedule(adminClass.id, 'THURSDAY');
    const pendingSchedule = await createSchedule(pendingClass.id, 'TUESDAY');
    const student = await prisma.student.create({
      data: { teacherId: userA.id, fullName: `${prefix}-student`, status: 'INACTIVE' },
    });
    studentIds.push(student.id);
    const enrollment = await prisma.classStudent.create({
      data: {
        classId: classA.id,
        studentId: student.id,
        joinedAt: new Date('2026-09-01T00:00:00.000Z'),
        leftAt: new Date('2026-10-01T00:00:00.000Z'),
        status: 'LEFT',
      },
    });
    enrollmentIds.push(enrollment.id);
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const initialSchedules = await prisma.classSchedule.findMany({ where: { classId: { in: classIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(classId: string | number, scheduleId: string, token?: string, body?: unknown, query = '') {
      const response = await fetch(`${baseUrl}/${classId}/schedules/${scheduleId}${query}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    async function assertRemainingSchedules() {
      assert.deepEqual(
        await prisma.classSchedule.findMany({ where: { classId: { in: classIds } }, orderBy: { id: 'asc' } }),
        initialSchedules.filter(schedule => !deletedIds.has(schedule.id)),
      );
    }

    async function assertHistoryUnchanged() {
      assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
      assert.deepEqual(await prisma.student.findUniqueOrThrow({ where: { id: student.id } }), student);
      assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: enrollment.id } }), enrollment);
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
    for (const scheduleId of ['not-a-uuid', scheduleA.id.replace(/-/g, '')]) {
      assert.deepEqual(await request(classA.id, scheduleId, tokenA), {
        status: 400,
        body: { success: false, message: 'ID lịch học phải là UUID hợp lệ' },
      });
    }

    const hiddenRequests: Array<[number, string, string]> = [
      [classA.id, randomUUID(), tokenA], [2147483647, scheduleA.id, tokenA],
      [otherClassA.id, scheduleA.id, tokenA], [classA.id, otherScheduleA.id, tokenA],
      [classB.id, scheduleB.id, tokenA], [classA.id, scheduleA.id, tokenB],
      [classA.id, scheduleB.id, tokenA], [classB.id, scheduleA.id, tokenA],
      [classA.id, scheduleA.id, tokenAdmin], [classB.id, scheduleB.id, tokenAdmin],
      [adminClass.id, adminSchedule.id, tokenA],
    ];
    for (const [classId, scheduleId, token] of hiddenRequests) {
      assert.deepEqual(await request(classId, scheduleId, token), notFound);
    }
    assert.deepEqual(await request(classB.id, scheduleB.id, tokenA, {
      teacherId: userB.id, classId: classA.id, scheduleId: scheduleA.id,
    }, `?teacherId=${userB.id}&classId=${classA.id}&scheduleId=${scheduleA.id}`), notFound);
    assert.deepEqual(await request(otherClassA.id, scheduleA.id, tokenA, {
      classId: classA.id, scheduleId: scheduleA.id,
    }, `?classId=${classA.id}`), notFound);
    await assertRemainingSchedules();
    await assertHistoryUnchanged();

    // Chỉ ID trong URL được xóa; body/query không chuyển sang lịch của B.
    assert.deepEqual(await request(classA.id, scheduleA.id.toUpperCase(), tokenA, {
      teacherId: userB.id,
      teacher_id: userB.id,
      classId: classB.id,
      scheduleId: scheduleB.id,
      id: scheduleB.id,
      status: 'ACTIVE',
    }, `?teacherId=${userB.id}&classId=${classB.id}&scheduleId=${scheduleB.id}`), success);
    deletedIds.add(scheduleA.id);
    assert.equal(await prisma.classSchedule.findUnique({ where: { id: scheduleA.id } }), null);
    assert.deepEqual(await request(classA.id, scheduleA.id, tokenA), notFound);
    await assertRemainingSchedules();
    await assertHistoryUnchanged();

    assert.deepEqual(await request(classB.id, scheduleB.id, tokenB), success);
    deletedIds.add(scheduleB.id);
    assert.deepEqual(await request(adminClass.id, adminSchedule.id, tokenAdmin), success);
    deletedIds.add(adminSchedule.id);
    assert.equal(await prisma.classSchedule.findUnique({ where: { id: scheduleB.id } }), null);
    assert.equal(await prisma.classSchedule.findUnique({ where: { id: adminSchedule.id } }), null);

    const concurrent = await Promise.all([
      request(classA.id, concurrentSchedule.id, tokenA),
      request(classA.id, concurrentSchedule.id, tokenA),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 404]);
    assert.deepEqual(concurrent.find(result => result.status === 200), success);
    assert.deepEqual(concurrent.find(result => result.status === 404), notFound);
    deletedIds.add(concurrentSchedule.id);
    assert.equal(await prisma.classSchedule.findUnique({ where: { id: concurrentSchedule.id } }), null);
    assert.deepEqual(await request(classA.id, concurrentSchedule.id, tokenA), notFound);
    await assertRemainingSchedules();
    await assertHistoryUnchanged();
    assert.deepEqual(await prisma.classSchedule.findUniqueOrThrow({ where: { id: siblingA.id } }), siblingA);
    assert.deepEqual(await prisma.classSchedule.findUniqueOrThrow({ where: { id: otherScheduleA.id } }), otherScheduleA);
    assert.deepEqual(await prisma.classSchedule.findUniqueOrThrow({ where: { id: pendingSchedule.id } }), pendingSchedule);
    console.log('PASS: DELETE đúng lịch/ownership, bỏ qua body/query, xóa lặp/đồng thời và giữ Class/Student/Enrollment');
  } finally {
    try {
      if (classIds.length) {
        await prisma.classSchedule.deleteMany({ where: { classId: { in: classIds } } });
      }
      if (enrollmentIds.length) {
        await prisma.classStudent.deleteMany({ where: { id: { in: enrollmentIds } } });
      }
      if (classIds.length) {
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
