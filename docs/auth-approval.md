# Đăng ký và duyệt tài khoản giáo viên

Luồng hiện tại: giáo viên đăng ký → tài khoản `PENDING` → ADMIN duyệt → tài khoản `ACTIVE` và đăng nhập được. Tài khoản ADMIN được tạo bằng lệnh nội bộ; API đăng ký công khai không thể tạo ADMIN.

## Tạo ADMIN lần đầu

Đặt `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD` (ít nhất 12 ký tự) trong môi trường riêng rồi chạy `npm run seed:admin`. Script `prisma/seed-admin.ts` không đổi role/status của tài khoản đã tồn tại và không in mật khẩu. Đừng commit thông tin đăng nhập.

Ví dụ PowerShell, nhập mật khẩu qua lời nhắc thay vì ghi vào lịch sử lệnh:

```powershell
$env:SEED_ADMIN_EMAIL = 'admin@example.com'
$adminPassword = Read-Host 'Mật khẩu ADMIN (ít nhất 12 ký tự)' -AsSecureString
$env:SEED_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminPassword).Password
npm run seed:admin
Remove-Item Env:\SEED_ADMIN_EMAIL, Env:\SEED_ADMIN_PASSWORD
```

## Các API

| API | Quyền | Kết quả chính |
| --- | --- | --- |
| `POST /api/auth/register` | Công khai | Tạo `TEACHER/PENDING`, trả `201`, không cấp token/cookie |
| `POST /api/auth/login` | Công khai | `PENDING` trả `403`; `ACTIVE` đăng nhập như trước |
| `GET /api/auth/registrations/pending` | Access token ADMIN | Danh sách giáo viên `PENDING`, cũ nhất trước |
| `PATCH /api/auth/registrations/:id/approve` | Access token ADMIN | Chuyển đúng một giáo viên `PENDING` sang `ACTIVE` |

Đăng ký nhận JSON `{"email":"teacher@example.com","password":"mật khẩu ít nhất 12 ký tự"}`. Email được chuẩn hóa về chữ thường; login chấp nhận cách nhập chữ hoa/thường của tài khoản mới. Mật khẩu tối đa 72 byte theo giới hạn của bcrypt. Client không được gửi `role` hoặc `status`. Email trùng, kể cả chỉ khác chữ hoa/thường, trả `409`. Response đăng ký chứa `data.user.id`, dùng ID này để duyệt.

ADMIN đăng nhập bằng `POST /api/auth/login`, lấy `data.accessToken` và gửi header `Authorization: Bearer <accessToken>` khi gọi hai API quản trị. Danh sách chờ trả `data.users`, mỗi mục có `id`, `email`, `role`, `status`, `createdAt`; không trả mật khẩu hoặc hash. Duyệt thành công trả `200` với `data.user` gồm `id`, `email`, `role`, `status`. ID sai định dạng trả `400`, ID không thuộc giáo viên cần duyệt trả `404`, tài khoản đã duyệt trả `409`. Thiếu token trả `401`, tài khoản không phải ADMIN trả `403`.

Sau khi được duyệt, giáo viên gọi lại `POST /api/auth/login` để lấy access token và refresh cookie. Không có email thông báo tự động; ADMIN hoặc giao diện cần thông báo cho giáo viên theo cách đang sử dụng.

Chạy `npm run test:auth` để kiểm tra luồng trên database hiện tại. Test chỉ tạo rồi xóa các tài khoản fixture riêng của nó; không tạo ADMIN sử dụng thật.

## Refresh và logout

| API | Dữ liệu xác thực | Kết quả |
| --- | --- | --- |
| `POST /api/auth/refresh` | Cookie `refreshToken` | Token hợp lệ và User ACTIVE: 200, access token và refresh cookie mới |
| `POST /api/auth/logout` | Cookie `refreshToken`, nếu có | 200, thu hồi phiên tương ứng và xóa cookie |
| `GET /api/auth/me` | Bearer access token | Trả public user của tài khoản đã xác thực |

- Refresh không yêu cầu Bearer token. Cookie thiếu/rỗng, token sai/đã dùng/
  hết hạn hoặc User PENDING trả 401; không cấp hoặc xóa cookie ở response lỗi.
- Mỗi lần login tạo một phiên riêng. Refresh đổi hash trên cùng bản ghi và
  đặt cookie mới; cookie cũ không dùng lại được. Cookie dùng Path `/api/auth`,
  HttpOnly, SameSite=Lax, Secure khi production; thời hạn được cấu hình 7 ngày.
- Logout chỉ xóa phiên khớp cookie gửi lên, giữ các phiên khác kể cả cùng User.
  Gọi lại, thiếu/rỗng hoặc cookie sai vẫn trả 200 và cookie rỗng có ngày hết hạn
  trong quá khứ. Frontend cần xóa access token đang giữ sau khi logout.
- Access JWT có hạn 15 phút; logout không thu hồi JWT đã cấp. Nếu User vẫn
  ACTIVE, JWT còn hạn vẫn dùng được. Đây là hành vi của luồng hiện tại.

### Kiểm tra đã chạy (2026-10-10)

`npm run test:auth` đạt **5/5** trên PostgreSQL, gồm ba test đăng ký/duyệt/trạng
thái và hai test mới:

- `tests/auth.refresh.integration.test.ts`: cookie thiếu/rỗng/sai/hết hạn,
  rotation, hash/ID/createdAt, replay, hai request song song một 200/một 401,
  cookie thắng vẫn refresh được, access token dùng được qua `/me`.
- `tests/auth.logout.integration.test.ts`: A có hai phiên, B có một phiên;
  logout A1 thu hồi đúng phiên, A2/B giữ nguyên và refresh được. Kiểm tra cookie
  bị xóa, gọi lại/thiếu/rỗng/sai cookie và access JWT còn hạn sau logout.

TypeScript cho src và kiểm tra riêng hai file test mới đều đạt. Test tạo/dọn
RefreshToken và User theo ID fixture, đóng server và ngắt Prisma; không sửa
tài khoản sử dụng thật. Các assertion token/hash/cookie dùng thông báo cố định
để tránh in giá trị nhạy cảm khi kiểm tra thất bại.

Giới hạn: test kiểm tra cookie/DB cùng thời hạn và còn hạn, chưa kiểm tra chính
xác khoảng 7 ngày hoặc chạy riêng cấu hình production. Hai request refresh
được gửi song song, chưa ép chúng cùng đọc một snapshot. Chưa test ACTIVE
chuyển PENDING sau khi đã cấp token hoặc refresh chạy đồng thời với logout.
Theo truy vấn hiện có, nếu refresh đã đổi token trước khi logout dùng cookie
cũ, logout không thu hồi token mới; chưa có chính sách thu hồi cả chuỗi token.
Lượt bổ sung test giữ nguyên luồng authentication.
