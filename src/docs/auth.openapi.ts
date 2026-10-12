const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorExample = (message: string) => ({ value: { success: false, message } });

function errorResponse(description: string, examples: Record<string, ReturnType<typeof errorExample>>) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef('AuthError'),
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

const bearerUnauthorized = errorResponse(
  'Thiếu/sai/hết hạn access token hoặc tài khoản không còn tồn tại.',
  {
    missingToken: errorExample('Thiếu access token'),
    invalidToken: errorExample('Access token không hợp lệ hoặc đã hết hạn'),
    missingAccount: errorExample('Tài khoản không còn tồn tại'),
    unauthenticated: errorExample('Chưa xác thực'),
  },
);

const accountPending = errorResponse('Tài khoản chưa ACTIVE.', {
  pending: errorExample('Tài khoản đang chờ duyệt'),
});

const adminForbidden = errorResponse('Tài khoản chưa ACTIVE hoặc không có role ADMIN.', {
  pending: errorExample('Tài khoản đang chờ duyệt'),
  wrongRole: errorExample('Bạn không có quyền thực hiện thao tác này'),
});

const publicUserExample = { id: 101, email: 'teacher@example.com', name: 'teacher@example.com', role: 'TEACHER' };
const accessTokenExample = 'ACCESS_TOKEN_FROM_LOGIN_OR_REFRESH';

const refreshCookieHeader = {
  description: [
    'Đặt cookie refreshToken mới, hạn 7 ngày kể từ lúc cấp.',
    'HttpOnly; Path=/api/auth; SameSite=Lax; Secure chỉ trong production.',
    'Refresh token không nằm trong JSON. Trình duyệt nhận và gửi cookie tự động;',
    'JavaScript không đọc được cookie HttpOnly. Ví dụ header dùng giá trị minh họa.',
  ].join(' '),
  schema: { type: 'string' },
  example: 'refreshToken=<refresh-token>; Path=/api/auth; Expires=Sat, 17 Oct 2026 00:00:00 GMT; HttpOnly; SameSite=Lax',
};

