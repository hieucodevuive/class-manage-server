# Payment — schema học phí theo tháng

Mỗi Payment lưu khoản học phí của một Enrollment trong một tháng. Enrollment
xác định học sinh và lớp; một Enrollment có nhiều Payment ở các tháng khác nhau.

## Model và quan hệ

Giữ naming convention hiện tại: bảng vật lý `"Payment"`, cột camelCase.
Tên logic trong thiết kế là `payments`; `classStudentId` tương ứng
`class_student_id`, tham chiếu bảng Enrollment vật lý `"ClassStudent"`.

| Trường Prisma/DB | Kiểu PostgreSQL | Quy tắc |
| --- | --- | --- |
| `id` | UUID | Khóa chính; Prisma tạo UUID khi insert |
| `classStudentId` | UUID | Bắt buộc; FK đến `"ClassStudent"."id"` |
| `billingPeriod` | DATE | Bắt buộc; ngày đầu tháng, ví dụ `2026-10-01` |
| `amountDue` | NUMERIC(12,2) | Bắt buộc, không âm; lưu số tiền phải thu của kỳ này |
| `amountPaid` | NUMERIC(12,2) | Bắt buộc, không âm; default 0 |
| `paidAt` | TIMESTAMPTZ(3) | Nullable |
| `paymentMethod` | enum `PaymentMethod` | Nullable; `CASH`, `BANK_TRANSFER`, `OTHER` |
| `note` | TEXT | Nullable |
| `createdAt` | TIMESTAMPTZ(3) | Bắt buộc; default thời điểm tạo |
| `updatedAt` | TIMESTAMPTZ(3) | Bắt buộc; Prisma tự cập nhật khi ghi |

- Quan hệ ClassStudent 1:N Payment qua `classStudentId`; relation trong Payment
  là `enrollment`, trong ClassStudent là `payments`. Hai relation này không tạo
  thêm cột trong bảng Payment.
- Quyền sở hữu được xác định qua Payment → ClassStudent → Class → `teacher_id`.
  POST Payment kiểm tra đường quan hệ này và Student cùng giáo viên theo
  `res.locals.auth.userId`, cả khi đọc lẫn khi connect để ghi. Schema không có
  `teacherId`, `classId` hoặc `studentId` trên Payment.
- `amountDue` là số tiền được lưu tại thời điểm tạo khoản học phí. POST nhận
  giá trị nhập hoặc lấy từ học phí lớp nếu không gửi `amountDue`. Database không có
  default lấy từ Class hay trigger đồng bộ: sửa `Class.tuitionFee` không đổi
  Payment cũ. PATCH có thể điều chỉnh `amountDue` riêng của khoản, không lấy
  lại mức học phí Class và không sửa các khoản khác.
- Tiền dùng Prisma Decimal. CHECK chặn số âm và NaN; giới hạn lớn nhất
  `9999999999.99` là giới hạn sẵn có của NUMERIC(12,2).
- CHECK kỳ học phí yêu cầu ngày hữu hạn và ngày trong tháng bằng 1. Việc chuẩn
  hóa dữ liệu nhập về ngày đầu tháng được xử lý ở API tạo Payment.
- Unique index `Payment_classStudentId_billingPeriod_key` đảm bảo mỗi Enrollment
  chỉ có một khoản trong cùng kỳ. Cột đầu của index là `classStudentId`, nên
  index này cũng phục vụ truy vấn theo khóa ngoại; không tạo index trùng chức năng.
- FK dùng `ON DELETE RESTRICT`: không thể xóa Enrollment đã có Payment. Các FK
  Class/Student → Enrollment hiện có cũng dùng RESTRICT, tiếp tục bảo vệ lịch sử.
  `ON UPDATE CASCADE` giữ khóa ngoại đồng bộ nếu khóa chính Enrollment thay đổi.
- Nghỉ lớp vẫn chuyển Enrollment sang `LEFT`, giữ nguyên Payment. Schema không
  lưu payment status tính được hay thêm bảng lịch sử giao dịch thanh toán.

## Migration

Migration: `20261006154547_create_payment_model`.

- Tạo enum, bảng có đúng 10 cột, ba CHECK, unique index và FK trong transaction.
- Chỉ thêm cấu trúc mới; không backfill, đổi ID, rename bảng/cột hoặc reset database.
- Áp dụng sau khi các migration trước đã hoàn thành và bảng Payment/enum
  PaymentMethod chưa tồn tại. Không bổ sung cột bắt buộc vào các bảng đang được
  API hiện tại sử dụng.
- Sau migration, generate Prisma Client để dùng model và relation mới.

```text
npx prisma validate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
npx tsc --noEmit
npm run test:payments:schema
npm run test:enrollments
```

Test schema dùng PostgreSQL thật: kiểm tra kiểu cột/default, enum, CHECK,
unique/index/FK, đường quan hệ giáo viên và việc thay đổi học phí/nghỉ lớp không
đổi Payment. Dữ liệu thử của test schema nằm trong transaction và được rollback.
Test Enrollment kiểm tra Prisma ghi/đọc Payment và API nghỉ lớp/xóa Class/Student
giữ lịch sử; chỉ tạo và dọn dữ liệu thử riêng. Chạy các bộ test database lần lượt.

## Kết quả bước schema (2026-10-10)

- Migration đã áp dụng; database có đủ 10 migration, Prisma báo schema đã cập
  nhật. Prisma Client đã generate.
- Prisma validate và TypeScript đều đạt.
- `test:payments:schema`: 1/1 đạt trên PostgreSQL; dữ liệu thử được rollback.
  Đã kiểm tra kiểu/default/enum, tiền âm/NaN/vượt giới hạn, kỳ không hợp lệ,
  trùng kỳ, khóa ngoại, đường quan hệ giáo viên, snapshot và bảo vệ lịch sử.
- `test:enrollments`: 3/3 đạt trên PostgreSQL. Test nghỉ lớp đã bổ sung Payment
  qua Prisma để kiểm tra UUID, DATE, Decimal, default và relation `payments`.
  Nghỉ lớp giữ Payment; DELETE Class/Student trả 409 và Payment vẫn nguyên vẹn.
  Dữ liệu thử của test API đã được dọn.
- Chưa triển khai API Payment trong bước schema này.

Đã có `POST /api/payments`, `GET /api/payments`, `GET /api/payments/:id`
và `PATCH /api/payments/:id`;
request, response và kết quả kiểm tra ở `docs/payment-api.md`. GET thêm trạng
thái tính được trong response; danh sách lọc theo Class/Student/kỳ/trạng thái.
Schema giữ nguyên. Khoản học phí 0 xếp `PAID` theo phương án đã duyệt;
không thêm cột status vào database.
PATCH dùng tổng `amountPaid`, tự tính `paidAt`, kiểm tra ownership và dữ liệu
đã đọc ngay trong truy vấn ghi; không cần migration mới.
