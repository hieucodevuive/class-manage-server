import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import type { Class } from '../src/generated/prisma/client';
import { createAccessToken } from '../src/utils/jwt';

// Cần .env và migration đã apply. Chỉ tạo/xóa các bản ghi riêng của lượt test này.
test('Class CRUD theo model đầy đủ', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  let otherUserId: number | undefined;
  const ownedIds = new Set<number>();
  const prefix = `class-test-${randomUUID()}`;

  try {
    const user = await prisma.user.findFirst({ select: { id: true, role: true } });
    assert.ok(user, 'Cần có tài khoản đã seed');
    const initialIds = new Set((await prisma.class.findMany({ select: { id: true } })).map(row => row.id));
    const teacherToken = createAccessToken({ id: user.id, role: 'TEACHER' });
    const adminToken = createAccessToken({ id: user.id, role: 'ADMIN' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api/classes`;

    async function request(method: string, path: string, token?: string, body?: unknown) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      if (method === 'POST' && response.status === 201) {
        const id = json.data?.class?.id;
        assert.ok(Number.isInteger(id) && id > 0 && !initialIds.has(id));
        ownedIds.add(id);
      }
      return { status: response.status, body: json };
    }

    function expectedClass(row: Class) {
      return {
        id: row.id, name: row.name, grade: row.grade, schoolYear: row.schoolYear,
        subject: row.subject, tuitionFee: row.tuitionFee.toFixed(2),
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
        status: row.status, note: row.note,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      };
    }

    const valid = {
      name: `${prefix}-primary`, grade: 12, schoolYear: '2026-2027',
      subject: 'Ngữ Văn', tuitionFee: '600000.25', startDate: '2026-09-01',
    };
    const initialList = await request('GET', '', teacherToken);
    assert.equal(initialList.status, 200);
    assert.equal(initialList.body.data.classes.length, await prisma.class.count({ where: { teacherId: user.id } }));
    const created = await request('POST', '', teacherToken, {
      ...valid, name: `  ${valid.name}  `, subject: ' Ngữ Văn ',
      id: -1, createdAt: '2000-01-01T00:00:00Z',
    });
    assert.equal(created.status, 201);
    const id = created.body.data.class.id;
    const primary = await prisma.class.findUniqueOrThrow({ where: { id } });
    assert.equal(primary.name, valid.name);
    assert.equal(primary.subject, 'Ngữ Văn');
    assert.equal(primary.tuitionFee.toFixed(2), '600000.25');
    assert.equal(primary.status, 'ACTIVE');
    assert.equal(primary.endDate, null);
    assert.equal(primary.note, null);
    assert.ok(primary.createdAt.getTime() > new Date('2000-01-01T00:00:00Z').getTime());
    assert.deepEqual(created.body.data.class, expectedClass(primary));
    console.log('PASS: POST 201, default/trim đúng; response đầy đủ, Decimal và DATE nhất quán');

    const routes: Array<[string, string, unknown?]> = [
      ['POST', '', valid], ['GET', ''], ['GET', `/${id}`],
      ['PATCH', `/${id}`, { note: 'Không được lưu' }], ['DELETE', `/${id}`],
    ];
    for (const [method, path, body] of routes) {
      for (const token of [undefined, 'abc']) {
        const result = await request(method, path, token, body);
        assert.equal(result.status, 401, `${method} ${path}`);
        assert.equal(result.body.success, false);
      }
    }
    assert.deepEqual(await prisma.class.findUniqueOrThrow({ where: { id } }), primary);
    console.log('PASS: Cả 5 endpoint yêu cầu token hợp lệ, không thay đổi dữ liệu khi bị từ chối');

    const invalidValues: Record<string, unknown[]> = {
      name: ['', '   ', 123, 'x'.repeat(101), null],
      grade: [0, 13, 1.5, '12', null],
      schoolYear: ['2026', '2026-2028', '2027-2026', '0000-0001', null],
      subject: ['', '   ', false, 'x'.repeat(101), null],
      tuitionFee: [-1, '-0.01', '', null, true, 'NaN', 'Infinity', '1.234', 1.234, '10000000000.00'],
      startDate: ['', null, '2026-02-30', '2025-02-29', '0000-01-01', '2026-09-01T00:00:00Z'],
      endDate: ['', 1, '2026-02-30'],
      status: ['UNKNOWN', null, 1],
      note: [1, false, {}],
    };
    let invalidCount = 0;
    for (const [field, values] of Object.entries(invalidValues)) {
      for (const value of values) {
        for (const method of ['POST', 'PATCH']) {
          const result = await request(method, method === 'POST' ? '' : `/${id}`, teacherToken,
            method === 'POST' ? { ...valid, [field]: value } : { [field]: value });
          assert.equal(result.status, 400, `${method}: sai ${field}`);
          assert.equal(result.body.success, false);
          assert.ok(result.body.errors.some((issue: { field: string }) => issue.field === field));
          invalidCount++;
        }
      }
    }
    for (const field of ['name', 'grade', 'schoolYear', 'subject', 'tuitionFee', 'startDate']) {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      const result = await request('POST', '', teacherToken, body);
      assert.equal(result.status, 400);
      invalidCount++;
    }
    for (const body of [undefined, [], {}, { id: -1 }, { createdAt: '2000-01-01T00:00:00Z' }]) {
      const result = await request('PATCH', `/${id}`, teacherToken, body);
      assert.equal(result.status, 400);
      invalidCount++;
    }
    assert.deepEqual(await prisma.class.findUniqueOrThrow({ where: { id } }), primary);
    console.log(`PASS: ${invalidCount} input POST/PATCH sai -> 400; không sửa dữ liệu`);

    for (const token of [teacherToken, adminToken]) {
      const detail = await request('GET', `/${id}`, token);
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.data.class, expectedClass(primary));
      const list = await request('GET', '', token);
      assert.equal(list.status, 200);
      const rows = await prisma.class.findMany({
        where: { teacherId: user.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      assert.deepEqual(list.body.data.classes, rows.map(expectedClass));
    }
    console.log('PASS: GET danh sách/chi tiết cho hai role; đủ các trường, đúng thứ tự');

    const adminCreated = await request('POST', '', adminToken, {
      ...valid, name: `${prefix}-admin`, tuitionFee: '9999999999.99',
      endDate: '2027-05-31', status: 'INACTIVE', note: ' Ghi chú ',
    });
    assert.equal(adminCreated.status, 201);
    assert.equal(adminCreated.body.data.class.tuitionFee, '9999999999.99');
    assert.equal(adminCreated.body.data.class.note, 'Ghi chú');
    assert.equal(adminCreated.body.data.class.endDate, '2027-05-31');
    const zeroCreated = await request('POST', '', teacherToken, {
      ...valid, name: `${prefix}-zero`, tuitionFee: 0,
      startDate: '2024-02-29', endDate: '2024-02-29', status: 'COMPLETED',
    });
    assert.equal(zeroCreated.status, 201);
    assert.equal(zeroCreated.body.data.class.tuitionFee, '0.00');
    console.log('PASS: POST cho ADMIN, học phí tối đa/0, ngày nhuận và ngày kết thúc bằng bắt đầu');

    const fullUpdate = {
      name: ` ${prefix}-updated `, grade: 11, schoolYear: '2027-2028',
      subject: ' Ngữ Văn nâng cao ', tuitionFee: 700000.5,
      startDate: '2027-02-01', endDate: '2027-06-01', status: 'INACTIVE', note: ' Đã sửa ',
    };
    const patched = await request('PATCH', `/${id}`, adminToken, fullUpdate);
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.class.name, `${prefix}-updated`);
    assert.equal(patched.body.data.class.subject, 'Ngữ Văn nâng cao');
    assert.equal(patched.body.data.class.grade, 11);
    assert.equal(patched.body.data.class.schoolYear, '2027-2028');
    assert.equal(patched.body.data.class.tuitionFee, '700000.50');
    assert.equal(patched.body.data.class.startDate, '2027-02-01');
    assert.equal(patched.body.data.class.endDate, '2027-06-01');
    assert.equal(patched.body.data.class.note, 'Đã sửa');
    assert.equal(patched.body.data.class.status, 'INACTIVE');
    assert.equal(patched.body.data.class.createdAt, primary.createdAt.toISOString());
    assert.deepEqual(patched.body.data.class, expectedClass(await prisma.class.findUniqueOrThrow({ where: { id } })));

    const renamed = await request('PATCH', `/${id}`, teacherToken, {
      name: `${prefix}-renamed`, id: -1, createdAt: '2000-01-01T00:00:00Z',
    });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.body.data.class, {
      ...patched.body.data.class, name: `${prefix}-renamed`, updatedAt: renamed.body.data.class.updatedAt,
    });
    console.log('PASS: PATCH tất cả trường hoặc chỉ name; không reset status, giữ id/createdAt/trường không gửi');

    const beforeDates = await prisma.class.findUniqueOrThrow({ where: { id } });
    for (const body of [
      { startDate: '2027-07-01' }, { endDate: '2027-01-31' },
      { startDate: '2028-01-01', endDate: '2027-12-31' },
    ]) {
      const result = await request('PATCH', `/${id}`, teacherToken, body);
      assert.equal(result.status, 400);
      assert.equal(result.body.errors[0].field, 'endDate');
    }
    assert.deepEqual(await prisma.class.findUniqueOrThrow({ where: { id } }), beforeDates);
    const cleared = await request('PATCH', `/${id}`, teacherToken, { endDate: null, note: null, tuitionFee: '0.00' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.class.endDate, null);
    assert.equal(cleared.body.data.class.note, null);
    assert.equal(cleared.body.data.class.tuitionFee, '0.00');
    assert.equal(cleared.body.data.class.status, 'INACTIVE');
    console.log('PASS: PATCH kiểm tra ngày với DB; null xóa endDate/note, phí 0 hợp lệ');

    // Những ID có thể bị parse sai vẫn chỉ trỏ tới bản ghi tự tạo, không tới dữ liệu có sẵn.
    for (const badId of ['abc', '0', '-1', `${id}abc`, `${id}.5`, `${id}e0`, `0x${id.toString(16)}`, '2147483648']) {
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const result = await request(method, `/${badId}`, teacherToken,
          method === 'PATCH' ? { note: 'Không được lưu' } : undefined);
        assert.equal(result.status, 400, `${method}: ID sai ${badId}`);
      }
    }
    const missingId = zeroCreated.body.data.class.id;
    assert.ok(ownedIds.has(missingId));
    const deleted = await request('DELETE', `/${missingId}`, teacherToken);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { success: true, message: 'Xóa lớp thành công' });
    assert.equal(await prisma.class.findUnique({ where: { id: missingId } }), null);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const result = await request(method, `/${missingId}`, adminToken,
        method === 'PATCH' ? { status: 'INACTIVE' } : undefined);
      assert.equal(result.status, 404);
    }
    console.log('PASS: GET/PATCH/DELETE: ID sai 400, lớp không tồn tại 404; DELETE xóa đúng lớp');

    // Mỗi PATCH riêng hợp lệ với trạng thái cũ, nhưng kết hợp cả hai sẽ sai thứ tự ngày.
    for (let attempt = 0; attempt < 4; attempt++) {
      assert.equal((await request('PATCH', `/${id}`, teacherToken, {
        startDate: '2026-09-01', endDate: '2026-12-31',
      })).status, 200);
      const concurrent = await Promise.all([
        request('PATCH', `/${id}`, teacherToken, { startDate: '2026-11-01' }),
        request('PATCH', `/${id}`, adminToken, { endDate: '2026-10-01' }),
      ]);
      assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 400]);
      const row = await prisma.class.findUniqueOrThrow({ where: { id } });
      assert.ok(row.endDate && row.endDate >= row.startDate);
    }
    console.log('PASS: PATCH ngày đồng thời không lưu dữ liệu sai và không trả 500');

    const adminId = adminCreated.body.data.class.id;
    assert.ok(ownedIds.has(adminId));
    const concurrentDelete = await Promise.all([
      request('DELETE', `/${adminId}`, teacherToken),
      request('DELETE', `/${adminId}`, adminToken),
    ]);
    assert.deepEqual(concurrentDelete.map(result => result.status).sort(), [200, 404]);
    const finalList = await request('GET', '', teacherToken);
    assert.equal(finalList.status, 200);
    assert.ok(!finalList.body.data.classes.some((row: { id: number }) => row.id === adminId || row.id === missingId));
    console.log('PASS: DELETE đồng thời một 200/một 404; danh sách không còn các lớp đã xóa');

    const otherUser = await prisma.user.create({
      data: {
        email: `${prefix}@example.test`,
        passwordHash: 'test-fixture-no-login',
        role: 'TEACHER',
      },
    });
    otherUserId = otherUser.id;
    const otherToken = createAccessToken({ id: otherUser.id, role: 'TEACHER' });
    const otherAdminToken = createAccessToken({ id: otherUser.id, role: 'ADMIN' });
    const otherCreated = await request('POST', '', otherToken, {
      ...valid,
      name: `${prefix}-other`,
      teacherId: user.id,
      teacher_id: user.id,
    });
    assert.equal(otherCreated.status, 201);
    const otherId = otherCreated.body.data.class.id;
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id } })).teacherId, user.id);
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: otherId } })).teacherId, otherUser.id);

    const ownerList = await request('GET', '', teacherToken);
    const otherList = await request('GET', '', otherToken);
    const otherAdminList = await request('GET', '', otherAdminToken);
    assert.ok(ownerList.body.data.classes.some((row: { id: number }) => row.id === id));
    assert.ok(!ownerList.body.data.classes.some((row: { id: number }) => row.id === otherId));
    assert.deepEqual(otherList.body.data.classes.map((row: { id: number }) => row.id), [otherId]);
    assert.deepEqual(otherAdminList.body.data.classes.map((row: { id: number }) => row.id), [otherId]);

    const ownerBefore = await prisma.class.findUniqueOrThrow({ where: { id } });
    const otherBefore = await prisma.class.findUniqueOrThrow({ where: { id: otherId } });
    for (const [token, foreignId] of [
      [teacherToken, otherId],
      [otherToken, id],
      [otherAdminToken, id],
    ] as const) {
      assert.equal((await request('GET', `/${foreignId}`, token)).status, 404);
      assert.equal((await request('PATCH', `/${foreignId}`, token, { note: 'Không được lưu' })).status, 404);
      assert.equal((await request('DELETE', `/${foreignId}`, token)).status, 404);
    }
    assert.deepEqual(await prisma.class.findUniqueOrThrow({ where: { id } }), ownerBefore);
    assert.deepEqual(await prisma.class.findUniqueOrThrow({ where: { id: otherId } }), otherBefore);

    const ownerPatch = await request('PATCH', `/${id}`, teacherToken, {
      teacherId: otherUser.id,
      teacher_id: otherUser.id,
      note: 'Chủ sở hữu không đổi',
    });
    assert.equal(ownerPatch.status, 200);
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id } })).teacherId, user.id);
    assert.equal((await request('PATCH', `/${id}`, teacherToken, { teacherId: otherUser.id })).status, 400);
    assert.equal((await request('GET', `/${otherId}`, otherToken)).status, 200);
    assert.equal((await request('PATCH', `/${otherId}`, otherToken, { status: 'INACTIVE' })).status, 200);
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: otherId } })).teacherId, otherUser.id);
    assert.equal((await request('DELETE', `/${otherId}`, otherToken)).status, 200);
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id } })).teacherId, user.id);
    console.log('PASS: Hai tài khoản tách biệt Class; không giả mạo/chuyển chủ sở hữu qua POST/PATCH/ADMIN');
  } finally {
    try {
      if (ownedIds.size) {
        const cleaned = await prisma.class.deleteMany({ where: { id: { in: [...ownedIds] } } });
        console.log(`Đã dọn ${cleaned.count} lớp test còn lại; giữ nguyên dữ liệu có sẵn`);
      }
    } finally {
      try {
        if (otherUserId !== undefined) {
          await prisma.user.delete({ where: { id: otherUserId } });
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
  }
});
