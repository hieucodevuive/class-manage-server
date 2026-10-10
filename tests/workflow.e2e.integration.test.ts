import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { prisma } from '../src/config/prisma';

test('Luồng HTTP đăng ký, duyệt, quản lý lớp, thu học phí và nghỉ lớp giữ ownership/lịch sử', { timeout: 60000 }, async () => {
  let server: Server | undefined;
  const prefix = `workflow-${randomUUID()}`;
  const emails = {
    admin: `${prefix}-admin@example.test`,
    a: `${prefix}-a@example.test`,
    b: `${prefix}-b@example.test`,
  };
  const password = 'Workflow-test-password-123!';
  const setupDay = new Date().toISOString().slice(0, 10);
  const joinedAt = new Date(new Date(`${setupDay}T00:00:00.000Z`).getTime() - 86400000)
    .toISOString().slice(0, 10);
  const billingPeriod = `${setupDay.slice(0, 7)}-01`;

  try {
    // ADMIN chỉ là fixture; hai giáo viên được tạo và duyệt qua HTTP thật.
    const admin = await prisma.user.create({
      data: {
        email: emails.admin,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    async function request(path: string, method = 'GET', token?: string, body?: unknown) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie'),
      };
    }

    async function expectRequest(path: string, method = 'GET', token?: string, body?: unknown, status = 200) {
      const response = await request(path, method, token, body);
      assert.equal(response.status, status, `${method} ${path}`);
      assert.ok(response.body.success === (status < 400), `success: ${method} ${path}`);
      return response.body;
    }

    function publicUser(user: Record<string, unknown>, id: number, email: string, role: string) {
      assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'role']);
      // Boolean assertions tránh in giá trị bí mật nếu response Auth bị hồi quy.
      assert.ok(user.id === id && user.email === email && user.role === role, 'Thông tin User công khai phải khớp fixture');
    }

    async function register(email: string) {
      const response = await request('/auth/register', 'POST', undefined, { email, password });
      assert.equal(response.status, 201);
      assert.ok(response.body.success === true);
      assert.deepEqual(Object.keys(response.body.data).sort(), ['user']);
      const id = response.body.data.user.id as number;
      assert.ok(Number.isInteger(id) && id > 0, 'Register phải trả User ID hợp lệ');
      publicUser(response.body.data.user, id, email, 'TEACHER');
      assert.ok(response.cookie === null, 'Register không được cấp refresh cookie');
      const stored = await prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true, status: true } });
      assert.deepEqual(stored, { role: 'TEACHER', status: 'PENDING' });
      const denied = await request('/auth/login', 'POST', undefined, { email, password });
      assert.equal(denied.status, 403);
      assert.ok(denied.body.success === false && denied.body.data === undefined, 'PENDING không được cấp token');
      assert.ok(denied.cookie === null, 'Login PENDING không được cấp refresh cookie');
      return id;
    }

    async function login(id: number, email: string, role: string) {
      const response = await request('/auth/login', 'POST', undefined, { email, password });
      assert.equal(response.status, 200);
      assert.ok(response.body.success === true);
      assert.deepEqual(Object.keys(response.body.data).sort(), ['accessToken', 'user']);
      publicUser(response.body.data.user, id, email, role);
      const token: unknown = response.body.data.accessToken;
      assert.ok(typeof token === 'string' && token.length > 0, 'Login phải cấp access token');
      assert.ok(response.cookie?.startsWith('refreshToken='), 'Login phải đặt refresh cookie');
      const me = await expectRequest('/auth/me', 'GET', token);
      publicUser(me.data.user, id, email, role);
      return token;
    }

    const idA = await register(emails.a);
    const idB = await register(emails.b);
    const adminToken = await login(admin.id, emails.admin, 'ADMIN');
    const pending = await expectRequest('/auth/registrations/pending', 'GET', adminToken);
    for (const id of [idA, idB]) {
      const registration = pending.data.users.find((user: { id: number }) => user.id === id);
      assert.ok(registration, 'ADMIN phải thấy đăng ký fixture đang chờ duyệt');
      assert.deepEqual(Object.keys(registration).sort(), ['createdAt', 'email', 'id', 'role', 'status']);
      assert.ok(registration.status === 'PENDING' && registration.role === 'TEACHER');
      const approval = await expectRequest(`/auth/registrations/${id}/approve`, 'PATCH', adminToken);
      assert.deepEqual(Object.keys(approval.data.user).sort(), ['email', 'id', 'role', 'status']);
      assert.ok(approval.data.user.id === id && approval.data.user.status === 'ACTIVE');
    }
    const tokenA = await login(idA, emails.a, 'TEACHER');
    const tokenB = await login(idB, emails.b, 'TEACHER');
    await expectRequest('/auth/registrations/pending', 'GET', tokenA, undefined, 403);
    await expectRequest(`/auth/registrations/${idB}/approve`, 'PATCH', tokenA, undefined, 403);

    async function createBranch(token: string, suffix: string, attemptedOwner: number) {
      const classResponse = await expectRequest('/classes', 'POST', token, {
        name: `${prefix}-class-${suffix}`,
        grade: 10,
        schoolYear: '2026-2027',
        subject: 'Ngữ Văn',
        tuitionFee: '500000.00',
        startDate: joinedAt,
        teacherId: attemptedOwner,
        teacher_id: attemptedOwner,
      }, 201);
      const classRecord = classResponse.data.class;
      assert.ok(Number.isInteger(classRecord.id) && classRecord.id > 0);
      assert.equal(classRecord.tuitionFee, '500000.00');
      const studentResponse = await expectRequest('/students', 'POST', token, {
        fullName: `${prefix}-same-learner`,
        grade: 10,
        teacherId: attemptedOwner,
        teacher_id: attemptedOwner,
      }, 201);
      const student = studentResponse.data.student;
      assert.equal(student.status, 'ACTIVE');
      const classPath = `/classes/${classRecord.id}`;
      const enrollmentResponse = await expectRequest(`${classPath}/students`, 'POST', token, {
        studentId: student.id,
        joinedAt,
      }, 201);
      const enrollment = enrollmentResponse.data.enrollment;
      assert.equal(enrollment.classId, classRecord.id);
      assert.equal(enrollment.studentId, student.id);
      assert.equal(enrollment.status, 'ACTIVE');
      assert.equal(enrollment.leftAt, null);
      const scheduleResponse = await expectRequest(`${classPath}/schedules`, 'POST', token, {
        dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:30',
      }, 201);
      const schedule = scheduleResponse.data.schedule;
      assert.equal(schedule.classId, classRecord.id);
      assert.equal(schedule.startTime, '18:00:00');
      assert.equal(schedule.endTime, '19:30:00');
      const paymentResponse = await expectRequest('/payments', 'POST', token, {
        classStudentId: enrollment.id,
        billingPeriod: setupDay,
      }, 201);
      const payment = paymentResponse.data.payment;
      assert.equal(payment.classStudentId, enrollment.id);
      assert.equal(payment.billingPeriod, billingPeriod);
      assert.equal(payment.amountDue, '500000.00');
      assert.equal(payment.amountPaid, '0.00');
      assert.equal(payment.paidAt, null);
      assert.equal(payment.paymentMethod, null);
      return { classRecord, student, enrollment, schedule, payment, classPath };
    }

    const a = await createBranch(tokenA, 'a', idB);
    const b = await createBranch(tokenB, 'b', idA);
    assert.notEqual(a.student.id, b.student.id, 'Cùng người học phải có hồ sơ riêng cho từng giáo viên');

    async function assertOwnership(branch: typeof a, teacherId: number) {
      const classOwner = await prisma.class.findUniqueOrThrow({ where: { id: branch.classRecord.id }, select: { teacherId: true } });
      const studentOwner = await prisma.student.findUniqueOrThrow({ where: { id: branch.student.id }, select: { teacherId: true } });
      assert.equal(classOwner.teacherId, teacherId);
      assert.equal(studentOwner.teacherId, teacherId);
    }
    await assertOwnership(a, idA);
    await assertOwnership(b, idB);

    async function readBranch(branch: typeof a, token: string) {
      return {
        classRecord: (await expectRequest(branch.classPath, 'GET', token)).data.class,
        student: (await expectRequest(`/students/${branch.student.id}`, 'GET', token)).data.student,
        enrollments: (await expectRequest(`${branch.classPath}/students`, 'GET', token)).data.enrollments,
        schedules: (await expectRequest(`${branch.classPath}/schedules`, 'GET', token)).data.schedules,
        payment: (await expectRequest(`/payments/${branch.payment.id}`, 'GET', token)).data.payment,
      };
    }
    const untouchedB = await readBranch(b, tokenB);

    for (const [branch, token] of [[a, tokenA], [b, tokenB]] as const) {
      for (const [path, key, id] of [
        ['/classes', 'classes', branch.classRecord.id],
        ['/students', 'students', branch.student.id],
        ['/payments', 'payments', branch.payment.id],
        [`${branch.classPath}/schedules`, 'schedules', branch.schedule.id],
        [`${branch.classPath}/students`, 'enrollments', branch.enrollment.id],
      ] as const) {
        const list = await expectRequest(path, 'GET', token);
        assert.deepEqual(list.data[key].map((record: { id: string | number }) => record.id), [id], path);
      }
      const list = await expectRequest(`${branch.classPath}/students`, 'GET', token);
      assert.deepEqual(list.data.enrollments[0].student, branch.student);
    }

    // Các route cha/con đều yêu cầu đăng nhập và chặn ID của giáo viên khác.
    for (const path of ['/classes', '/students', '/payments', `${a.classPath}/students`, `${a.classPath}/schedules`]) {
      await expectRequest(path, 'GET', undefined, undefined, 401);
    }
    for (const [branch, otherToken, otherStudent] of [[a, tokenB, b.student], [b, tokenA, a.student]] as const) {
      const schedulePath = `${branch.classPath}/schedules/${branch.schedule.id}`;
      const paymentPath = `/payments/${branch.payment.id}`;
      const deniedRequests: Array<[string, string, unknown?]> = [
        [branch.classPath, 'GET'],
        [branch.classPath, 'PATCH', { name: 'Không được sửa' }],
        [branch.classPath, 'DELETE'],
        [`/students/${branch.student.id}`, 'GET'],
        [`/students/${branch.student.id}`, 'PATCH', { fullName: 'Không được sửa' }],
        [`/students/${branch.student.id}`, 'DELETE'],
        [`${branch.classPath}/students`, 'GET'],
        [`${branch.classPath}/students`, 'POST', { studentId: otherStudent.id, joinedAt }],
        [`${branch.classPath}/students/${branch.student.id}`, 'DELETE'],
        [`${branch.classPath}/schedules`, 'GET'],
        [`${branch.classPath}/schedules`, 'POST', { dayOfWeek: 'TUESDAY', startTime: '18:00', endTime: '19:00' }],
        [schedulePath, 'GET'],
        [schedulePath, 'PATCH', { endTime: '20:00' }],
        [schedulePath, 'DELETE'],
        ['/payments', 'POST', { classStudentId: branch.enrollment.id, billingPeriod: setupDay }],
        [paymentPath, 'GET'],
        [paymentPath, 'PATCH', { amountPaid: '1.00', paymentMethod: 'CASH' }],
      ];
      for (const [path, method, body] of deniedRequests) {
        const denied = await expectRequest(path, method, otherToken, body, 404);
        assert.ok(denied.data === undefined, `Không trả dữ liệu ngoài quyền: ${method} ${path}`);
      }
      const filtered = await expectRequest(`/payments?classId=${branch.classRecord.id}&studentId=${branch.student.id}`, 'GET', otherToken);
      assert.deepEqual(filtered.data.payments, []);
    }
    await expectRequest(`${a.classPath}/students`, 'POST', tokenA, { studentId: b.student.id, joinedAt }, 404);
    await expectRequest(a.classPath, 'GET', adminToken, undefined, 404);

    const changedClass = await expectRequest(a.classPath, 'PATCH', tokenA, {
      tuitionFee: '600000.00', teacherId: idB, teacher_id: idB,
    });
    assert.equal(changedClass.data.class.tuitionFee, '600000.00');
    await expectRequest(`/students/${a.student.id}`, 'PATCH', tokenA, {
      note: 'Đã liên hệ phụ huynh', teacherId: idB, teacher_id: idB,
    });
    await assertOwnership(a, idA);
    const snapshot = await expectRequest(`/payments/${a.payment.id}`, 'GET', tokenA);
    assert.equal(snapshot.data.payment.amountDue, '500000.00');
    assert.equal(snapshot.data.payment.status, 'UNPAID');
    await expectRequest('/payments', 'POST', tokenA, {
      classStudentId: a.enrollment.id, billingPeriod: setupDay,
    }, 409);

    const partial = await expectRequest(`/payments/${a.payment.id}`, 'PATCH', tokenA, {
      amountPaid: '200000.00', paymentMethod: 'BANK_TRANSFER',
    });
    assert.equal(partial.data.payment.amountDue, '500000.00');
    assert.equal(partial.data.payment.amountPaid, '200000.00');
    assert.equal(partial.data.payment.status, 'PARTIAL');
    assert.equal(partial.data.payment.paidAt, null);
    const paidStart = Date.now();
    const paid = await expectRequest(`/payments/${a.payment.id}`, 'PATCH', tokenA, { amountPaid: '500000.00' });
    const paidEnd = Date.now();
    assert.equal(paid.data.payment.amountPaid, '500000.00', 'amountPaid thay thế tổng đã thu, không cộng thêm');
    assert.equal(paid.data.payment.amountDue, '500000.00');
    assert.equal(paid.data.payment.status, 'PAID');
    assert.equal(paid.data.payment.paymentMethod, 'BANK_TRANSFER');
    assert.equal(typeof paid.data.payment.paidAt, 'string');
    const paidAt = new Date(paid.data.payment.paidAt);
    assert.equal(paidAt.toISOString(), paid.data.payment.paidAt);
    assert.ok(paidAt.getTime() >= paidStart && paidAt.getTime() <= paidEnd, 'paidAt phải là thời điểm server ghi nhận thu đủ');
    const paidList = await expectRequest(`/payments?classId=${a.classRecord.id}&studentId=${a.student.id}&billingPeriod=${setupDay}&status=PAID`, 'GET', tokenA);
    assert.deepEqual(paidList.data.payments, [paid.data.payment]);

    const leaveStartDay = new Date().toISOString().slice(0, 10);
    const left = await expectRequest(`${a.classPath}/students/${a.student.id}`, 'DELETE', tokenA);
    const leaveEndDay = new Date().toISOString().slice(0, 10);
    assert.equal(left.data.enrollment.id, a.enrollment.id);
    assert.equal(left.data.enrollment.classId, a.classRecord.id);
    assert.equal(left.data.enrollment.studentId, a.student.id);
    assert.equal(left.data.enrollment.joinedAt, joinedAt);
    assert.equal(left.data.enrollment.createdAt, a.enrollment.createdAt);
    assert.equal(left.data.enrollment.status, 'LEFT');
    assert.ok([leaveStartDay, leaveEndDay].includes(left.data.enrollment.leftAt), 'Ngày nghỉ phải thuộc khoảng ngày UTC của request');
    const repeated = await expectRequest(`${a.classPath}/students/${a.student.id}`, 'DELETE', tokenA);
    assert.deepEqual(repeated.data.enrollment, left.data.enrollment);
    await expectRequest(`${a.classPath}/students`, 'POST', tokenA, { studentId: a.student.id, joinedAt }, 409);
    await expectRequest(a.classPath, 'DELETE', tokenA, undefined, 409);
    await expectRequest(`/students/${a.student.id}`, 'DELETE', tokenA, undefined, 409);

    const history = await readBranch(a, tokenA);
    assert.equal(history.classRecord.tuitionFee, '600000.00');
    assert.equal(history.student.note, 'Đã liên hệ phụ huynh');
    assert.equal(history.enrollments.length, 1);
    const { student: historicalStudent, ...historicalEnrollment } = history.enrollments[0];
    assert.deepEqual(historicalEnrollment, left.data.enrollment);
    assert.deepEqual(historicalStudent, history.student);
    assert.deepEqual(history.schedules, [a.schedule]);
    assert.deepEqual(history.payment, paid.data.payment, 'Nghỉ lớp và xóa bị chặn phải giữ nguyên học phí');
    assert.deepEqual(await readBranch(b, tokenB), untouchedB, 'Dữ liệu giáo viên B phải giữ nguyên sau toàn bộ thao tác của A');
    await assertOwnership(a, idA);
    await assertOwnership(b, idB);
  } finally {
    try {
      // Tìm lại fixture từ exact email, kể cả POST đã commit trước khi assertion lỗi.
      const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } });
      const userIds = users.map(user => user.id);
      if (userIds.length) {
        const classes = await prisma.class.findMany({ where: { teacherId: { in: userIds } }, select: { id: true } });
        const students = await prisma.student.findMany({ where: { teacherId: { in: userIds } }, select: { id: true } });
        const classIds = classes.map(record => record.id);
        const studentIds = students.map(record => record.id);
        const enrollments = await prisma.classStudent.findMany({
          where: { OR: [{ classId: { in: classIds } }, { studentId: { in: studentIds } }] },
          select: { id: true },
        });
        if (enrollments.length) {
          const enrollmentIds = enrollments.map(record => record.id);
          await prisma.payment.deleteMany({ where: { classStudentId: { in: enrollmentIds } } });
          await prisma.classStudent.deleteMany({ where: { id: { in: enrollmentIds } } });
        }
        if (classIds.length) {
          await prisma.classSchedule.deleteMany({ where: { classId: { in: classIds } } });
          await prisma.class.deleteMany({ where: { id: { in: classIds } } });
        }
        if (studentIds.length) await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
        await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        assert.equal(await prisma.user.count({ where: { email: { in: Object.values(emails) } } }), 0, 'Phải dọn hết tài khoản fixture');
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
