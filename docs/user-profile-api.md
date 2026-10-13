# Hồ sơ tài khoản: tên và avatar

User có trường `name` để hiển thị tên giáo viên/ADMIN. Đây là tên tài khoản,
khác với `Class.name` và `Student.fullName`.

## Dữ liệu và tên ban đầu

- `User.name` là PostgreSQL `TEXT NOT NULL`, không có default trong SQL.
- Migration `20261012110000_add_user_name` đã được áp dụng. Người dùng đã
  duyệt backfill: mỗi tài khoản có sẵn nhận `name = email`
  bằng đúng email đang lưu. Migration thêm cột, cập nhật các hàng hiện có,
  rồi đặt NOT NULL.
- API register và seed tạo tài khoản mới gán tên bằng email được lưu.
  Register vẫn chỉ nhận email/password; đổi tên sau khi tài khoản được duyệt.
- Seed giáo viên/ADMIN gặp tài khoản đã có sẽ giữ tên hiện tại. Chạy lại seed
  không thay tên người dùng đã cập nhật.
- Giới hạn 1–150 bên dưới áp dụng cho PATCH tên. Cột TEXT không tự cắt email
  dài hơn giới hạn đó trong lúc backfill hoặc tạo tên ban đầu.

Public User của register, login, refresh, GET `/api/auth/me` và PATCH
`/api/auth/me` gồm đúng `id`, `email`, `name`,
`avatar`, `role`. `avatar` luôn là URL ảnh riêng hoặc ảnh mặc định chung.
Danh sách đăng ký chờ
thêm `status`, `createdAt`; response duyệt thêm `status`.

## PATCH /api/auth/me

Đổi tên, avatar hoặc cả hai của chính tài khoản đã đăng nhập, yêu cầu Bearer access token và
trạng thái ACTIVE. Backend lấy ID từ `res.locals.auth.userId`; không có ID
trong path và query không được dùng để chọn tài khoản.
TEACHER và ADMIN dùng cùng cách gọi cho hồ sơ của mình.

| Cách gửi | Field được nhận | Yêu cầu |
| --- | --- | --- |
| `application/json` | `name` | `name` bắt buộc; body strict, không nhận avatar/URL ảnh |
| `multipart/form-data` | `name` dạng Text, `avatar` dạng File | Mỗi field optional; phải gửi ít nhất một, tối đa một file |

Field không gửi giữ nguyên. Endpoint avatar riêng đã được gộp; dùng một
PATCH `/api/auth/me` cho mọi thay đổi hồ sơ.

### JSON: chỉ đổi tên

```http
PATCH /api/auth/me
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "name": "  Nguyễn Minh Anh  "
}
```

Với JSON, body strict và chỉ có một field bắt buộc `name`:

| Điều kiện | Kết quả |
| --- | --- |
| Chuỗi được trim còn từ 1 đến 150 Unicode code points | Hợp lệ |
| Thiếu field, null, số, object, chuỗi rỗng/chỉ khoảng trắng hoặc quá dài | 400 |
| Có thêm field như avatar, email, role, status, id hoặc password | 400 |

Zod đang dùng đếm Unicode code points sau trim, tương đương
`Array.from(name.trim()).length`. Ví dụ `😀` là một code point. Emoji ghép
bằng ZWJ hoặc chữ có dấu kết hợp có thể gồm nhiều code points dù hiển thị
thành một ký tự. Tên không có yêu cầu unique.

### Thành công — 200

```json
{
  "success": true,
  "message": "Cập nhật thông tin tài khoản thành công",
  "data": {
    "user": {
      "id": 42,
      "email": "teacher@example.com",
      "name": "Nguyễn Minh Anh",
      "avatar": "http://localhost:5000/api/assets/default-avatar.svg",
      "role": "TEACHER"
    }
  }
}
```

