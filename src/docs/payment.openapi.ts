const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorExample = (message: string) => ({ value: { success: false, message } });

function errorResponse(description: string, examples: Record<string, ReturnType<typeof errorExample>>) {
  return {
    description,
    content: { 'application/json': { schema: schemaRef('ApiError'), examples } },
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

const forbidden = errorResponse('Tài khoản chưa ACTIVE hoặc role không được phép.', {
  pending: errorExample('Tài khoản đang chờ duyệt'),
  roleNotAllowed: errorExample('Bạn không có quyền thực hiện thao tác này'),
});

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const paymentIdExample = '33333333-3333-4333-8333-333333333333';
const enrollmentIdExample = '22222222-2222-4222-8222-222222222222';
const studentIdExample = '11111111-1111-4111-8111-111111111111';

const uuidInput = {
  type: 'string',
  format: 'uuid',
  pattern: uuidPattern,
  minLength: 36,
  maxLength: 36,
  description: 'UUID đúng 36 ký tự dạng hex 8-4-4-4-12, nhận chữ hoa/thường. Không trim hoặc ràng buộc version/variant; UUID nil qua validation.',
};

const billingPeriodInput = {
  type: 'string',
  format: 'date',
  pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  description: 'Ngày lịch thực sự tồn tại đúng YYYY-MM-DD, năm 0001–9999. Không trim, không nhận chỉ tháng/giờ/timezone. Nhận ngày bất kỳ trong tháng; backend chuẩn hóa về YYYY-MM-01, ví dụ 2026-10-15 thành 2026-10-01.',
  example: '2026-10-15',
};

const moneyInput = {
  description: [
    'Số hoặc chuỗi thập phân từ 0 đến 9999999999.99, tối đa 2 chữ số phần lẻ, không nhận null.',
    'Chuỗi được trim; không nhận dấu cộng/trừ, số 0 ở đầu (trừ 0), ký pháp mũ, dấu phẩy hoặc dấu phân cách hàng nghìn.',
    'JSON number được chuyển bằng String(value) rồi kiểm cùng mẫu thập phân; không tự làm tròn.',
    'Ưu tiên gửi chuỗi để giữ chính xác tiền. Response luôn là chuỗi Decimal có hai chữ số phần lẻ.',
  ].join(' '),
  oneOf: [
    { type: 'string', pattern: '^\\s*(0|[1-9][0-9]{0,9})(\\.[0-9]{1,2})?\\s*$', example: '500000.00' },
    {
      type: 'number',
      minimum: 0,
      maximum: 9999999999.99,
      description: 'String(value) phải khớp mẫu tiền và có tối đa hai chữ số thập phân; không nhận số âm/không hữu hạn.',
      'x-maxDecimalPlaces': 2,
      example: 500000,
    },
  ],
};

const noteInput = {
  type: 'string',
  nullable: true,
  description: 'Chuỗi được trim, có thể rỗng hoặc null, không có giới hạn độ dài riêng trong schema. POST bỏ qua thì null; PATCH bỏ qua giữ nguyên. Gửi null để xóa ghi chú; chuỗi chỉ có khoảng trắng thành chuỗi rỗng.',
  example: 'Học phí tháng 10',
};

const paymentMethodInput = {
  type: 'string',
  enum: ['CASH', 'BANK_TRANSFER', 'OTHER', null],
  nullable: true,
  description: 'Phương thức thanh toán hoặc null; sau khi ghép PATCH với dữ liệu đang lưu, amountPaid > 0 phải có phương thức. Không gửi thì giữ nguyên, gửi null để xóa khi tổng đã thu bằng 0.',
  example: 'BANK_TRANSFER',
};

const moneyOutput = {
  type: 'string',
  pattern: '^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$',
  description: 'Prisma Decimal được serialize bằng toFixed(2); chuỗi tiền không âm có đúng hai chữ số phần lẻ.',
  example: '500000.00',
};

const paymentFields = {
  id: { ...uuidInput, readOnly: true, description: 'ID Payment do Prisma tạo; dùng trong URL GET/PATCH chi tiết.', example: paymentIdExample },
  classStudentId: { ...uuidInput, description: 'Enrollment.id (ClassStudent.id), không phải Student.id/Class.id. Quan hệ này bất biến qua API PATCH.', example: enrollmentIdExample },
  billingPeriod: { type: 'string', format: 'date', pattern: '^(?!0000)[0-9]{4}-[0-9]{2}-01$', description: 'Tháng học phí đã chuẩn hóa về ngày đầu tháng YYYY-MM-01.', example: '2026-10-01' },
  amountDue: { ...moneyOutput, description: 'Snapshot số tiền phải thu của riêng kỳ này; đổi học phí Class không ghi đè khoản đã tạo.', example: '500000.00' },
  amountPaid: { ...moneyOutput, description: 'Tổng tiền đã thu hiện tại; khoản mới trả 0.00. PATCH thay thế tổng, không cộng dồn số gửi.', example: '0.00' },
  paidAt: {
    type: 'string', format: 'date-time', nullable: true,
    description: 'ISO UTC hoặc null. POST luôn null. PATCH: null khi chưa thu/thu thiếu (gồm 0/0); khi đã thu dương và đủ/thừa, giữ thời điểm đã có hoặc dùng thời điểm server.',
    example: null,
  },
  paymentMethod: { type: 'string', enum: ['CASH', 'BANK_TRANSFER', 'OTHER', null], nullable: true, description: 'Phương thức hiện tại; POST luôn null.', example: null },
  note: { type: 'string', nullable: true, description: 'Ghi chú hiện tại, đã trim khi ghi qua API, hoặc null.', example: null },
  createdAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
  updatedAt: { type: 'string', format: 'date-time', readOnly: true, description: 'ISO UTC.', example: '2026-10-10T00:00:00.000Z' },
};

const paymentExample = {
  id: paymentIdExample,
  classStudentId: enrollmentIdExample,
  billingPeriod: '2026-10-01',
  amountDue: '500000.00',
  amountPaid: '0.00',
  paidAt: null,
  paymentMethod: null,
  note: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const unpaidExample = { ...paymentExample, status: 'UNPAID' };
const paidExample = {
  ...paymentExample,
  amountPaid: '500000.00',
  paidAt: '2026-10-10T00:30:00.000Z',
  paymentMethod: 'BANK_TRANSFER',
  note: 'Đã thu đủ học phí tháng 10',
  updatedAt: '2026-10-10T00:30:00.000Z',
  status: 'PAID',
};

const dataPayment = (schemaName: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['payment'],
  properties: { payment: schemaRef(schemaName) },
});

export const paymentSchemas = {
  PaymentRecord: {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(paymentFields),
    description: 'DTO POST có đúng 10 trường Payment; không có status, teacherId, studentId, classId hoặc dữ liệu cha lồng nhau.',
    properties: paymentFields,
    example: paymentExample,
  },
  PaymentWithStatus: {
    type: 'object',
    additionalProperties: false,
    required: [...Object.keys(paymentFields), 'status'],
    description: 'DTO GET/PATCH có 10 trường Payment và status tính bằng Decimal; không lưu thêm cột status hoặc trả dữ liệu cha lồng nhau.',
    properties: {
      ...paymentFields,
      status: {
        type: 'string',
        enum: ['UNPAID', 'PARTIAL', 'PAID'],
        readOnly: true,
        description: 'PAID khi amountPaid >= amountDue (gồm 0/0 và trả thừa); UNPAID khi amountPaid = 0 và amountDue > 0; PARTIAL khi 0 < amountPaid < amountDue. GET chỉ đọc và không tự ghi paidAt.',
        example: 'UNPAID',
      },
    },
    example: unpaidExample,
  },
  PaymentCreateRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['classStudentId', 'billingPeriod'],
    description: 'Strict: chỉ nhận 4 field đã khai báo. Field lạ, kể cả amountPaid/paidAt/paymentMethod/status/ownership/ID/timestamps, trả 400. Không gửi amountDue thì backend lấy snapshot Class.tuitionFee đọc trong request; không có default tiền cố định.',
    properties: {
      classStudentId: { ...uuidInput, description: 'ID Enrollment lấy từ data.enrollment.id hoặc data.enrollments[].id; Class và Student của Enrollment phải cùng thuộc tài khoản gọi.', example: enrollmentIdExample },
      billingPeriod: billingPeriodInput,
      amountDue: { ...moneyInput, description: `${moneyInput.description} Không gửi thì lấy Class.tuitionFee tại lúc đọc Enrollment, lưu snapshot cho khoản mới.` },
      note: noteInput,
    },
  },
  PaymentUpdateRequest: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    description: 'Strict, ít nhất một field; không gửi giữ nguyên. Chỉ nhận amountDue/amountPaid/paymentMethod/note; field khác trả 400. Backend tính lại paidAt và status sau ghép; không cho đổi Enrollment, billingPeriod, ownership hoặc timestamps.',
    properties: {
      amountDue: { ...moneyInput, description: `${moneyInput.description} Chỉ sửa nghĩa vụ khoản này, không đọc lại học phí lớp hoặc sửa khoản khác.` },
      amountPaid: { ...moneyInput, description: `${moneyInput.description} Tổng đã thu thay thế giá trị cũ, không cộng dồn. Đã thu 200000 rồi thu thêm 300000 thì gửi 500000. Cho phép sửa giảm và trả thừa; gửi lại cùng tổng không cộng thêm.` },
      paymentMethod: paymentMethodInput,
      note: noteInput,
    },
  },
  PaymentValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: { type: 'string', description: 'Đường dẫn field; lỗi toàn object/trường không được nhận dùng body hoặc query tùy API.', example: 'amountDue' },
      message: { type: 'string', example: 'Số tiền phải từ 0 đến 9999999999.99 và có tối đa 2 chữ số thập phân' },
    },
  },
  PaymentBodyValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin học phí không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('PaymentValidationIssue') },
    },
  },
  PaymentQueryValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Bộ lọc học phí không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('PaymentValidationIssue') },
    },
  },
  PaymentCreateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Tạo học phí thành công'] },
      data: dataPayment('PaymentRecord'),
    },
  },
  PaymentListResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object', additionalProperties: false, required: ['payments'],
        properties: { payments: { type: 'array', items: schemaRef('PaymentWithStatus') } },
      },
    },
  },
  PaymentDetailResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: dataPayment('PaymentWithStatus'),
    },
  },
  PaymentUpdateResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Cập nhật học phí thành công'] },
      data: dataPayment('PaymentWithStatus'),
    },
  },
};

