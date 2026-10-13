# Swagger và hướng dẫn kết nối Auth cho frontend

## Mở tài liệu

Chạy backend bằng `npm run dev`, rồi mở `/api/docs` trên cùng host/cổng backend.
Với backend chạy cổng 5000:

- Swagger UI: `http://localhost:5000/api/docs/`.
- OpenAPI JSON: `http://localhost:5000/api/docs/openapi.json`.

Trang tài liệu mô tả toàn bộ **30 API hiện có**, trên **17 path OpenAPI**:

| Nhóm | Số API | Hướng dẫn |
| --- | --- | --- |
| Auth / AuthAdmin | 8 | [auth-approval.md](auth-approval.md), [user-profile-api.md](user-profile-api.md) |
| Classes | 5 | [class-api.md](class-api.md) |
| Students | 5 | [student-api.md](student-api.md) |
| Enrollments | 3 | [enrollment-api.md](enrollment-api.md) |
| ClassSchedules | 5 | [class-schedule-api.md](class-schedule-api.md) |
| Payments | 4 | [payment-api.md](payment-api.md) |

OpenAPI dùng server `/api`, nên các request thử đi tới đúng backend đang mở,
không bị cố định vào cổng 5000.

## Đọc và gọi thử trong Swagger

1. Mở một API để xem body/path, trường bắt buộc, response và mã lỗi.
2. Chọn **Try it out**, sửa dữ liệu mẫu rồi chọn **Execute**.
3. Đăng nhập bằng `/auth/login`. Response thành công có `data.accessToken`;
   trình duyệt nhận cookie `refreshToken` qua `Set-Cookie`.
4. Chọn **Authorize** → `bearerAuth`, nhập access token vừa nhận, không thêm
   tiền tố `Bearer`. Sau đó gọi `/auth/me`, các nhóm API nghiệp vụ hoặc API quản trị.
5. `/auth/refresh` và `/auth/logout` dùng cookie trình duyệt nhận từ login;
   không nhập cookie thủ công trong Authorize và không gửi token trong body.
   Sau refresh, dùng access token mới từ response để cập nhật bearerAuth.
6. Sau logout, bỏ token trong Authorize. Reload trang cũng bỏ Bearer đã nhập;
   cookie HttpOnly vẫn theo trạng thái phiên của backend/trình duyệt.

Trang docs chạy cùng origin backend và bật `withCredentials`. Trình duyệt
vẫn áp dụng Path/SameSite/Secure của cookie; Swagger không thể tự đặt header
Cookie thủ công. Trong production, cookie Secure yêu cầu HTTPS. Đăng ký,
duyệt và logout trong **Try it out** gọi API thật và có tác động như gọi từ FE.

Các giá trị email/password/ID/token trong tài liệu là ví dụ. Thay bằng dữ liệu
thử của bạn khi Execute; không ghi thông tin đăng nhập hoặc token thật vào
file tài liệu.

## Luồng frontend

| Bước | API | Cách xử lý |
| --- | --- | --- |
| Đăng ký | `POST /api/auth/register` | Gửi email/password. 201 nghĩa là TEACHER/PENDING, chưa có token/cookie |
| Chờ duyệt | Login trả 403 khi mật khẩu đúng và User PENDING | Hiển thị thông báo chờ ADMIN duyệt |
| ADMIN xem đăng ký | `GET /api/auth/registrations/pending` | Bearer token của ADMIN ACTIVE; dùng `data.users` |
| ADMIN duyệt | `PATCH /api/auth/registrations/:id/approve` | Không cần body; ID User là số nguyên, lấy từ danh sách đăng ký |
| Đăng nhập | `POST /api/auth/login` | Gửi email/password; giữ `data.accessToken` và `data.user` trong trạng thái ứng dụng |
| Lấy User | `GET /api/auth/me` | Gửi `Authorization: Bearer <accessToken>` |
| Đổi tên/ảnh | `PATCH /api/auth/me` | Bearer token; JSON name hoặc multipart name Text/avatar File, ít nhất một field |
| Làm mới phiên | `POST /api/auth/refresh` | Trình duyệt gửi cookie; cập nhật access token và User từ response |
| Đăng xuất | `POST /api/auth/logout` | Trình duyệt gửi cookie; xóa access token/User đang giữ trên FE |

Register luôn tạo TEACHER/PENDING, không nhận role/status. ADMIN chỉ duyệt
tài khoản; các API nghiệp vụ vẫn giới hạn dữ liệu của chính người đăng nhập.
Chi tiết nghiệp vụ và giới hạn phiên hiện có ở [auth-approval.md](auth-approval.md).

### Hồ sơ và type frontend

`data.user` của register/login/refresh/GET `/auth/me` và PATCH `/auth/me`
có `id`, `email`, `name`, `avatar`, `role`.
`avatar` luôn là URL ảnh riêng hoặc URL ảnh mặc định chung khi DB null.
Register vẫn chỉ nhận email/password, tên ban
đầu lấy từ email. Danh sách đăng ký chờ thêm `status`, `createdAt`; response
duyệt thêm `status`.

PATCH `/auth/me` nhận hai kiểu body: JSON chỉ có `name` bắt buộc hoặc
multipart có `name` dạng Text và tối đa một file `avatar`, mỗi field optional
nhưng phải có ít nhất một. Tên trim rồi kiểm 1–150 Unicode code points,
tương đương `Array.from(name.trim()).length`; field không gửi giữ nguyên.
Thành công trả message `Cập nhật thông tin tài khoản thành công` và User
hiện tại ở `data.user`. Không cần refresh phiên riêng để lấy hồ sơ mới;
API không đổi JWT/cookie. Chi tiết ở [user-profile-api.md](user-profile-api.md).

