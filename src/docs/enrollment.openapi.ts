const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorExample = (message: string) => ({ value: { success: false, message } });

function errorResponse(description: string, examples: Record<string, ReturnType<typeof errorExample>>) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef('ApiError'),
        examples,
      },
    },
  };
}

const parserResponses = {
  '400': { $ref: '#/components/responses/JsonParseError' },
  '413': { $ref: '#/components/responses/PayloadTooLarge' },
  '415': { $ref: '#/components/responses/UnsupportedBody' },
  '500': { $ref: '#/components/responses/ServerError' },
};

const unauthorized = errorResponse('Thiếu/sai/hết hạn access token hoặc tài khoản không còn tồn tại.', {
  missingToken: errorExample('Thiếu access token'),
  invalidToken: errorExample('Access token không hợp lệ hoặc đã hết hạn'),
  missingAccount: errorExample('Tài khoản không còn tồn tại'),
  unauthenticated: errorExample('Chưa xác thực'),
});

const forbidden = errorResponse('Tài khoản chưa ACTIVE.', {
  pending: errorExample('Tài khoản đang chờ duyệt'),
});

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const studentIdExample = '11111111-1111-4111-8111-111111111111';
const enrollmentIdExample = '22222222-2222-4222-8222-222222222222';

const classIdParameter = {
  name: 'classId',
  in: 'path',
  required: true,
  description: [
    'Class ID là Int tự tăng, không phải UUID.',
    'Route kiểm chuỗi chữ số bằng ^[0-9]+$, chuyển Number rồi kiểm số nguyên dương từ 1 đến 2147483647.',
    'Số 0 ở đầu được chấp nhận: 00042 được hiểu là 42; không dùng dấu, số thập phân hoặc ký pháp mũ.',
  ].join(' '),
  schema: { type: 'integer', format: 'int32', minimum: 1, maximum: 2147483647 },
  example: 42,
};

const studentIdParameter = {
  name: 'studentId',
  in: 'path',
  required: true,
  description: 'UUID Student dạng nhóm hex 8-4-4-4-12, chấp nhận hoa/thường. Validator không ràng buộc version/variant; UUID nil cũng qua validation. Đây là ID Student, không phải ID Enrollment.',
  schema: { type: 'string', format: 'uuid', pattern: uuidPattern },
  example: studentIdExample,
};

const enrollmentFields = {
  id: { type: 'string', format: 'uuid', pattern: uuidPattern, readOnly: true, description: 'ID Enrollment (bản ghi ClassStudent), do Prisma tạo.', example: enrollmentIdExample },
  classId: { type: 'integer', format: 'int32', minimum: 1, maximum: 2147483647, example: 42 },
  studentId: { type: 'string', format: 'uuid', pattern: uuidPattern, example: studentIdExample },
  joinedAt: { type: 'string', format: 'date', description: 'Ngày vào lớp YYYY-MM-DD, không kèm giờ.', example: '2026-09-01' },
  leftAt: { type: 'string', format: 'date', nullable: true, description: 'Ngày nghỉ YYYY-MM-DD hoặc null khi đang học.', example: null },
  status: { type: 'string', enum: ['ACTIVE', 'LEFT'], example: 'ACTIVE' },
  createdAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
  updatedAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC; khi đã LEFT, gọi DELETE lại giữ thời điểm này.', example: '2026-10-10T00:00:00.000Z' },
};

