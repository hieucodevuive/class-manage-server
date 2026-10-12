# Tên hiển thị của tài khoản

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
`/api/auth/me` gồm đúng `id`, `email`, `name`, `role`. Danh sách đăng ký chờ
thêm `status`, `createdAt`; response duyệt thêm `status`.

## PATCH /api/auth/me

Đổi tên của chính tài khoản đã đăng nhập, yêu cầu Bearer access token và
trạng thái ACTIVE. Backend lấy ID từ `res.locals.auth.userId`; không có ID
trong path, body chỉ có name và query không được dùng để chọn tài khoản.
TEACHER và ADMIN dùng cùng cách gọi cho hồ sơ của mình.

### Request

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

Body strict, chỉ có một field bắt buộc `name`:

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
  "message": "Cập nhật tên thành công",
  "data": {
    "user": {
      "id": 42,
      "email": "teacher@example.com",
      "name": "Nguyễn Minh Anh",
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
   tổng 30 operation trên 17 path. PATCH dùng lại path `/auth/me` của GET.
2. Trong project frontend `class-manage`, chạy `npm run api:generate` để sinh
   lại `types/generated/api.ts`; giữ file generated là output của generator.
3. Gửi `{ name }` qua service dùng API client hiện có. Thành công thì cập
   nhật state/cache hồ sơ từ `data.user`, hoặc đọc lại GET `/api/auth/me`.
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

Avatar chưa được triển khai: chưa có column User.avatar/Avatar URL, API upload
hoặc field avatar trong PATCH. FE có thể dùng một ảnh mặc định chung ở giao
diện. Cloudinary là gợi ý cho bước lưu ảnh sau này; chưa cấu hình dịch vụ,
upload hoặc lưu ảnh tài khoản trong bước đổi tên này.