Response `data.user` không trả password/hash, trạng thái tài khoản hoặc
timestamps. Đổi tên không cấp token/cookie mới; access JWT hiện chỉ mang
User ID/role. JWT còn hạn tiếp tục dùng được. GET `/api/auth/me`, login và
refresh đọc lại tên đang lưu trong DB.

### Lỗi

| HTTP | Message/phạm vi |
| --- | --- |
| 400 | `Thông tin tài khoản không hợp lệ`, kèm `errors: [{field, message}]`; lỗi tên dùng field `name`, lỗi toàn body/field lạ dùng `body` |
| 400 | JSON sai cú pháp/null bị parser từ chối: `Body JSON không hợp lệ`, không có errors validation |
| 401 | `Thiếu access token`, `Access token không hợp lệ hoặc đã hết hạn`, hoặc `Tài khoản không còn tồn tại` |
| 403 | `Tài khoản đang chờ duyệt` |

Tài khoản không còn tồn tại được xử lý 401, kể cả mất giữa bước middleware
và bước cập nhật; endpoint này không trả 404. Lỗi parser 413/415 và CORS giữ
cách xử lý chung hiện có.

## Cập nhật frontend

1. Tải contract mới từ `/api/docs/openapi.json`; Swagger có 8 API Auth và
   tổng 30 operation trên 17 path. PATCH `/auth/me` dùng lại path của GET,
   với cả JSON và multipart trong requestBody.
2. Trong project frontend `class-manage`, chạy `npm run api:generate` để sinh
   lại `types/generated/api.ts`; giữ file generated là output của generator.
3. Chỉ tên: gửi JSON `{ name }`. Có ảnh: gửi FormData `avatar` và tùy chọn
   `name` qua cùng service/API client hiện có. Thành công cập nhật state/cache
   từ `data.user`, hoặc đọc lại GET `/api/auth/me`.
4. Login/refresh cũng trả User có name; cập nhật cả token và User khi refresh
   thành công. Không cần tạo refresh request riêng sau PATCH tên.

## Triển khai migration

Cột mới bắt buộc phải được triển khai cùng code ghi/đọc `name`:

1. Dừng server đang chạy và cập nhật bộ code gồm migration, Prisma schema,
   Auth, seed, OpenAPI và tests mới.
2. Áp dụng migration đã chuẩn bị bằng
   `npx prisma migrate deploy --config prisma7.config.ts`. Migration dùng
   backfill email đã được người dùng duyệt, không cần nhập tên từng tài khoản.
3. Chạy `npx prisma generate --config prisma7.config.ts`, kiểm tra TypeScript
   và các test phù hợp; khởi động lại server sau khi DB/client/code đồng bộ.
4. Sinh lại type frontend từ OpenAPI mới rồi cập nhật phần hiển thị hồ sơ.

### Kết quả kiểm tra

Migration `20261012110000_add_user_name` đã chạy bằng migrate deploy,
Prisma Client đã generate, validate và migrate status đạt (11 migration).
Postflight xác nhận cột TEXT, NOT NULL, không default và 3 User có sẵn có
name = email sau backfill.

TypeScript src và kiểm tra riêng Auth/E2E/Docs/hai seed đạt. Các bộ đã chạy:
Auth 6/6, E2E 1/1, Class 2/2, schema Schedule 1/1, schema Payment 1/1,
Docs 1/1; tổng 12/12 đạt, không fail/skipped/cancelled trong lượt chạy cuối.
Test profile kiểm tra quyền A/B/ADMIN/PENDING, strict body, trim/Unicode,
giữ dữ liệu tài khoản khác và tên mới trong GET me/login/refresh với phiên cũ.
Chưa chạy lại toàn bộ bộ test module; chi tiết và giới hạn typecheck rộng
ở mục 16 `docs/backend-status-report.md`. Không reset DB hoặc chạy seed.

## Avatar

### Schema đã chuẩn bị (2026-10-12)