const enrollmentExample = {
  id: enrollmentIdExample,
  classId: 42,
  studentId: studentIdExample,
  joinedAt: '2026-09-01',
  leftAt: null,
  status: 'ACTIVE',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const leftEnrollmentExample = {
  ...enrollmentExample,
  leftAt: '2026-10-10',
  status: 'LEFT',
  updatedAt: '2026-10-10T00:05:00.000Z',
};

const nestedStudentExample = {
  id: studentIdExample,
  fullName: 'Nguyễn Văn An',
  phone: null,
  parentName: null,
  parentPhone: null,
  school: null,
  grade: null,
  dateOfBirth: null,
  address: null,
  status: 'ACTIVE',
  note: null,
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const enrollmentData = {
  type: 'object',
  additionalProperties: false,
  required: ['enrollment'],
  properties: { enrollment: schemaRef('EnrollmentRecord') },
};

export const enrollmentSchemas = {
  EnrollmentRecord: {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(enrollmentFields),
    description: 'DTO Enrollment có đúng 8 trường; không trả teacherId/teacher_id, Payment hoặc Class/Student lồng nhau. POST và DELETE dùng DTO này.',
    properties: enrollmentFields,
    example: enrollmentExample,
  },
  EnrollmentWithStudent: {
    type: 'object',
    additionalProperties: false,
    required: [...Object.keys(enrollmentFields), 'student'],
    description: 'DTO của GET: toàn bộ 8 trường Enrollment và student theo serializeStudent (13 trường), được giới hạn cùng chủ sở hữu.',
    properties: {
      ...enrollmentFields,
      student: schemaRef('StudentRecord'),
    },
    example: { ...enrollmentExample, student: nestedStudentExample },
  },
  EnrollmentCreateRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['studentId', 'joinedAt'],
    description: 'Strict: chỉ nhận studentId và joinedAt, cả hai bắt buộc và không nhận null. Field lạ, kể cả teacherId/teacher_id, classId, status, leftAt, id hoặc timestamps, trả 400; không có mặc định joinedAt.',
    properties: {
      studentId: {
        type: 'string',
        format: 'uuid',
        pattern: uuidPattern,
        description: 'UUID của Student đã có, dạng hex 8-4-4-4-12, nhận chữ hoa/thường, không ràng version/variant. UUID nil qua validation; Student phải tồn tại và thuộc tài khoản đang gọi.',
        example: studentIdExample,
      },
      joinedAt: {
        type: 'string',
        format: 'date',
        pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$',
        description: 'Ngày lịch thực sự tồn tại đúng YYYY-MM-DD, năm 0001–9999; không trim, không nhận giờ/timezone. Bắt buộc, không tự dùng ngày hiện tại. POST cho phép ngày trong tương lai và không giới hạn theo ngày bắt đầu/kết thúc Class.',
        example: '2026-09-01',
      },
    },
  },
  EnrollmentValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: { type: 'string', description: 'Đường dẫn field; lỗi toàn object hoặc field không được nhận có field body.', example: 'joinedAt' },
      message: { type: 'string', description: 'Thông báo validation của Zod.', example: 'Ngày không hợp lệ' },
    },
  },
  EnrollmentValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin ghi danh không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('EnrollmentValidationIssue') },
    },
  },
  EnrollmentCreateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Ghi danh học sinh thành công'] },
      data: enrollmentData,
    },
  },
  EnrollmentListResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['enrollments'],
        properties: { enrollments: { type: 'array', items: schemaRef('EnrollmentWithStudent') } },
      },
    },
  },
  EnrollmentLeaveResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Học sinh đã rời lớp'] },
      data: enrollmentData,
    },
  },
};

