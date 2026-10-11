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

const notFound = errorResponse('Học sinh không tồn tại hoặc thuộc tài khoản khác, kể cả người gọi là ADMIN.', {
  notFound: errorExample('Không tìm thấy học sinh'),
});

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const studentIdExample = '11111111-1111-4111-8111-111111111111';

const studentIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: [
    'Student ID là UUID dạng nhóm hex 8-4-4-4-12, chấp nhận chữ hoa hoặc chữ thường.',
    'Validator hiện chỉ kiểm mẫu hex, không ràng buộc version/variant UUID;',
    'UUID nil 00000000-0000-0000-0000-000000000000 cũng qua validation, nhưng không có bản ghi vẫn trả 404.',
  ].join(' '),
  schema: { type: 'string', format: 'uuid', pattern: uuidPattern },
  example: studentIdExample,
};

const phoneInput = {
  type: 'string',
  nullable: true,
  pattern: '^\\s*\\+?[0-9][0-9 .()-]*\\s*$',
  description: [
    'Tùy chọn hoặc null. Trim hai đầu; sau trim dài 7–20 đơn vị UTF-16 và có ít nhất 7 chữ số ASCII.',
    'Cho phép dấu + ở đầu, tiếp theo phải là một chữ số; phần sau chỉ gồm chữ số, khoảng trắng ASCII, dấu chấm, ngoặc và gạch ngang.',
    'Không nhận chuỗi rỗng. Gửi null để xóa; không yêu cầu unique hoặc một định dạng quốc gia riêng.',
  ].join(' '),
  'x-minTrimmedUtf16Length': 7,
  'x-maxTrimmedUtf16Length': 20,
  'x-minDigits': 7,
  example: '+84 900 000 000',
};

const inputFields = {
  fullName: {
    type: 'string',
    minLength: 1,
    pattern: '\\S',
    description: 'Trim hai đầu; sau trim không rỗng và tối đa 150 đơn vị UTF-16 theo độ dài chuỗi JavaScript (Zod hiện tại). Không nhận null.',
    'x-maxTrimmedUtf16Length': 150,
    example: 'Nguyễn Văn An',
  },
  phone: phoneInput,
  parentName: {
    type: 'string',
    nullable: true,
    minLength: 1,
    pattern: '\\S',
    description: 'Tùy chọn hoặc null. Trim hai đầu; sau trim không rỗng và tối đa 150 đơn vị UTF-16. Chuỗi rỗng/chỉ có khoảng trắng bị từ chối; gửi null để xóa.',
    'x-maxTrimmedUtf16Length': 150,
    example: 'Nguyễn Văn Bình',
  },
  parentPhone: phoneInput,
  school: {
    type: 'string',
    nullable: true,
    minLength: 1,
    pattern: '\\S',
    description: 'Tùy chọn hoặc null. Trim hai đầu; sau trim không rỗng và tối đa 200 đơn vị UTF-16. Chuỗi rỗng/chỉ có khoảng trắng bị từ chối; gửi null để xóa.',
    'x-maxTrimmedUtf16Length': 200,
    example: 'THPT Chu Văn An',
  },
  grade: {
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 12,
    description: 'JSON number nguyên từ 1 đến 12 hoặc null; không nhận chuỗi số.',
    example: 12,
  },
  dateOfBirth: {
    type: 'string',
    format: 'date',
    nullable: true,
    pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$',
    description: 'Ngày lịch tồn tại đúng YYYY-MM-DD, năm 0001–9999, hoặc null. Không nhận khoảng trắng, giờ/timezone hoặc ngày không tồn tại. Hiện không chặn ngày sinh trong tương lai. Gửi null để xóa.',
    example: '2010-05-15',
  },
  address: {
    type: 'string',
    nullable: true,
    description: 'Tùy chọn hoặc null; chuỗi được trim, có thể rỗng, không có giới hạn độ dài riêng trong schema. Chuỗi chỉ có khoảng trắng thành chuỗi rỗng, không tự đổi thành null.',
    example: 'Hà Nội',
  },
  status: {
    type: 'string',
    enum: ['ACTIVE', 'INACTIVE'],
    description: 'Không nhận null. POST bỏ qua thì mặc định ACTIVE tại API; PATCH bỏ qua giữ trạng thái hiện tại.',
    example: 'ACTIVE',
  },
  note: {
    type: 'string',
    nullable: true,
    description: 'Tùy chọn hoặc null; chuỗi được trim, có thể rỗng, không có giới hạn độ dài riêng trong schema. Chuỗi chỉ có khoảng trắng thành chuỗi rỗng, không tự đổi thành null.',
    example: 'Cần ôn tập thêm phần nghị luận',
  },
};

