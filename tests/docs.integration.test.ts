import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import app from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';

test('Swagger UI tải OpenAPI đầy đủ, assets local và giữ auth/CORS/404', { timeout: 30000 }, async () => {
  let server: Server | undefined;
  try {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function get(path: string) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { Origin: env.FRONTEND_ORIGIN } });
      assert.equal(response.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGIN);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      return response;
    }

    const specResponse = await get('/api/docs/openapi.json');
    assert.equal(specResponse.status, 200);
    assert.match(specResponse.headers.get('content-type') ?? '', /^application\/json\b/i);
    const spec = await specResponse.json();
    assert.equal(spec.openapi, '3.0.4');
    assert.deepEqual(spec.servers.map((server: { url: string }) => server.url), ['/api']);
    assert.deepEqual(Object.keys(spec.paths).sort(), [
      '/auth/login', '/auth/logout', '/auth/me', '/auth/me/avatar', '/auth/refresh', '/auth/register',
      '/auth/registrations/pending', '/auth/registrations/{id}/approve',
      '/classes', '/classes/{classId}/schedules', '/classes/{classId}/schedules/{scheduleId}',
      '/classes/{classId}/students', '/classes/{classId}/students/{studentId}', '/classes/{id}',
      '/payments', '/payments/{id}',
      '/students', '/students/{id}',
    ]);
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
    const operations = Object.values(spec.paths).flatMap(path =>
      Object.entries(path as Record<string, { operationId: string }>).filter(([method]) => methods.includes(method))
        .map(([, operation]) => operation));
    assert.equal(operations.length, 31);
    assert.equal(new Set(operations.map(operation => operation.operationId)).size, 31);
    const serialized = JSON.stringify(spec);
    assert.ok(!serialized.includes(env.JWT_SECRET), 'OpenAPI không được chứa JWT secret');
    assert.ok(!serialized.includes(env.DATABASE_URL), 'OpenAPI không được chứa database URL');
    if (process.env.CLOUDINARY_API_SECRET) {
      assert.ok(!serialized.includes(process.env.CLOUDINARY_API_SECRET), 'OpenAPI không được chứa Cloudinary API secret');
    }
    // Validate schema và mọi $ref bằng thư viện, không cần validator online.
    await SwaggerParser.validate(structuredClone(spec), { resolve: { external: false } });

    type Schema = {
      $ref?: string; type?: string; format?: string; pattern?: string;
      properties?: Record<string, Schema>; items?: Schema; required?: string[];
      nullable?: boolean; default?: unknown; minProperties?: number; enum?: unknown[];
      additionalProperties?: boolean;
      minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
      'x-minTrimmedCodePoints'?: number; 'x-maxTrimmedCodePoints'?: number;
      'x-maxBytes'?: number; 'x-maxPixels'?: number;
      oneOf?: Schema[]; anyOf?: Schema[];
    };
    function resolveSchema(schema: Schema): Schema {
      assert.ok(schema && typeof schema === 'object', 'Operation phải mô tả JSON schema');
      if (!schema.$ref) return schema;
      assert.match(schema.$ref, /^#\/components\/schemas\/[^/]+$/);
      return resolveSchema(spec.components.schemas[schema.$ref.split('/').at(-1)!]);
    }
    function propertiesOf(schema: Schema) {
      const resolved = resolveSchema(schema);
      assert.equal(resolved.type, 'object');
      assert.ok(resolved.properties, 'Object phải mô tả các field');
      return resolved.properties;
    }
    function responseProperties(path: string, method: string, status = '200') {
      return propertiesOf(spec.paths[path][method].responses[status].content['application/json'].schema);
    }

    // Public User luôn có name và URL avatar riêng/mặc định, vẫn loại dữ liệu tài khoản nhạy cảm.
    const authOperationCount = Object.entries(spec.paths).filter(([path]) => path.startsWith('/auth/'))
      .reduce((count, [, path]) => count + Object.keys(path as object).filter(method => methods.includes(method)).length, 0);
    assert.equal(authOperationCount, 9);
    assert.deepEqual(Object.keys(spec.paths['/auth/me']).filter(key => methods.includes(key)).sort(), ['get', 'patch']);
    const authUserKeys = ['avatar', 'email', 'id', 'name', 'role'];
    for (const [path, method, status] of [
      ['/auth/register', 'post', '201'], ['/auth/login', 'post', '200'], ['/auth/refresh', 'post', '200'],
      ['/auth/me', 'get', '200'], ['/auth/me', 'patch', '200'], ['/auth/me/avatar', 'patch', '200'],
    ] as const) {
      const fields = responseProperties(path, method, status);
      const userSchema = resolveSchema(propertiesOf(fields.data!).user!);
      const userFields = propertiesOf(userSchema);
      assert.deepEqual(Object.keys(userFields).sort(), authUserKeys, `${method} ${path} trả id/email/name/avatar/role`);
      assert.deepEqual([...(userSchema.required ?? [])].sort(), authUserKeys);
      assert.equal(resolveSchema(userFields.name!).type, 'string');
      assert.ok(resolveSchema(userFields.name!).nullable !== true);
      assert.equal(resolveSchema(userFields.avatar!).type, 'string');
      assert.equal(resolveSchema(userFields.avatar!).format, 'uri');
      assert.ok(resolveSchema(userFields.avatar!).nullable !== true, 'DB avatar null phải serialize thành URL ảnh chung');
      const example = spec.paths[path][method].responses[status].content['application/json'].example;
      assert.deepEqual(Object.keys(example.data.user).sort(), authUserKeys);
      assert.equal(typeof example.data.user.name, 'string');
      assert.ok(typeof example.data.user.avatar === 'string' && /^https?:\/\//.test(example.data.user.avatar));
    }
    for (const method of ['get', 'patch']) {
      const operation = spec.paths['/auth/me'][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      assert.ok(operation.responses['401'] && operation.responses['403']);
      assert.equal(operation.responses['404'], undefined, 'Tài khoản mất trả 401, không 404');
    }
    const pendingData = propertiesOf(responseProperties('/auth/registrations/pending', 'get').data!);
    const pendingSchema = resolveSchema(resolveSchema(pendingData.users!).items!);
    const pendingKeys = ['avatar', 'createdAt', 'email', 'id', 'name', 'role', 'status'];
    assert.deepEqual(Object.keys(propertiesOf(pendingSchema)).sort(), pendingKeys);
    assert.deepEqual([...(pendingSchema.required ?? [])].sort(), pendingKeys);
    const approvedData = propertiesOf(responseProperties('/auth/registrations/{id}/approve', 'patch').data!);
    const approvedSchema = resolveSchema(approvedData.user!);
    const approvedKeys = ['avatar', 'email', 'id', 'name', 'role', 'status'];
    assert.deepEqual(Object.keys(propertiesOf(approvedSchema)).sort(), approvedKeys);
    assert.deepEqual([...(approvedSchema.required ?? [])].sort(), approvedKeys);
    for (const schema of [pendingSchema, approvedSchema]) {
      const avatar = resolveSchema(propertiesOf(schema).avatar!);
      assert.equal(avatar.type, 'string');
      assert.equal(avatar.format, 'uri');
      assert.ok(avatar.nullable !== true);
    }
    const authRegisterBody = resolveSchema(spec.paths['/auth/register'].post.requestBody.content['application/json'].schema);
    assert.deepEqual(Object.keys(propertiesOf(authRegisterBody)).sort(), ['email', 'password'], 'Đăng ký tự đặt tên từ email, không nhận tên/avatar');
    assert.equal(authRegisterBody.additionalProperties, false);
    const profilePatch = spec.paths['/auth/me'].patch;
    const profileBody = resolveSchema(profilePatch.requestBody.content['application/json'].schema);
    assert.equal(profilePatch.requestBody.required, true);
    assert.equal(profileBody.additionalProperties, false);
    assert.deepEqual(profileBody.required, ['name']);
    const profileFields = propertiesOf(profileBody);
    assert.deepEqual(Object.keys(profileFields), ['name']);
    const profileName = resolveSchema(profileFields.name!);
    assert.equal(profileName.type, 'string');
    assert.equal(profileName.minLength, 1);
    assert.equal(profileName['x-minTrimmedCodePoints'], 1);
    assert.equal(profileName['x-maxTrimmedCodePoints'], 150);
    assert.equal(profileName.maxLength, undefined, 'Giới hạn tên áp dụng sau trim, không giới hạn độ dài chuỗi JSON còn khoảng trắng');
    assert.equal(profileName.default, undefined);
    assert.ok(profileName.nullable !== true);
    assert.ok(typeof profileName.pattern === 'string');
    assert.ok(!new RegExp(profileName.pattern).test('   '));
    const profileResponse = responseProperties('/auth/me', 'patch');
    assert.deepEqual(Object.keys(profileResponse).sort(), ['data', 'message', 'success']);
    assert.deepEqual(resolveSchema(profileResponse.message!).enum, ['Cập nhật tên thành công']);
    const profileErrors = profilePatch.responses['400'].content['application/json'].schema.oneOf.map(resolveSchema) as Schema[];
    const profileValidation = profileErrors.find(schema => schema.properties?.errors);
    assert.ok(profileValidation, 'PATCH mô tả lỗi validation có field/message');
    assert.deepEqual(resolveSchema(propertiesOf(profileValidation).message!).enum, ['Thông tin tài khoản không hợp lệ']);
    assert.deepEqual(Object.keys(propertiesOf(resolveSchema(propertiesOf(profileValidation).errors!).items!)).sort(), ['field', 'message']);

    const avatarPath = '/auth/me/avatar';
    assert.deepEqual(Object.keys(spec.paths[avatarPath]).filter(key => methods.includes(key)), ['patch']);
    const avatarPatch = spec.paths[avatarPath].patch;
    assert.deepEqual(avatarPatch.security, [{ bearerAuth: [] }]);
    assert.ok(['200', '400', '401', '403', '409', '413', '415', '502', '503'].every(status => avatarPatch.responses[status]));
    assert.equal(avatarPatch.responses['404'], undefined, 'Tài khoản mất khi upload avatar dùng 401');
    assert.equal(avatarPatch.requestBody.required, true);
    assert.deepEqual(Object.keys(avatarPatch.requestBody.content), ['multipart/form-data']);
    const avatarBody = resolveSchema(avatarPatch.requestBody.content['multipart/form-data'].schema);
    assert.equal(avatarBody.additionalProperties, false);
    assert.deepEqual(avatarBody.required, ['avatar']);
    const avatarFields = propertiesOf(avatarBody);
    assert.deepEqual(Object.keys(avatarFields), ['avatar']);
    const avatarFile = resolveSchema(avatarFields.avatar!);
    assert.equal(avatarFile.type, 'string');
    assert.equal(avatarFile.format, 'binary');
    assert.equal(avatarFile['x-maxBytes'], 2097152);
    assert.equal(avatarFile['x-maxPixels'], 20000000);
    assert.ok(avatarFile.nullable !== true);
    assert.deepEqual(avatarPatch.requestBody.content['multipart/form-data'].encoding.avatar.contentType.split(',').map((mime: string) => mime.trim()).sort(),
      ['image/jpeg', 'image/png', 'image/webp']);
    const avatarResponse = responseProperties(avatarPath, 'patch');
    assert.deepEqual(Object.keys(avatarResponse).sort(), ['data', 'message', 'success']);
    assert.deepEqual(resolveSchema(avatarResponse.message!).enum, ['Cập nhật avatar thành công']);
    assert.equal(spec.paths['/assets/default-avatar.svg'], undefined, 'Ảnh mặc định là asset, không tăng inventory API');

    const classOperations = [
      ['/classes', 'get'], ['/classes', 'post'],
      ['/classes/{id}', 'get'], ['/classes/{id}', 'patch'], ['/classes/{id}', 'delete'],
    ] as const;
    assert.deepEqual(Object.keys(spec.paths['/classes']).filter(key => methods.includes(key)).sort(), ['get', 'post']);
    assert.deepEqual(Object.keys(spec.paths['/classes/{id}']).filter(key => methods.includes(key)).sort(), ['delete', 'get', 'patch']);
    for (const [path, method] of classOperations) {
      const operation = spec.paths[path][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${method} ${path} yêu cầu Bearer`);
      assert.ok(operation.responses['401'] && operation.responses['403'], 'Class phải mô tả auth và tài khoản chưa được duyệt');
    }

    // Các định dạng FE cần dùng: tiền là chuỗi, ngày học khác timestamps và không lộ ownership.
    const detail = responseProperties('/classes/{id}', 'get');
    assert.deepEqual(Object.keys(detail).sort(), ['data', 'success']);
    const classSchema = resolveSchema(propertiesOf(detail.data!).class!);
    const classFields = propertiesOf(classSchema);
    assert.deepEqual(Object.keys(classFields).sort(), [
      'createdAt', 'endDate', 'grade', 'id', 'name', 'note', 'schoolYear',
      'startDate', 'status', 'subject', 'tuitionFee', 'updatedAt',
    ]);
    assert.equal(resolveSchema(classFields.id!).type, 'integer');
    const responseFee = resolveSchema(classFields.tuitionFee!);
    assert.equal(responseFee.type, 'string');
    assert.ok(typeof responseFee.pattern === 'string', 'Học phí response phải mô tả hai chữ số thập phân');
    const feePattern = new RegExp(responseFee.pattern);
    assert.ok(['0.00', '600000.25', '9999999999.99'].every(value => feePattern.test(value)));
    assert.ok(['600000', '1.2', '1.234'].every(value => !feePattern.test(value)), 'Không mô tả học phí response như input chưa chuẩn hóa');
    assert.equal(resolveSchema(classFields.startDate!).format, 'date');
    assert.equal(resolveSchema(classFields.endDate!).format, 'date');
    assert.equal(resolveSchema(classFields.endDate!).nullable, true);
    assert.equal(resolveSchema(classFields.note!).nullable, true);
    for (const field of ['createdAt', 'updatedAt']) assert.equal(resolveSchema(classFields[field]!).format, 'date-time');
    const list = responseProperties('/classes', 'get');
    assert.deepEqual(Object.keys(list).sort(), ['data', 'success']);
    const listData = propertiesOf(list.data!);
    assert.deepEqual(Object.keys(listData), ['classes']);
    const classList = resolveSchema(listData.classes!);
    assert.equal(classList.type, 'array');
    assert.deepEqual(Object.keys(propertiesOf(classList.items!)).sort(), Object.keys(classFields).sort());
    for (const [path, method, status] of [['/classes', 'post', '201'], ['/classes/{id}', 'patch', '200']] as const) {
      const response = responseProperties(path, method, status);
      assert.deepEqual(Object.keys(response).sort(), ['data', 'message', 'success']);
      assert.deepEqual(Object.keys(propertiesOf(response.data!)), ['class']);
    }
    assert.deepEqual(Object.keys(responseProperties('/classes/{id}', 'delete')).sort(), ['message', 'success']);
    assert.ok(spec.paths['/classes/{id}'].delete.responses['409'], 'DELETE phải mô tả việc giữ lịch sử ghi danh');

    const createBody = resolveSchema(spec.paths['/classes'].post.requestBody.content['application/json'].schema);
    assert.deepEqual([...createBody.required!].sort(), ['grade', 'name', 'schoolYear', 'startDate', 'subject', 'tuitionFee']);
    const createFields = propertiesOf(createBody);
    const inputFee = resolveSchema(createFields.tuitionFee!);
    assert.deepEqual((inputFee.oneOf ?? inputFee.anyOf ?? []).map(schema => resolveSchema(schema).type).sort(), ['number', 'string']);
    assert.equal(resolveSchema(createFields.status!).default, 'ACTIVE');
    const patchBody = resolveSchema(spec.paths['/classes/{id}'].patch.requestBody.content['application/json'].schema);
    const patchFields = propertiesOf(patchBody);
    assert.deepEqual(patchBody.required ?? [], []);
    assert.equal(patchBody.minProperties, 1);
    assert.equal(resolveSchema(patchFields.endDate!).nullable, true);
    assert.equal(resolveSchema(patchFields.note!).nullable, true);
    assert.equal(resolveSchema(patchFields.status!).default, undefined, 'PATCH không mặc định lại field chưa gửi');
    for (const fields of [createFields, patchFields]) {
      assert.ok(['id', 'teacherId', 'teacher_id', 'createdAt', 'updatedAt'].every(field => !(field in fields)),
        'Body Class không được cho client chọn ownership hoặc sửa field bất biến');
    }

    const studentOperations = [
      ['/students', 'get'], ['/students', 'post'],
      ['/students/{id}', 'get'], ['/students/{id}', 'patch'], ['/students/{id}', 'delete'],
    ] as const;
    assert.deepEqual(Object.keys(spec.paths['/students']).filter(key => methods.includes(key)).sort(), ['get', 'post']);
    assert.deepEqual(Object.keys(spec.paths['/students/{id}']).filter(key => methods.includes(key)).sort(), ['delete', 'get', 'patch']);
    for (const [path, method] of studentOperations) {
      const operation = spec.paths[path][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${method} ${path} yêu cầu Bearer`);
      assert.ok(operation.responses['401'] && operation.responses['403'], 'Student phải mô tả auth và tài khoản chưa được duyệt');
    }
    const studentDetail = responseProperties('/students/{id}', 'get');
    assert.deepEqual(Object.keys(studentDetail).sort(), ['data', 'success']);
    const studentData = propertiesOf(studentDetail.data!);
    assert.deepEqual(Object.keys(studentData), ['student']);
    const studentFields = propertiesOf(studentData.student!);
    assert.deepEqual(Object.keys(studentFields).sort(), [
      'address', 'createdAt', 'dateOfBirth', 'fullName', 'grade', 'id', 'note',
      'parentName', 'parentPhone', 'phone', 'school', 'status', 'updatedAt',
    ]);
    assert.equal(resolveSchema(studentFields.id!).type, 'string');
    assert.equal(resolveSchema(studentFields.id!).format, 'uuid');
    assert.equal(resolveSchema(studentFields.fullName!).type, 'string');
    assert.ok(['fullName', 'status'].every(field => resolveSchema(studentFields[field]!).nullable !== true), 'fullName/status không nhận null');
    const nullableStudentFields = ['phone', 'parentName', 'parentPhone', 'school', 'grade', 'dateOfBirth', 'address', 'note'];
    for (const field of nullableStudentFields) assert.equal(resolveSchema(studentFields[field]!).nullable, true, field);
    assert.equal(resolveSchema(studentFields.dateOfBirth!).format, 'date');
    for (const field of ['createdAt', 'updatedAt']) assert.equal(resolveSchema(studentFields[field]!).format, 'date-time');
    const studentList = responseProperties('/students', 'get');
    assert.deepEqual(Object.keys(studentList).sort(), ['data', 'success']);
    const studentListData = propertiesOf(studentList.data!);
    assert.deepEqual(Object.keys(studentListData), ['students']);
    const studentArray = resolveSchema(studentListData.students!);
    assert.equal(studentArray.type, 'array');
    assert.deepEqual(Object.keys(propertiesOf(studentArray.items!)).sort(), Object.keys(studentFields).sort());
    for (const [path, method, status] of [['/students', 'post', '201'], ['/students/{id}', 'patch', '200']] as const) {
      const response = responseProperties(path, method, status);
      assert.deepEqual(Object.keys(response).sort(), ['data', 'message', 'success']);
      assert.deepEqual(Object.keys(propertiesOf(response.data!)), ['student']);
    }
    assert.deepEqual(Object.keys(responseProperties('/students/{id}', 'delete')).sort(), ['message', 'success']);
    assert.ok(spec.paths['/students/{id}'].delete.responses['409'], 'DELETE Student phải mô tả việc giữ lịch sử ghi danh');
    const studentCreateBody = resolveSchema(spec.paths['/students'].post.requestBody.content['application/json'].schema);
    assert.deepEqual(studentCreateBody.required, ['fullName']);
    const studentCreateFields = propertiesOf(studentCreateBody);
    assert.equal(resolveSchema(studentCreateFields.status!).default, 'ACTIVE');
    const studentPatchBody = resolveSchema(spec.paths['/students/{id}'].patch.requestBody.content['application/json'].schema);
    assert.deepEqual(studentPatchBody.required ?? [], []);
    assert.equal(studentPatchBody.minProperties, 1);
    const studentPatchFields = propertiesOf(studentPatchBody);
    assert.equal(resolveSchema(studentPatchFields.status!).default, undefined, 'PATCH Student không mặc định lại trạng thái chưa gửi');
    for (const fields of [studentCreateFields, studentPatchFields]) {
      assert.ok(['fullName', 'status'].every(field => resolveSchema(fields[field]!).nullable !== true), 'Body Student không nhận fullName/status null');
      for (const field of nullableStudentFields) assert.equal(resolveSchema(fields[field]!).nullable, true, field);
      const grade = resolveSchema(fields.grade!);
      assert.equal(grade.type, 'integer');
      assert.equal(grade.minimum, 1);
      assert.equal(grade.maximum, 12);
      assert.ok(['id', 'teacherId', 'teacher_id', 'classId', 'createdAt', 'updatedAt'].every(field => !(field in fields)),
        'Body Student không được cho client chọn ownership, lớp học hoặc sửa field bất biến');
    }

    const enrollmentsPath = '/classes/{classId}/students';
    const leavePath = '/classes/{classId}/students/{studentId}';
    const enrollmentOperations = [[enrollmentsPath, 'post'], [enrollmentsPath, 'get'], [leavePath, 'delete']] as const;
    assert.deepEqual(Object.keys(spec.paths[enrollmentsPath]).filter(key => methods.includes(key)).sort(), ['get', 'post']);
    assert.deepEqual(Object.keys(spec.paths[leavePath]).filter(key => methods.includes(key)), ['delete']);
    for (const [path, method] of enrollmentOperations) {
      const operation = spec.paths[path][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${method} ${path} yêu cầu Bearer`);
      assert.ok(['400', '401', '403', '404'].every(status => operation.responses[status]), 'Enrollment phải mô tả validation, auth và phạm vi sở hữu');
      const classId = resolveSchema(operation.parameters.find((parameter: { name: string }) => parameter.name === 'classId').schema);
      assert.equal(classId.type, 'integer');
      assert.equal(classId.minimum, 1);
      assert.equal(classId.maximum, 2147483647);
    }
    assert.ok(spec.paths[enrollmentsPath].post.responses['409'], 'POST phải mô tả trùng ghi danh kể cả học sinh đã nghỉ');
    const enrollmentCreateBody = resolveSchema(spec.paths[enrollmentsPath].post.requestBody.content['application/json'].schema);
    const enrollmentCreateFields = propertiesOf(enrollmentCreateBody);
    assert.deepEqual(Object.keys(enrollmentCreateFields).sort(), ['joinedAt', 'studentId']);
    assert.deepEqual([...enrollmentCreateBody.required!].sort(), ['joinedAt', 'studentId']);
    assert.equal(enrollmentCreateBody.additionalProperties, false, 'POST ghi danh từ chối field ngoài studentId/joinedAt');
    assert.equal(resolveSchema(enrollmentCreateFields.studentId!).format, 'uuid');
    assert.equal(resolveSchema(enrollmentCreateFields.joinedAt!).format, 'date');
    assert.ok(Object.values(enrollmentCreateFields).every(field => resolveSchema(field).default === undefined && resolveSchema(field).nullable !== true));

    const enrollmentCreate = responseProperties(enrollmentsPath, 'post', '201');
    assert.deepEqual(Object.keys(enrollmentCreate).sort(), ['data', 'message', 'success']);
    const enrollmentCreateData = propertiesOf(enrollmentCreate.data!);
    assert.deepEqual(Object.keys(enrollmentCreateData), ['enrollment']);
    const enrollmentFields = propertiesOf(enrollmentCreateData.enrollment!);
    const enrollmentKeys = ['classId', 'createdAt', 'id', 'joinedAt', 'leftAt', 'status', 'studentId', 'updatedAt'];
    assert.deepEqual(Object.keys(enrollmentFields).sort(), enrollmentKeys);
    for (const field of ['id', 'studentId']) assert.equal(resolveSchema(enrollmentFields[field]!).format, 'uuid');
    assert.equal(resolveSchema(enrollmentFields.classId!).type, 'integer');
    for (const field of ['joinedAt', 'leftAt']) assert.equal(resolveSchema(enrollmentFields[field]!).format, 'date');
    assert.equal(resolveSchema(enrollmentFields.leftAt!).nullable, true);
    assert.deepEqual(resolveSchema(enrollmentFields.status!).enum, ['ACTIVE', 'LEFT']);
    for (const field of ['createdAt', 'updatedAt']) assert.equal(resolveSchema(enrollmentFields[field]!).format, 'date-time');

    const enrollmentList = responseProperties(enrollmentsPath, 'get');
    assert.deepEqual(Object.keys(enrollmentList).sort(), ['data', 'success']);
    const enrollmentListData = propertiesOf(enrollmentList.data!);
    assert.deepEqual(Object.keys(enrollmentListData), ['enrollments']);
    const enrollmentArray = resolveSchema(enrollmentListData.enrollments!);
    assert.equal(enrollmentArray.type, 'array');
    const enrollmentWithStudent = propertiesOf(enrollmentArray.items!);
    assert.deepEqual(Object.keys(enrollmentWithStudent).sort(), [...enrollmentKeys, 'student'].sort());
    const nestedStudentFields = propertiesOf(enrollmentWithStudent.student!);
    assert.deepEqual(Object.keys(nestedStudentFields).sort(), Object.keys(studentFields).sort());
    for (const field of nullableStudentFields) assert.equal(resolveSchema(nestedStudentFields[field]!).nullable, true, field);
    assert.equal(resolveSchema(nestedStudentFields.id!).format, 'uuid');
    assert.equal(resolveSchema(nestedStudentFields.dateOfBirth!).format, 'date');

    // DELETE là nghỉ lớp, trả lại ghi danh được giữ trong lịch sử; ngày nghỉ do server quyết định.
    const leaveOperation = spec.paths[leavePath].delete;
    assert.equal(leaveOperation.requestBody, undefined);
    assert.equal(resolveSchema(leaveOperation.parameters.find((parameter: { name: string }) => parameter.name === 'studentId').schema).format, 'uuid');
    const leaveResponse = responseProperties(leavePath, 'delete');
    assert.deepEqual(Object.keys(leaveResponse).sort(), ['data', 'message', 'success']);
    assert.deepEqual(resolveSchema(leaveResponse.message!).enum, ['Học sinh đã rời lớp']);
    const leaveData = propertiesOf(leaveResponse.data!);
    assert.deepEqual(Object.keys(leaveData), ['enrollment']);
    assert.deepEqual(Object.keys(propertiesOf(leaveData.enrollment!)).sort(), enrollmentKeys);

    const schedulesPath = '/classes/{classId}/schedules';
    const scheduleDetailPath = '/classes/{classId}/schedules/{scheduleId}';
    const scheduleOperations = [
      [schedulesPath, 'post'], [schedulesPath, 'get'],
      [scheduleDetailPath, 'get'], [scheduleDetailPath, 'patch'], [scheduleDetailPath, 'delete'],
    ] as const;
    assert.deepEqual(Object.keys(spec.paths[schedulesPath]).filter(key => methods.includes(key)).sort(), ['get', 'post']);
    assert.deepEqual(Object.keys(spec.paths[scheduleDetailPath]).filter(key => methods.includes(key)).sort(), ['delete', 'get', 'patch']);
    for (const [path, method] of scheduleOperations) {
      const operation = spec.paths[path][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      assert.ok(['400', '401', '403', '404'].every(status => operation.responses[status]), 'Lịch học phải mô tả validation/auth và lớp/lịch ngoài ownership');
      const classId = resolveSchema(operation.parameters.find((parameter: { name: string }) => parameter.name === 'classId').schema);
      assert.equal(classId.type, 'integer');
      assert.equal(classId.minimum, 1);
      assert.equal(classId.maximum, 2147483647);
      if (path === scheduleDetailPath) {
        assert.equal(resolveSchema(operation.parameters.find((parameter: { name: string }) => parameter.name === 'scheduleId').schema).format, 'uuid');
      }
    }
    const scheduleDetail = responseProperties(scheduleDetailPath, 'get');
    assert.deepEqual(Object.keys(scheduleDetail).sort(), ['data', 'success']);
    const scheduleData = propertiesOf(scheduleDetail.data!);
    assert.deepEqual(Object.keys(scheduleData), ['schedule']);
    const scheduleFields = propertiesOf(scheduleData.schedule!);
    const scheduleKeys = ['classId', 'createdAt', 'dayOfWeek', 'endTime', 'id', 'startTime', 'updatedAt'];
    assert.deepEqual(Object.keys(scheduleFields).sort(), scheduleKeys);
    assert.equal(resolveSchema(scheduleFields.id!).format, 'uuid');
    assert.equal(resolveSchema(scheduleFields.classId!).type, 'integer');
    assert.deepEqual(resolveSchema(scheduleFields.dayOfWeek!).enum, ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
    for (const field of ['createdAt', 'updatedAt']) assert.equal(resolveSchema(scheduleFields[field]!).format, 'date-time');
    for (const field of ['startTime', 'endTime']) {
      const clock = resolveSchema(scheduleFields[field]!);
      assert.equal(clock.type, 'string');
      assert.ok(typeof clock.pattern === 'string', 'Giờ response phải mô tả HH:mm:ss, không phải DateTime');
      const pattern = new RegExp(clock.pattern);
      assert.ok(['00:00:00', '19:00:01', '23:59:59'].every(value => pattern.test(value)));
      assert.ok(['19:00', '24:00:00', '19:00:00.000', '1970-01-01T19:00:00Z'].every(value => !pattern.test(value)));
    }
    const scheduleList = responseProperties(schedulesPath, 'get');
    assert.deepEqual(Object.keys(scheduleList).sort(), ['data', 'success']);
    const scheduleListData = propertiesOf(scheduleList.data!);
    assert.deepEqual(Object.keys(scheduleListData), ['schedules']);
    const scheduleArray = resolveSchema(scheduleListData.schedules!);
    assert.equal(scheduleArray.type, 'array');
    assert.deepEqual(Object.keys(propertiesOf(scheduleArray.items!)).sort(), scheduleKeys);
    for (const [path, method, status] of [[schedulesPath, 'post', '201'], [scheduleDetailPath, 'patch', '200']] as const) {
      const response = responseProperties(path, method, status);
      assert.deepEqual(Object.keys(response).sort(), ['data', 'message', 'success']);
      const data = propertiesOf(response.data!);
      assert.deepEqual(Object.keys(data), ['schedule']);
      assert.deepEqual(Object.keys(propertiesOf(data.schedule!)).sort(), scheduleKeys);
    }
    const scheduleCreateBody = resolveSchema(spec.paths[schedulesPath].post.requestBody.content['application/json'].schema);
    const schedulePatchBody = resolveSchema(spec.paths[scheduleDetailPath].patch.requestBody.content['application/json'].schema);
    assert.deepEqual([...scheduleCreateBody.required!].sort(), ['dayOfWeek', 'endTime', 'startTime']);
    assert.deepEqual(schedulePatchBody.required ?? [], []);
    assert.equal(schedulePatchBody.minProperties, 1);
    for (const body of [scheduleCreateBody, schedulePatchBody]) {
      assert.equal(body.additionalProperties, false);
      const fields = propertiesOf(body);
      assert.deepEqual(Object.keys(fields).sort(), ['dayOfWeek', 'endTime', 'startTime']);
      assert.ok(Object.values(fields).every(field => resolveSchema(field).nullable !== true && resolveSchema(field).default === undefined));
      for (const field of ['startTime', 'endTime']) {
        const clock = resolveSchema(fields[field]!);
        assert.ok(typeof clock.pattern === 'string');
        const pattern = new RegExp(clock.pattern);
        assert.ok(['19:00', '19:00:01'].every(value => pattern.test(value)), 'Input nhận cả HH:mm và HH:mm:ss');
        assert.ok(['24:00', '19:00:00.000'].every(value => !pattern.test(value)));
      }
    }
    const scheduleDelete = spec.paths[scheduleDetailPath].delete;
    assert.equal(scheduleDelete.requestBody, undefined);
    const scheduleDeleteFields = responseProperties(scheduleDetailPath, 'delete');
    assert.deepEqual(Object.keys(scheduleDeleteFields).sort(), ['message', 'success']);
    assert.deepEqual(resolveSchema(scheduleDeleteFields.message!).enum, ['Xóa lịch học thành công']);

    const paymentOperations = [['/payments', 'post'], ['/payments', 'get'], ['/payments/{id}', 'get'], ['/payments/{id}', 'patch']] as const;
    assert.deepEqual(Object.keys(spec.paths['/payments']).filter(key => methods.includes(key)).sort(), ['get', 'post']);
    assert.deepEqual(Object.keys(spec.paths['/payments/{id}']).filter(key => methods.includes(key)).sort(), ['get', 'patch'], 'Giữ lịch sử Payment: không mở DELETE');
    for (const [path, method] of paymentOperations) {
      const operation = spec.paths[path][method];
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      assert.ok(['400', '401', '403'].every(status => operation.responses[status]), 'Payment phải mô tả validation/auth');
      if (path === '/payments/{id}') assert.equal(resolveSchema(operation.parameters.find((parameter: { name: string }) => parameter.name === 'id').schema).format, 'uuid');
      if (method !== 'get' || path === '/payments/{id}') assert.ok(operation.responses['404'], 'Payment ngoài ownership phải được mô tả 404');
    }
    assert.ok(spec.paths['/payments'].post.responses['409'], 'POST phải mô tả trùng kỳ đã chuẩn hóa');
    assert.ok(spec.paths['/payments/{id}'].patch.responses['409'], 'PATCH phải mô tả xung đột khi bản ghi đã thay đổi');
    const paymentCreate = responseProperties('/payments', 'post', '201');
    assert.deepEqual(Object.keys(paymentCreate).sort(), ['data', 'message', 'success']);
    const paymentCreateData = propertiesOf(paymentCreate.data!);
    assert.deepEqual(Object.keys(paymentCreateData), ['payment']);
    const paymentFields = propertiesOf(paymentCreateData.payment!);
    const paymentKeys = ['amountDue', 'amountPaid', 'billingPeriod', 'classStudentId', 'createdAt', 'id', 'note', 'paidAt', 'paymentMethod', 'updatedAt'];
    assert.deepEqual(Object.keys(paymentFields).sort(), paymentKeys, 'POST Payment trả 10 field, không có status/quan hệ lồng nhau');
    for (const field of ['id', 'classStudentId']) assert.equal(resolveSchema(paymentFields[field]!).format, 'uuid');
    const paymentPeriod = resolveSchema(paymentFields.billingPeriod!);
    assert.equal(paymentPeriod.format, 'date');
    assert.ok(typeof paymentPeriod.pattern === 'string');
    const periodPattern = new RegExp(paymentPeriod.pattern);
    assert.ok(periodPattern.test('2026-10-01') && !periodPattern.test('2026-10-15'), 'Response kỳ học phí đã chuẩn hóa về đầu tháng');
    for (const field of ['amountDue', 'amountPaid']) {
      const money = resolveSchema(paymentFields[field]!);
      assert.equal(money.type, 'string');
      assert.ok(typeof money.pattern === 'string');
      const pattern = new RegExp(money.pattern);
      assert.ok(['0.00', '0.01', '9999999999.99'].every(value => pattern.test(value)));
      assert.ok(['0', '1.2', '-0.01', '1.234'].every(value => !pattern.test(value)), 'Response tiền luôn là chuỗi Decimal hai số lẻ');
    }
    for (const field of ['paidAt', 'createdAt', 'updatedAt']) assert.equal(resolveSchema(paymentFields[field]!).format, 'date-time');
    for (const field of ['paidAt', 'paymentMethod', 'note']) assert.equal(resolveSchema(paymentFields[field]!).nullable, true);
    assert.deepEqual(resolveSchema(paymentFields.paymentMethod!).enum?.filter(value => value !== null), ['CASH', 'BANK_TRANSFER', 'OTHER']);
    for (const method of ['get', 'patch']) {
      const response = responseProperties('/payments/{id}', method);
      assert.deepEqual(Object.keys(response).sort(), method === 'get' ? ['data', 'success'] : ['data', 'message', 'success']);
      const data = propertiesOf(response.data!);
      assert.deepEqual(Object.keys(data), ['payment']);
      const fields = propertiesOf(data.payment!);
      assert.deepEqual(Object.keys(fields).sort(), [...paymentKeys, 'status'].sort());
      assert.deepEqual(resolveSchema(fields.status!).enum, ['UNPAID', 'PARTIAL', 'PAID']);
    }
    const paymentList = responseProperties('/payments', 'get');
    assert.deepEqual(Object.keys(paymentList).sort(), ['data', 'success']);
    const paymentListData = propertiesOf(paymentList.data!);
    assert.deepEqual(Object.keys(paymentListData), ['payments']);
    const paymentArray = resolveSchema(paymentListData.payments!);
    assert.equal(paymentArray.type, 'array');
    assert.deepEqual(Object.keys(propertiesOf(paymentArray.items!)).sort(), [...paymentKeys, 'status'].sort());
    const paymentListExamples = Object.values(spec.paths['/payments'].get.responses['200'].content['application/json'].examples) as Array<{
      value: { data: { payments: Array<{ amountDue: string; amountPaid: string; status: string; paidAt: string | null }> } };
    }>;
    assert.ok(paymentListExamples.some(example => example.value.data.payments.some(payment =>
      payment.amountDue === '0.00' && payment.amountPaid === '0.00' && payment.status === 'PAID' && payment.paidAt === null)),
      'Khoản 0/0 phải được minh họa PAID nhưng chưa có paidAt');
    const paymentFilters = spec.paths['/payments'].get.parameters;
    assert.deepEqual(paymentFilters.map((parameter: { name: string }) => parameter.name).sort(), ['billingPeriod', 'classId', 'status', 'studentId']);
    assert.ok(paymentFilters.every((parameter: { in: string; required?: boolean }) => parameter.in === 'query' && parameter.required !== true));
    const filterSchema = (name: string) => resolveSchema(paymentFilters.find((parameter: { name: string }) => parameter.name === name).schema);
    assert.equal(filterSchema('classId').type, 'integer');
    assert.equal(filterSchema('classId').minimum, 1);
    assert.equal(filterSchema('classId').maximum, 2147483647);
    assert.equal(filterSchema('studentId').format, 'uuid');
    assert.equal(filterSchema('billingPeriod').format, 'date');
    assert.deepEqual(filterSchema('status').enum, ['UNPAID', 'PARTIAL', 'PAID']);
    assert.equal(spec.paths['/payments'].get.responses['404'], undefined, 'ID bộ lọc không có/ngoài phạm vi trả danh sách rỗng, không 404');
    const paymentCreateBody = resolveSchema(spec.paths['/payments'].post.requestBody.content['application/json'].schema);
    const paymentCreateFields = propertiesOf(paymentCreateBody);
    assert.equal(paymentCreateBody.additionalProperties, false);
    assert.deepEqual(Object.keys(paymentCreateFields).sort(), ['amountDue', 'billingPeriod', 'classStudentId', 'note']);
    assert.deepEqual([...paymentCreateBody.required!].sort(), ['billingPeriod', 'classStudentId']);
    assert.equal(resolveSchema(paymentCreateFields.classStudentId!).format, 'uuid');
    assert.equal(resolveSchema(paymentCreateFields.billingPeriod!).format, 'date');
    const paymentPatchBody = resolveSchema(spec.paths['/payments/{id}'].patch.requestBody.content['application/json'].schema);
    const paymentPatchFields = propertiesOf(paymentPatchBody);
    assert.equal(paymentPatchBody.additionalProperties, false);
    assert.equal(paymentPatchBody.minProperties, 1);
    assert.deepEqual(paymentPatchBody.required ?? [], []);
    assert.deepEqual(Object.keys(paymentPatchFields).sort(), ['amountDue', 'amountPaid', 'note', 'paymentMethod']);
    assert.ok(Object.values(paymentPatchFields).every(field => resolveSchema(field).default === undefined), 'PATCH giữ field không gửi; không đặt lại defaults');
    assert.equal(resolveSchema(paymentPatchFields.paymentMethod!).nullable, true);
    for (const fields of [paymentCreateFields, paymentPatchFields]) {
      assert.equal(resolveSchema(fields.note!).nullable, true);
      for (const field of ['amountDue', 'amountPaid'].filter(field => field in fields)) {
        const money = resolveSchema(fields[field]!);
        assert.deepEqual((money.oneOf ?? money.anyOf ?? []).map(schema => resolveSchema(schema).type).sort(), ['number', 'string']);
        assert.ok(money.nullable !== true, 'Không dùng null để xóa số tiền');
      }
    }

    for (const path of ['/api/docs', '/api/docs/']) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
      const html = await response.text();
      assert.ok(html.includes('id="swagger-ui"') && html.includes('swagger-ui-init.js'), 'Trang tài liệu phải tải Swagger UI');
      assert.ok(!/<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i.test(html), 'Assets Swagger phải được phục vụ local');
    }
    for (const [asset, contentType] of [
      ['swagger-ui.css', /^text\/css\b/i],
      ['swagger-ui-bundle.js', /^(?:text|application)\/javascript\b/i],
      ['swagger-ui-standalone-preset.js', /^(?:text|application)\/javascript\b/i],
      ['swagger-ui-init.js', /^(?:text|application)\/javascript\b/i],
    ] as const) {
      const response = await get(`/api/docs/${asset}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', contentType);
      const source = await response.text();
      assert.ok(source.length > 100, 'Asset phải có nội dung');
      if (asset === 'swagger-ui-init.js') {
        assert.match(source, /"url"\s*:\s*"\/api\/docs\/openapi\.json"/);
        assert.match(source, /"withCredentials"\s*:\s*true/);
        assert.match(source, /"persistAuthorization"\s*:\s*false/);
        assert.match(source, /"validatorUrl"\s*:\s*null/);
        assert.match(source, /"queryConfigEnabled"\s*:\s*false/);
      }
    }

    // Các request dừng trước DB hoặc không có cookie; không tạo tài khoản/phiên.
    const studentPath = '/students/00000000-0000-0000-0000-000000000001';
    const classStudentsPath = '/classes/1/students';
    const classStudentPath = `${classStudentsPath}/00000000-0000-0000-0000-000000000001`;
    const classSchedulesPath = '/classes/1/schedules';
    const classSchedulePath = `${classSchedulesPath}/00000000-0000-0000-0000-000000000001`;
    const paymentPath = '/payments/00000000-0000-0000-0000-000000000001';
    const calls: Array<[string, string, unknown, number]> = [
      ['/auth/register', 'POST', {}, 400],
      ['/auth/login', 'POST', {}, 400],
      ['/auth/refresh', 'POST', undefined, 401],
      ['/auth/logout', 'POST', undefined, 200],
      ['/auth/me', 'GET', undefined, 401],
      ['/auth/me', 'PATCH', { name: 'Nguyễn Văn An' }, 401],
      ['/auth/me/avatar', 'PATCH', undefined, 401],
      ['/auth/registrations/pending', 'GET', undefined, 401],
      ['/auth/registrations/1/approve', 'PATCH', undefined, 401],
      ['/classes', 'POST', {}, 401],
      ['/classes', 'GET', undefined, 401],
      ['/classes/1', 'GET', undefined, 401],
      ['/classes/1', 'PATCH', {}, 401],
      ['/classes/1', 'DELETE', undefined, 401],
      ['/students', 'POST', {}, 401],
      ['/students', 'GET', undefined, 401],
      [studentPath, 'GET', undefined, 401],
      [studentPath, 'PATCH', {}, 401],
      [studentPath, 'DELETE', undefined, 401],
      [classStudentsPath, 'POST', {}, 401],
      [classStudentsPath, 'GET', undefined, 401],
      [classStudentPath, 'DELETE', undefined, 401],
      [classSchedulesPath, 'POST', {}, 401],
      [classSchedulesPath, 'GET', undefined, 401],
      [classSchedulePath, 'GET', undefined, 401],
      [classSchedulePath, 'PATCH', {}, 401],
      [classSchedulePath, 'DELETE', undefined, 401],
      ['/payments', 'POST', {}, 401],
      ['/payments', 'GET', undefined, 401],
      [paymentPath, 'GET', undefined, 401],
      [paymentPath, 'PATCH', {}, 401],
    ];
    for (const [path, method, body, status] of calls) {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { Origin: env.FRONTEND_ORIGIN, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.status, status, `${method} ${path}`);
      assert.equal(response.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGIN);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      const documentedPath = path === classStudentsPath ? enrollmentsPath
        : path === classStudentPath ? leavePath
          : path === classSchedulesPath ? schedulesPath
            : path === classSchedulePath ? scheduleDetailPath
              : path.startsWith('/classes/') ? '/classes/{id}'
                : path.startsWith('/students/') ? '/students/{id}'
                  : path.startsWith('/payments/') ? '/payments/{id}'
                    : path.endsWith('/approve') ? '/auth/registrations/{id}/approve' : path;
      assert.ok(spec.paths[documentedPath][method.toLowerCase()].responses[String(status)], 'Trạng thái HTTP thực tế phải được mô tả');
      if (path.startsWith('/classes') || path.startsWith('/students') || path.startsWith('/payments') || path.startsWith('/auth/me')) {
        const denied = await response.json();
        assert.deepEqual(Object.keys(denied).sort(), ['message', 'success']);
        assert.ok(denied.success === false && denied.message === 'Thiếu access token', 'API nghiệp vụ phải chặn trước khi truy vấn/ghi DB');
      }
    }
    // Lỗi JSON được parser xử lý trước auth; JWT sai bị chặn trước truy vấn tài khoản.
    for (const [body, authorization, status, message] of [
      ['{"name":}', undefined, 400, 'Body JSON không hợp lệ'],
      ['{"name":"Nguyễn Văn An"}', 'Bearer invalid-access-token', 401, 'Access token không hợp lệ hoặc đã hết hạn'],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          Origin: env.FRONTEND_ORIGIN,
          'Content-Type': 'application/json',
          ...(authorization === undefined ? {} : { Authorization: authorization }),
        },
        body,
      });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGIN);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      assert.deepEqual(await response.json(), { success: false, message });
      assert.ok(profilePatch.responses[String(status)], 'Lỗi HTTP PATCH thực tế phải có trong Swagger');
    }
    const avatarForm = new FormData();
    avatarForm.append('avatar', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'avatar.png');
    const unauthorizedAvatar = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: 'PATCH', headers: { Origin: env.FRONTEND_ORIGIN }, body: avatarForm,
    });
    assert.equal(unauthorizedAvatar.status, 401, 'Multipart upload phải xác thực trước khi đọc file hoặc gọi Cloudinary');
    assert.deepEqual(await unauthorizedAvatar.json(), { success: false, message: 'Thiếu access token' });
    assert.equal(unauthorizedAvatar.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGIN);
    assert.equal(unauthorizedAvatar.headers.get('access-control-allow-credentials'), 'true');
    const defaultAvatar = await get('/api/assets/default-avatar.svg');
    assert.equal(defaultAvatar.status, 200, 'Ảnh mặc định phải tải công khai khi không có Bearer');
    assert.match(defaultAvatar.headers.get('content-type') ?? '', /^image\/svg\+xml\b/i);
    const defaultSvg = await defaultAvatar.text();
    assert.ok(defaultSvg.includes('<svg') && defaultSvg.length > 100);
    for (const path of ['/api/docs/missing-docs-route', '/api/missing-business-route']) {
      const response = await get(path);
      assert.equal(response.status, 404);
      const missing = await response.json();
      assert.deepEqual(Object.keys(missing).sort(), ['message', 'success']);
      assert.ok(missing.success === false && missing.message === 'Không tìm thấy API', 'Route lạ phải giữ JSON 404 hiện có');
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
});
