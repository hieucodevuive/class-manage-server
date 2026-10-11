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

const notFound = errorResponse('Lớp không tồn tại hoặc thuộc tài khoản khác, kể cả người gọi là ADMIN.', {
  notFound: errorExample('Không tìm thấy lớp'),
});

const classIdParameter = {
  name: 'id',
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

const dateInput = {
  type: 'string',
  format: 'date',
  pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  description: 'Ngày lịch thực sự tồn tại, đúng YYYY-MM-DD, năm 0001–9999. Không nhận khoảng trắng, giờ, timezone hoặc ngày không tồn tại.',
  example: '2026-09-01',
};

const inputFields = {
  name: {
    type: 'string',
    minLength: 1,
    pattern: '\\S',
    description: 'Trim hai đầu; sau trim phải không rỗng và tối đa 100 đơn vị UTF-16 theo độ dài chuỗi JavaScript (Zod hiện tại).',
    'x-maxTrimmedUtf16Length': 100,
    example: 'Văn 12A1',
  },
  grade: { type: 'integer', minimum: 1, maximum: 12, description: 'JSON number nguyên từ 1 đến 12, không nhận chuỗi số.', example: 12 },
  schoolYear: {
    type: 'string',
    pattern: '^\\s*[0-9]{4}-[0-9]{4}\\s*$',
    description: 'Trim hai đầu; hai năm 4 chữ số liên tiếp YYYY-YYYY. Năm bắt đầu từ 0001 đến 9998, năm kết thúc bằng năm bắt đầu cộng 1.',
    example: '2026-2027',
  },
  subject: {
    type: 'string',
    minLength: 1,
    pattern: '\\S',
    description: 'Trim hai đầu; sau trim phải không rỗng và tối đa 100 đơn vị UTF-16 theo độ dài chuỗi JavaScript (Zod hiện tại).',
    'x-maxTrimmedUtf16Length': 100,
    example: 'Ngữ Văn',
  },
  tuitionFee: {
    description: [
      'Số hoặc chuỗi thập phân từ 0 đến 9999999999.99, tối đa 2 chữ số phần lẻ.',
      'Chuỗi được trim; không nhận dấu cộng/trừ, số 0 ở đầu (trừ 0), ký pháp mũ hoặc dấu phẩy.',
      'JSON number được chuyển bằng String(value) rồi kiểm cùng mẫu thập phân; không tự làm tròn.',
      'Ưu tiên gửi chuỗi để giữ chính xác tiền. Response luôn là chuỗi Decimal hai chữ số phần lẻ.',
    ].join(' '),
    oneOf: [
      {
        type: 'string',
        pattern: '^\\s*(0|[1-9][0-9]{0,9})(\\.[0-9]{1,2})?\\s*$',
        example: '600000.00',
      },
      {
        type: 'number',
        minimum: 0,
        maximum: 9999999999.99,
        description: 'String(value) phải có tối đa 2 chữ số thập phân và khớp mẫu tiền; số âm/không hữu hạn bị từ chối.',
        'x-maxDecimalPlaces': 2,
        example: 600000,
      },
    ],
  },
  startDate: dateInput,
  endDate: {
    ...dateInput,
    nullable: true,
    description: 'Ngày YYYY-MM-DD hợp lệ từ năm 0001–9999 hoặc null; khi có giá trị phải không trước startDate. POST bỏ qua thì lưu null; PATCH bỏ qua thì giữ nguyên, gửi null để xóa ngày kết thúc.',
    example: '2027-05-31',
  },
  status: {
    type: 'string',
    enum: ['ACTIVE', 'INACTIVE', 'COMPLETED'],
    description: 'Không nhận null. POST bỏ qua thì ACTIVE; PATCH bỏ qua giữ trạng thái hiện tại.',
    example: 'ACTIVE',
  },
  note: {
    type: 'string',
    nullable: true,
    description: 'Chuỗi được trim, có thể rỗng hoặc null; không có giới hạn độ dài riêng trong schema. POST bỏ qua thì null; PATCH bỏ qua giữ nguyên, gửi null để xóa ghi chú. Chuỗi chỉ có khoảng trắng trở thành chuỗi rỗng, không tự đổi thành null.',
    example: 'Lớp ôn thi tốt nghiệp',
  },
};

const classExample = {
  id: 42,
  name: 'Văn 12A1',
  grade: 12,
  schoolYear: '2026-2027',
  subject: 'Ngữ Văn',
  tuitionFee: '600000.00',
  startDate: '2026-09-01',
  endDate: null,
  status: 'ACTIVE',
  note: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const invalidDatesExample = {
  value: {
    success: false,
    message: 'Thông tin lớp không hợp lệ',
    errors: [{ field: 'endDate', message: 'Ngày kết thúc không được trước ngày bắt đầu' }],
  },
};

const classData = {
  type: 'object',
  additionalProperties: false,
  required: ['class'],
  properties: { class: schemaRef('ClassRecord') },
};

export const classSchemas = {
  ClassRecord: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'grade', 'schoolYear', 'subject', 'tuitionFee', 'startDate', 'endDate', 'status', 'note', 'createdAt', 'updatedAt'],
    description: 'Class đã serialize: đúng 12 trường, không trả teacherId/teacher_id, studentCount hoặc quan hệ lồng nhau.',
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, maximum: 2147483647, readOnly: true, example: 42 },
      name: { type: 'string', description: 'Tên đã trim.', example: 'Văn 12A1' },
      grade: { type: 'integer', minimum: 1, maximum: 12, example: 12 },
      schoolYear: { type: 'string', pattern: '^[0-9]{4}-[0-9]{4}$', example: '2026-2027' },
      subject: { type: 'string', description: 'Môn học đã trim.', example: 'Ngữ Văn' },
      tuitionFee: {
        type: 'string',
        pattern: '^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$',
        description: 'Decimal serialize bằng toFixed(2); luôn là chuỗi, không phải JSON number.',
        example: '600000.00',
      },
      startDate: { type: 'string', format: 'date', description: 'Ngày YYYY-MM-DD, không kèm giờ.', example: '2026-09-01' },
      endDate: { type: 'string', format: 'date', nullable: true, description: 'Ngày YYYY-MM-DD hoặc null.', example: null },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'COMPLETED'], example: 'ACTIVE' },
      note: { type: 'string', nullable: true, description: 'Ghi chú đã trim, chuỗi rỗng hoặc null.', example: null },
      createdAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
    },
    example: classExample,
  },
  ClassCreateRequest: {
    type: 'object',
    additionalProperties: true,
    required: ['name', 'grade', 'schoolYear', 'subject', 'tuitionFee', 'startDate'],
    description: 'Sáu trường bắt buộc. Field lạ bị loại bỏ, kể cả id, teacherId/teacher_id, timestamps và studentCount. Chỉ endDate/note nhận null; endDate nếu có phải không trước startDate.',
    properties: {
      ...inputFields,
      status: { ...inputFields.status, default: 'ACTIVE' },
    },
  },
  ClassUpdateRequest: {
    type: 'object',
    additionalProperties: true,
    minProperties: 1,
    anyOf: Object.keys(inputFields).map(field => ({ required: [field] })),
    description: [
      'Partial: phải còn ít nhất một field trong properties sau khi loại field lạ.',
      'Body rỗng hoặc chỉ gửi id/teacherId/teacher_id/timestamps/field lạ trả 400.',
      'Field không gửi giữ nguyên; không mặc định lại status.',
      'Chỉ endDate và note nhận null. Ngày cuối sau khi ghép với dữ liệu DB phải không trước ngày đầu.',
    ].join(' '),
    properties: inputFields,
  },
  ClassValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: { type: 'string', description: 'Đường dẫn field; lỗi toàn object có field body.', example: 'endDate' },
      message: { type: 'string', description: 'Thông báo validation.', example: 'Ngày kết thúc không được trước ngày bắt đầu' },
    },
  },
  ClassValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin lớp không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('ClassValidationIssue') },
    },
  },
  ClassCreateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Tạo lớp thành công'] },
      data: classData,
    },
  },
  ClassListResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['classes'],
        properties: { classes: { type: 'array', items: schemaRef('ClassRecord') } },
      },
    },
  },
  ClassDetailResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', enum: [true] }, data: classData },
  },
  ClassUpdateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Cập nhật lớp thành công'] },
      data: classData,
    },
  },
  ClassDeleteResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Xóa lớp thành công'] },
    },
  },
};

