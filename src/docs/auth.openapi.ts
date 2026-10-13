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

const defaultAvatarExample = 'http://localhost:5000/api/assets/default-avatar.svg';
const avatarResponseField = {
  type: 'string',
  format: 'uri',
  description: 'URL ảnh riêng hiện tại hoặc URL ảnh mặc định chung khi User.avatar trong DB là null. Response luôn là URL tuyệt đối, không trả null. Upload ảnh riêng bằng multipart/form-data qua PATCH /auth/me.',
  example: defaultAvatarExample,
};
const publicUserExample = { id: 101, email: 'teacher@example.com', name: 'teacher@example.com', avatar: defaultAvatarExample, role: 'TEACHER' };
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
    required: ['id', 'email', 'name', 'avatar', 'role'],
    description: 'User công khai của register/login/refresh/GET me/PATCH tên và avatar; không có status hoặc passwordHash. name ban đầu bằng email được lưu; avatar luôn có URL ảnh riêng hoặc ảnh mặc định chung.',
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên hiển thị hiện tại. Ban đầu bằng email được lưu; có thể đổi sau khi tài khoản ACTIVE. Không áp giới hạn PATCH cho tên khởi tạo/backfill từ email cũ.', example: 'teacher@example.com' },
      avatar: avatarResponseField,
      role: { type: 'string', enum: ['TEACHER', 'ADMIN'] },
    },
  },
  AuthRegisteredUser: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'avatar', 'role'],
    description: 'Đăng ký công khai luôn tạo TEACHER/PENDING; name bằng email đã trim/chuyển chữ thường. avatar dùng ảnh mặc định chung. Response không trả status.',
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên ban đầu bằng email đã chuẩn hóa; client không gửi name khi đăng ký.', example: 'teacher@example.com' },
      avatar: avatarResponseField,
      role: { type: 'string', enum: ['TEACHER'] },
    },
  },
  AuthPendingRegistration: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'avatar', 'role', 'status', 'createdAt'],
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên hiển thị hiện tại, ban đầu bằng email được lưu.', example: 'teacher@example.com' },
      avatar: avatarResponseField,
      role: { type: 'string', enum: ['TEACHER'] },
      status: { type: 'string', enum: ['PENDING'] },
      createdAt: { type: 'string', format: 'date-time', example: '2026-10-10T00:00:00.000Z' },
    },
  },
  AuthApprovedRegistration: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'name', 'avatar', 'role', 'status'],
    properties: {
      id: { type: 'integer', format: 'int32', minimum: 1, example: 101 },
      email: { type: 'string', format: 'email', example: 'teacher@example.com' },
      name: { type: 'string', description: 'Tên hiển thị được giữ nguyên khi duyệt.', example: 'teacher@example.com' },
      avatar: avatarResponseField,
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
      message: { type: 'string', enum: ['Cập nhật thông tin tài khoản thành công'] },
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['user'],
        properties: { user: schemaRef('AuthUser') },
      },
    },
  },
  AuthUpdateProfileMultipartRequest: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    anyOf: [{ required: ['name'] }, { required: ['avatar'] }],
    description: 'Multipart: chỉ nhận name dạng text và tối đa một file avatar, cả hai optional nhưng phải gửi ít nhất một. Không nhận avatar text/URL, name dạng file, ID tài khoản hoặc field khác. Field không gửi giữ nguyên; name chỉ có khoảng trắng hoặc file rỗng bị từ chối. Client tự tạo Content-Type/boundary.',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        'x-minTrimmedCodePoints': 1,
        'x-maxTrimmedCodePoints': 150,
        description: 'Text optional; nếu gửi phải trim còn 1–150 Unicode code point như JSON. Không gửi giữ tên đang lưu. Không nhận name dạng file/null/số.',
        example: 'Nguyễn Văn An',
      },
      avatar: {
        type: 'string',
        format: 'binary',
        'x-maxBytes': 2097152,
        'x-maxPixels': 20000000,
        'x-acceptedMimeTypes': ['image/jpeg', 'image/png', 'image/webp'],
        description: 'File optional; không gửi giữ ảnh đang lưu. Nếu gửi: JPEG/PNG/WebP không rỗng, tối đa 2 MiB (2097152 byte), ảnh giải mã tối đa 20 megapixel. Backend kiểm nội dung khớp MIME, áp EXIF orientation, crop cover thành WebP tĩnh 256×256 chất lượng 80, bỏ metadata; PNG/WebP động lấy frame đầu.',
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
      description: 'Yêu cầu access JWT hợp lệ và tài khoản đang ACTIVE. Chỉ trả id/email/name/avatar/role hiện tại của tài khoản đó; tên/ảnh đọc từ database, không lấy từ JWT. Avatar null trong DB dùng ảnh mặc định chung. Body/query không được dùng.',
      security: [{ bearerAuth: [] }],
      responses: {
        ...parserResponses,
        '200': {
          description: 'Thông tin user hiện tại có name/avatar, không có message/status/passwordHash.',
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
      summary: 'Cập nhật tên và avatar của tài khoản đang đăng nhập',
      description: [
        'Yêu cầu access JWT hợp lệ và tài khoản ACTIVE; chỉ cập nhật tài khoản được middleware xác thực. TEACHER và ADMIN cùng dùng API này, không lấy ID từ client.',
        'JSON application/json chỉ nhận name bắt buộc, trim còn 1–150 Unicode code point; avatar/URL hoặc field lạ trong JSON trả 400.',
        'Multipart/form-data nhận name dạng text và tối đa một file avatar, cả hai optional nhưng phải có ít nhất một. Không gửi field nào thì giữ nguyên field đó; name không được rỗng và file không được rỗng.',
        'Ảnh JPEG/PNG/WebP tối đa 2 MiB, ảnh giải mã tối đa 20 megapixel; kiểm nội dung khớp MIME, EXIF orientation, crop cover thành WebP tĩnh 256×256 chất lượng 80 và bỏ metadata. PNG/WebP động lấy frame đầu.',
        'Chỉ sửa tên không cần Cloudinary. Khi có ảnh, upload trước rồi ghi các field đã gửi trong một lần cập nhật DB; lỗi validation/Cloudinary không lưu tên hoặc ảnh mới.',
        'Ghi ảnh kiểm snapshot avatar và tài khoản ACTIVE; xung đột ảnh trả 409 để tải lại. Cập nhật tên riêng đồng thời không gây xung đột với upload chỉ ảnh; request có cả tên/ảnh ghi cả hai field đã gửi.',
        'Không đổi email, role, status, mật khẩu, ownership, access token hoặc refresh cookie. Response có id/email/name/avatar/role; avatar null trong DB dùng URL ảnh chung.',
        'Tài khoản mất trả 401, PENDING trả 403. Chỉ request có ảnh mới cần cấu hình dịch vụ (503) hoặc có thể lỗi upload (502). Lỗi lưu/đối soát ảnh 500: đọc lại GET /auth/me để biết thông tin đang lưu. Query không được dùng.',
      ].join(' '),
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: schemaRef('AuthUpdateProfileRequest'),
            example: { name: 'Nguyễn Văn An' },
          },
          'multipart/form-data': {
            schema: schemaRef('AuthUpdateProfileMultipartRequest'),
            encoding: { avatar: { contentType: 'image/jpeg, image/png, image/webp' }, name: { contentType: 'text/plain' } },
          },
        },
      },
      responses: {
        ...parserResponses,
        '200': {
          description: 'Các field đã gửi được lưu; field bỏ qua giữ nguyên, không cấp token/cookie mới.',
          content: {
            'application/json': {
              schema: schemaRef('AuthUpdateProfileResponse'),
              examples: {
                nameOnly: { value: { success: true, message: 'Cập nhật thông tin tài khoản thành công', data: { user: { ...publicUserExample, name: 'Nguyễn Văn An' } } } },
                nameAndAvatar: {
                  value: {
                    success: true,
                    message: 'Cập nhật thông tin tài khoản thành công',
                    data: { user: { ...publicUserExample, name: 'Nguyễn Văn An', avatar: 'https://res.cloudinary.com/example/image/upload/avatar-example.webp' } },
                  },
                },
              },
            },
          },
        },
        '400': {
          description: 'Body/name không hợp lệ hoặc thiếu cả tên/ảnh có errors. Multipart/file/JSON parser sai không có errors.',
          content: {
            'application/json': {
              schema: { oneOf: [schemaRef('AuthUpdateProfileValidationError'), schemaRef('AuthError')] },
              examples: {
                unknownJsonField: { value: { success: false, message: 'Thông tin tài khoản không hợp lệ', errors: [{ field: 'body', message: 'Unrecognized key: "avatar"' }] } },
                invalidName: { value: { success: false, message: 'Thông tin tài khoản không hợp lệ', errors: [{ field: 'name', message: 'Tên không được để trống' }] } },
                emptyMultipart: { value: { success: false, message: 'Thông tin tài khoản không hợp lệ', errors: [{ field: 'body', message: 'Cần gửi name hoặc một file avatar' }] } },
                emptyFile: errorExample('Vui lòng gửi một file avatar'),
                malformedMultipart: errorExample('Dữ liệu cập nhật tài khoản không hợp lệ'),
                extraField: errorExample('Chỉ gửi field name và một file avatar'),
                invalidImage: errorExample('File ảnh không hợp lệ'),
                mimeMismatch: errorExample('Nội dung file không khớp định dạng ảnh'),
                malformedJson: errorExample('Body JSON không hợp lệ'),
              },
            },
          },
        },
        '401': bearerUnauthorized,
        '403': accountPending,
        '409': errorResponse('Avatar thay đổi trong lúc upload/ghi; tải lại hồ sơ rồi thử lại.', {
          changedAvatar: errorExample('Avatar đã thay đổi, vui lòng tải lại và thử lại'),
        }),
        '413': errorResponse('File avatar vượt 2 MiB; JSON body quá giới hạn parser chung cũng có thể trả 413 trước auth.', {
          tooLargeAvatar: errorExample('Ảnh không được vượt quá 2 MiB'),
          tooLargeJson: errorExample('Body JSON vượt quá giới hạn cho phép'),
        }),
        '415': errorResponse('Chỉ nhận JSON hoặc multipart/form-data; MIME ảnh không hỗ trợ hoặc lỗi charset/encoding parser.', {
          wrongContentType: errorExample('Cập nhật tài khoản phải dùng application/json hoặc multipart/form-data'),
          unsupportedImage: errorExample('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP'),
          unsupportedEncoding: errorExample('Charset hoặc encoding của body không được hỗ trợ'),
        }),
        '500': errorResponse('Không thể lưu/đối soát ảnh hoặc lỗi máy chủ; đọc GET /auth/me để biết thông tin đang lưu.', {
          saveError: errorExample('Không thể lưu thông tin tài khoản'),
          serverError: errorExample('Lỗi máy chủ'),
        }),
        '502': errorResponse('Cloudinary upload thất bại; không lưu tên/ảnh mới và không trả raw provider error/credentials.', {
          uploadFailed: errorExample('Không thể upload avatar, vui lòng thử lại'),
        }),
        '503': errorResponse('Request có ảnh nhưng backend chưa được cấu hình đủ Cloudinary; không lưu tên/ảnh mới. Request chỉ tên vẫn hoạt động.', {
          notConfigured: errorExample('Dịch vụ avatar chưa được cấu hình'),
        }),
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
