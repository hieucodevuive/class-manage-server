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

test('POST /api/payments giữ snapshot học phí, chuẩn hóa tháng và giới hạn đúng giáo viên', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const createdPayments: Payment[] = [];
  const prefix = `payment-create-test-${randomUUID()}`;

  try {
    async function createUser(suffix: string, role: 'TEACHER' | 'ADMIN' = 'TEACHER', status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
      const user = await prisma.user.create({
        data: { email: `${prefix}-${suffix}@example.test`, passwordHash: 'test-fixture-no-login', role, status },
      });
      userIds.push(user.id);
      return user;
    }

    async function createClass(teacherId: number, suffix: string, status: 'ACTIVE' | 'INACTIVE' | 'COMPLETED' = 'ACTIVE', tuitionFee = '500000.25') {
      const classRecord = await prisma.class.create({
        data: {
          teacherId, name: `${prefix}-${suffix}`, grade: 10, schoolYear: '2026-2027',
          subject: 'Ngữ Văn', tuitionFee, startDate: new Date('2026-09-01T00:00:00.000Z'), status,
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

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const classA = await createClass(userA.id, 'class-a');
    const classB = await createClass(userB.id, 'class-b', 'COMPLETED', '750000.40');
    const adminClass = await createClass(admin.id, 'class-admin', 'INACTIVE', '900000.00');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const studentA = await createStudent(userA.id, 'student-a');
    const leftStudentA = await createStudent(userA.id, 'student-left', 'INACTIVE');
    const studentB = await createStudent(userB.id, 'student-b', 'INACTIVE');
    const adminStudent = await createStudent(admin.id, 'student-admin');
    const pendingStudent = await createStudent(pending.id, 'student-pending');
    const enrollmentA = await createEnrollment(classA.id, studentA.id);
    const leftEnrollmentA = await createEnrollment(classA.id, leftStudentA.id, 'LEFT');
    const enrollmentB = await createEnrollment(classB.id, studentB.id);
    const adminEnrollment = await createEnrollment(adminClass.id, adminStudent.id);
    const pendingEnrollment = await createEnrollment(pendingClass.id, pendingStudent.id);
    // Prisma cho phép tạo quan hệ chéo này; API phải kiểm tra cả Class và Student.
    const malformedA = await createEnrollment(classA.id, studentB.id);
    const malformedB = await createEnrollment(classB.id, studentA.id);
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });
    const initialStudents = await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } });
    const initialEnrollments = await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    async function request(token?: string, body?: unknown) {
      const response = await fetch(`${baseUrl}/payments`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    async function assertParentsUnchanged(expectedClasses = initialClasses) {
      assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), expectedClasses);
      assert.deepEqual(await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } }), initialStudents);
      assert.deepEqual(await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } }), initialEnrollments);
    }

    async function assertPaymentsUnchanged() {
      assert.deepEqual(await prisma.payment.findMany({ where: { classStudentId: { in: enrollmentIds } }, orderBy: { id: 'asc' } }),
        [...createdPayments].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    const valid = { classStudentId: enrollmentA.id, billingPeriod: '2026-10-19' };
    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(token, valid);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(tokenPending, { ...valid, classStudentId: pendingEnrollment.id });
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);

    const invalidBodies: Array<[unknown, string]> = [
      [undefined, 'body'], [[], 'body'], [{}, 'classStudentId'],
      [{ billingPeriod: valid.billingPeriod }, 'classStudentId'],
      [{ classStudentId: enrollmentA.id }, 'billingPeriod'],
      [{ ...valid, classStudentId: null }, 'classStudentId'],
      [{ ...valid, classStudentId: 1 }, 'classStudentId'],
      [{ ...valid, classStudentId: 'not-a-uuid' }, 'classStudentId'],
      [{ ...valid, classStudentId: enrollmentA.id.replace(/-/g, '') }, 'classStudentId'],
      [{ ...valid, classStudentId: `${enrollmentA.id}\n` }, 'classStudentId'],
      [{ ...valid, classStudentId: `${enrollmentA.id}\r\n` }, 'classStudentId'],
      [{ ...valid, classStudentId: ` ${enrollmentA.id} ` }, 'classStudentId'],
      [{ ...valid, note: 123 }, 'note'],
    ];
    for (const billingPeriod of [
      null, '2026-2-01', '2026-02-30', '2025-02-29', '2026-04-31',
      '0000-01-01', '10000-01-01', '2026-10-19T00:00:00Z', '2026-10-19\n',
    ]) {
      invalidBodies.push([{ ...valid, billingPeriod }, 'billingPeriod']);
    }
    for (const amountDue of [-0.01, '-0.01', 1.234, '1.234', 10000000000, '10000000000.00', 'NaN', 'Infinity', '1e3', '00.10', null, true, {}]) {
      invalidBodies.push([{ ...valid, amountDue }, 'amountDue']);
    }
    for (const [field, value] of Object.entries({
      amountPaid: '0.00', paidAt: '2026-10-01T00:00:00Z', paymentMethod: 'CASH',
      id: randomUUID(), status: 'PAID', teacherId: userB.id, teacher_id: userB.id,
      classId: classB.id, studentId: studentB.id, createdAt: '2000-01-01T00:00:00Z',
      updatedAt: '2000-01-01T00:00:00Z', enrollment: { connect: { id: enrollmentB.id } },
    })) {
      invalidBodies.push([{ ...valid, [field]: value }, 'body']);
    }
    for (const [body, field] of invalidBodies) {
      const invalid = await request(tokenA, body);
      assert.equal(invalid.status, 400, field);
      assert.equal(invalid.body.success, false);
      assert.equal(invalid.body.message, 'Thông tin học phí không hợp lệ');
      assert.ok(invalid.body.errors.some((issue: { field: string; message: string }) => (
        issue.field === field && typeof issue.message === 'string' && issue.message.length > 0
      )), field);
    }
    const invalidJson = { status: 400, body: { success: false, message: 'Body JSON không hợp lệ' } };
    assert.deepEqual(await request(tokenA, null), invalidJson);
    const malformedJson = await fetch(`${baseUrl}/payments`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: '{"classStudentId":',
    });
    assert.deepEqual({ status: malformedJson.status, body: await malformedJson.json() }, invalidJson);

    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy ghi danh' } };
    const hiddenRequests: Array<[string, string]> = [
      [enrollmentB.id, tokenA], [enrollmentA.id, tokenB],
      [enrollmentA.id, tokenAdmin], [enrollmentB.id, tokenAdmin], [adminEnrollment.id, tokenA],
      [malformedA.id, tokenA], [malformedA.id, tokenB], [malformedA.id, tokenAdmin],
      [malformedB.id, tokenB], [malformedB.id, tokenA], [randomUUID(), tokenA],
    ];
    for (const [classStudentId, token] of hiddenRequests) {
      assert.deepEqual(await request(token, { ...valid, classStudentId }), notFound);
    }
    await assertPaymentsUnchanged();
    await assertParentsUnchanged();

    type CreateBody = { classStudentId: string; billingPeriod: string; amountDue?: number | string; note?: string | null };
    async function assertCreated(result: Awaited<ReturnType<typeof request>>, enrollmentId: string, period: string, due: string, note: string | null) {
      assert.equal(result.status, 201);
      const responsePayment = result.body.data.payment;
      assert.match(responsePayment.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.ok(!createdPayments.some(row => row.id === responsePayment.id));
      const persisted = await prisma.payment.findUniqueOrThrow({ where: { id: responsePayment.id } });
      assert.equal(persisted.classStudentId, enrollmentId);
      assert.equal(persisted.billingPeriod.toISOString(), `${period}T00:00:00.000Z`);
      assert.ok(Prisma.Decimal.isDecimal(persisted.amountDue));
      assert.ok(Prisma.Decimal.isDecimal(persisted.amountPaid));
      assert.equal(persisted.amountDue.toFixed(2), due);
      assert.equal(persisted.amountPaid.toFixed(2), '0.00');
      assert.equal(persisted.paidAt, null);
      assert.equal(persisted.paymentMethod, null);
      assert.equal(persisted.note, note);
      assert.ok(persisted.createdAt instanceof Date && persisted.updatedAt instanceof Date);
      assert.deepEqual(result, {
        status: 201,
        body: {
          success: true, message: 'Tạo học phí thành công',
          data: { payment: {
            id: persisted.id, classStudentId: enrollmentId, billingPeriod: period,
            amountDue: due, amountPaid: '0.00', paidAt: null, paymentMethod: null, note,
            createdAt: persisted.createdAt.toISOString(), updatedAt: persisted.updatedAt.toISOString(),
          } },
        },
      });
      createdPayments.push(persisted);
      return persisted;
    }

    function createAndAssert(token: string, body: CreateBody, period: string, due: string, note: string | null = null) {
      return request(token, body).then(result => assertCreated(result, body.classStudentId.toLowerCase(), period, due, note));
    }
    const firstPayment = await createAndAssert(tokenA, {
      classStudentId: enrollmentA.id.toUpperCase(), billingPeriod: '2024-02-29', note: '  Học phí tháng 2  ',
    }, '2024-02-01', '500000.25', 'Học phí tháng 2');
    const conflict = { status: 409, body: { success: false, message: 'Học phí của ghi danh trong tháng này đã tồn tại' } };
    assert.deepEqual(await request(tokenA, {
      classStudentId: enrollmentA.id.toUpperCase(), billingPeriod: '2024-02-07', amountDue: '0.00', note: 'Không được ghi đè',
    }), conflict);
    assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id: firstPayment.id } }), firstPayment);

    // Không áp đặt giới hạn trạng thái hay tháng nằm trong khoảng ngày học ở bước POST này.
    await createAndAssert(tokenA, { classStudentId: leftEnrollmentA.id, billingPeriod: '0001-01-31', amountDue: 0, note: null }, '0001-01-01', '0.00');
    await createAndAssert(tokenA, { ...valid, billingPeriod: '2026-10-31', amountDue: 1250.5, note: null }, '2026-10-01', '1250.50');
    await createAndAssert(tokenA, { classStudentId: leftEnrollmentA.id, billingPeriod: '9999-12-31', amountDue: '9999999999.99' }, '9999-12-01', '9999999999.99');
    await createAndAssert(tokenA, { classStudentId: leftEnrollmentA.id, billingPeriod: '2026-12-15', amountDue: ' 12345.6 ', note: '   ' }, '2026-12-01', '12345.60', '');
    await createAndAssert(tokenA, { classStudentId: leftEnrollmentA.id, billingPeriod: '2024-02-15', amountDue: '0.00' }, '2024-02-01', '0.00');
    await createAndAssert(tokenB, { classStudentId: enrollmentB.id, billingPeriod: '2024-02-08' }, '2024-02-01', '750000.40');
    await createAndAssert(tokenAdmin, { classStudentId: adminEnrollment.id, billingPeriod: '2026-10-19' }, '2026-10-01', '900000.00');

    const concurrent = await Promise.all([
      request(tokenA, { ...valid, billingPeriod: '2026-11-05' }),
      request(tokenA, { ...valid, billingPeriod: '2026-11-27' }),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
    const winner = concurrent.find(result => result.status === 201);
    assert.ok(winner);
    assert.deepEqual(concurrent.find(result => result.status === 409), conflict);
    const concurrentPayment = await assertCreated(winner, enrollmentA.id, '2026-11-01', '500000.25', null);
    assert.equal(await prisma.payment.count({ where: { classStudentId: enrollmentA.id, billingPeriod: new Date('2026-11-01T00:00:00.000Z') } }), 1);
    assert.deepEqual(await request(tokenA, { ...valid, billingPeriod: '2026-11-30' }), conflict);
    assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id: concurrentPayment.id } }), concurrentPayment);
    await assertPaymentsUnchanged();
    await assertParentsUnchanged();

    const changedFee = await fetch(`${baseUrl}/classes/${classA.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuitionFee: '600000.75' }),
    });
    assert.equal(changedFee.status, 200);
    await changedFee.json();
    const updatedClassA = await prisma.class.findUniqueOrThrow({ where: { id: classA.id } });
    assert.equal(updatedClassA.tuitionFee.toFixed(2), '600000.75');
    assert.deepEqual({ ...updatedClassA, tuitionFee: classA.tuitionFee, updatedAt: classA.updatedAt }, classA);
    await assertPaymentsUnchanged();
    await createAndAssert(tokenA, { ...valid, billingPeriod: '2026-12-31' }, '2026-12-01', '600000.75');
    await assertPaymentsUnchanged();
    await assertParentsUnchanged(initialClasses.map(row => row.id === classA.id ? updatedClassA : row));
    assert.equal(await prisma.payment.count({ where: { classStudentId: { in: [malformedA.id, malformedB.id, pendingEnrollment.id] } } }), 0);
    assert.equal(createdPayments.length, 10);
    console.log('PASS: Payment POST auth/ownership, strict body, Decimal/DATE, snapshot, normalized duplicate và concurrency');
  } finally {
    try {
      if (enrollmentIds.length) {
        await prisma.payment.deleteMany({ where: { classStudentId: { in: enrollmentIds } } });
        await prisma.classStudent.deleteMany({ where: { id: { in: enrollmentIds } } });
      }
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