const studentExample = {
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
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const studentData = {
  type: 'object',
  additionalProperties: false,
  required: ['student'],
  properties: { student: schemaRef('StudentRecord') },
};

export const studentSchemas = {
  StudentRecord: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'fullName', 'phone', 'parentName', 'parentPhone', 'school', 'grade', 'dateOfBirth', 'address', 'status', 'note', 'createdAt', 'updatedAt'],
    description: 'Student đã serialize: đúng 13 trường. Không trả teacherId/teacher_id, classId, tuổi hoặc quan hệ lớp lồng nhau. Các field nullable vẫn có trong response.',
    properties: {
      id: { type: 'string', format: 'uuid', pattern: uuidPattern, readOnly: true, example: studentIdExample },
      fullName: { type: 'string', description: 'Tên học sinh đã trim.', example: 'Nguyễn Văn An' },
      phone: { type: 'string', nullable: true, description: 'Số điện thoại đã trim hoặc null.', example: null },
      parentName: { type: 'string', nullable: true, description: 'Tên phụ huynh đã trim hoặc null.', example: null },
      parentPhone: { type: 'string', nullable: true, description: 'Số điện thoại phụ huynh đã trim hoặc null.', example: null },
      school: { type: 'string', nullable: true, description: 'Tên trường đã trim hoặc null.', example: null },
      grade: { type: 'integer', nullable: true, minimum: 1, maximum: 12, example: null },
      dateOfBirth: { type: 'string', format: 'date', nullable: true, description: 'Ngày YYYY-MM-DD hoặc null, không kèm giờ.', example: null },
      address: { type: 'string', nullable: true, description: 'Địa chỉ đã trim, chuỗi rỗng hoặc null.', example: null },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' },
      note: { type: 'string', nullable: true, description: 'Ghi chú đã trim, chuỗi rỗng hoặc null.', example: null },
      createdAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
    },
    example: studentExample,
  },
  StudentCreateRequest: {
    type: 'object',
    additionalProperties: true,
    required: ['fullName'],
    description: [
      'Chỉ fullName bắt buộc. Field lạ bị loại bỏ, kể cả id, teacherId/teacher_id, classId và timestamps.',
      'Tám field nullable bỏ qua thì được lưu null; status bỏ qua thì ACTIVE.',
      'FullName/status không nhận null. ID UUID và ownership do backend tạo/gán.',
    ].join(' '),
    properties: {
      ...inputFields,
      status: { ...inputFields.status, default: 'ACTIVE' },
    },
  },
  StudentUpdateRequest: {
    type: 'object',
    additionalProperties: true,
    minProperties: 1,
    anyOf: Object.keys(inputFields).map(field => ({ required: [field] })),
    description: [
      'Partial: phải còn ít nhất một trong 10 field thuộc properties sau khi loại field lạ.',
      'Body rỗng hoặc chỉ gửi id/teacherId/teacher_id/classId/timestamps/field lạ trả 400.',
      'Field không gửi giữ nguyên, không mặc định lại status.',
      'Tám field nullable nhận null để xóa; fullName/status không nhận null.',
    ].join(' '),
    properties: inputFields,
  },
  StudentValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: { type: 'string', description: 'Đường dẫn field; lỗi toàn object có field body.', example: 'phone' },
      message: { type: 'string', description: 'Thông báo validation của Zod.', example: 'Số điện thoại không hợp lệ' },
    },
  },
  StudentValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin học sinh không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('StudentValidationIssue') },
    },
  },
  StudentCreateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Tạo học sinh thành công'] },
      data: studentData,
    },
  },
  StudentListResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['students'],
        properties: { students: { type: 'array', items: schemaRef('StudentRecord') } },
      },
    },
  },
  StudentDetailResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', enum: [true] }, data: studentData },
  },
  StudentUpdateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Cập nhật học sinh thành công'] },
      data: studentData,
    },
  },
  StudentDeleteResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Xóa học sinh thành công'] },
    },
  },
};

