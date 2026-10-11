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

const classNotFound = errorResponse('Class không tồn tại hoặc thuộc tài khoản khác, kể cả người gọi là ADMIN.', {
  notFound: errorExample('Không tìm thấy lớp'),
});

const scheduleNotFound = errorResponse('Lịch không tồn tại, không thuộc Class trong URL (kể cả cùng giáo viên), hoặc Class thuộc tài khoản khác, kể cả ADMIN.', {
  notFound: errorExample('Không tìm thấy lịch học'),
});

const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const scheduleIdExample = '33333333-3333-4333-8333-333333333333';
const inputTimePattern = '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$';
const outputTimePattern = '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$';

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

const scheduleIdParameter = {
  name: 'scheduleId',
  in: 'path',
  required: true,
  description: 'UUID lịch học dạng nhóm hex 8-4-4-4-12, chấp nhận hoa/thường. Validator không ràng buộc version/variant; UUID nil cũng qua validation. Lịch phải thuộc đúng Class trong URL.',
  schema: { type: 'string', format: 'uuid', pattern: uuidPattern },
  example: scheduleIdExample,
};

const timeInput = {
  type: 'string',
  minLength: 5,
  maxLength: 8,
  pattern: inputTimePattern,
  description: [
    'HH:mm hoặc HH:mm:ss, đủ hai chữ số mỗi phần; giờ 00–23, phút/giây 00–59.',
    'Không trim, không nhận khoảng trắng, ngày đầy đủ, timezone hoặc phần thập phân.',
    'HH:mm được chuẩn hóa thêm :00. Giờ lưu dưới dạng TIME không có múi giờ và giữ nguyên giờ nhập;',
    'response luôn HH:mm:ss, không phải ISO DateTime.',
  ].join(' '),
  example: '19:00',
};

const inputFields = {
  dayOfWeek: { type: 'string', enum: weekdays, description: 'Tên ngày viết hoa theo enum; không trim hoặc tự chuyển hoa/thường.', example: 'MONDAY' },
  startTime: timeInput,
  endTime: {
    ...timeInput,
    description: `${timeInput.description} Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày; không hỗ trợ lịch qua nửa đêm.`,
    example: '21:00',
  },
};

const scheduleExample = {
  id: scheduleIdExample,
  classId: 42,
  dayOfWeek: 'MONDAY',
  startTime: '19:00:00',
  endTime: '21:00:00',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const invalidTimesExample = {
  value: {
    success: false,
    message: 'Thông tin lịch học không hợp lệ',
    errors: [{ field: 'endTime', message: 'Giờ kết thúc phải sau giờ bắt đầu' }],
  },
};

const scheduleData = {
  type: 'object',
  additionalProperties: false,
  required: ['schedule'],
  properties: { schedule: schemaRef('ScheduleRecord') },
};

export const scheduleSchemas = {
  ScheduleRecord: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'classId', 'dayOfWeek', 'startTime', 'endTime', 'createdAt', 'updatedAt'],
    description: 'ClassSchedule đã serialize: đúng 7 trường không nullable, không trả teacherId/teacher_id hoặc Class/User lồng nhau.',
    properties: {
      id: { type: 'string', format: 'uuid', pattern: uuidPattern, readOnly: true, example: scheduleIdExample },
      classId: { type: 'integer', format: 'int32', minimum: 1, maximum: 2147483647, example: 42 },
      dayOfWeek: { type: 'string', enum: weekdays, example: 'MONDAY' },
      startTime: { type: 'string', minLength: 8, maxLength: 8, pattern: outputTimePattern, description: 'HH:mm:ss, giữ nguyên giờ đã nhập, không kèm ngày/timezone.', example: '19:00:00' },
      endTime: { type: 'string', minLength: 8, maxLength: 8, pattern: outputTimePattern, description: 'HH:mm:ss, sau startTime trong cùng ngày.', example: '21:00:00' },
      createdAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
    },
    example: scheduleExample,
  },
  ScheduleCreateRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['dayOfWeek', 'startTime', 'endTime'],
    description: 'Strict: cả 3 field bắt buộc, không nhận null và không có default. Field lạ, kể cả id, classId, teacherId/teacher_id, status, note hoặc timestamps, trả 400. EndTime phải sau startTime.',
    properties: inputFields,
  },
  ScheduleUpdateRequest: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    description: 'Strict partial: ít nhất một trong 3 field, không nhận null hoặc field lạ. Field không gửi giữ nguyên. Khi chỉ gửi một giờ, backend ghép với giờ đang có trong DB để kiểm endTime > startTime; cả hai giờ được gửi thì kiểm ngay trong body.',
    properties: inputFields,
  },
  ScheduleValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: { type: 'string', description: 'Đường dẫn field; lỗi toàn object hoặc field không được nhận có field body.', example: 'endTime' },
      message: { type: 'string', description: 'Thông báo validation.', example: 'Giờ kết thúc phải sau giờ bắt đầu' },
    },
  },
  ScheduleValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin lịch học không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('ScheduleValidationIssue') },
    },
  },
  ScheduleCreateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Tạo lịch học thành công'] },
      data: scheduleData,
    },
  },
  ScheduleListResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['schedules'],
        properties: { schedules: { type: 'array', items: schemaRef('ScheduleRecord') } },
      },
    },
  },
  ScheduleDetailResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', enum: [true] }, data: scheduleData },
  },
  ScheduleUpdateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Cập nhật lịch học thành công'] },
      data: scheduleData,
    },
  },
  ScheduleDeleteResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Xóa lịch học thành công'] },
    },
  },
};