export const enrollmentPaths = {
  '/classes/{classId}/students': {
    post: {
      tags: ['Enrollments'],
      operationId: 'enrollmentsCreate',
      summary: 'Ghi danh Student đã có vào Class',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN.',
        'Cả Class và Student phải thuộc tài khoản đang gọi, kể cả ADMIN; kiểm ownership trước và trong connect khi ghi.',
        'Body strict chỉ nhận studentId/joinedAt, không tự dùng ngày hiện tại.',
        'Tạo Enrollment ACTIVE, leftAt = null; cho phép các trạng thái Class/Student đã có và ngày vào lớp trong tương lai.',
        'Mỗi cặp Class–Student chỉ có một Enrollment. Cặp đã tồn tại, kể cả LEFT, trả 409; không tạo lại hoặc ghi đè lịch sử.',
        'Unique/FK bảo vệ cả khi request đồng thời. Query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('EnrollmentCreateRequest'),
            example: { studentId: studentIdExample, joinedAt: '2026-09-01' },
          },
        },
      },
      responses: {
        ...parserResponses,
        '201': {
          description: 'Đã ghi danh; data.enrollment có 8 trường, status ACTIVE và leftAt null.',
          content: {
            'application/json': {
              schema: schemaRef('EnrollmentCreateResponse'),
              example: { success: true, message: 'Ghi danh học sinh thành công', data: { enrollment: enrollmentExample } },
            },
          },
        },
        '400': {
          description: 'ID lớp/JSON sai (không có errors), hoặc body/field/ngày không hợp lệ hay field lạ (có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('EnrollmentValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
                invalidDate: {
                  value: { success: false, message: 'Thông tin ghi danh không hợp lệ', errors: [{ field: 'joinedAt', message: 'Ngày không hợp lệ' }] },
                },
                unknownField: {
                  value: { success: false, message: 'Thông tin ghi danh không hợp lệ', errors: [{ field: 'body', message: 'Unrecognized key: "status"' }] },
                },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
        '404': errorResponse('Class/Student không tồn tại hoặc ngoài ownership; hoặc parent không còn hợp lệ khi ghi.', {
          missingClass: errorExample('Không tìm thấy lớp'),
          missingStudent: errorExample('Không tìm thấy học sinh'),
          parentChanged: errorExample('Không tìm thấy lớp hoặc học sinh'),
        }),
        '409': errorResponse('Cặp Class–Student đã tồn tại, gồm ACTIVE/LEFT và ghi danh trùng đồng thời.', {
          alreadyEnrolled: errorExample('Học sinh đã từng được ghi danh vào lớp này'),
        }),
      },
    },
    get: {
      tags: ['Enrollments'],
      operationId: 'enrollmentsListForClass',
      summary: 'Danh sách ghi danh của Class kèm Student',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; Class phải thuộc tài khoản đang gọi, kể cả ADMIN.',
        'Gồm Enrollment ACTIVE và LEFT; sắp xếp createdAt DESC rồi id DESC.',
        'Mỗi item gồm 8 trường Enrollment và student theo serializeStudent (13 trường).',
        'Truy vấn còn lọc Student cùng teacherId; quan hệ sai ownership trong DB không được trả ra.',
        'Class hợp lệ chưa có ghi danh trong phạm vi trả 200 với data.enrollments = [].',
        'Chưa có tìm kiếm/bộ lọc/phân trang hoặc total/count; body/query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Danh sách Enrollment và Student cùng ownership; JSON không có message.',
          content: {
            'application/json': {
              schema: schemaRef('EnrollmentListResponse'),
              examples: {
                active: { value: { success: true, data: { enrollments: [{ ...enrollmentExample, student: nestedStudentExample }] } } },
                left: { value: { success: true, data: { enrollments: [{ ...leftEnrollmentExample, student: nestedStudentExample }] } } },
                empty: { value: { success: true, data: { enrollments: [] } } },
              },
            },
          },
        },
        '400': errorResponse('ID lớp không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': errorResponse('Class không tồn tại hoặc ngoài ownership, kể cả ADMIN.', {
          classNotFound: errorExample('Không tìm thấy lớp'),
        }),
      },
    },
  },
  '/classes/{classId}/students/{studentId}': {
    delete: {
      tags: ['Enrollments'],
      operationId: 'enrollmentsLeaveClass',
      summary: 'Cho Student rời Class và giữ lịch sử ghi danh',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; cập nhật kiểm cả Class và Student thuộc tài khoản đang gọi.',
        'Không cần body; body/query không được dùng, client không được chọn leftAt/status.',
        'Enrollment ACTIVE có joinedAt không sau hôm nay được chuyển LEFT; leftAt là ngày hiện tại UTC của server.',
        'Giữ Enrollment/Payment, joinedAt, Class/Student và ghi danh ở lớp khác; không xóa hẳn bản ghi.',
        'Gọi lại khi LEFT trả 200 với bản ghi cũ, giữ nguyên leftAt/updatedAt; các request rời lớp đồng thời không ghi đè ngày nghỉ.',
        'Chỉ Enrollment ACTIVE có joinedAt ở tương lai mới bị từ chối 400.',
        'Enrollment LEFT vẫn có trong GET; POST lại cùng cặp tiếp tục 409.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter, studentIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đã rời lớp hoặc đã LEFT trước đó. Response gồm data.enrollment có 8 trường; ví dụ ngày server UTC là 2026-10-10.',
          content: {
            'application/json': {
              schema: schemaRef('EnrollmentLeaveResponse'),
              example: { success: true, message: 'Học sinh đã rời lớp', data: { enrollment: leftEnrollmentExample } },
            },
          },
        },
        '400': errorResponse('ID Class/Student sai, ACTIVE joinedAt ở tương lai, hoặc body JSON sai cú pháp.', {
          invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
          invalidStudentId: errorExample('ID học sinh phải là UUID hợp lệ'),
          futureJoinedAt: errorExample('Ngày nghỉ không được trước ngày vào lớp'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': errorResponse('Không tìm thấy Enrollment hoặc không sở hữu cả Class/Student, kể cả ADMIN. Ghi danh được tạo đồng thời sau truy vấn cập nhật cũng có thể trả 404.', {
          enrollmentNotFound: errorExample('Không tìm thấy ghi danh'),
        }),
      },
    },
  },
};