const paymentIdParameter = {
  name: 'id', in: 'path', required: true,
  description: 'Payment.id lấy từ POST/GET danh sách, UUID đúng 36 ký tự hex 8-4-4-4-12, hoa/thường; không trim/version/variant constraint. ID Enrollment/Student không thay thế ID Payment.',
  schema: uuidInput,
  example: paymentIdExample,
};

const listParameters = [
  {
    name: 'classId', in: 'query', required: false,
    description: 'ID Class Int từ 1 đến 2147483647; URL nhận chuỗi chữ số, cho phép số 0 ở đầu, không có khoảng trắng/dấu/ký pháp mũ. ID hợp lệ ngoài phạm vi/không tồn tại trả mảng rỗng.',
    schema: { type: 'integer', format: 'int32', minimum: 1, maximum: 2147483647 },
    example: 42,
  },
  {
    name: 'studentId', in: 'query', required: false,
    description: 'UUID Student đúng 36 ký tự hex 8-4-4-4-12, hoa/thường. ID hợp lệ ngoài phạm vi/không tồn tại trả mảng rỗng.',
    schema: uuidInput,
    example: studentIdExample,
  },
  { name: 'billingPeriod', in: 'query', required: false, description: billingPeriodInput.description, schema: billingPeriodInput, example: '2026-10-15' },
  {
    name: 'status', in: 'query', required: false,
    description: 'Trạng thái tính từ các cột Decimal, phải đúng chữ hoa. PAID gồm khoản 0/0; UNPAID yêu cầu còn amountDue > 0; PARTIAL đã thu dương nhưng chưa đủ.',
    schema: { type: 'string', enum: ['UNPAID', 'PARTIAL', 'PAID'] },
    example: 'UNPAID',
  },
];