export const schedulePaths = {
  '/classes/{classId}/schedules': {
    post: {
      tags: ['ClassSchedules'],
      operationId: 'schedulesCreate',
      summary: 'Tạo một khung giờ học theo tuần cho Class',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; Class phải thuộc tài khoản đang gọi, kể cả ADMIN.',
        'Ownership được kiểm trước và trong classRecord.connect khi ghi; classId lấy từ URL.',
        'Body strict chỉ nhận dayOfWeek/startTime/endTime; ba field bắt buộc, không nullable.',
        'Giờ HH:mm được chuẩn hóa thêm :00, giữ nguyên giờ nhập; endTime > startTime trong cùng ngày.',
        'Cho phép Class ở các trạng thái hiện có và các khung giờ trùng/giao nhau; chưa có ràng buộc chống trùng/giao giờ.',
        'ID UUID/timestamps do backend tạo; query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('ScheduleCreateRequest'),
            examples: {
              minutes: { value: { dayOfWeek: 'MONDAY', startTime: '19:00', endTime: '21:00' } },
              seconds: { value: { dayOfWeek: 'THURSDAY', startTime: '19:00:15', endTime: '21:00:30' } },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '201': {
          description: 'Đã tạo lịch học; data.schedule có 7 trường, giờ HH:mm:ss.',
          content: {
            'application/json': {
              schema: schemaRef('ScheduleCreateResponse'),
              example: { success: true, message: 'Tạo lịch học thành công', data: { schedule: scheduleExample } },
            },
          },
        },
        '400': {
          description: 'ID lớp/JSON sai (không có errors), hoặc body/giờ không hợp lệ hay field lạ (có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('ScheduleValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
                invalidTimes: invalidTimesExample,
                invalidTimeFormat: {
                  value: { success: false, message: 'Thông tin lịch học không hợp lệ', errors: [{ field: 'startTime', message: 'Giờ phải có định dạng HH:mm hoặc HH:mm:ss hợp lệ' }] },
                },
                unknownField: {
                  value: { success: false, message: 'Thông tin lịch học không hợp lệ', errors: [{ field: 'body', message: 'Unrecognized key: "classId"' }] },
                },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
        '404': classNotFound,
      },
    },
    get: {
      tags: ['ClassSchedules'],
      operationId: 'schedulesListForClass',
      summary: 'Danh sách khung giờ học của Class',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; Class phải thuộc tài khoản đang gọi, kể cả ADMIN.',
        'Thứ tự MONDAY→SUNDAY, rồi startTime ASC, endTime ASC và id ASC.',
        'Class hợp lệ chưa có lịch trả 200 với data.schedules = [].',
        'Không lọc theo trạng thái Class; chưa có tìm kiếm/bộ lọc/phân trang hoặc total/count.',
        'Body/query không được dùng; mỗi item có đúng 7 trường, không có quan hệ lồng nhau.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Danh sách lịch trong Class thuộc người gọi; JSON không có message.',
          content: {
            'application/json': {
              schema: schemaRef('ScheduleListResponse'),
              examples: {
                schedules: { value: { success: true, data: { schedules: [scheduleExample] } } },
                empty: { value: { success: true, data: { schedules: [] } } },
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
        '404': classNotFound,
      },
    },
  },
  '/classes/{classId}/schedules/{scheduleId}': {
    get: {
      tags: ['ClassSchedules'],
      operationId: 'schedulesGetById',
      summary: 'Chi tiết một lịch học trong Class',
      description: 'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN. Truy vấn theo scheduleId, classId và giáo viên sở hữu Class; khác lớp trong URL hoặc ngoài ownership trả cùng 404 như không tồn tại. Body/query không được dùng, không lọc theo trạng thái Class.',
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter, scheduleIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Chi tiết lịch có 7 trường, giờ HH:mm:ss; JSON không có message.',
          content: {
            'application/json': {
              schema: schemaRef('ScheduleDetailResponse'),
              example: { success: true, data: { schedule: scheduleExample } },
            },
          },
        },
        '400': errorResponse('ID Class/Schedule không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
          invalidScheduleId: errorExample('ID lịch học phải là UUID hợp lệ'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': scheduleNotFound,
      },
    },
    patch: {
      tags: ['ClassSchedules'],
      operationId: 'schedulesUpdate',
      summary: 'Cập nhật một phần lịch học',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; đọc và ghi đều kiểm scheduleId/classId/ownership Class.',
        'Strict partial chỉ nhận dayOfWeek/startTime/endTime, ít nhất một field; không nullable.',
        'Field không gửi giữ nguyên và không bị ghi lại. Giờ dùng cùng validation/chuẩn hóa với POST.',
        'Khung giờ sau khi ghép với DB phải có endTime > startTime; CHECK database cũng bảo vệ khi có cập nhật đồng thời.',
        'Vi phạm CHECK giờ được trả 400 tại endTime; không có cơ chế version hoặc lỗi xung đột 409 cho API này.',
        'Không đổi Class liên quan hoặc ownership. Giữ quy tắc hiện có cho trạng thái Class và lịch trùng/giao giờ; query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter, scheduleIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('ScheduleUpdateRequest'),
            examples: {
              changeDay: { value: { dayOfWeek: 'THURSDAY' } },
              changeTimes: { value: { startTime: '18:30', endTime: '20:30' } },
              changeOneTime: { value: { endTime: '21:30' } },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Lịch sau cập nhật, cùng DTO 7 trường; field không gửi giữ nguyên.',
          content: {
            'application/json': {
              schema: schemaRef('ScheduleUpdateResponse'),
              example: {
                success: true,
                message: 'Cập nhật lịch học thành công',
                data: { schedule: { ...scheduleExample, startTime: '18:30:00', endTime: '20:30:00', updatedAt: '2026-10-10T00:05:00.000Z' } },
              },
            },
          },
        },
        '400': {
          description: 'ID/JSON sai (không có errors), hoặc body/khung giờ sau ghép với DB không hợp lệ (có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('ScheduleValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
                invalidScheduleId: errorExample('ID lịch học phải là UUID hợp lệ'),
                invalidTimes: invalidTimesExample,
                empty: {
                  value: { success: false, message: 'Thông tin lịch học không hợp lệ', errors: [{ field: 'body', message: 'Cần gửi ít nhất một trường để cập nhật' }] },
                },
                unknownField: {
                  value: { success: false, message: 'Thông tin lịch học không hợp lệ', errors: [{ field: 'body', message: 'Unrecognized key: "classId"' }] },
                },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
        '404': scheduleNotFound,
      },
    },
    delete: {
      tags: ['ClassSchedules'],
      operationId: 'schedulesDelete',
      summary: 'Xóa hẳn một lịch học trong Class',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; truy vấn xóa kiểm scheduleId/classId/ownership Class.',
        'Không cần body; body/query không được dùng.',
        'Chỉ xóa ClassSchedule, giữ Class/Student/Enrollment/Payment và các lịch khác.',
        'Cho phép xóa lịch cả khi Class đã có Enrollment hoặc ở các trạng thái hiện có.',
        'Gọi lại sau khi xóa trả 404; hai request cùng xóa một lịch trả một 200/một 404.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [classIdParameter, scheduleIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đã xóa lịch; JSON chỉ có success/message, không có data.',
          content: {
            'application/json': {
              schema: schemaRef('ScheduleDeleteResponse'),
              example: { success: true, message: 'Xóa lịch học thành công' },
            },
          },
        },
        '400': errorResponse('ID Class/Schedule không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidClassId: errorExample('ID lớp phải là số nguyên dương không vượt quá 2147483647'),
          invalidScheduleId: errorExample('ID lịch học phải là UUID hợp lệ'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': unauthorized,
        '403': forbidden,
        '404': scheduleNotFound,
      },
    },
  },
};
