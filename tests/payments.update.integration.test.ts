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

test('PATCH /api/payments/:id thay tổng tiền, tính paidAt và bảo vệ snapshot khi đồng thời', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  let restoreFindFirst: (() => void) | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const paymentIds: string[] = [];
  const prefix = `payment-update-test-${randomUUID()}`;

  try {
    async function createUser(suffix: string, role: 'TEACHER' | 'ADMIN' = 'TEACHER', status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
      const user = await prisma.user.create({
        data: { email: `${prefix}-${suffix}@example.test`, passwordHash: 'test-fixture-no-login', role, status },
      });
      userIds.push(user.id);
      return user;
    }
    async function createClass(teacherId: number, suffix: string, status: 'ACTIVE' | 'INACTIVE' | 'COMPLETED' = 'ACTIVE') {
      const row = await prisma.class.create({ data: {
        teacherId, name: `${prefix}-${suffix}`, grade: 10, schoolYear: '2026-2027', subject: 'Ngữ Văn',
        tuitionFee: '500000.25', startDate: new Date('2026-09-01T00:00:00.000Z'), status,
      } });
      classIds.push(row.id);
      return row;
    }
    async function createStudent(teacherId: number, suffix: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
      const row = await prisma.student.create({ data: { teacherId, fullName: `${prefix}-${suffix}`, status } });
      studentIds.push(row.id);
      return row;
    }
    async function createEnrollment(classId: number, studentId: string, status: 'ACTIVE' | 'LEFT' = 'ACTIVE') {
      const row = await prisma.classStudent.create({ data: {
        classId, studentId, status, joinedAt: new Date('2026-09-01T00:00:00.000Z'),
        leftAt: status === 'LEFT' ? new Date('2026-10-01T00:00:00.000Z') : null,
      } });
      enrollmentIds.push(row.id);
      return row;
    }
    async function createPayment(enrollmentId: string, month: string, due = '100.10', paid = '0.00', options: {
      paidAt?: string; paymentMethod?: Payment['paymentMethod']; note?: string;
    } = {}) {
      const row = await prisma.payment.create({ data: {
        classStudentId: enrollmentId, billingPeriod: new Date(`${month}-01T00:00:00.000Z`),
        amountDue: new Prisma.Decimal(due), amountPaid: new Prisma.Decimal(paid),
        paidAt: options.paidAt ? new Date(options.paidAt) : null,
        paymentMethod: options.paymentMethod ?? null, note: options.note ?? null,
        createdAt: new Date('2020-01-01T01:02:03.456Z'), updatedAt: new Date('2020-01-02T04:05:06.789Z'),
      } });
      paymentIds.push(row.id);
      return row;
    }
    type Status = 'UNPAID' | 'PARTIAL' | 'PAID';
    function view(row: Payment, status: Status) {
      return {
        id: row.id, classStudentId: row.classStudentId, billingPeriod: row.billingPeriod.toISOString().slice(0, 10),
        amountDue: row.amountDue.toFixed(2), amountPaid: row.amountPaid.toFixed(2), paidAt: row.paidAt?.toISOString() ?? null,
        paymentMethod: row.paymentMethod, note: row.note, createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(), status,
      };
    }
    function success(row: Payment, status: Status) {
      return { status: 200, body: {
        success: true, message: 'Cập nhật học phí thành công', data: { payment: view(row, status) },
      } };
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const pending = await createUser('pending', 'TEACHER', 'PENDING');
    const classA = await createClass(userA.id, 'class-a');
    const historyClass = await createClass(userA.id, 'class-history', 'COMPLETED');
    const classB = await createClass(userB.id, 'class-b', 'INACTIVE');
    const adminClass = await createClass(admin.id, 'class-admin', 'INACTIVE');
    const pendingClass = await createClass(pending.id, 'class-pending');
    const studentA = await createStudent(userA.id, 'student-a');
    const historyStudent = await createStudent(userA.id, 'student-history', 'INACTIVE');
    const studentB = await createStudent(userB.id, 'student-b', 'INACTIVE');
    const adminStudent = await createStudent(admin.id, 'student-admin');
    const pendingStudent = await createStudent(pending.id, 'student-pending');
    const enrollmentA = await createEnrollment(classA.id, studentA.id);
    const historyEnrollment = await createEnrollment(historyClass.id, historyStudent.id, 'LEFT');
    const enrollmentB = await createEnrollment(classB.id, studentB.id);
    const adminEnrollment = await createEnrollment(adminClass.id, adminStudent.id);
    const pendingEnrollment = await createEnrollment(pendingClass.id, pendingStudent.id);
    const malformedA = await createEnrollment(classA.id, studentB.id);
    const malformedB = await createEnrollment(classB.id, studentA.id);
    const paymentA = await createPayment(enrollmentA.id, '2026-09', '100.10', '0.00', { note: 'Ban đầu' });
    const history = await createPayment(historyEnrollment.id, '2026-09', '100.10', '100.10', {
      paymentMethod: 'BANK_TRANSFER', paidAt: '2020-09-15T12:34:56.789Z', note: 'Lịch sử',
    });
    const paymentB = await createPayment(enrollmentB.id, '2026-09');
    const paymentAdmin = await createPayment(adminEnrollment.id, '2026-09', '100.10', '40.01', { paymentMethod: 'OTHER' });
    const paymentPending = await createPayment(pendingEnrollment.id, '2026-09');
    const malformedPaymentA = await createPayment(malformedA.id, '2026-09');
    const malformedPaymentB = await createPayment(malformedB.id, '2026-09');
    const race = await createPayment(enrollmentA.id, '2026-10', '500000.25', '0.00', { paymentMethod: 'CASH' });
    const sibling = await createPayment(enrollmentA.id, '2026-11');
    const legacy = await createPayment(enrollmentA.id, '2026-12', '100.10', '40.01');
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });
    const tokenPending = createAccessToken({ id: pending.id, role: 'TEACHER' });
    const initialPayments = await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } });
    const initialClasses = await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } });
    const initialStudents = await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } });
    const initialEnrollments = await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/payments`;
    async function request(id: string, token?: string, body?: unknown, query = '') {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`, {
        method: 'PATCH', headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    async function assertParentsUnchanged() {
      assert.deepEqual(await prisma.class.findMany({ where: { id: { in: classIds } }, orderBy: { id: 'asc' } }), initialClasses);
      assert.deepEqual(await prisma.student.findMany({ where: { id: { in: studentIds } }, orderBy: { id: 'asc' } }), initialStudents);
      assert.deepEqual(await prisma.classStudent.findMany({ where: { id: { in: enrollmentIds } }, orderBy: { id: 'asc' } }), initialEnrollments);
    }
    async function assertMissingMethod(id: string, body: unknown) {
      const before = await prisma.payment.findUniqueOrThrow({ where: { id } });
      const result = await request(id, tokenA, body);
      assert.equal(result.status, 400);
      assert.equal(result.body.success, false);
      assert.equal(result.body.message, 'Cần có phương thức thanh toán khi đã thu tiền');
      assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id } }), before);
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(paymentA.id, token, { note: 'Không được lưu' });
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }
    const pendingDenied = await request(paymentPending.id, tokenPending, { note: 'Không được lưu' });
    assert.equal(pendingDenied.status, 403);
    assert.equal(pendingDenied.body.success, false);
    const invalidId = { status: 400, body: { success: false, message: 'ID học phí phải là UUID hợp lệ' } };
    for (const id of ['not-a-uuid', paymentA.id.slice(0, -1), paymentA.id.replace(/^[0-9a-f]/i, 'g'),
      `${paymentA.id}\n`, `${paymentA.id}\r\n`, ` ${paymentA.id} `]) {
      assert.deepEqual(await request(id, tokenA, {}), invalidId);
    }
    const invalidBodies: Array<[unknown, string]> = [
      [undefined, 'body'], [{}, 'body'], [[], 'body'], [{ note: 123 }, 'note'],
      [{ paymentMethod: 'cash' }, 'paymentMethod'], [{ paymentMethod: 1 }, 'paymentMethod'],
    ];
    for (const field of ['amountDue', 'amountPaid']) {
      for (const value of [-0.01, '1.234', '10000000000.00', 'NaN', 'Infinity', '1e3', '00.10', '', null, true]) {
        invalidBodies.push([{ [field]: value }, field]);
      }
    }
    for (const [field, value] of Object.entries({
      id: randomUUID(), classStudentId: enrollmentB.id, billingPeriod: '2027-01-01',
      teacherId: userB.id, teacher_id: userB.id, classId: classB.id, studentId: studentB.id,
      status: 'PAID', paidAt: '2000-01-01T00:00:00Z', createdAt: '2000-01-01T00:00:00Z',
      updatedAt: '2000-01-01T00:00:00Z', enrollment: { connect: { id: enrollmentB.id } }, unknown: 'Không được lưu',
    })) invalidBodies.push([{ note: 'Không được lưu', [field]: value }, 'body']);
    for (const [body, field] of invalidBodies) {
      const result = await request(paymentA.id, tokenA, body);
      assert.equal(result.status, 400, field);
      assert.equal(result.body.success, false);
      assert.equal(result.body.message, 'Thông tin học phí không hợp lệ');
      assert.ok(result.body.errors.some((issue: { field: string; message: string }) => (
        issue.field === field && typeof issue.message === 'string' && issue.message.length > 0
      )), field);
    }
    const invalidJson = { status: 400, body: { success: false, message: 'Body JSON không hợp lệ' } };
    assert.deepEqual(await request(paymentA.id, tokenA, null), invalidJson);
    const malformedJson = await fetch(`${baseUrl}/${paymentA.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' }, body: '{"amountPaid":',
    });
    assert.deepEqual({ status: malformedJson.status, body: await malformedJson.json() }, invalidJson);
    const notFound = { status: 404, body: { success: false, message: 'Không tìm thấy học phí' } };
    const hidden: Array<[string, string]> = [
      [randomUUID(), tokenA], [paymentB.id, tokenA], [paymentA.id, tokenB],
      [paymentA.id, tokenAdmin], [paymentB.id, tokenAdmin], [paymentAdmin.id, tokenA],
    ];
    for (const row of [malformedPaymentA, malformedPaymentB]) {
      for (const token of [tokenA, tokenB, tokenAdmin]) hidden.push([row.id, token]);
    }
    for (const [id, token] of hidden) assert.deepEqual(await request(id, token, { note: 'Không được lưu' }), notFound);
    assert.deepEqual(await request(paymentB.id, tokenA, { note: 'Không được lưu' },
      `teacherId=${userB.id}&teacher_id=${userB.id}&id=${paymentA.id}`), notFound);
    await assertMissingMethod(paymentA.id, { amountPaid: '0.01' });
    await assertMissingMethod(legacy.id, { note: 'Vẫn cần phương thức' });
    await assertMissingMethod(legacy.id, { paymentMethod: null });
    assert.deepEqual(await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } }), initialPayments);
    await assertParentsUnchanged();

    type State = { due: string; paid: string; method: Payment['paymentMethod']; note: string | null; status: Status; paidAt: Date | null | 'now' };
    const updatedIds = new Set<string>();
    async function patchAndAssert(row: Payment, token: string, body: Record<string, unknown>, expected: State, query = '', id = row.id) {
      const before = await prisma.payment.findUniqueOrThrow({ where: { id: row.id } });
      const startedAt = Date.now();
      const result = await request(id, token, body, query);
      const finishedAt = Date.now();
      const after = await prisma.payment.findUniqueOrThrow({ where: { id: row.id } });
      assert.ok(Prisma.Decimal.isDecimal(after.amountDue) && Prisma.Decimal.isDecimal(after.amountPaid));
      assert.equal(after.amountDue.toFixed(2), expected.due);
      assert.equal(after.amountPaid.toFixed(2), expected.paid);
      assert.equal(after.paymentMethod, expected.method);
      assert.equal(after.note, expected.note);
      assert.deepEqual({ ...after, amountDue: before.amountDue, amountPaid: before.amountPaid,
        paymentMethod: before.paymentMethod, paidAt: before.paidAt, note: before.note, updatedAt: before.updatedAt }, before);
      if (!('amountDue' in body)) assert.ok(after.amountDue.equals(before.amountDue));
      if (!('amountPaid' in body)) assert.ok(after.amountPaid.equals(before.amountPaid));
      if (!('paymentMethod' in body)) assert.equal(after.paymentMethod, before.paymentMethod);
      if (!('note' in body)) assert.equal(after.note, before.note);
      assert.ok(after.updatedAt.getTime() >= before.updatedAt.getTime());
      if (expected.paidAt === 'now') {
        assert.ok(after.paidAt && after.paidAt.getTime() >= startedAt && after.paidAt.getTime() <= finishedAt);
      } else assert.deepEqual(after.paidAt, expected.paidAt);
      assert.deepEqual(result, success(after, expected.status));
      updatedIds.add(after.id);
      return after;
    }
    const first = await patchAndAssert(paymentA, tokenA, { note: '  Thu tháng 9  ' },
      { due: '100.10', paid: '0.00', method: null, note: 'Thu tháng 9', status: 'UNPAID', paidAt: null },
      `teacherId=${userB.id}&teacher_id=${userB.id}&id=${paymentB.id}`, paymentA.id.toUpperCase());
    assert.ok(first.updatedAt.getTime() > paymentA.updatedAt.getTime());
    await patchAndAssert(paymentA, tokenA, { amountPaid: ' 40.01 ', paymentMethod: 'CASH' },
      { due: '100.10', paid: '40.01', method: 'CASH', note: 'Thu tháng 9', status: 'PARTIAL', paidAt: null });
    await assertMissingMethod(paymentA.id, { paymentMethod: null });
    // amountPaid là tổng thay thế: gửi lại 40.01 vẫn là 40.01, không cộng thêm.
    await patchAndAssert(paymentA, tokenA, { amountPaid: 40.01 },
      { due: '100.10', paid: '40.01', method: 'CASH', note: 'Thu tháng 9', status: 'PARTIAL', paidAt: null });
    const fullyPaid = await patchAndAssert(paymentA, tokenA, { amountPaid: '100.10' },
      { due: '100.10', paid: '100.10', method: 'CASH', note: 'Thu tháng 9', status: 'PAID', paidAt: 'now' });
    await patchAndAssert(paymentA, tokenA, { note: null, paymentMethod: 'BANK_TRANSFER' },
      { due: '100.10', paid: '100.10', method: 'BANK_TRANSFER', note: null, status: 'PAID', paidAt: fullyPaid.paidAt });
    await patchAndAssert(paymentA, tokenA, { amountDue: ' 200.20 ' },
      { due: '200.20', paid: '100.10', method: 'BANK_TRANSFER', note: null, status: 'PARTIAL', paidAt: null });
    await patchAndAssert(paymentA, tokenA, { amountDue: 50.05 },
      { due: '50.05', paid: '100.10', method: 'BANK_TRANSFER', note: null, status: 'PAID', paidAt: 'now' });
    await patchAndAssert(paymentA, tokenA, { amountPaid: 0 },
      { due: '50.05', paid: '0.00', method: 'BANK_TRANSFER', note: null, status: 'UNPAID', paidAt: null });
    await patchAndAssert(paymentA, tokenA, { amountDue: '0.00', paymentMethod: null, note: '   ' },
      { due: '0.00', paid: '0.00', method: null, note: '', status: 'PAID', paidAt: null });
    // 0/0 đã là PAID nhưng chỉ khoản thực thu dương mới có paidAt.
    await patchAndAssert(paymentA, tokenA, { amountPaid: '0.01', paymentMethod: 'OTHER' },
      { due: '0.00', paid: '0.01', method: 'OTHER', note: '', status: 'PAID', paidAt: 'now' });
    await patchAndAssert(history, tokenA, { note: '  Điều chỉnh lịch sử  ', paymentMethod: 'CASH' },
      { due: '100.10', paid: '100.10', method: 'CASH', note: 'Điều chỉnh lịch sử', status: 'PAID', paidAt: history.paidAt });
    await patchAndAssert(paymentB, tokenB, { amountDue: '9999999999.99', amountPaid: '9999999999.98', paymentMethod: 'OTHER' },
      { due: '9999999999.99', paid: '9999999999.98', method: 'OTHER', note: null, status: 'PARTIAL', paidAt: null });
    const maximum = await patchAndAssert(paymentB, tokenB, { amountPaid: '9999999999.99' },
      { due: '9999999999.99', paid: '9999999999.99', method: 'OTHER', note: null, status: 'PAID', paidAt: 'now' });
    const adminPartial = await patchAndAssert(paymentAdmin, tokenAdmin, { amountPaid: '0.01', note: null },
      { due: '100.10', paid: '0.01', method: 'OTHER', note: null, status: 'PARTIAL', paidAt: null });
    await patchAndAssert(legacy, tokenA, { amountPaid: 0 },
      { due: '100.10', paid: '0.00', method: null, note: null, status: 'UNPAID', paidAt: null });
    for (const [row, token, status] of [[maximum, tokenB, 'PAID'], [adminPartial, tokenAdmin, 'PARTIAL']] as const) {
      const read = await fetch(`${baseUrl}/${row.id}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.deepEqual({ status: read.status, body: await read.json() }, { status: 200, body: { success: true, data: { payment: view(row, status) } } });
      assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id: row.id } }), row);
    }

    const conflict = { status: 409, body: { success: false, message: 'Học phí đã thay đổi, vui lòng tải lại và thử lại' } };
    const originalFindFirst = prisma.payment.findFirst;
    const nativeFindFirst = originalFindFirst.bind(prisma.payment);
    restoreFindFirst = () => { prisma.payment.findFirst = originalFindFirst; };
    let readCount = 0;
    let releaseReads!: () => void;
    const gate = new Promise<void>(resolve => { releaseReads = resolve; });
    const barrierTimer = setTimeout(releaseReads, 5000);
    const captured: Payment[] = [];
    prisma.payment.findFirst = (async (args: Prisma.PaymentFindFirstArgs) => {
      const row = await nativeFindFirst(args);
      if (args.where?.id === race.id && readCount < 2) {
        readCount++;
        assert.ok(row);
        captured.push(row as Payment);
        if (readCount === 2) releaseReads();
        await gate;
      }
      return row;
    }) as typeof prisma.payment.findFirst;
    let concurrent: Awaited<ReturnType<typeof request>>[];
    try {
      concurrent = await Promise.all([
        request(race.id, tokenA, { amountPaid: '100.00' }), request(race.id, tokenA, { amountPaid: '200.00' }),
      ]);
    } finally {
      clearTimeout(barrierTimer);
      releaseReads();
      restoreFindFirst();
    }
    assert.equal(readCount, 2);
    assert.deepEqual(captured, [race, race]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    assert.deepEqual(concurrent.find(result => result.status === 409), conflict);
    const raceAfter = await prisma.payment.findUniqueOrThrow({ where: { id: race.id } });
    assert.equal(raceAfter.amountPaid.toFixed(2), concurrent[0].status === 200 ? '100.00' : '200.00');
    assert.deepEqual({ ...raceAfter, amountPaid: race.amountPaid, updatedAt: race.updatedAt }, race);
    assert.deepEqual(concurrent.find(result => result.status === 200), success(raceAfter, 'PARTIAL'));
    updatedIds.add(race.id);

    // Giữ cùng updatedAt để xác nhận kiểm tra cả nội dung snapshot, không chỉ timestamp.
    let changedSnapshot = false;
    prisma.payment.findFirst = (async (args: Prisma.PaymentFindFirstArgs) => {
      const row = await nativeFindFirst(args);
      if (args.where?.id === race.id && row && !changedSnapshot) {
        changedSnapshot = true;
        await prisma.payment.update({ where: { id: race.id }, data: { note: 'Sửa cùng timestamp', updatedAt: row.updatedAt } });
      }
      return row;
    }) as typeof prisma.payment.findFirst;
    try {
      assert.deepEqual(await request(race.id, tokenA, { amountPaid: '300.00' }), conflict);
    } finally { restoreFindFirst(); }
    assert.ok(changedSnapshot);
    const sameTimestamp = await prisma.payment.findUniqueOrThrow({ where: { id: race.id } });
    assert.deepEqual(sameTimestamp, { ...raceAfter, note: 'Sửa cùng timestamp' });

    // Quyền đổi sau lúc đọc: lần ghi vẫn phải kiểm tra cả Student và Class.
    let changedOwner = false;
    prisma.payment.findFirst = (async (args: Prisma.PaymentFindFirstArgs) => {
      const row = await nativeFindFirst(args);
      if (args.where?.id === race.id && row && !changedOwner) {
        changedOwner = true;
        await prisma.student.update({ where: { id: studentA.id }, data: { teacherId: userB.id, updatedAt: studentA.updatedAt } });
      }
      return row;
    }) as typeof prisma.payment.findFirst;
    try {
      assert.deepEqual(await request(race.id, tokenA, { note: 'Không được ghi sau đổi quyền' }), notFound);
    } finally {
      restoreFindFirst();
      if (changedOwner) await prisma.student.update({ where: { id: studentA.id }, data: { teacherId: userA.id, updatedAt: studentA.updatedAt } });
    }
    assert.ok(changedOwner);
    assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id: race.id } }), sameTimestamp);
    const untouched = initialPayments.filter(row => !updatedIds.has(row.id));
    assert.deepEqual(await prisma.payment.findMany({ where: { id: { in: untouched.map(row => row.id) } }, orderBy: { id: 'asc' } }), untouched);
    assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { id: sibling.id } }), sibling);
    assert.equal(await prisma.payment.count({ where: { id: { in: paymentIds } } }), paymentIds.length);
    await assertParentsUnchanged();
    console.log('PASS: Payment PATCH strict body/ownership, tổng Decimal, paidAt, snapshot và conflict đồng thời');
  } finally {
    restoreFindFirst?.();
    try {
      if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (enrollmentIds.length) await prisma.classStudent.deleteMany({ where: { id: { in: enrollmentIds } } });
      if (classIds.length) await prisma.class.deleteMany({ where: { id: { in: classIds } } });
      if (studentIds.length) await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      try {
        if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); });
      } finally { await prisma.$disconnect(); }
    }
  }
});