const paymentNotFound = errorResponse('Payment không tồn tại hoặc ngoài ownership của Class/Student qua Enrollment; kể cả ADMIN chỉ có dữ liệu riêng.', {
  notFound: errorExample('Không tìm thấy học phí'),
});

export const paymentPaths = {
  '/payments': {
    post: {
      tags: ['Payments'],
      operationId: 'paymentsCreate',
      summary: 'Tạo khoản học phí tháng cho Enrollment',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN.',
        'Kiểm Enrollment → Class và Student cùng chủ sở hữu theo người đã xác thực, cả lúc đọc và connect khi ghi; ADMIN chỉ dùng dữ liệu riêng.',
        'Cho phép Enrollment ACTIVE/LEFT, Class INACTIVE/COMPLETED và Student INACTIVE; không giới hạn kỳ theo ngày vào/nghỉ lớp, không chia tiền theo ngày/buổi hoặc tạo hàng loạt.',
        'billingPeriod nhận ngày hợp lệ bất kỳ và chuẩn hóa về đầu tháng. Không gửi amountDue thì lưu snapshot học phí lớp đọc trong request; sửa học phí lớp về sau không đổi khoản cũ.',
        'Tạo amountPaid = 0, paidAt/paymentMethod = null; note bỏ qua thì null. Ghi nhận tiền đã thu qua PATCH.',
        'Unique(Enrollment, billingPeriod) bảo vệ tạo trùng kể cả request đồng thời (một 201/một 409).',
        'Response có đúng 10 trường Payment, không status hoặc dữ liệu cha; query không được dùng.',
        'Theo quyết định giữ lịch sử, module không mở DELETE Payment.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('PaymentCreateRequest'),
            examples: {
              classTuitionSnapshot: { value: { classStudentId: enrollmentIdExample, billingPeriod: '2026-10-15' } },
              customAmount: { value: { classStudentId: enrollmentIdExample, billingPeriod: '2026-10-01', amountDue: '450000.00', note: 'Học phí tháng 10' } },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '201': {
          description: 'Đã tạo khoản; ví dụ không gửi amountDue và Class có học phí 500000.00. DTO có 10 trường, không status.',
          content: { 'application/json': { schema: schemaRef('PaymentCreateResponse'), example: { success: true, message: 'Tạo học phí thành công', data: { payment: paymentExample } } } },
        },
        '400': {
          description: 'Body/UUID/ngày/số tiền/field lạ sai: có errors. JSON sai hoặc null bị parser từ chối: không có errors.',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('PaymentBodyValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidAmount: { value: { success: false, message: 'Thông tin học phí không hợp lệ', errors: [{ field: 'amountDue', message: 'Số tiền phải từ 0 đến 9999999999.99 và có tối đa 2 chữ số thập phân' }] } },
                unknownField: { value: { success: false, message: 'Thông tin học phí không hợp lệ', errors: [{ field: 'body', message: 'Unrecognized key: "amountPaid"' }] } },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
        '404': errorResponse('Enrollment không tồn tại/ngoài ownership hoặc quan hệ mất/đổi ownership khi connect.', { enrollmentNotFound: errorExample('Không tìm thấy ghi danh') }),
        '409': errorResponse('Enrollment đã có khoản học phí trong tháng sau chuẩn hóa, kể cả tạo đồng thời.', { duplicatePeriod: errorExample('Học phí của ghi danh trong tháng này đã tồn tại') }),
      },
    },
    get: {
      tags: ['Payments'],
      operationId: 'paymentsList',
      summary: 'Danh sách khoản học phí với bộ lọc tùy chọn',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; giới hạn qua Enrollment → Class và Student cùng chủ sở hữu, kể cả ADMIN.',
        'Không query thì trả tất cả trong phạm vi. Chỉ nhận classId, studentId, billingPeriod, status; kết hợp các bộ lọc bằng AND.',
        'Ngày chuẩn hóa về đầu tháng; status so sánh các cột Decimal trong DB. Query lặp, dạng mảng/object, rỗng/sai hoặc tên lạ (gồm page/limit/teacherId/classStudentId) trả 400.',
        'ID Class/Student hợp lệ nhưng không tồn tại/ngoài phạm vi hoặc không có khoản khớp trả 200 với payments = [].',
        'Bao gồm học phí lịch sử Enrollment LEFT, Class INACTIVE/COMPLETED, Student INACTIVE. Không tự ghi paidAt khi GET.',
        'Thứ tự billingPeriod DESC, createdAt DESC, id DESC. Chưa có phân trang, tổng/count hoặc tìm theo tên.',
        'Mỗi item có 11 trường gồm status tính bằng Decimal; không dữ liệu cha lồng nhau. Body không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: listParameters,
      responses: {
        ...parserResponses,
        '200': {
          description: 'Danh sách có 11 trường mỗi item, gồm status; JSON không có message. Có thể mảng rỗng.',
          content: {
            'application/json': {
              schema: schemaRef('PaymentListResponse'),
              examples: {
                unpaid: { value: { success: true, data: { payments: [unpaidExample] } } },
                zeroDue: { value: { success: true, data: { payments: [{ ...unpaidExample, amountDue: '0.00', status: 'PAID' }] } } },
                empty: { value: { success: true, data: { payments: [] } } },
              },
            },
          },
        },
        '400': {
          description: 'Bộ lọc sai/lặp/tên lạ có errors; lỗi body JSON parser không có errors.',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('PaymentQueryValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidPeriod: { value: { success: false, message: 'Bộ lọc học phí không hợp lệ', errors: [{ field: 'billingPeriod', message: 'Ngày không hợp lệ' }] } },
                unknownQuery: { value: { success: false, message: 'Bộ lọc học phí không hợp lệ', errors: [{ field: 'query', message: 'Unrecognized key: "page"' }] } },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
      },
    },
  },
  '/payments/{id}': {
    get: {
      tags: ['Payments'],
      operationId: 'paymentsGetById',
      summary: 'Chi tiết một khoản học phí',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN. Payment.id là UUID, không phải Enrollment.id.',
        'Tìm đồng thời ID Payment và chủ sở hữu Class/Student qua Enrollment. Không tồn tại/ngoài phạm vi trả cùng 404; ADMIN chỉ có dữ liệu riêng.',
        'Đọc cả khoản lịch sử Enrollment LEFT, Class INACTIVE/COMPLETED, Student INACTIVE trong phạm vi.',
        'DTO có 11 trường gồm status tính bằng Decimal, không dữ liệu cha lồng nhau. Khoản 0/0 là PAID; GET không ghi paidAt, giữ snapshot amountDue.',
        'Body/query không được dùng; query không thay ID hoặc ownership.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [paymentIdParameter],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Chi tiết có 11 trường ở data.payment; JSON không có message.',
          content: { 'application/json': { schema: schemaRef('PaymentDetailResponse'), example: { success: true, data: { payment: unpaidExample } } } },
        },
        '400': errorResponse('ID không phải UUID đúng 36 ký tự hoặc body JSON sai cú pháp.', { invalidId: errorExample('ID học phí phải là UUID hợp lệ'), malformedJson: errorExample('Body JSON không hợp lệ') }),
        '401': unauthorized,
        '403': forbidden,
        '404': paymentNotFound,
      },
    },
    patch: {
      tags: ['Payments'],
      operationId: 'paymentsUpdate',
      summary: 'Cập nhật nghĩa vụ và tổng tiền đã thu',
      description: [
        'Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; đọc và ghi kiểm đồng thời ID Payment cùng chủ sở hữu Class/Student qua Enrollment, kể cả ADMIN.',
        'Strict chỉ nhận amountDue/amountPaid/paymentMethod/note, ít nhất một field. Không gửi giữ nguyên. Cho sửa học phí lịch sử Enrollment LEFT/Class không ACTIVE/Student INACTIVE trong phạm vi.',
        'amountPaid là tổng đã thu THAY THẾ giá trị cũ, không cộng dồn; cho phép gửi lại tổng, sửa giảm và trả thừa. Tổng dương sau ghép phải có paymentMethod, có thể dùng phương thức đang lưu.',
        'amountDue chỉ sửa khoản này, không đồng bộ lại từ học phí lớp hoặc thay các khoản khác.',
        'paidAt do server tính: null khi chưa thu/thu thiếu, gồm khoản 0/0 PAID; khi đã thu dương và đủ/thừa giữ thời điểm cũ hoặc dùng thời điểm server. Đủ → thiếu xóa thời điểm; đủ lại ghi thời điểm mới.',
        'Truy vấn ghi đối chiếu toàn bộ snapshot Payment đã đọc (Decimal/null/timestamps) và ownership. Khoản đổi giữa server đọc/ghi trả 409 để tải lại rồi gửi lại; bản ghi mất/ngoài phạm vi trả 404.',
        'Chưa có version/precondition do client gửi để phát hiện lần tải cũ; không tự retry. Không sửa dữ liệu cha, ID/Enrollment/billingPeriod/status/timestamps. Query không được dùng.',
        'Response có 11 trường; giữ Payment theo quyết định chưa mở DELETE.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [paymentIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('PaymentUpdateRequest'),
            examples: {
              collectTotal: { value: { amountPaid: '500000.00', paymentMethod: 'BANK_TRANSFER', note: 'Đã thu đủ học phí tháng 10' } },
              correctAmountDue: { value: { amountDue: '450000.00' } },
              clearPayment: { value: { amountPaid: '0.00', paymentMethod: null, note: null } },
            },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đã cập nhật; DTO có 11 trường. Ví dụ nhận tổng đủ 500000.00 từ khoản mới, server tính paidAt và PAID.',
          content: { 'application/json': { schema: schemaRef('PaymentUpdateResponse'), example: { success: true, message: 'Cập nhật học phí thành công', data: { payment: paidExample } } } },
        },
        '400': {
          description: 'ID sai, JSON parser sai hoặc thiếu phương thức sau ghép không có errors; body rỗng/sai/trường bị cấm có errors.',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('PaymentBodyValidationError'), schemaRef('ApiError')] },
              examples: {
                invalidId: errorExample('ID học phí phải là UUID hợp lệ'),
                emptyBody: { value: { success: false, message: 'Thông tin học phí không hợp lệ', errors: [{ field: 'body', message: 'Cần gửi ít nhất một trường để cập nhật' }] } },
                missingMethod: errorExample('Cần có phương thức thanh toán khi đã thu tiền'),
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': unauthorized,
        '403': forbidden,
        '404': paymentNotFound,
        '409': errorResponse('Payment thay đổi giữa lúc server đọc và ghi; tải lại khoản rồi gửi lại, API không tự retry.', { conflict: errorExample('Học phí đã thay đổi, vui lòng tải lại và thử lại') }),
      },
    },
  },
};
