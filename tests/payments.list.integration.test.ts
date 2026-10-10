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

test('GET /api/payments lọc theo AND, tính trạng thái Decimal và giữ đúng phạm vi giáo viên', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const paymentIds: string[] = [];
  const prefix = `payment-list-test-${randomUUID()}`;

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
      id?: string; createdAt?: string; paidAt?: string; paymentMethod?: Payment['paymentMethod']; note?: string;
    } = {}) {
      const row = await prisma.payment.create({
        data: {
          id: options.id, classStudentId: enrollmentId, billingPeriod: new Date(`${period}T00:00:00.000Z`),
          amountDue: new Prisma.Decimal(due), amountPaid: new Prisma.Decimal(paid),
          paidAt: options.paidAt ? new Date(options.paidAt) : null,
          paymentMethod: options.paymentMethod ?? null, note: options.note ?? null,
          createdAt: new Date(options.createdAt ?? '2026-09-08T01:02:03.456Z'),
          updatedAt: new Date('2026-10-09T04:05:06.789Z'),
        },
      });
      paymentIds.push(row.id);
      assert.ok(Prisma.Decimal.isDecimal(row.amountDue) && Prisma.Decimal.isDecimal(row.amountPaid));
      assert.equal(row.amountDue.toFixed(2), due);
      assert.equal(row.amountPaid.toFixed(2), paid);
      assert.equal(row.billingPeriod.toISOString(), `${period}T00:00:00.000Z`);
      return row;
    }
    function paymentView(row: Payment, status: 'UNPAID' | 'PARTIAL' | 'PAID') {
      return {
        id: row.id, classStudentId: row.classStudentId, billingPeriod: row.billingPeriod.toISOString().slice(0, 10),
        amountDue: row.amountDue.toFixed(2), amountPaid: row.amountPaid.toFixed(2),
        paidAt: row.paidAt?.toISOString() ?? null, paymentMethod: row.paymentMethod, note: row.note,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), status,
      };
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const emptyUser = await createUser('empty');
    const classA = await createClass(userA.id, 'class-a');
    const otherClassA = await createClass(userA.id, 'class-a-history', 'COMPLETED');
    const classB = await createClass(userB.id, 'class-b');
    const adminClass = await createClass(admin.id, 'class-admin', 'INACTIVE');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const studentA = await createStudent(userA.id, 'student-a');
    const historicalStudentA = await createStudent(userA.id, 'student-a-history', 'INACTIVE');
    const studentB = await createStudent(userB.id, 'student-b');
    const adminStudent = await createStudent(admin.id, 'student-admin');
    const pendingStudent = await createStudent(pending.id, 'student-pending');
    const enrollmentA = await createEnrollment(classA.id, studentA.id);
    const leftEnrollmentA = await createEnrollment(classA.id, historicalStudentA.id, 'LEFT');
    const otherEnrollmentA = await createEnrollment(otherClassA.id, studentA.id, 'LEFT');
    const enrollmentB = await createEnrollment(classB.id, studentB.id);
    const adminEnrollment = await createEnrollment(adminClass.id, adminStudent.id);
    const pendingEnrollment = await createEnrollment(pendingClass.id, pendingStudent.id);
    const malformedA = await createEnrollment(classA.id, studentB.id);
    const malformedB = await createEnrollment(classB.id, studentA.id);

    const tiePrefix = randomUUID().slice(0, 24);
    // Tạo theo thứ tự xáo trộn; cùng tháng vẫn ưu tiên createdAt trước UUID.
    const exact = paymentView(await createPayment(otherEnrollmentA.id, '2026-10-01', '100.10', '100.10', {
      id: `${tiePrefix}000000000003`, createdAt: '2026-09-01T01:02:03.456Z',
      paidAt: '2026-10-06T12:34:56.789+07:00', paymentMethod: 'BANK_TRANSFER', note: 'Học phí lịch sử',
    }), 'PAID');
    const ancient = paymentView(await createPayment(enrollmentA.id, '0001-01-01', '100.00', '0.00', {
      createdAt: '2026-11-20T01:02:03.456Z',
    }), 'UNPAID');
    const maximum = paymentView(await createPayment(enrollmentA.id, '9999-12-01', '9999999999.99', '9999999999.99'), 'PAID');
    const leap = paymentView(await createPayment(enrollmentA.id, '2024-02-01', '0.01', '0.00'), 'UNPAID');
    const free = paymentView(await createPayment(enrollmentA.id, '2026-11-01', '0.00', '0.00', {
      createdAt: '2026-07-01T01:02:03.456Z',
    }), 'PAID');
    const unpaid = paymentView(await createPayment(enrollmentA.id, '2026-10-01', '500000.25', '0.00', {
      id: `${tiePrefix}000000000001`,
    }), 'UNPAID');
    const partial = paymentView(await createPayment(leftEnrollmentA.id, '2026-10-01', '100.00', '40.01', {
      id: `${tiePrefix}000000000002`,
    }), 'PARTIAL');
    const overpaid = paymentView(await createPayment(leftEnrollmentA.id, '2026-09-01', '50.00', '75.01', {
      createdAt: '2026-11-20T01:02:03.456Z', paidAt: '2026-09-15T00:01:02.345Z', paymentMethod: 'CASH',
    }), 'PAID');
    const cent = paymentView(await createPayment(otherEnrollmentA.id, '2026-09-01', '9999999999.99', '9999999999.98', {
      createdAt: '2026-10-20T01:02:03.456Z', paymentMethod: 'OTHER',
    }), 'PARTIAL');
    const paymentB = paymentView(await createPayment(enrollmentB.id, '2026-10-01', '500000.00', '0.00'), 'UNPAID');
    const paymentAdmin = paymentView(await createPayment(adminEnrollment.id, '2026-10-01', '500000.00', '250000.00'), 'PARTIAL');
    await createPayment(pendingEnrollment.id, '2026-10-01', '500000.00', '0.00');
    await createPayment(malformedA.id, '2026-10-01', '500000.00', '0.00');
    await createPayment(malformedB.id, '2026-10-01', '500000.00', '500000.00');
    const expectedA = [maximum, free, partial, unpaid, exact, overpaid, cent, leap, ancient];
    assert.equal(exact.paidAt, '2026-10-06T05:34:56.789Z');
    const initialPayments = await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } });
    const initialEnrollments = await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });
    const initialStudents = await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } });
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const tokenEmpty = createAccessToken({ id: emptyUser.id, role: 'TEACHER' });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/payments`;
    async function request(token?: string, query = '') {
      const response = await fetch(`${baseUrl}${query ? `?${query}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }
    function query(filters: Record<string, string | number>) {
      return new URLSearchParams(Object.entries(filters).map(([field, value]) => [field, String(value)])).toString();
    }
    async function assertList(token: string, payments: ReturnType<typeof paymentView>[], filters = '') {
      assert.deepEqual(await request(token, filters), { status: 200, body: { success: true, data: { payments } } });
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(tokenPending);
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);
    await assertList(tokenA, expectedA);
    await assertList(tokenB, [paymentB]);
    await assertList(tokenAdmin, [paymentAdmin]);
    await assertList(tokenEmpty, []);

    await assertList(tokenA, [maximum, free, partial, unpaid, overpaid, leap, ancient], query({ classId: classA.id }));
    await assertList(tokenA, [exact, cent], query({ classId: otherClassA.id }));
    await assertList(tokenA, [maximum, free, unpaid, exact, cent, leap, ancient], query({ studentId: studentA.id.toUpperCase() }));
    await assertList(tokenA, [partial, overpaid], query({ studentId: historicalStudentA.id }));
    await assertList(tokenA, [partial, unpaid, exact], query({ billingPeriod: '2026-10-31' }));
    await assertList(tokenA, [leap], query({ billingPeriod: '2024-02-29' }));
    await assertList(tokenA, [ancient], query({ billingPeriod: '0001-01-31' }));
    await assertList(tokenA, [maximum], query({ billingPeriod: '9999-12-31' }));
    await assertList(tokenA, [unpaid, leap, ancient], query({ status: 'UNPAID' }));
    await assertList(tokenA, [partial, cent], query({ status: 'PARTIAL' }));
    await assertList(tokenA, [maximum, free, exact, overpaid], query({ status: 'PAID' }));
    await assertList(tokenA, [partial], query({ classId: classA.id, studentId: historicalStudentA.id, billingPeriod: '2026-10-19', status: 'PARTIAL' }));
    await assertList(tokenA, [], query({ classId: classA.id, studentId: historicalStudentA.id, billingPeriod: '2026-10-19', status: 'PAID' }));
    await assertList(tokenA, [], query({ classId: otherClassA.id, studentId: historicalStudentA.id }));
    await assertList(tokenA, [maximum, free], query({ classId: classA.id, studentId: studentA.id, status: 'PAID' }));

    const emptyFilters: Array<Record<string, string | number>> = [
      { classId: classB.id }, { classId: adminClass.id }, { classId: 2147483647 },
      { studentId: studentB.id }, { studentId: adminStudent.id }, { studentId: randomUUID() },
      { classId: classA.id, studentId: studentB.id }, { classId: classB.id, studentId: studentA.id },
    ];
    for (const filters of emptyFilters) {
      await assertList(tokenA, [], query(filters));
    }
    await assertList(tokenB, [], query({ studentId: studentA.id }));
    await assertList(tokenAdmin, [], query({ classId: classA.id }));
    await assertList(tokenAdmin, [], query({ studentId: studentB.id }));
    await assertList(tokenEmpty, [], query({ classId: classA.id }));

    const invalidQueries = [
      'classId=', 'classId=0', 'classId=-1', 'classId=1.5', 'classId=abc', 'classId=2147483648', 'classId=1e2',
      query({ classId: ` ${classA.id} ` }), query({ classId: `${classA.id}\n` }),
      'studentId=', query({ studentId: 'not-a-uuid' }), query({ studentId: studentA.id.replace(/-/g, '') }),
      query({ studentId: `${studentA.id}\n` }), query({ studentId: `${studentA.id}\r\n` }), query({ studentId: ` ${studentA.id} ` }),
      'billingPeriod=', 'billingPeriod=2026-02-30', 'billingPeriod=2025-02-29', 'billingPeriod=0000-01-01',
      'billingPeriod=10000-01-01', 'billingPeriod=2026-2-01', query({ billingPeriod: '2026-10-19T00:00:00Z' }),
      'status=', 'status=paid', 'status=ACTIVE', 'status=UNKNOWN',
      query({ teacherId: userB.id }), 'limit=1', 'classId%5Bid%5D=1', 'studentId%5B%5D=invalid',
      `classId=${classA.id}&classId=${classA.id}`, `classId=${classA.id}&classId=${classB.id}`,
      `studentId=${studentA.id}&studentId=${historicalStudentA.id}`,
      'billingPeriod=2026-10-01&billingPeriod=2026-10-19', 'status=PAID&status=PARTIAL',
    ];
    for (const filters of invalidQueries) {
      const invalid = await request(tokenA, filters);
      assert.equal(invalid.status, 400, filters);
      assert.equal(invalid.body.success, false);
      assert.equal(invalid.body.message, 'Bộ lọc học phí không hợp lệ');
      assert.ok(Array.isArray(invalid.body.errors) && invalid.body.errors.length > 0);
    }

    assert.deepEqual(await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } }), initialPayments);
    assert.deepEqual(await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } }), initialEnrollments);
    assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
    assert.deepEqual(await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } }), initialStudents);
    console.log('PASS: Payment GET ownership A/B/ADMIN, strict AND filters, Decimal statuses, sorting và không đổi lịch sử');
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