- Đã thêm `User.avatar` kiểu `String? @db.Text`, tương ứng PostgreSQL
  `TEXT NULL`, để lưu URL ảnh riêng của tài khoản. Không có SQL default,
  index hoặc bảng ảnh mới.
- Migration `20261012120000_add_user_avatar` chỉ thêm cột nullable. Đã áp
  dụng bằng migrate deploy trước khi generate lại Prisma Client; cột optional
  tương thích với code tạo tài khoản chưa gửi avatar.
- Cả 3 tài khoản đang có giữ `avatar = null`. Đã kiểm tra dữ liệu User trước/
  sau migration: các trường ngoài avatar được giữ nguyên, gồm tên đã đổi,
  email, ID, mật khẩu, quyền, trạng thái và timestamps.
- `null` nghĩa là chưa có ảnh riêng. Public response dùng một ảnh mặc định
  chung; không chép URL ảnh mặc định vào từng hàng.

Ở cuối bước database này, public User vẫn chỉ có `id`, `email`, `name`,
`role`; contract còn 30 operation trên 17 path. Bước upload dưới đây mới
bổ sung `avatar` vào response. Contract hiện tại đã gộp upload và tên vào
PATCH `/api/auth/me`; kết quả từng bước trước vẫn được giữ riêng.

Kết quả kiểm tra bước schema avatar được ghi riêng trong
`docs/backend-status-report.md`, không dùng kết quả name để xác nhận upload.
Prisma validate/generate, TypeScript src và migrate status (12 migration)
đạt; probe Client ghi/đọc URL/null trong transaction rollback đạt.
Auth 6/6 và Docs 1/1 đạt, tổng hồi quy 7/7. Upload và ảnh mặc định thực tế
chưa được triển khai/kiểm tra ở bước database này.

### Ảnh mặc định và public response

- Khi `User.avatar = null`, backend trả một URL ảnh mặc định chung ở field
  `avatar`, không lưu URL mặc định vào từng hàng User.
- Asset mặc định được phục vụ công khai tại
  `GET /api/assets/default-avatar.svg`; đây là file ảnh, không phải API
  nghiệp vụ được tính vào 30 operation Swagger.
- Có thể đặt `PUBLIC_API_ORIGIN` thành origin công khai của backend để tạo
  URL asset tuyệt đối, ví dụ `https://api.example.com`. `DEFAULT_AVATAR_URL`
  dùng để chọn URL ảnh mặc định khác khi cần. Ở local, backend dùng origin
  localhost theo `PORT` khi chưa đặt origin riêng. Production phải có
  `PUBLIC_API_ORIGIN` hoặc `DEFAULT_AVATAR_URL`; dùng URL HTTP/HTTPS,
  `PUBLIC_API_ORIGIN` chỉ chứa origin, không thêm path/query/fragment.
- Register/login/refresh/GET me/PATCH hồ sơ trả cùng public User
  5 field. Danh sách chờ và duyệt vẫn giữ các field quản trị bổ sung đã có.

### Multipart: đổi tên, avatar hoặc cả hai

Gửi tới cùng `PATCH /api/auth/me`. Backend lấy ID từ
`res.locals.auth.userId`; TEACHER và ADMIN đều chỉ sửa hồ sơ của mình.

| Request | Quy tắc |
| --- | --- |
| Content-Type | `multipart/form-data`, client tự thêm boundary |
| Field tên | `name` dạng Text, optional; nếu gửi phải trim còn 1–150 Unicode code points |
| Field ảnh | `avatar` dạng File, optional; tối đa một file, không nhận URL/Text |
| Ít nhất một field | Gửi name, avatar hoặc cả hai; không gửi cả hai trả 400 |
| Loại ảnh | JPEG (`image/jpeg`), PNG (`image/png`) hoặc WebP (`image/webp`) |
| Kích thước file | Tối đa 2 MiB = 2.097.152 byte |
| Ảnh giải mã | Tối đa 20 megapixel; backend xác nhận định dạng thật khớp MIME |