export const classPaths = {
  '/classes': {
    post: {
      tags: ['Classes'],
      operationId: 'classesCreate',
      summary: 'Tạo lớp thuộc tài khoản đang đăng nhập',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN.',
        'Backend gán teacher_id từ userId đã xác thực, bỏ qua teacherId/teacher_id trong payload.',
        'Sáu field bắt buộc; status bỏ qua thì ACTIVE, endDate/note bỏ qua thì null.',
        'Field lạ bị loại bỏ. EndDate nếu có phải không trước startDate.',
        'Response không trả ownership hoặc các quan hệ lồng nhau.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('ClassCreateRequest'),
            examples: {
              minimal: {
                value: { name: 'Văn 12A1', grade: 12, schoolYear: '2026-2027', subject: 'Ngữ Văn', tuitionFee: '600000.00', startDate: '2026-09-01' },
              },
              full: {
                value: {
                  name: 'Văn 12A1', grade: 12, schoolYear: '2026-2027', subject: 'Ngữ Văn',
                  tuitionFee: '600000.00', startDate: '2026-09-01', endDate: '2027-05-31', status: 'ACTIVE', note: 'Lớp ôn thi tốt nghiệp',
                },
              },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '201': {
          description: 'Đã tạo lớp; data.class dùng cùng serializer với GET/PATCH.',
          content: {
            'application/json': {
              schema: schemaRef('ClassCreateResponse'),
              example: { success: true, message: 'Tạo lớp thành công', data: { class: classExample } },
            },
          },
        },
        '400': {
          description: 'Schema/thứ tự ngày sai (có errors), hoặc JSON sai cú pháp (không có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('ClassValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidFee: {
                  value: {
                    success: false,
                    message: 'Thông tin lớp không hợp lệ',
                    errors: [{ field: 'tuitionFee', message: 'Học phí phải từ 0 đến 9999999999.99 và có tối đa 2 chữ số thập phân' }],
                  },
                },
                invalidDates: invalidDatesExample,
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
      tags: ['Classes'],
      operationId: 'classesList',
      summary: 'Danh sách lớp của tài khoản đang đăng nhập',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; ADMIN cũng chỉ đọc lớp của chính mình.',
        'Gồm các trạng thái ACTIVE/INACTIVE/COMPLETED, sắp xếp createdAt DESC rồi id DESC.',
        'Chưa có bộ lọc/tìm kiếm/phân trang; query không được dùng.',
        'Không có lớp trả 200 với data.classes = []; không có total/count hoặc dữ liệu lồng nhau.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Danh sách lớp trong phạm vi ownership; JSON không có message.',
          content: {
            'application/json': {
              schema: schemaRef('ClassListResponse'),
              examples: {
                classes: { value: { success: true, data: { classes: [classExample] } } },
                empty: { value: { success: true, data: { classes: [] } } },
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
      },
    },
  },
  '/classes/{id}': {
    get: {
      tags: ['Classes'],
      operationId: 'classesGetById',
      summary: 'Chi tiết một lớp thuộc tài khoản đang đăng nhập',
      description: 'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN. Tìm theo ID và userId đã xác thực; ngoài ownership trả cùng 404 như không tồn tại. Query không được dùng.',
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Chi tiết lớp, đúng 12 trường serialize; không có message.',
          content: {
            'application/json': {
              schema: schemaRef('ClassDetailResponse'),
              example: { success: true, data: { class: classExample } },
            },
          },
        },
        '400': errorResponse('ID lớp không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': notFound,
      },
    },
    patch: {
      tags: ['Classes'],
      operationId: 'classesUpdate',
      summary: 'Cập nhật một phần lớp thuộc tài khoản đang đăng nhập',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN. Cả đọc và ghi đều kiểm tra ownership.',
        'Phải gửi ít nhất một field được sửa; field lạ bị loại bỏ, không đổi id hoặc teacherId/teacher_id.',
        'Field không gửi giữ nguyên, kể cả status. Chỉ endDate/note nhận null để xóa giá trị.',
        'Ngày được ghép với dữ liệu DB rồi kiểm endDate >= startDate.',
        'CHECK database cũng giữ thứ tự ngày khi cập nhật đồng thời; vi phạm trả 400, không tự sửa ngày.',
        'Đổi tuitionFee không đồng bộ lại amountDue của Payment đã có. Query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('ClassUpdateRequest'),
            examples: {
              feeAndStatus: { value: { tuitionFee: '750000.50', status: 'INACTIVE' } },
              clearOptional: { value: { endDate: null, note: null } },
              dates: { value: { startDate: '2026-09-01', endDate: '2027-05-31' } },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Lớp sau cập nhật; các field không gửi được giữ nguyên.',
          content: {
            'application/json': {
              schema: schemaRef('ClassUpdateResponse'),
              example: {
                success: true,
                message: 'Cập nhật lớp thành công',
                data: { class: { ...classExample, tuitionFee: '750000.50', status: 'INACTIVE', updatedAt: '2026-10-10T00:05:00.000Z' } },
              },
            },
          },
        },
        '400': {
          description: 'ID/JSON sai (không có errors), hoặc body/thứ tự ngày sau ghép với DB không hợp lệ (có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('ClassValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
                emptyOrUnknownOnly: {
                  value: {
                    success: false,
                    message: 'Thông tin lớp không hợp lệ',
                    errors: [{ field: 'body', message: 'Cần gửi ít nhất một trường để cập nhật' }],
                  },
                },
                invalidDates: invalidDatesExample,
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
      tags: ['Classes'],
      operationId: 'classesDelete',
      summary: 'Xóa hẳn lớp chưa có Enrollment',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; truy vấn xóa kiểm ID và ownership.',
        'Không cần body; body/query không được dùng.',
        'Lớp đã có bất kỳ Enrollment nào, kể cả LEFT, trả 409 để giữ lịch sử Enrollment/Payment.',
        'Lớp chưa có Enrollment được xóa hẳn; các ClassSchedule của lớp cũng bị xóa qua ON DELETE CASCADE.',
        'Khóa ngoại RESTRICT bảo vệ Enrollment cả khi có request ghi danh đồng thời.',
        'Không tồn tại/ngoài ownership/xóa lặp trả 404; không chuyển trạng thái tự động.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đã xóa lớp; JSON chỉ có success/message, không có data.',
          content: {
            'application/json': {
              schema: schemaRef('ClassDeleteResponse'),
              example: { success: true, message: 'Xóa lớp thành công' },
            },
          },
        },
        '400': errorResponse('ID lớp không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': notFound,
        '409': errorResponse('Lớp đã có Enrollment ACTIVE hoặc LEFT; lớp và lịch sử được giữ nguyên.', {
          hasEnrollments: errorExample('Không thể xóa lớp đã có học sinh ghi danh'),
        }),
      },
    },
  },
};