export const authSchemas = {
  AuthError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string' },
    },
  },
  AuthValidationIssue: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: {
        type: 'string',
        description: 'Đường dẫn field; lỗi ở object hoặc field không được nhận có giá trị body.',
        example: 'password',
      },
      message: { type: 'string', description: 'Thông báo validation của Zod.' },
    },
  },
  AuthRegisterValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin đăng ký không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('AuthValidationIssue') },
    },
  },
  AuthRegisterRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    description: 'Chỉ nhận email và password. Field lạ, kể cả name/avatar/role/status, bị từ chối; các field không nhận null. Backend tự đặt name ban đầu bằng email đã chuẩn hóa.',
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Backend trim khoảng trắng đầu/cuối và chuyển chữ thường trước khi kiểm tra/lưu.',
        example: 'teacher@example.com',
      },
      password: {
        type: 'string',
        format: 'password',
        writeOnly: true,
        description: [
          'Không trim. Tối thiểu 12 Unicode code point theo Zod hiện tại,',
          'tối đa 72 byte UTF-8. Giới hạn byte không tương đương maxLength:72 ký tự.',
          'Các extension bên dưới mô tả giới hạn runtime; server vẫn kiểm tra cả hai.',
        ].join(' '),
        'x-minCodePoints': 12,
        'x-maxUtf8Bytes': 72,
        example: 'example-only-password',
      },
    },
  },
  AuthLoginRequest: {
    type: 'object',
    additionalProperties: true,
    required: ['email', 'password'],
    description: 'Field lạ bị loại bỏ, không gây lỗi validation. Email/password bắt buộc và không nhận null.',
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Trim đầu/cuối. Tra email đúng như gửi, rồi thử chữ thường khi cần cho tài khoản đăng ký mới.',
        example: 'teacher@example.com',
      },
      password: {
        type: 'string',
        format: 'password',
        writeOnly: true,
        minLength: 1,
        description: 'Không trim; phải là chuỗi không rỗng. Login không áp lại độ dài tối thiểu của đăng ký.',
        example: 'example-only-password',
      },
    },
  },
  AuthUser: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'role'],
    description: 'User công khai của login/refresh/GET và PATCH me; không có status, avatar hoặc passwordHash. name ban đầu bằng email được lưu; cập nhật tên riêng bằng PATCH /auth/me.',
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên hiển thị hiện tại. Ban đầu bằng email được lưu; có thể đổi sau khi tài khoản ACTIVE. Không áp giới hạn PATCH cho tên khởi tạo/backfill từ email cũ.', example: 'teacher@example.com' },
      role: { type: 'string', enum: ['TEACHER', 'ADMIN'] },
    },
  },
  AuthRegisteredUser: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'role'],
    description: 'Đăng ký công khai luôn tạo TEACHER/PENDING; name bằng email đã trim/chuyển chữ thường. Response không trả status/avatar.',
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên ban đầu bằng email đã chuẩn hóa; client không gửi name khi đăng ký.', example: 'teacher@example.com' },
      role: { type: 'string', enum: ['TEACHER'] },
    },
  },
  AuthPendingRegistration: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'role', 'status', 'createdAt'],
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên hiển thị hiện tại, ban đầu bằng email được lưu.', example: 'teacher@example.com' },
      role: { type: 'string', enum: ['TEACHER'] },
      status: { type: 'string', enum: ['PENDING'] },
      createdAt: { type: 'string', format: 'date-time', example: '2026-10-10T00:00:00.000Z' },
    },
  },
  AuthApprovedRegistration: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'role', 'status'],
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên hiển thị được giữ nguyên khi duyệt.', example: 'teacher@example.com' },
      role: { type: 'string', enum: ['TEACHER'] },
      status: { type: 'string', enum: ['ACTIVE'] },
    },
  },
  AuthRegisterResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Đăng ký thành công, tài khoản đang chờ duyệt'] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user'],
        properties: { user: schemaRef('AuthRegisteredUser') },
      },
    },
  },
  AuthLoginResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Đăng nhập thành công'] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user', 'accessToken'],
        properties: {
          user: schemaRef('AuthUser'),
          accessToken: {
            type: 'string',
            description: 'Access JWT HS256 hạn 15 phút. Dùng Authorization: Bearer <accessToken>. Ví dụ là placeholder.',
            example: accessTokenExample,
          },
        },
      },
    },
  },
  AuthRefreshResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    description: 'Refresh thành công không có field message.',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user', 'accessToken'],
        properties: {
          user: schemaRef('AuthUser'),
          accessToken: { type: 'string', description: 'Access JWT mới, hạn 15 phút.', example: accessTokenExample },
        },
      },
    },
  },
  AuthMeResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user'],
        properties: { user: schemaRef('AuthUser') },
      },
    },
  },
  AuthUpdateProfileRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    description: 'Strict: chỉ nhận name, bắt buộc và không nhận null. Không cho cập nhật email, role, status, ID, password, avatar hoặc field lạ. ID tài khoản lấy từ access token đã xác thực.',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        'x-minTrimmedCodePoints': 1,
        'x-maxTrimmedCodePoints': 150,
        description: 'Backend trim hai đầu rồi kiểm tên có từ 1 đến 150 Unicode code point theo Zod hiện tại. Giới hạn áp dụng sau trim, không áp maxLength cho toàn bộ chuỗi JSON chưa trim. Chỉ có khoảng trắng trả 400.',
        example: 'Nguyễn Văn An',
      },
    },
  },
  AuthUpdateProfileValidationError: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'errors'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      message: { type: 'string', enum: ['Thông tin tài khoản không hợp lệ'] },
      errors: { type: 'array', minItems: 1, items: schemaRef('AuthValidationIssue') },
    },
  },
  AuthUpdateProfileResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Cập nhật tên thành công'] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user'],
        properties: { user: schemaRef('AuthUser') },
      },
    },
  },
  AuthLogoutResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Đã đăng xuất'] },
    },
  },
  AuthPendingRegistrationsResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['users'],
        properties: { users: { type: 'array', items: schemaRef('AuthPendingRegistration') } },
      },
    },
  },
  AuthApproveRegistrationResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string', enum: ['Đã duyệt tài khoản'] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user'],
        properties: { user: schemaRef('AuthApprovedRegistration') },
      },
    },
  },
};