Backend giải mã ảnh bằng Sharp, xử lý thành ảnh WebP kích thước 256×256
rồi upload qua Cloudinary. Ảnh được xoay theo EXIF orientation, crop `cover`,
chất lượng WebP 80 và bỏ metadata. PNG/WebP động dùng frame đầu, kết quả
là ảnh tĩnh. API không nhận URL ảnh qua JSON hoặc text field.

Chỉ có tên thì không cần Cloudinary. Khi có ảnh, backend upload trước rồi
lưu URL ảnh cùng tên đã gửi trong **một lần cập nhật DB**. File/validation,
Cloudinary lỗi 502 hoặc thiếu cấu hình 503 không làm đổi tên hay ảnh đang
lưu. Nếu bỏ qua name hoặc avatar thì field đó giữ nguyên; muốn đổi tên
cùng ảnh, gửi cả hai trong cùng FormData.

#### Thử bằng Postman

1. Chọn `PATCH http://localhost:5000/api/auth/me`.
2. Authorization → Bearer Token: dùng access token của tài khoản ACTIVE.
3. Body → **form-data**. Có thể thêm key `name` kiểu **Text**, key `avatar`
   kiểu **File** rồi chọn ảnh JPEG/PNG/WebP hợp lệ. Gửi ít nhất một field;
   bỏ key không muốn thay đổi, không gửi field rỗng để giữ nguyên.
4. Xóa header `Content-Type: application/json` đã đặt thủ công nếu có.
   Để Postman tự tạo `multipart/form-data` kèm boundary, rồi Send.
5. Lấy URL từ `data.user.avatar`, hoặc gọi GET `/api/auth/me` để đọc lại.

Thành công trả 200:

```json
{
  "success": true,
  "message": "Cập nhật thông tin tài khoản thành công",
  "data": {
    "user": {
      "id": 42,
      "email": "teacher@example.com",
      "name": "Nguyễn Minh Anh",
      "avatar": "https://res.cloudinary.com/example/image/upload/avatar-example.webp",
      "role": "TEACHER"
    }
  }
}
```

URL trong ví dụ chỉ minh họa; response thật dùng URL ảnh vừa upload.
Upload không cấp access token hoặc refresh cookie mới. FE cập nhật hồ sơ
từ toàn bộ `data.user`; phiên đăng nhập hiện có tiếp tục dùng được.

#### Mã lỗi cập nhật hồ sơ

Lỗi nghiệp vụ/parser dùng `{ "success": false, "message": "..." }`.
Lỗi validation còn có `errors: [{field, message}]`; không trả credentials
hoặc lỗi thô từ Cloudinary:

| HTTP | Message/phạm vi |
| --- | --- |
| 400 | `Thông tin tài khoản không hợp lệ`: name/body sai, JSON thiếu name hoặc multipart thiếu cả hai field; có errors |
| 400 | `Vui lòng gửi một file avatar`: file được gửi nhưng rỗng |
| 400 | `Dữ liệu cập nhật tài khoản không hợp lệ`: multipart/boundary sai |
| 400 | `Chỉ gửi field name và một file avatar`: field/file thêm, avatar Text hoặc sai tên |
| 400 | `File ảnh không hợp lệ`: không giải mã được hoặc ảnh vượt giới hạn pixels |
| 400 | `Nội dung file không khớp định dạng ảnh`: ảnh thật khác MIME gửi lên |
| 401 | Theo auth; gồm `Tài khoản không còn tồn tại` nếu tài khoản mất trong lúc xử lý |
| 403 | `Tài khoản đang chờ duyệt` |
| 409 | `Avatar đã thay đổi, vui lòng tải lại và thử lại`: snapshot ảnh đổi trong lúc upload/ghi |
| 413 | `Ảnh không được vượt quá 2 MiB` |
| 415 | `Cập nhật tài khoản phải dùng application/json hoặc multipart/form-data` hoặc `Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP` |
| 500 | `Không thể lưu thông tin tài khoản`: lỗi lưu/đối soát database; đọc GET me để xác nhận thông tin hiện tại |
| 502 | `Không thể upload avatar, vui lòng thử lại`: lỗi upload Cloudinary |
| 503 | `Dịch vụ avatar chưa được cấu hình`: request có ảnh và thiếu cấu hình Cloudinary; chỉ tên không cần cấu hình |

