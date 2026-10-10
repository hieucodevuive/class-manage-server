import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { Prisma, type Payment } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

test('GET /api/payments/:id đọc đúng snapshot và quyền sở hữu Class/Student', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const paymentIds: string[] = [];
  const prefix = `payment-detail-test-${randomUUID()}`;

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
          teacherId, name: `${prefix}-${suffix}`, grade: 10, schoolYear: '2026-2027',
          subject: 'Ngữ Văn', tuitionFee: '500000.25', startDate: new Date('2026-09-01T00:00:00.000Z'), status,
        },
      });
      classIds.push(classRecord.id);
      return classRecord;
    }
    async function createStudent(teacherId: number, suffix: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
      const student = await prisma.student.create({ data: { teacherId, fullName: `${prefix}-${suffix}`, status } });
      studentIds.push(student.id);
      return student;
    }
    async function createEnrollment(classId: number, studentId: string, status: 'ACTIVE' | 'LEFT' = 'ACTIVE') {
      const enrollment = await prisma.classStudent.create({
        data: {
          classId, studentId, status, joinedAt: new Date('2026-09-01T00:00:00.000Z'),
          leftAt: status === 'LEFT' ? new Date('2026-10-01T00:00:00.000Z') : null,
        },
      });
      enrollmentIds.push(enrollment.id);
      return enrollment;
    }
    async function createPayment(enrollmentId: string, period: string, due: string, paid: string, options: {
      paidAt?: string; paymentMethod?: Payment['paymentMethod']; note?: string;
    } = {}) {
      const row = await prisma.payment.create({
        data: {
          classStudentId: enrollmentId, billingPeriod: new Date(`${period}T00:00:00.000Z`),
          amountDue: new Prisma.Decimal(due), amountPaid: new Prisma.Decimal(paid),
          paidAt: options.paidAt ? new Date(options.paidAt) : null,
          paymentMethod: options.paymentMethod ?? null, note: options.note ?? null,
          createdAt: new Date('2026-09-08T01:02:03.456Z'), updatedAt: new Date('2026-10-09T04:05:06.789Z'),
        },
      });
      paymentIds.push(row.id);
      assert.ok(Prisma.Decimal.isDecimal(row.amountDue) && Prisma.Decimal.isDecimal(row.amountPaid));
      assert.equal(row.amountDue.toFixed(2), due);
      assert.equal(row.amountPaid.toFixed(2), paid);
      assert.equal(row.billingPeriod.toISOString(), `${period}T00:00:00.000Z`);
      return row;
    }
    function successResponse(row: Payment, status: 'UNPAID' | 'PARTIAL' | 'PAID') {
      return {
        status: 200,
        body: { success: true, data: { payment: {
          id: row.id, classStudentId: row.classStudentId, billingPeriod: row.billingPeriod.toISOString().slice(0, 10),
          amountDue: row.amountDue.toFixed(2), amountPaid: row.amountPaid.toFixed(2),
          paidAt: row.paidAt?.toISOString() ?? null, paymentMethod: row.paymentMethod, note: row.note,
          createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), status,
        } } },
      };
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const classA = await createClass(userA.id, 'class-a');
    const historyClassA = await createClass(userA.id, 'class-history', 'COMPLETED');
    const classB = await createClass(userB.id, 'class-b');
    const adminClass = await createClass(admin.id, 'class-admin', 'INACTIVE');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const studentA = await createStudent(userA.id, 'student-a');
    const historyStudentA = await createStudent(userA.id, 'student-history', 'INACTIVE');
    const studentB = await createStudent(userB.id, 'student-b');
    const adminStudent = await createStudent(admin.id, 'student-admin');
    const pendingStudent = await createStudent(pending.id, 'student-pending');
    const enrollmentA = await createEnrollment(classA.id, studentA.id);
    const historyEnrollment = await createEnrollment(historyClassA.id, historyStudentA.id, 'LEFT');
    const enrollmentB = await createEnrollment(classB.id, studentB.id);
    const adminEnrollment = await createEnrollment(adminClass.id, adminStudent.id);
    const pendingEnrollment = await createEnrollment(pendingClass.id, pendingStudent.id);
    const malformedA = await createEnrollment(classA.id, studentB.id);
    const malformedB = await createEnrollment(classB.id, studentA.id);
    const unpaid = await createPayment(enrollmentA.id, '2026-09-01', '500000.25', '0.00');
    const partial = await createPayment(enrollmentA.id, '2026-10-01', '100.00', '40.01');
    const free = await createPayment(enrollmentA.id, '2026-11-01', '0.00', '0.00');
    const maximum = await createPayment(enrollmentA.id, '2026-12-01', '9999999999.99', '9999999999.99');
    const exact = await createPayment(historyEnrollment.id, '2026-09-01', '100.10', '100.10', {
      paidAt: '2026-09-15T12:34:56.789+07:00', paymentMethod: 'BANK_TRANSFER', note: 'Snapshot lịch sử',
    });
    const overpaid = await createPayment(historyEnrollment.id, '2026-10-01', '50.00', '75.01', {
      paidAt: '2026-10-02T00:01:02.345Z', paymentMethod: 'CASH',
    });
    const cent = await createPayment(historyEnrollment.id, '2026-11-01', '9999999999.99', '9999999999.98', { paymentMethod: 'OTHER' });
    const paymentB = await createPayment(enrollmentB.id, '2026-09-01', '700000.00', '0.00');
    const paymentAdmin = await createPayment(adminEnrollment.id, '2026-09-01', '900000.00', '450000.00');
    const paymentPending = await createPayment(pendingEnrollment.id, '2026-09-01', '500000.00', '0.00');
    const malformedPaymentA = await createPayment(malformedA.id, '2026-09-01', '500000.00', '0.00');
    const malformedPaymentB = await createPayment(malformedB.id, '2026-09-01', '500000.00', '500000.00');
    assert.equal(exact.paidAt?.toISOString(), '2026-09-15T05:34:56.789Z');
    const initialPayments = await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } });
    const initialEnrollments = await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });
    const initialStudents = await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } });
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/payments`;
    async function request(id: string, token?: string, query = '') {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }
    async function assertUnchanged(expectedClasses = initialClasses) {
      assert.deepEqual(await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } }), initialPayments);
      assert.deepEqual(await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } }), initialEnrollments);
      assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), expectedClasses);
      assert.deepEqual(await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } }), initialStudents);
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(unpaid.id, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(paymentPending.id, tokenPending);
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);
    const invalidId = { status: 400, body: { success: false, message: 'ID học phí phải là UUID hợp lệ' } };
    for (const id of [
      'not-a-uuid', '1', unpaid.id.replace(/-/g, ''), unpaid.id.slice(0, -1),
      unpaid.id.replace(/^[0-9a-f]/i, 'g'), `${unpaid.id}\n`, `${unpaid.id}\r\n`, ` ${unpaid.id} `,
    ]) {
      assert.deepEqual(await request(id, tokenA), invalidId);
    }
    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy học phí' } };
    const hiddenRequests: Array<[string, string]> = [
      [randomUUID(), tokenA], ['00000000-0000-0000-0000-000000000000', tokenA],
      [paymentB.id, tokenA], [unpaid.id, tokenB], [unpaid.id, tokenAdmin],
      [paymentB.id, tokenAdmin], [paymentAdmin.id, tokenA],
    ];
    for (const row of [malformedPaymentA, malformedPaymentB]) {
      for (const token of [tokenA, tokenB, tokenAdmin]) hiddenRequests.push([row.id, token]);
    }
    for (const [id, token] of hiddenRequests) assert.deepEqual(await request(id, token), notFound);

    const ownCases: Array<[Payment, 'UNPAID' | 'PARTIAL' | 'PAID']> = [
      [unpaid, 'UNPAID'], [partial, 'PARTIAL'], [free, 'PAID'], [maximum, 'PAID'],
      [exact, 'PAID'], [overpaid, 'PAID'], [cent, 'PARTIAL'],
    ];
    for (const [row, status] of ownCases) {
      assert.deepEqual(await request(row.id, tokenA), successResponse(row, status));
    }
    assert.deepEqual(await request(unpaid.id.toUpperCase(), tokenA), successResponse(unpaid, 'UNPAID'));
    assert.deepEqual(await request(unpaid.id, tokenA), successResponse(unpaid, 'UNPAID'));
    assert.deepEqual(await request(paymentB.id, tokenB), successResponse(paymentB, 'UNPAID'));
    assert.deepEqual(await request(paymentAdmin.id, tokenAdmin), successResponse(paymentAdmin, 'PARTIAL'));

    // Query không được quyết định chủ sở hữu hay thay ID trong URL.
    const spoofQuery = `teacherId=${userB.id}&teacher_id=${userB.id}&id=${paymentB.id}`;
    assert.deepEqual(await request(unpaid.id, tokenA, spoofQuery), successResponse(unpaid, 'UNPAID'));
    assert.deepEqual(await request(paymentB.id.toUpperCase(), tokenA, spoofQuery), notFound);
    assert.deepEqual(await request(unpaid.id, tokenAdmin, `teacherId=${userA.id}&teacher_id=${userA.id}`), notFound);
    await assertUnchanged();

    const changedClass = await prisma.class.update({ where: { id: classA.id }, data: { tuitionFee: '600000.75' } });
    assert.equal(changedClass.tuitionFee.toFixed(2), '600000.75');
    assert.deepEqual({ ...changedClass, tuitionFee: classA.tuitionFee, updatedAt: classA.updatedAt }, classA);
    assert.deepEqual(await request(unpaid.id, tokenA), successResponse(unpaid, 'UNPAID'));
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: unpaid.id } })).amountDue.toFixed(2), '500000.25');
    await assertUnchanged(initialClasses.map(row => row.id === classA.id ? changedClass : row));
    console.log('PASS: Payment detail UUID/auth/ownership, Decimal statuses, lịch sử và snapshot không đổi khi đọc');
  } finally {
    try {
      if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (enrollmentIds.length) await prisma.classStudent.deleteMany({ where: { id: { in: enrollmentIds } } });
      if (classIds.length) await prisma.class.deleteMany({ where: { id: { in: classIds } } });
      if (studentIds.length) await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