export const authPaths = {
  '/auth/register': {
    post: {
      tags: ['Auth'],
      operationId: 'authRegister',
      summary: 'Giáo viên đăng ký tài khoản chờ duyệt',
      description: [
        'API công khai, luôn tạo role TEACHER và status PENDING.',
        'Không cấp access token hoặc refresh cookie; cần ADMIN duyệt trước khi đăng nhập.',
        'Email được trim/chuyển chữ thường; email đã dùng, kể cả khác hoa/thường, trả 409.',
        'Backend tự đặt name ban đầu bằng email đã chuẩn hóa; chỉ nhận email/password, không cho client chọn name/avatar/role/status.',
      ].join(' '),
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('AuthRegisterRequest'),
            example: { email: 'teacher@example.com', password: 'example-only-password' },
          },
        },
      },
      responses: {
        ...parserResponses,
        '201': {
          description: 'Tạo TEACHER/PENDING thành công; không cấp token/cookie.',
          content: {
            'application/json': {
              schema: schemaRef('AuthRegisterResponse'),
              example: {
                success: true,
                message: 'Đăng ký thành công, tài khoản đang chờ duyệt',
                data: { user: publicUserExample },
              },
            },
          },
        },
        '400': {
          description: 'Body/field đăng ký không hợp lệ (có errors), hoặc JSON sai cú pháp (không có errors).',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('AuthRegisterValidationError'), schemaRef('AuthError')] },
              examples: {
                validation: {
                  value: {
                    success: false,
                    message: 'Thông tin đăng ký không hợp lệ',
                    errors: [{ field: 'password', message: 'Mật khẩu không được vượt quá 72 byte' }],
                  },
                },
                unknownField: {
                  value: {
                    success: false,
                    message: 'Thông tin đăng ký không hợp lệ',
                    errors: [{ field: 'body', message: 'Unrecognized key: "role"' }],
                  },
                },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '409': errorResponse('Email đã được sử dụng.', {
          emailExists: errorExample('Email đã được sử dụng'),
        }),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      operationId: 'authLogin',
      summary: 'Đăng nhập tài khoản ACTIVE',
      description: [
        'API công khai. Mật khẩu đúng nhưng tài khoản PENDING trả 403.',
        'Thành công trả data.user và access JWT hạn 15 phút, đồng thời đặt refreshToken HttpOnly hạn 7 ngày.',
        'Mỗi lần đăng nhập tạo một phiên refresh riêng; không thu hồi các phiên khác.',
        'Field lạ trong JSON bị loại bỏ. Các ví dụ mật khẩu/token chỉ là dữ liệu minh họa.',
      ].join(' '),
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('AuthLoginRequest'),
            example: { email: 'teacher@example.com', password: 'example-only-password' },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đăng nhập thành công; cookie được đặt qua Set-Cookie.',
          headers: { 'Set-Cookie': refreshCookieHeader },
          content: {
            'application/json': {
              schema: schemaRef('AuthLoginResponse'),
              example: {
                success: true,
                message: 'Đăng nhập thành công',
                data: { user: publicUserExample, accessToken: accessTokenExample },
              },
            },
          },
        },
        '400': errorResponse('Email/password không hợp lệ hoặc JSON sai cú pháp.', {
          validation: errorExample('Email hoặc mật khẩu không hợp lệ'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': errorResponse('Email không tồn tại hoặc mật khẩu không đúng.', {
          badCredentials: errorExample('Email hoặc mật khẩu không đúng'),
        }),
        '403': accountPending,
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      operationId: 'authRefresh',
      summary: 'Đổi refresh cookie lấy access token mới',
      description: [
        'Dùng cookie refreshToken đã nhận từ login/refresh; không dùng JSON body hay access JWT để refresh.',
        'Thành công xoay refresh token trên cùng phiên, đặt cookie mới hạn 7 ngày và cấp access JWT hạn 15 phút.',
        'Cookie cũ không dùng lại được; hai request dùng cùng cookie đồng thời chỉ một request thành công.',
        'Tài khoản phải ACTIVE; PENDING, token hết hạn/đã dùng/không tồn tại đều trả 401.',
        'Response lỗi không đặt hoặc xóa refresh cookie.',
        'Swagger UI dùng cookie trình duyệt khi login cùng origin; không nhập Cookie header thủ công.',
        'Body và query không được dùng.',
      ].join(' '),
      security: [{ refreshCookie: [] }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Cấp access token và refresh cookie mới; JSON không có message.',
          headers: { 'Set-Cookie': refreshCookieHeader },
          content: {
            'application/json': {
              schema: schemaRef('AuthRefreshResponse'),
              example: { success: true, data: { user: publicUserExample, accessToken: accessTokenExample } },
            },
          },
        },
        '401': errorResponse('Cookie thiếu/rỗng, token không hợp lệ/hết hạn/đã dùng hoặc tài khoản chưa ACTIVE.', {
          missingCookie: errorExample('Thiếu refresh token'),
          invalidCookie: errorExample('Refresh token không hợp lệ hoặc đã hết hạn'),
        }),
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      operationId: 'authLogout',
      summary: 'Thu hồi refresh token được gửi và xóa cookie',
      description: [
        'API công khai, cookie refreshToken tùy chọn; không yêu cầu access token.',
        'Thiếu/rỗng/sai cookie hoặc gọi lại vẫn trả 200 và xóa cookie phía trình duyệt.',
        'Chỉ thu hồi refresh token khớp cookie được gửi, không thu hồi các phiên đăng nhập khác.',
        'Cookie cũ đã xoay không thu hồi được token mới của phiên đó.',
        'Access JWT đã cấp vẫn có thể dùng đến khi hết hạn nếu tài khoản còn ACTIVE.',
        'Body và query không được dùng.',
      ].join(' '),
      security: [],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Đăng xuất idempotent; luôn trả header xóa refresh cookie.',
          headers: {
            'Set-Cookie': {
              description: 'Xóa refreshToken với Path=/api/auth, HttpOnly, SameSite=Lax; Secure chỉ trong production; Expires ở quá khứ.',
              schema: { type: 'string' },
              example: 'refreshToken=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
            },
          },
          content: {
            'application/json': {
              schema: schemaRef('AuthLogoutResponse'),
              example: { success: true, message: 'Đã đăng xuất' },
            },
          },
        },
      },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      operationId: 'authMe',
      summary: 'Đọc thông tin tài khoản đang đăng nhập',
      description: 'Yêu cầu access JWT hợp lệ và tài khoản đang ACTIVE. Chỉ trả id/email/name/role hiện tại của tài khoản đó; tên đọc từ database, không lấy từ JWT. Body/query không được dùng.',
      security: [{ bearerAuth: [] }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Thông tin user hiện tại có name, không có message/status/avatar/passwordHash.',
          content: {
            'application/json': {
              schema: schemaRef('AuthMeResponse'),
              example: { success: true, data: { user: publicUserExample } },
            },
          },
        },
        '401': bearerUnauthorized,
        '403': accountPending,
      },
    },
    patch: {
      tags: ['Auth'],
      operationId: 'authUpdateProfile',
      summary: 'Cập nhật tên tài khoản đang đăng nhập',
      description: [
        'Yêu cầu access JWT hợp lệ và tài khoản ACTIVE; chỉ cập nhật chính tài khoản được middleware xác thực.',
        'Không nhận ID tài khoản từ URL/body/query, không mở API sửa tên người khác. TEACHER và ADMIN cập nhật tên của mình theo cùng luồng.',
        'Body strict chỉ nhận name bắt buộc; trim hai đầu rồi kiểm từ 1 đến 150 Unicode code point. Không gửi name ở đăng ký: tên ban đầu bằng email được lưu.',
        'Không đổi email, role, status, mật khẩu, ownership, access token hoặc refresh cookie; avatar chưa được triển khai và field lạ trả 400.',
        'Thành công trả user hiện tại có id/email/name/role. Tài khoản không còn tồn tại trả 401; PENDING bị middleware chặn 403. Không dùng query.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('AuthUpdateProfileRequest'),
            example: { name: 'Nguyễn Văn An' },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Tên đã được trim và lưu; không cấp token hoặc đặt refresh cookie.',
          content: {
            'application/json': {
              schema: schemaRef('AuthUpdateProfileResponse'),
              example: { success: true, message: 'Cập nhật tên thành công', data: { user: { ...publicUserExample, name: 'Nguyễn Văn An' } } },
            },
          },
        },
        '400': {
          description: 'Body thiếu/sai/rỗng/field lạ hoặc tên không hợp lệ có errors; JSON sai cú pháp/null bị parser từ chối không có errors.',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('AuthUpdateProfileValidationError'), schemaRef('AuthError')] },
              examples: {
                unknownField: { value: { success: false, message: 'Thông tin tài khoản không hợp lệ', errors: [{ field: 'body', message: 'Unrecognized key: "avatar"' }] } },
                invalidName: { value: { success: false, message: 'Thông tin tài khoản không hợp lệ', errors: [{ field: 'name', message: 'Tên không được để trống' }] } },
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': bearerUnauthorized,
        '403': accountPending,
      },
    },
  },
  '/auth/registrations/pending': {
    get: {
      tags: ['AuthAdmin'],
      operationId: 'authListPendingRegistrations',
      summary: 'ADMIN xem giáo viên đang chờ duyệt',
      description: [
        'Chỉ ADMIN ACTIVE. Trả tất cả tài khoản TEACHER/PENDING, cũ nhất trước (createdAt ASC, id ASC).',
        'Không có phân trang hoặc bộ lọc; query không được dùng.',
        'Không có đăng ký chờ duyệt vẫn trả 200 với data.users = [].',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Danh sách đăng ký TEACHER/PENDING.',
          content: {
            'application/json': {
              schema: schemaRef('AuthPendingRegistrationsResponse'),
              examples: {
                pending: {
                  value: {
                    success: true,
                    data: {
                      users: [{ ...publicUserExample, status: 'PENDING', createdAt: '2026-10-10T00:00:00.000Z' }],
                    },
                  },
                },
                empty: { value: { success: true, data: { users: [] } } },
              },
            },
          },
        },
        '401': bearerUnauthorized,
        '403': adminForbidden,
      },
    },
  },
  '/auth/registrations/{id}/approve': {
    patch: {
      tags: ['AuthAdmin'],
      operationId: 'authApproveRegistration',
      summary: 'ADMIN duyệt một giáo viên PENDING',
      description: [
        'Chỉ ADMIN ACTIVE. Chuyển đúng tài khoản TEACHER/PENDING sang ACTIVE; không đổi role.',
        'Không cần body, body/query không được dùng và không được dùng để chọn role/status.',
        'Không cấp token; giáo viên đăng nhập sau khi được duyệt.',
        'Duyệt lại tài khoản TEACHER/ACTIVE trả 409; ID không tồn tại hoặc không phải TEACHER trả 404.',
        'Hai request duyệt cùng tài khoản đồng thời có một 200 và một 409.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        description: 'User ID dạng chữ số thập phân nguyên dương, không dấu/không số 0 ở đầu; tối đa 2147483647.',
        schema: { type: 'integer', format: 'int32', minimum: 1, maximum: 2147483647 },
        example: 101,
      }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Tài khoản TEACHER đã chuyển thành ACTIVE.',
          content: {
            'application/json': {
              schema: schemaRef('AuthApproveRegistrationResponse'),
              example: {
                success: true,
                message: 'Đã duyệt tài khoản',
                data: { user: { ...publicUserExample, status: 'ACTIVE' } },
              },
            },
          },
        },
        '400': errorResponse('ID không hợp lệ hoặc body JSON sai cú pháp.', {
          invalidId: errorExample('ID tài khoản phải là số nguyên dương không vượt quá 2147483647'),
          malformedJson: errorExample('Body JSON không hợp lệ'),
        }),
        '401': bearerUnauthorized,
        '403': adminForbidden,
        '404': errorResponse('Không có tài khoản này hoặc tài khoản không phải TEACHER.', {
          notFound: errorExample('Không tìm thấy tài khoản giáo viên chờ duyệt'),
        }),
        '409': errorResponse('Tài khoản TEACHER đã ACTIVE, gồm cả request duyệt lặp/đồng thời.', {
          alreadyApproved: errorExample('Tài khoản đã được duyệt'),
        }),
      },
    },
  },
};
