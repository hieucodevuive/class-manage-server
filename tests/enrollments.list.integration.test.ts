import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import type { ClassStudent, Student } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

test('GET /api/classes/:classId/students liệt kê lịch sử ghi danh đúng quyền sở hữu', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  const userIds: number[] = [];
  const classIds: number[] = [];
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];
  const prefix = `enrollment-list-test-${randomUUID()}`;

  try {
    async function createUser(suffix: string, role: 'TEACHER' | 'ADMIN' = 'TEACHER') {
      const user = await prisma.user.create({
        data: {
          email: `${prefix}-${suffix}@example.test`,
          passwordHash: 'test-fixture-no-login',
          role,
          status: 'ACTIVE',
        },
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
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });
      classIds.push(classRecord.id);
      return classRecord;
    }

    async function createStudent(teacherId: number, suffix: string, fullProfile = false) {
      const student = await prisma.student.create({
        data: {
          teacherId,
          fullName: `${prefix}-${suffix}`,
          status: fullProfile ? 'INACTIVE' : 'ACTIVE',
          ...(fullProfile ? {
            phone: '0901234567',
            parentName: 'Phụ huynh mẫu',
            parentPhone: '0912345678',
            school: 'THPT mẫu',
            grade: 10,
            dateOfBirth: new Date('2010-05-06T00:00:00.000Z'),
            address: 'Địa chỉ mẫu',
            note: 'Hồ sơ dùng cho kiểm tra danh sách ghi danh',
          } : {}),
          createdAt: new Date('2026-08-01T01:02:03.456Z'),
          updatedAt: new Date('2026-08-02T04:05:06.789Z'),
        },
      });
      studentIds.push(student.id);
      return student;
    }

    async function createEnrollment(
      classId: number,
      studentId: string,
      status: 'ACTIVE' | 'LEFT',
      createdAt: string,
      id = randomUUID(),
    ) {
      const enrollment = await prisma.classStudent.create({
        data: {
          id,
          classId,
          studentId,
          joinedAt: new Date('2026-09-03T00:00:00.000Z'),
          leftAt: status === 'LEFT' ? new Date('2026-10-01T00:00:00.000Z') : null,
          status,
          createdAt: new Date(createdAt),
          updatedAt: new Date('2026-10-02T07:08:09.123Z'),
        },
      });
      enrollmentIds.push(enrollment.id);
      return enrollment;
    }

    function expectedEnrollment(enrollment: ClassStudent, student: Student) {
      return {
        id: enrollment.id,
        classId: enrollment.classId,
        studentId: student.id,
        joinedAt: '2026-09-03',
        leftAt: enrollment.status === 'LEFT' ? '2026-10-01' : null,
        status: enrollment.status,
        createdAt: enrollment.createdAt.toISOString(),
        updatedAt: '2026-10-02T07:08:09.123Z',
        student: {
          id: student.id,
          fullName: student.fullName,
          phone: student.phone,
          parentName: student.parentName,
          parentPhone: student.parentPhone,
          school: student.school,
          grade: student.grade,
          dateOfBirth: student.dateOfBirth ? '2010-05-06' : null,
          address: student.address,
          status: student.status,
          note: student.note,
          createdAt: '2026-08-01T01:02:03.456Z',
          updatedAt: '2026-08-02T04:05:06.789Z',
        },
      };
    }

    const userA = await createUser('a');
    const userB = await createUser('b');
    const admin = await createUser('admin', 'ADMIN');
    const classA = await createClass(userA.id, 'class-a');
    const emptyClassA = await createClass(userA.id, 'class-a-empty');
    const classB = await createClass(userB.id, 'class-b');
    const adminClass = await createClass(admin.id, 'class-admin');
    const studentAOld = await createStudent(userA.id, 'student-a-old');
    const studentALow = await createStudent(userA.id, 'student-a-low', true);
    const studentAHigh = await createStudent(userA.id, 'student-a-high');
    const studentB = await createStudent(userB.id, 'student-b', true);
    const tokenA = createAccessToken({ id: userA.id, role: 'TEACHER' });
    const tokenB = createAccessToken({ id: userB.id, role: 'TEACHER' });
    const tokenAdmin = createAccessToken({ id: admin.id, role: 'ADMIN' });

    const oldest = await createEnrollment(classA.id, studentAOld.id, 'LEFT', '2026-09-01T01:02:03.456Z');
    const [lowId, highId] = [randomUUID(), randomUUID()].sort();
    assert.ok(lowId && highId);
    const tieTime = '2026-09-02T01:02:03.456Z';
    const lowerId = await createEnrollment(classA.id, studentALow.id, 'LEFT', tieTime, lowId);
    const higherId = await createEnrollment(classA.id, studentAHigh.id, 'ACTIVE', tieTime, highId);
    const enrollmentB = await createEnrollment(classB.id, studentB.id, 'ACTIVE', '2026-09-03T01:02:03.456Z');

    // Database cho phép FK này, nhưng API phải lọc học sinh thuộc giáo viên khác.
    const invalidOwnership = await createEnrollment(classA.id, studentB.id, 'ACTIVE', '2026-09-04T01:02:03.456Z');

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(classId: string | number, token?: string) {
      const response = await fetch(`${baseUrl}/${classId}/students`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }

    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(classA.id, token);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.success, false);
    }

    for (const classId of ['abc', '0', '-1', '1.5', '2147483648']) {
      const invalid = await request(classId, tokenA);
      assert.equal(invalid.status, 400, classId);
      assert.equal(invalid.body.success, false);
    }

    const classNotFound = {
      status: 404,
      body: { success: false, message: 'Không tìm thấy lớp' },
    };
    assert.deepEqual(await request(classB.id, tokenA), classNotFound);
    assert.deepEqual(await request(classA.id, tokenB), classNotFound);
    assert.deepEqual(await request(2147483647, tokenA), classNotFound);
    assert.deepEqual(await request(classA.id, tokenAdmin), classNotFound);
    assert.deepEqual(await request(classB.id, tokenAdmin), classNotFound);

    const emptyList = {
      status: 200,
      body: { success: true, data: { enrollments: [] } },
    };
    assert.deepEqual(await request(emptyClassA.id, tokenA), emptyList);
    assert.deepEqual(await request(adminClass.id, tokenAdmin), emptyList);

    const listA = await request(classA.id, tokenA);
    assert.deepEqual(listA, {
      status: 200,
      body: {
        success: true,
        data: {
          enrollments: [
            expectedEnrollment(higherId, studentAHigh),
            expectedEnrollment(lowerId, studentALow),
            expectedEnrollment(oldest, studentAOld),
          ],
        },
      },
    });
    assert.equal(listA.body.data.enrollments.some((enrollment: { id: string }) => enrollment.id === invalidOwnership.id), false);
    assert.equal(listA.body.data.enrollments.some((enrollment: { studentId: string }) => enrollment.studentId === studentB.id), false);
    for (const enrollment of listA.body.data.enrollments) {
      assert.equal(enrollment.teacherId, undefined);
      assert.equal(enrollment.teacher_id, undefined);
      assert.equal(enrollment.student.teacherId, undefined);
      assert.equal(enrollment.student.teacher_id, undefined);
    }

    assert.deepEqual(await request(classB.id, tokenB), {
      status: 200,
      body: {
        success: true,
        data: { enrollments: [expectedEnrollment(enrollmentB, studentB)] },
      },
    });

    console.log('PASS: danh sách Enrollment ACTIVE/LEFT, hồ sơ Student, ngày/UTC, thứ tự, mảng rỗng và ownership A/B/ADMIN');
  } finally {
    try {
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