Trong PATCH `/auth/me`, chọn **Try it out** và content type
`multipart/form-data`, điền name hoặc chọn file trong field avatar rồi
Execute với Bearer token. Chấp nhận
JPEG/PNG/WebP tối đa 2 MiB; backend kiểm nội dung ảnh/20 megapixel, xử lý
WebP 256×256 và upload Cloudinary. Không nhập URL qua JSON hoặc gửi kèm
field khác. Có ảnh thì upload trước rồi ghi tên/ảnh đã gửi trong một lần DB;
lỗi ảnh/Cloudinary giữ cả hai field đang lưu. Request chỉ tên không cần
Cloudinary; request có ảnh thiếu cấu hình trả 503, lỗi upload trả 502.
Trong FE, dùng FormData và để browser tự tạo Content-Type/boundary.

Ảnh chung ở `/api/assets/default-avatar.svg` là asset công khai, không
tính vào operation Swagger. Có thể cấu hình URL mặc định/origin backend;
cách chuẩn bị Cloudinary local và thử Postman ở
[user-profile-api.md](user-profile-api.md).

Sau khi backend/OpenAPI được cập nhật và phục vụ contract mới, chạy
`npm run api:generate` trong project frontend `class-manage` để sinh lại
`types/generated/api.ts`. Không sửa tay file generated. Cập nhật service/
state sử dụng public User mới và response của PATCH; refresh thành công cũng
nên thay User đang giữ bằng `data.user`. Việc sinh type không tự nối API với
màn hình hồ sơ.

### Fetch mẫu cho FE

`apiBaseUrl` là địa chỉ backend theo môi trường của FE, ví dụ
`http://localhost:5000/api` ở local. Email/password do người dùng nhập vào form.

```typescript
const response = await fetch(`${apiBaseUrl}/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const result = await response.json();

if (!response.ok) {
  // Hiển thị result.message; register còn có result.errors theo field.
  throw new Error(result.message);
}

const accessToken = result.data.accessToken;
const user = result.data.user;
```

Login, refresh và logout cần [`credentials: 'include'`](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials) khi FE khác origin;
nếu dùng Axios thì cấu hình [`withCredentials: true`](https://axios.rest/pages/advanced/request-config#withcredentials). Backend hiện chỉ cho
origin cấu hình ở `FRONTEND_ORIGIN` và bật CORS credentials. Dùng cùng hostname
ở local (ví dụ đều localhost), vì cookie gắn với host và còn chịu SameSite.
FE không đọc refresh token HttpOnly từ JavaScript; browser quản lý cookie.

Khi access token hết hạn, gọi refresh một lần cho các request đang chờ,
để tránh gửi nhiều request refresh song song với cùng cookie. Refresh thành
công thì cập nhật token và thử lại request cần xác thực một lần. Refresh 401
thì quay về đăng nhập; 403 từ API có Bearer cần xử lý theo message/quyền hoặc
trạng thái tài khoản. Access token hết hạn sau 15 phút; refresh cookie có hạn
7 ngày và được đổi mỗi lần refresh. Logout chỉ thu hồi phiên khớp cookie,
JWT còn hạn vẫn theo chính sách hiện tại, nên FE phải bỏ access token.

## Cập nhật tài liệu

- `src/docs/auth.openapi.ts`: mô tả 8 API Auth, public User có name/avatar, một PATCH hồ sơ nhận JSON/multipart.
- `src/docs/class.openapi.ts`: mô tả 5 API CRUD Class, tiền/ngày và ownership.
- `src/docs/student.openapi.ts`: mô tả 5 API CRUD Student, trường nullable và ownership.
- `src/docs/enrollment.openapi.ts`: mô tả 3 API ghi danh/nghỉ lớp, Student lồng nhau và bảo vệ lịch sử.
- `src/docs/schedule.openapi.ts`: mô tả 5 API lịch học, định dạng giờ và ownership qua Class.
- `src/docs/payment.openapi.ts`: mô tả 4 API học phí, bộ lọc, Decimal, snapshot và tổng đã thu.
- `src/docs/openapi.ts`: thông tin API, server, security schemes và lỗi chung.
- `src/docs/docs.route.ts`: phục vụ JSON, Swagger UI và assets.
- Đọc route, Zod schema, controller/serializer trước khi sửa docs. Schema mô
  tả dữ liệu API nhận/trả, không lấy nguyên model database làm response.
- Khi đổi contract Auth, cập nhật OpenAPI/guide và chạy `npm run test:docs`,
  `npm run test:auth`, TypeScript.
- Khi đổi API nghiệp vụ, cập nhật OpenAPI/guide tương ứng, chạy TypeScript,
  `npm run test:docs` và bộ integration test của module đó.

Swagger dùng assets local, tắt validator online và không lưu Bearer qua reload.
Test docs kiểm tra schema/$ref và HTTP, không tạo dữ liệu thử hoặc ghi DB.

Nguồn tham khảo: [Swagger UI Express](https://github.com/scottie1984/swagger-ui-express),
[cấu hình Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/),
[cookie authentication](https://swagger.io/docs/specification/v3_0/authentication/cookie-authentication/).