Lỗi JSON parser chung vẫn có thể trả 400/413/415 trước middleware auth.
Backend kiểm lại tài khoản và snapshot ảnh khi ghi; xung đột trả 409 để
FE tải lại hồ sơ rồi gửi lại. API không có version/precondition từ client
để phát hiện một hồ sơ đã cũ từ lần tải trước.

Cập nhật chỉ tên đồng thời với cập nhật chỉ ảnh không xung đột theo snapshot
avatar. Request có cả hai field sẽ ghi cả hai giá trị đã gửi; request khác
vẫn có thể đổi tên tiếp sau đó. Response dùng hồ sơ backend xác nhận được.

Sau khi xác thực và kiểm multipart/MIME/kích thước, service kiểm cấu hình
Cloudinary trước khi giải mã ảnh. Thiếu cấu hình sẽ trả 503 ở bước này.
Nếu không xác nhận được kết quả ghi DB sau lỗi kết nối, backend giữ ảnh
candidate để tránh xóa ảnh có thể đã được dùng; FE đọc lại GET me sau 500.

#### Frontend dùng FormData

`file` là đối tượng `File` lấy từ input chọn ảnh. Service gửi tới backend:

```typescript
const formData = new FormData();
if (name !== undefined) formData.append('name', name);
if (file) formData.append('avatar', file);

const response = await fetch(`${apiBaseUrl}/auth/me`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${accessToken}` },
  body: formData,
});
const result = await response.json();
if (!response.ok) throw new Error(result.message);
const user = result.data.user;
```

Để trình duyệt tự tạo `Content-Type` và boundary khi gửi FormData theo
[hướng dẫn FormData của MDN](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest_API/Using_FormData_Objects). Nếu API
client hiện tại mặc định gắn `application/json`, bỏ header đó cho request
upload. Với Axios, gửi cùng FormData và Bearer token qua client hiện có.
FE không cần Cloudinary API secret hoặc gọi trực tiếp Cloudinary.

#### Cấu hình Cloudinary cho backend

1. Tạo tài khoản tại [Cloudinary](https://cloudinary.com/users/register_free).
2. Trong Console của product environment, tìm Cloud Name và trang API Keys
   để lấy API Key/API Secret. [Hướng dẫn cấu hình Node.js của Cloudinary](https://cloudinary.com/documentation/node_integration)
   mô tả ba giá trị cấu hình này.
3. Điền các giá trị **trong `.env` local của backend** vào
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
   rồi khởi động lại server. Không gửi các giá trị này vào chat hoặc đưa
   API secret vào frontend/repository.
4. Khi đủ cấu hình, dùng Postman hoặc Swagger để upload file thử như trên.

Ba biến Cloudinary là optional để backend/Auth vẫn chạy khi chưa cấu hình.
Upload thiếu cấu hình trả 503. Test upload dùng provider mock để kiểm tra
luồng API; kết quả mock không xác nhận ảnh đã được upload lên tài khoản
Cloudinary thật. Kết quả kiểm tra Cloudinary thực tế và các bộ test của
lượt upload được ghi riêng trong `docs/backend-status-report.md`.

Các lệnh kiểm tra của lượt này: `npx tsc --noEmit`, `npm run test:docs`,
`npm run test:auth`, `npm run test:avatar` và `npm run test:e2e`. Auth/Avatar/E2E
dùng fixture riêng và dọn dữ liệu của chính test; Docs chỉ đọc HTTP/contract,
không ghi DB. Chạy các bộ test DB lần lượt.
