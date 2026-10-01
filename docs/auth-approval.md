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
