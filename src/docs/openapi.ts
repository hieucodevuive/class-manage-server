import { authPaths, authSchemas } from './auth.openapi';
import { classPaths, classSchemas } from './class.openapi';
import { enrollmentPaths, enrollmentSchemas } from './enrollment.openapi';
import { paymentPaths, paymentSchemas } from './payment.openapi';
import { schedulePaths, scheduleSchemas } from './schedule.openapi';
import { studentPaths, studentSchemas } from './student.openapi';

function errorResponse(description: string, message: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
        example: { success: false, message },
      },
    },
  };
}

export const openapiDocument = {
  openapi: '3.0.4',
  info: {
    title: 'Class Management API',
    version: '1.0.0',
    description: [
      'Tài liệu toàn bộ 29 API hiện có: 7 API Authentication/duyệt tài khoản, 5 API CRUD Class, 5 API CRUD Student, 3 API Enrollment, 5 API ClassSchedule và 4 API Payment.',
      'Giáo viên đăng ký → PENDING → ADMIN duyệt → ACTIVE → đăng nhập.',
      'Login trả data.accessToken và đặt refreshToken trong cookie HttpOnly.',
      'Dùng Authorize với access token để gọi /auth/me, các API ADMIN, Class, Student, Enrollment, ClassSchedule và Payment. Nhập token, không thêm tiền tố Bearer.',
      'Refresh/logout dùng cookie trình duyệt đã nhận; không gửi refresh token trong JSON body.',
      'ADMIN có quyền duyệt tài khoản; dữ liệu nghiệp vụ vẫn thuộc riêng từng giáo viên.',
    ].join('\n\n'),
  },
  servers: [{ url: '/api', description: 'Backend đang phục vụ trang tài liệu này' }],
  tags: [
    { name: 'Auth', description: 'Đăng ký, đăng nhập và phiên đăng nhập' },
    { name: 'AuthAdmin', description: 'ADMIN ACTIVE xem và duyệt giáo viên chờ kích hoạt' },
    { name: 'Classes', description: 'CRUD lớp thuộc tài khoản đang đăng nhập; TEACHER/ADMIN ACTIVE' },
    { name: 'Students', description: 'CRUD hồ sơ học sinh thuộc tài khoản đang đăng nhập; TEACHER/ADMIN ACTIVE' },
    { name: 'Enrollments', description: 'Ghi danh, danh sách và nghỉ lớp; Class/Student cùng chủ sở hữu, giữ lịch sử' },
    { name: 'ClassSchedules', description: 'CRUD lịch học theo tuần; quyền sở hữu qua lớp, giờ HH:mm:ss' },
    { name: 'Payments', description: 'Tạo, xem và cập nhật học phí theo tháng; Decimal, snapshot và giữ lịch sử' },
  ],
  // Áp dụng security ở từng operation: register/login/logout là public.
  security: [],
  paths: { ...authPaths, ...classPaths, ...studentPaths, ...enrollmentPaths, ...schedulePaths, ...paymentPaths },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token từ data.accessToken của login/refresh; hạn 15 phút. Tài khoản phải ACTIVE.',
      },
      refreshCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
        description: 'Cookie HttpOnly do login/refresh đặt; Path=/api/auth, SameSite=Lax, Secure trong production, hạn 7 ngày. Swagger UI dùng cookie trình duyệt, không nhập Cookie thủ công.',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['success', 'message'],
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', enum: [false] },
          message: { type: 'string' },
        },
      },
      ...authSchemas,
      ...classSchemas,
      ...studentSchemas,
      ...enrollmentSchemas,
      ...scheduleSchemas,
      ...paymentSchemas,
    },
    responses: {
      JsonParseError: errorResponse('Body JSON sai cú pháp.', 'Body JSON không hợp lệ'),
      PayloadTooLarge: errorResponse('Body JSON vượt giới hạn parser hiện có (100 KiB).', 'Body JSON vượt quá giới hạn cho phép'),
      UnsupportedBody: errorResponse('Charset hoặc Content-Encoding không được parser hỗ trợ.', 'Charset hoặc encoding của body không được hỗ trợ'),
      ServerError: errorResponse('Lỗi máy chủ.', 'Lỗi máy chủ'),
    },
  },
};
