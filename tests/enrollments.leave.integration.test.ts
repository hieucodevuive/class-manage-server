import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { Prisma, type ClassStudent } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

test('DELETE /api/classes/:classId/students/:studentId giữ lịch sử và chỉ cho chủ sở hữu nghỉ lớp', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const paymentIds: string[] = [];
  const prefix = `enrollment-leave-test-${randomUUID()}`;
  const setupDay = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  function dayWithOffset(days: number) {
    return new Date(setupDay.getTime() + days * 24 * 60 * 60 * 1000);
  }

  function successResponse(enrollment: ClassStudent) {
    return {
      status: 200,
      body: {
        success: true,
        message: 'Học sinh đã rời lớp',
        data: {
          enrollment: {
            id: enrollment.id,
            classId: enrollment.classId,
            studentId: enrollment.studentId,
            joinedAt: enrollment.joinedAt.toISOString().slice(0, 10),
            leftAt: enrollment.leftAt?.toISOString().slice(0, 10) ?? null,
            status: enrollment.status,
            createdAt: enrollment.createdAt.toISOString(),
            updatedAt: enrollment.updatedAt.toISOString(),
          },
        },
      },
    };
  }

  function assertNewLeave(original: ClassStudent, updated: ClassStudent, startDay: string, endDay: string) {
    assert.equal(updated.status, 'LEFT');
    assert.ok(updated.leftAt);
    const leftDay = updated.leftAt.toISOString().slice(0, 10);
    assert.ok([startDay, endDay].includes(leftDay), 'Ngày nghỉ phải là ngày UTC khi request diễn ra');
    assert.equal(updated.leftAt.toISOString(), `${leftDay}T00:00:00.000Z`);
    assert.deepEqual({ ...updated, status: original.status, leftAt: original.leftAt, updatedAt: original.updatedAt }, original);
    assert.ok(updated.updatedAt.getTime() > original.updatedAt.getTime());
  }

  try {
    async function createUser(suffix: string, role: 'TEACHER' | 'ADMIN' = 'TEACHER', status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
      const user = await prisma.user.create({
        data: { email: `${prefix}-${suffix}@example.test`, passwordHash: 'test-fixture-no-login', role, status },
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
          startDate: dayWithOffset(-30),
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

    async function createEnrollment(classId: number, studentId: string, status: 'ACTIVE' | 'LEFT' = 'ACTIVE', joinedAt = dayWithOffset(-7)) {
      const enrollment = await prisma.classStudent.create({
        data: {
          classId,
          studentId,
          joinedAt,
          status,
          leftAt: status === 'LEFT' ? dayWithOffset(-1) : null,
          createdAt: new Date('2020-01-01T01:02:03.456Z'),
          updatedAt: new Date('2020-01-02T04:05:06.789Z'),
        },
      });
      enrollmentIds.push(enrollment.id);
      return enrollment;
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const classA = await createClass(userA.id, 'class-a');
    const otherClassA = await createClass(userA.id, 'class-a-other');
    const classB = await createClass(userB.id, 'class-b');
    const adminClass = await createClass(admin.id, 'class-admin');
    const studentA = await createStudent(userA.id, 'student-a');
    const historicalStudent = await createStudent(userA.id, 'student-history');
    const futureStudent = await createStudent(userA.id, 'student-future');
    const concurrentStudent = await createStudent(userA.id, 'student-concurrent');
    const studentB = await createStudent(userB.id, 'student-b');
    const adminStudent = await createStudent(admin.id, 'student-admin');
    const enrollmentA = await createEnrollment(classA.id, studentA.id);
    const otherEnrollmentA = await createEnrollment(otherClassA.id, studentA.id);
    const historical = await createEnrollment(classA.id, historicalStudent.id, 'LEFT');
    const future = await createEnrollment(classA.id, futureStudent.id, 'ACTIVE', dayWithOffset(7));
    const concurrentEnrollment = await createEnrollment(classA.id, concurrentStudent.id);
    const enrollmentB = await createEnrollment(classB.id, studentB.id);
    const adminEnrollment = await createEnrollment(adminClass.id, adminStudent.id);
    const billingPeriod = new Date(`${setupDay.toISOString().slice(0, 7)}-01T00:00:00.000Z`);
    const createdPayment = await prisma.payment.create({
      data: {
        classStudentId: adminEnrollment.id,
        billingPeriod,
        amountDue: adminClass.tuitionFee.toFixed(2),
      },
    });
    paymentIds.push(createdPayment.id);
    const adminPayment = await prisma.payment.findUniqueOrThrow({ where: { id: createdPayment.id } });
    assert.deepEqual(adminPayment, createdPayment);
    assert.match(adminPayment.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(adminPayment.classStudentId, adminEnrollment.id);
    assert.equal(adminPayment.billingPeriod.toISOString(), billingPeriod.toISOString());
    assert.ok(Prisma.Decimal.isDecimal(adminPayment.amountDue));
    assert.ok(Prisma.Decimal.isDecimal(adminPayment.amountPaid));
    assert.equal(adminPayment.amountDue.toFixed(2), adminClass.tuitionFee.toFixed(2));
    assert.equal(adminPayment.amountPaid.toFixed(2), '0.00');
    assert.equal(adminPayment.paidAt, null);
    assert.equal(adminPayment.paymentMethod, null);
    assert.equal(adminPayment.note, null);

    async function assertAdminPaymentUnchanged() {
      assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id: adminPayment.id } }), adminPayment);
      const enrollmentWithPayments = await prisma.classStudent.findUniqueOrThrow({
        where: { id: adminEnrollment.id },
        include: { payments: true },
      });
      assert.deepEqual(enrollmentWithPayments.payments, [adminPayment]);
    }
    await assertAdminPaymentUnchanged();
    const adminSchedule = await prisma.classSchedule.create({
      data: {
        classId: adminClass.id,
        dayOfWeek: 'MONDAY',
        startTime: new Date('1970-01-01T19:00:00.000Z'),
        endTime: new Date('1970-01-01T21:00:00.000Z'),
      },
    });
    const malformedOwnership = await createEnrollment(classA.id, studentB.id);
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const initialEnrollments = await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });
    const initialStudents = await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    async function request(path: string, method: 'GET' | 'POST' | 'DELETE', token?: string, body?: unknown) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    function leave(classId: string | number, studentId: string, token?: string, body?: unknown) {
      return request(`/classes/${classId}/students/${studentId}`, 'DELETE', token, body);
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await leave(classA.id, studentA.id, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await leave(classA.id, studentA.id, tokenPending);
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);

    for (const classId of ['abc', '0', '-1', '1.5', '2147483648']) {
      const invalid = await leave(classId, studentA.id, tokenA);
      assert.equal(invalid.status, 400, classId);
      assert.equal(invalid.body.success, false);
    }
    const invalidStudent = await leave(classA.id, 'not-a-uuid', tokenA);
    assert.equal(invalidStudent.status, 400);
    assert.equal(invalidStudent.body.success, false);

    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy ghi danh' } };
    const hiddenRequests: Array<[number, string, string]> = [
      [classB.id, studentB.id, tokenA],
      [classA.id, studentA.id, tokenB],
      [classA.id, studentA.id, tokenAdmin],
      [classA.id, studentB.id, tokenA],
      [classA.id, studentB.id, tokenB],
      [2147483647, studentA.id, tokenA],
      [classA.id, randomUUID(), tokenA],
      [otherClassA.id, historicalStudent.id, tokenA],
    ];
    for (const [classId, studentId, token] of hiddenRequests) {
      assert.deepEqual(await leave(classId, studentId, token), notFound);
    }

    assert.deepEqual(await leave(classA.id, futureStudent.id, tokenA), {
      status: 400,
      body: { success: false, message: 'Ngày nghỉ không được trước ngày vào lớp' },
    });
    assert.deepEqual(await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } }), initialEnrollments);

    const firstStartDay = new Date().toISOString().slice(0, 10);
    const firstLeave = await leave(classA.id, studentA.id, tokenA, {
      teacherId: userB.id,
      teacher_id: userB.id,
      classId: classB.id,
      studentId: studentB.id,
      joinedAt: '2099-01-01',
      leftAt: '2000-01-01',
      status: 'ACTIVE',
      updatedAt: '2099-01-01T00:00:00.000Z',
    });
    const firstEndDay = new Date().toISOString().slice(0, 10);
    const leftA = await prisma.classStudent.findUniqueOrThrow({ where: { id: enrollmentA.id } });
    assertNewLeave(enrollmentA, leftA, firstStartDay, firstEndDay);
    assert.deepEqual(firstLeave, successResponse(leftA));
    assert.equal(await prisma.classStudent.count({ where: { classId: classA.id, studentId: studentA.id } }), 1);
    assert.deepEqual(await leave(classA.id, studentA.id, tokenA), firstLeave);
    assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: enrollmentA.id } }), leftA);

    // Bản ghi LEFT từ trước phải giữ nguyên ngày nghỉ và timestamp khi gọi lại.
    assert.deepEqual(await leave(classA.id, historicalStudent.id, tokenA), successResponse(historical));
    assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: historical.id } }), historical);

    const concurrentStartDay = new Date().toISOString().slice(0, 10);
    const concurrent = await Promise.all([
      leave(classA.id, concurrentStudent.id, tokenA),
      leave(classA.id, concurrentStudent.id, tokenA),
    ]);
    const concurrentEndDay = new Date().toISOString().slice(0, 10);
    const concurrentLeft = await prisma.classStudent.findUniqueOrThrow({ where: { id: concurrentEnrollment.id } });
    assertNewLeave(concurrentEnrollment, concurrentLeft, concurrentStartDay, concurrentEndDay);
    assert.deepEqual(concurrent, [successResponse(concurrentLeft), successResponse(concurrentLeft)]);
    assert.equal(await prisma.classStudent.count({ where: { classId: classA.id, studentId: concurrentStudent.id } }), 1);
    assert.deepEqual(await leave(classA.id, concurrentStudent.id, tokenA), successResponse(concurrentLeft));
    assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: concurrentEnrollment.id } }), concurrentLeft);

    const adminStartDay = new Date().toISOString().slice(0, 10);
    const adminLeave = await leave(adminClass.id, adminStudent.id, tokenAdmin);
    const adminEndDay = new Date().toISOString().slice(0, 10);
    const adminLeft = await prisma.classStudent.findUniqueOrThrow({ where: { id: adminEnrollment.id } });
    assertNewLeave(adminEnrollment, adminLeft, adminStartDay, adminEndDay);
    assert.deepEqual(adminLeave, successResponse(adminLeft));
    await assertAdminPaymentUnchanged();

    const list = await request(`/classes/${classA.id}/students`, 'GET', tokenA);
    assert.equal(list.status, 200);
    const listedLeft = list.body.data.enrollments.find((enrollment: { id: string }) => enrollment.id === leftA.id);
    assert.ok(listedLeft);
    const { student: listedStudent, ...listedEnrollment } = listedLeft;
    assert.equal(listedStudent.id, studentA.id);
    assert.deepEqual(listedEnrollment, firstLeave.body.data.enrollment);

    assert.deepEqual(await request(`/classes/${classA.id}/students`, 'POST', tokenA, {
      studentId: studentA.id,
      joinedAt: setupDay.toISOString().slice(0, 10),
    }), {
      status: 409,
      body: { success: false, message: 'Học sinh đã từng được ghi danh vào lớp này' },
    });

    // Lớp ADMIN có một Enrollment LEFT và Payment, vẫn không được xóa lịch sử.
    assert.deepEqual(await request(`/classes/${adminClass.id}`, 'DELETE', tokenAdmin), {
      status: 409,
      body: { success: false, message: 'Không thể xóa lớp đã có học sinh ghi danh' },
    });
    await assertAdminPaymentUnchanged();
    assert.deepEqual(await request(`/students/${adminStudent.id}`, 'DELETE', tokenAdmin), {
      status: 409,
      body: { success: false, message: 'Không thể xóa học sinh đã có lịch sử ghi danh' },
    });
    await assertAdminPaymentUnchanged();
    assert.deepEqual(await prisma.classSchedule.findUniqueOrThrow({ where: { id: adminSchedule.id } }), adminSchedule);

    for (const untouched of [otherEnrollmentA, future, enrollmentB, malformedOwnership, historical]) {
      assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: untouched.id } }), untouched);
    }
    assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: leftA.id } }), leftA);
    assert.deepEqual(await prisma.classStudent.findUniqueOrThrow({ where: { id: adminLeft.id } }), adminLeft);
    assert.equal(await prisma.classStudent.count({ where: { id: { in: enrollmentIds } } }), enrollmentIds.length);
    assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
    assert.deepEqual(await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } }), initialStudents);
    console.log('PASS: nghỉ lớp đúng ownership, ngày UTC, body bị bỏ qua, lịch sử/idempotence/concurrency và bảo vệ Class/Student/Payment');
  } finally {
    try {
      if (paymentIds.length) {
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
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