export const studentPaths = {
  '/students': {
    post: {
      tags: ['Students'],
      operationId: 'studentsCreate',
      summary: 'Tạo hồ sơ học sinh thuộc tài khoản đang đăng nhập',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN.',
        'Backend gán teacher_id từ userId đã xác thực; payload teacherId/teacher_id bị loại bỏ.',
        'Chỉ fullName bắt buộc; status mặc định ACTIVE tại API, tám field nullable bỏ qua thì null.',
        'ID UUID do Prisma tạo. Field lạ, kể cả classId, id và timestamps, bị loại bỏ.',
        'Response không trả ownership hoặc quan hệ lớp.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('StudentCreateRequest'),
            examples: {
              minimal: { value: { fullName: 'Nguyễn Văn An' } },
              full: {
                value: {
                  fullName: 'Nguyễn Văn An', phone: '+84 900 000 000', parentName: 'Nguyễn Văn Bình', parentPhone: '0900000000',
                  school: 'THPT Chu Văn An', grade: 12, dateOfBirth: '2010-05-15', address: 'Hà Nội', status: 'ACTIVE', note: 'Cần ôn tập thêm phần nghị luận',
                },
              },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '201': {
          description: 'Đã tạo học sinh; data.student dùng cùng serializer với GET/PATCH.',
          content: {
            'application/json': {
              schema: schemaRef('StudentCreateResponse'),
              example: { success: true, message: 'Tạo học sinh thành công', data: { student: studentExample } },
            },
          },
        },
        '400': {
          description: 'Body/field không hợp lệ (có errors), hoặc JSON sai cú pháp (không có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('StudentValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidPhone: {
                  value: { success: false, message: 'Thông tin học sinh không hợp lệ', errors: [{ field: 'phone', message: 'Số điện thoại không hợp lệ' }] },
                },
                invalidDate: {
                  value: { success: false, message: 'Thông tin học sinh không hợp lệ', errors: [{ field: 'dateOfBirth', message: 'Ngày không hợp lệ' }] },
                },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
      },
    },
    get: {
      tags: ['Students'],
      operationId: 'studentsList',
      summary: 'Danh sách học sinh của tài khoản đang đăng nhập',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; ADMIN cũng chỉ đọc hồ sơ của chính mình.',
        'Gồm ACTIVE/INACTIVE, sắp xếp createdAt DESC rồi id DESC.',
        'Chưa có tìm kiếm/bộ lọc/phân trang; query không được dùng.',
        'Danh sách rỗng vẫn trả 200 với data.students = []; không có total/count hoặc quan hệ lớp lồng nhau.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Danh sách Student trong phạm vi ownership; JSON không có message.',
          content: {
            'application/json': {
              schema: schemaRef('StudentListResponse'),
              examples: {
                students: { value: { success: true, data: { students: [studentExample] } } },
                empty: { value: { success: true, data: { students: [] } } },
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
      },
    },
  },
  '/students/{id}': {
    get: {
      tags: ['Students'],
      operationId: 'studentsGetById',
      summary: 'Chi tiết hồ sơ học sinh thuộc tài khoản đang đăng nhập',
      description: 'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN. Tìm theo UUID và userId đã xác thực; ngoài ownership trả cùng 404 như không tồn tại, kể cả ADMIN. Query không được dùng.',
      security: [{ bearerAuth: [] }],
      parameters: [studentIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Chi tiết học sinh, đúng 13 trường serialize; không có message.',
          content: {
            'application/json': {
              schema: schemaRef('StudentDetailResponse'),
              example: { success: true, data: { student: studentExample } },
            },
          },
        },
        '400': errorResponse('UUID không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidId: errorExample('ID học sinh phải là UUID hợp lệ'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': notFound,
      },
    },
    patch: {
      tags: ['Students'],
      operationId: 'studentsUpdate',
      summary: 'Cập nhật một phần hồ sơ học sinh',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; truy vấn sửa kiểm cả UUID và ownership.',
        'Phải gửi ít nhất một field được sửa; field lạ bị loại bỏ, không đổi id/teacherId/teacher_id/classId hoặc timestamps.',
        'Field không gửi giữ nguyên, kể cả status; tám field nullable nhận null để xóa.',
        'ParentName/school không nhận chuỗi rỗng; address/note nhận chuỗi rỗng và không đổi thành null.',
        'Query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [studentIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('StudentUpdateRequest'),
            examples: {
              contactAndStatus: { value: { phone: '+84 900 000 000', grade: 12, status: 'INACTIVE' } },
              clearOptional: { value: { phone: null, school: null, dateOfBirth: null, address: '', note: null } },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Học sinh sau cập nhật; field không gửi được giữ nguyên.',
          content: {
            'application/json': {
              schema: schemaRef('StudentUpdateResponse'),
              example: {
                success: true,
                message: 'Cập nhật học sinh thành công',
                data: { student: { ...studentExample, phone: '+84 900 000 000', grade: 12, status: 'INACTIVE', updatedAt: '2026-10-10T00:05:00.000Z' } },
              },
            },
          },
        },
        '400': {
          description: 'UUID/JSON sai (không có errors), hoặc body/field không hợp lệ (có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('StudentValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidId: errorExample('ID học sinh phải là UUID hợp lệ'),
                emptyOrUnknownOnly: {
                  value: {
                    success: false,
                    message: 'Thông tin học sinh không hợp lệ',
                    errors: [{ field: 'body', message: 'Cần gửi ít nhất một trường để cập nhật' }],
                  },
                },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
        '404': notFound,
      },
    },
    delete: {
      tags: ['Students'],
      operationId: 'studentsDelete',
      summary: 'Xóa hẳn học sinh chưa có lịch sử ghi danh',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; truy vấn xóa kiểm UUID và ownership.',
        'Không cần body; body/query không được dùng.',
        'Học sinh đã có bất kỳ Enrollment nào, kể cả LEFT, trả 409 và giữ nguyên hồ sơ cùng lịch sử Enrollment/Payment.',
        'Học sinh chưa có Enrollment được xóa hẳn; không tự chuyển status.',
        'Khóa ngoại RESTRICT bảo vệ lịch sử cả khi có request ghi danh đồng thời.',
        'Không tồn tại/ngoài ownership/xóa lặp trả 404.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [studentIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đã xóa học sinh; JSON chỉ có success/message, không có data.',
          content: {
            'application/json': {
              schema: schemaRef('StudentDeleteResponse'),
              example: { success: true, message: 'Xóa học sinh thành công' },
            },
          },
        },
        '400': errorResponse('UUID không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidId: errorExample('ID học sinh phải là UUID hợp lệ'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': notFound,
        '409': errorResponse('Đã có Enrollment ACTIVE hoặc LEFT; học sinh và lịch sử được giữ nguyên.', {
          hasEnrollments: errorExample('Không thể xóa học sinh đã có lịch sử ghi danh'),
        }),
      },
    },
  },
};
