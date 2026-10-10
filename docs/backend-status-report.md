# Báo cáo backend Class Management

Ngày kiểm tra: **2026-10-10**. Báo cáo đối chiếu code hiện tại và kết quả chạy
test trong lượt tổng kiểm tra sau khi người dùng chọn giữ mọi Payment và lượt
sửa lỗi parser/CORS, bổ sung test logout/refresh và test luồng nghiệp vụ tiếp theo.
Kết quả chạy lại toàn bộ bộ test sau các thay đổi này ở mục 10.

## 1. Kết quả tổng kiểm tra trước sửa middleware

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `npx --no-install tsc --noEmit` | Đạt, không có lỗi TypeScript trong phạm vi `src/**/*` |
| `npx --no-install prisma validate --config prisma7.config.ts` | Schema Prisma hợp lệ |
| `npx --no-install prisma migrate status --config prisma7.config.ts` | Có 10 migration; database báo đã cập nhật |
| Các test API hiện có | 22/22 đạt trên PostgreSQL |
| Hai test schema Schedule/Payment | 2/2 đạt trên PostgreSQL |
| Tổng cộng | **24/24 test đạt; 0 fail, 0 skipped, 0 cancelled** |

Tám script được chạy lần lượt; các file trong từng script dùng cách chạy hiện
có của Node test runner. Đây là 24 test ở cấp cao nhất trong 22 file, mỗi test
chứa nhiều tình huống và assertion, không phải chỉ 24 request HTTP.

| Script đã chạy | Đạt / Tổng | Phạm vi chính |
| --- | --- | --- |
| `npm run test:auth` | 3/3 | Đăng ký PENDING, chặn sử dụng trước duyệt, ADMIN duyệt và login sau duyệt |
| `npm run test:classes` | 2/2 | CRUD, validation, quyền A/B, giữ trường PATCH, chặn xóa khi có Enrollment |
| `npm run test:students` | 5/5 | CRUD, quyền A/B, UUID, validation và bảo vệ Enrollment |
| `npm run test:enrollments` | 3/3 | Ghi danh, danh sách, nghỉ lớp, unique và giữ Payment/lịch sử |
| `npm run test:schedules` | 5/5 | Năm API, ownership lớp cha, thứ tự ngày/giờ và cập nhật đồng thời |
| `npm run test:payments` | 4/4 | Snapshot, lọc AND, chi tiết, tổng tiền/paidAt và xung đột PATCH |
| `npm run test:schedules:schema` | 1/1 | UUID, enum, TIME, CHECK, index, CASCADE lịch và RESTRICT Enrollment |
| `npm run test:payments:schema` | 1/1 | DATE/Decimal/default, CHECK, unique, FK và giữ lịch sử |

Các script trả exit code 0. Kết quả lấy từ tổng kết cuối của test runner,
không chỉ từ các dòng log PASS bên trong test.

Ngoài bộ test hiện có, bốn request thử lỗi đọc body đã xác nhận hai vấn đề
ở middleware chung: một số lỗi client bị trả 500 và response lỗi thiếu CORS
headers. Kết quả khắc phục ở mục 7; 24/24 test ban đầu không bao phủ các lỗi này.

### Dữ liệu thử

- Test API tạo fixture có tên/email riêng, dọn theo ID hoặc tài khoản fixture
  đã tạo, đóng server và ngắt Prisma trong `finally`.
- Payment được dọn trước Enrollment; Enrollment trước Class/Student và User.
  Schedule fixture được dọn trực tiếp hoặc qua Class fixture.
- Hai test schema dùng transaction và rollback dữ liệu thử.
- Ngoại lệ: test Class CRUD đầu tiên cần một tài khoản ACTIVE đã có. Nó đọc
  ID/role tài khoản này để tạo token và lớp thử; không sửa/xóa tài khoản đó.
  Chỉ các lớp đã track và tài khoản B thử mới được dọn.
- Lượt này không reset database, seed tài khoản hoặc áp dụng migration mới.

## 2. Kiến trúc và mô hình sử dụng

- Express 5, TypeScript/CommonJS, PostgreSQL, Prisma và Zod.
- Luồng xử lý: route → controller → service → repository → Prisma.
- API dùng prefix `/api`; module nằm trong `src/modules`.
- Nhiều giáo viên dùng độc lập. Mỗi User có lớp và hồ sơ học sinh riêng.
  Không có Organization, bảng teachers hoặc lớp do nhiều giáo viên cùng quản lý.
- Một người học với hai giáo viên được quản lý bằng hai hồ sơ Student riêng.

## 3. Các bảng và quan hệ

Code hiện có **7 model ứng dụng**; tên bảng vật lý theo Prisma:

| Bảng | ID | Trường lưu chính |
| --- | --- | --- |
| `User` | Int tự tăng | id, email, passwordHash, role, status, createdAt, updatedAt |
| `RefreshToken` | Int tự tăng | id, tokenHash, expiresAt, createdAt, userId |
| `Class` | Int tự tăng | id, teacher_id, name, grade, schoolYear, subject, tuitionFee, startDate, endDate, status, note, createdAt, updatedAt |
| `Student` | UUID | id, teacher_id, fullName, phone, parentName, parentPhone, school, grade, dateOfBirth, address, status, note, createdAt, updatedAt |
| `ClassStudent` (Enrollment) | UUID | id, classId, studentId, joinedAt, leftAt, status, createdAt, updatedAt |
| `ClassSchedule` | UUID | id, classId, dayOfWeek, startTime, endTime, createdAt, updatedAt |
| `Payment` | UUID | id, classStudentId, billingPeriod, amountDue, amountPaid, paidAt, paymentMethod, note, createdAt, updatedAt |

Ngoài ra Prisma có bảng kỹ thuật `_prisma_migrations` để theo dõi migration.
Tên logic trong thiết kế là users/classes/students/class_students/
class_schedules/payments; code giữ convention bảng trên, không đổi tên hàng loạt.
`teacherId` trong Prisma ánh xạ xuống cột `teacher_id` ở Class và Student.

```mermaid
erDiagram
    User ||--o{ Class : owns
    User ||--o{ Student : owns
    User ||--o{ RefreshToken : has
    Class ||--o{ ClassSchedule : has
    Class ||--o{ ClassStudent : has
    Student ||--o{ ClassStudent : enrolls
    ClassStudent ||--o{ Payment : has
```

- Class và Student nhiều–nhiều qua ClassStudent. Student không có classId.
- Enrollment lưu ngày vào/nghỉ và trạng thái ACTIVE/LEFT của một cặp lớp–học sinh.
- Payment thuộc Enrollment. Không lưu teacherId, studentId hoặc classId trực
  tiếp trên Payment; Schedule/Enrollment cũng không có teacherId.
- Unique `(classId, studentId)` chỉ cho một Enrollment mỗi cặp, kể cả đã LEFT.
  Hiện chưa có luồng ghi danh lại cùng cặp; POST lại trả 409.
- Unique `(classStudentId, billingPeriod)` chỉ cho một Payment mỗi tháng.
- Tiền nghiệp vụ dùng Decimal/NUMERIC(12,2), không âm. Kỳ học phí và ngày học
  dùng DATE; giờ lịch dùng TIME; timestamps nghiệp vụ dùng TIMESTAMPTZ.
- Không lưu tuổi, studentCount hoặc payment status tính được thành cột.

Chi tiết thiết kế ở [system-design.md](system-design.md),
[payment-schema.md](payment-schema.md) và
[class-schedule-schema.md](class-schedule-schema.md).

## 4. API hiện có

Có **29 cặp phương thức/đường dẫn** được đăng ký trong router hiện tại:
7 Auth + 5 Class + 5 Student + 3 Enrollment + 5 Schedule + 4 Payment.

### Authentication — 7 API

| Phương thức | Đường dẫn | Logic/quyền |
| --- | --- | --- |
| POST | `/api/auth/register` | Công khai; email/password hợp lệ tạo TEACHER/PENDING, không cấp token |
| POST | `/api/auth/login` | Kiểm tra mật khẩu và ACTIVE; trả access token, đặt refresh cookie |
| POST | `/api/auth/refresh` | Dùng refresh cookie hợp lệ và tài khoản ACTIVE; đổi refresh token |
| POST | `/api/auth/logout` | Xóa refresh token tương ứng nếu có, clear cookie |
| GET | `/api/auth/me` | Bearer token; trả tài khoản đã xác thực |
| GET | `/api/auth/registrations/pending` | Chỉ ADMIN ACTIVE xem giáo viên chờ duyệt |
| PATCH | `/api/auth/registrations/:id/approve` | Chỉ ADMIN ACTIVE chuyển TEACHER/PENDING sang ACTIVE; duyệt trùng 409 |

Đăng ký không nhận role/status từ client. Password được hash; RefreshToken lưu
hash token. Refresh cookie dùng httpOnly, path `/api/auth`, sameSite lax,
secure trong production. Logout thu hồi refresh token tương ứng; access token
đã cấp tiếp tục theo hạn JWT và điều kiện middleware hiện có.

ADMIN được xem/duyệt yêu cầu tài khoản; các API dữ liệu lớp/học sinh/học phí
vẫn giới hạn theo chủ sở hữu. Không có quyền quản trị xuyên dữ liệu giáo viên.
Tạo ADMIN là lệnh seed nội bộ riêng, không phải API đăng ký công khai.

Chi tiết ở [auth-approval.md](auth-approval.md).

### Class — 5 API

| Phương thức | Đường dẫn | Logic |
| --- | --- | --- |
| POST | `/api/classes` | Backend gán teacherId từ người đăng nhập; lưu đủ trường Class |
| GET | `/api/classes` | Danh sách lớp riêng, createdAt rồi id giảm dần |
| GET | `/api/classes/:id` | Tìm đồng thời ID lớp và teacherId |
| PATCH | `/api/classes/:id` | Sửa các trường cho phép; giữ trường không gửi; không đổi chủ sở hữu |
| DELETE | `/api/classes/:id` | Chỉ xóa hẳn khi chưa có Enrollment; đã có ACTIVE/LEFT thì 409 |

Class dùng Int ID; validation schoolYear/grade/tiền/ngày theo nghiệp vụ hiện có.
Trường client ngoài schema bị loại bỏ; teacherId luôn do backend quyết định.
Sửa tuitionFee không ghi đè amountDue Payment cũ.
Chi tiết ở [class-api.md](class-api.md).

### Student — 5 API

| Phương thức | Đường dẫn | Logic |
| --- | --- | --- |
| POST | `/api/students` | Tạo hồ sơ riêng, teacherId từ auth, mặc định ACTIVE |
| GET | `/api/students` | Chỉ trả hồ sơ của người đăng nhập |
| GET | `/api/students/:id` | UUID và teacherId cùng khớp |
| PATCH | `/api/students/:id` | Sửa các trường hợp lệ, hỗ trợ null ở trường nullable, giữ chủ sở hữu |
| DELETE | `/api/students/:id` | Chỉ xóa khi chưa có Enrollment; có lịch sử ACTIVE/LEFT thì 409 |

Student là hồ sơ độc lập. Không nhận classId/teacherId để gán lớp/chủ sở hữu.
Chi tiết ở [student-api.md](student-api.md).

### Enrollment — 3 API

| Phương thức | Đường dẫn | Logic |
| --- | --- | --- |
| POST | `/api/classes/:classId/students` | Body studentId/joinedAt; kiểm tra cả hai chủ sở hữu; tạo ACTIVE |
| GET | `/api/classes/:classId/students` | Trả ACTIVE/LEFT cùng hồ sơ Student trong phạm vi |
| DELETE | `/api/classes/:classId/students/:studentId` | Chuyển sang LEFT và lưu ngày UTC hiện tại; giữ bản ghi/lịch sử |

DELETE này là nghỉ lớp. Gọi lại giữ nguyên ngày nghỉ; joinedAt trong tương
lai không thể cho nghỉ trước ngày vào. POST trùng cặp, kể cả LEFT, trả 409.
Chi tiết ở [enrollment-api.md](enrollment-api.md).

### Schedule — 5 API

| Phương thức | Đường dẫn | Logic |
| --- | --- | --- |
| POST | `/api/classes/:classId/schedules` | Tạo dayOfWeek/startTime/endTime trên lớp thuộc tài khoản |
| GET | `/api/classes/:classId/schedules` | Sắp thứ MONDAY–SUNDAY rồi giờ/ID |
| GET | `/api/classes/:classId/schedules/:scheduleId` | Kiểm tra ID lịch, lớp trong URL và chủ lớp |
| PATCH | `/api/classes/:classId/schedules/:scheduleId` | Ghép trường gửi với DB và kiểm tra endTime > startTime |
| DELETE | `/api/classes/:classId/schedules/:scheduleId` | Xóa hẳn lịch phù hợp, giữ lớp/ghi danh/học phí |

Giờ nhận HH:mm hoặc HH:mm:ss, trả HH:mm:ss. Hiện cho lịch trùng/giao nhau;
chưa có quy tắc chống trùng buổi. Chi tiết ở
[class-schedule-api.md](class-schedule-api.md).

### Payment — 4 API

| Phương thức | Đường dẫn | Logic |
| --- | --- | --- |
| POST | `/api/payments` | Tạo khoản tháng cho classStudentId; chuẩn hóa ngày về đầu tháng |
| GET | `/api/payments` | Lọc classId/studentId/billingPeriod/status bằng AND trong phạm vi |
| GET | `/api/payments/:id` | Chi tiết theo UUID và chủ sở hữu Class/Student qua Enrollment |
| PATCH | `/api/payments/:id` | Sửa amountDue/amountPaid/paymentMethod/note, tự xử lý paidAt |

- Không gửi amountDue khi POST thì lưu snapshot học phí Class được đọc.
  Trùng Enrollment/tháng trả 409, kể cả tạo đồng thời.
- amountPaid là **tổng đã thu**, thay thế giá trị cũ; không cộng thêm.
  Có thể sửa giảm hoặc trả thừa. Khi tổng dương phải có phương thức sau ghép.
- Status tính bằng Decimal: UNPAID (paid = 0, due > 0), PARTIAL
  (0 < paid < due), PAID (paid >= due, gồm 0/0).
- paidAt null khi chưa thu/thu thiếu; khi có thu và trả đủ giữ thời điểm đã
  có hoặc dùng thời điểm server. Khoản 0/0 thuộc PAID nhưng paidAt null.
- PATCH kiểm tra toàn bộ snapshot và ownership ngay trong truy vấn ghi;
  dữ liệu đổi trong khoảng đọc/ghi trả 409, ngoài quyền/mất bản ghi trả 404.
- POST trả 10 trường Payment; GET/PATCH trả thêm status tính được.
- **Quyết định A đã duyệt:** giữ mọi Payment, tạm chưa mở DELETE. Chỉnh sai
  bằng PATCH; không thêm trường hủy/soft delete hoặc lịch sử giao dịch.

Chi tiết ở [payment-api.md](payment-api.md) và
[payment-delete-proposal.md](payment-delete-proposal.md).

## 5. Quyền sở hữu và bảo vệ lịch sử

Mọi route nghiệp vụ yêu cầu Bearer token, tài khoản ACTIVE và role
TEACHER/ADMIN. Middleware xác minh JWT và kiểm tra trạng thái tài khoản trong
DB; controller lấy userId từ `res.locals.auth`.

| Tài nguyên | Điều kiện quyền sở hữu |
| --- | --- |
| Class/Student | ID bản ghi và teacherId cùng người đăng nhập |
| Schedule | ID lịch, classId và teacherId của Class cha |
| Enrollment | Class và Student cùng thuộc người đăng nhập |
| Payment | Qua Enrollment → Class, đồng thời Student cùng chủ sở hữu |

Các truy vấn đọc/sửa/xóa có điều kiện ownership. Khi tạo Schedule/Enrollment/
Payment, điều kiện chủ sở hữu cũng được kiểm tra lại ở connect. Danh sách
Enrollment chỉ lồng Student đúng phạm vi; Schedule/Payment không trả các bản
ghi cha của giáo viên khác. ID ngoài quyền dùng 404; bộ lọc danh sách Payment
ngoài phạm vi trả mảng rỗng.

FK Class/Student → Enrollment và Enrollment → Payment dùng RESTRICT.
Nghỉ lớp giữ Enrollment và Payment; lớp/học sinh không ACTIVE không tự làm
mất học phí lịch sử. ClassSchedule dùng CASCADE khi Class fixture/lớp chưa
có ghi danh được xóa; lịch không được dùng để cascade lịch sử tài chính.

Test thực tế đã kiểm tra nghỉ lớp giữ Payment, reverse relation và ngày nghỉ;
DELETE Class/Student trả 409 khi có Enrollment, Payment/Schedule còn nguyên;
snapshot Payment không đổi khi đổi học phí Class. Hai test schema cũng kiểm
tra FK RESTRICT và CASCADE trong transaction thử được rollback.

## 6. Phần chưa có và giới hạn kiểm chứng

### Chức năng hiện chưa triển khai

- Search/phân trang/total cho danh sách Class/Student/Enrollment/Schedule;
  Payment có bốn bộ lọc, chưa có phân trang/total hoặc tìm theo tên.
- Dashboard, export, bulk thao tác hoặc tự tạo học phí hàng loạt/theo lịch.
- Ghi danh lại cùng cặp Class–Student sau LEFT, chống trùng buổi học,
  lịch sử từng lần thu/chỉnh sửa hoặc hủy Payment.
- DELETE Payment được chủ động bỏ khỏi phạm vi cơ bản theo phương án A.

Đây là các phần ngoài phạm vi đã triển khai; chưa tự thêm API/model cho chúng.

### Coverage cần bổ sung khi tiếp tục

1. Đã có test HTTP xuyên suốt đăng ký → duyệt → login → tạo Class/Student
   → ghi danh → lịch → học phí → thu tiền → nghỉ lớp, kết quả ở mục 9.
   Đây là một kịch bản liên module với quyền A/B và lịch sử; không thay thế
   các test validation, lỗi hoặc cập nhật đồng thời riêng của từng module.
2. Auth đã có test logout, refresh, replay, expiry và hai request refresh
   song song ở mục 8. Chưa test tài khoản ACTIVE chuyển về PENDING sau khi đã
   được cấp token hoặc refresh chạy đồng thời với logout. Chưa ép hai request
   refresh cùng đọc một snapshot hoặc kiểm tra chính xác TTL 7 ngày.
3. Class CRUD đầu tiên ký token TEACHER/ADMIN cùng User ACTIVE có sẵn;
   chưa dùng tài khoản ADMIN DB riêng cho bộ CRUD đó. Student test chủ yếu
   dùng TEACHER A/B; chưa có ADMIN/PENDING riêng trên từng endpoint.
   Enrollment POST cũng chưa có ADMIN/PENDING fixture, list chưa có PENDING
   case riêng. Middleware chung đã được kiểm tra, không thay cho mọi case
   trên từng endpoint.
4. Test catalog/constraint riêng hiện có Schedule và Payment. Prisma validate
   kiểm tra schema khai báo; migrate status kiểm tra trạng thái migration.
   Lượt này chưa so sánh toàn bộ DB để phát hiện mọi loại schema drift.
5. TypeScript check của dự án chỉ gồm src; các file test chạy bằng tsx. Hai
   file Auth mới và file workflow đã được typecheck riêng ở mục 8–9; chưa
   có cấu hình typecheck áp dụng cho toàn bộ tests.

Giới hạn dữ liệu hiện tại: giữ bản ghi Payment không đồng nghĩa lưu từng giá
trị trước khi sửa. PATCH vẫn có thể ghi đè tổng tiền/note/paidAt. Kiểm tra
xung đột bảo vệ khoảng server đọc/ghi, chưa có version từ client để phát hiện
snapshot cũ từ lần tải trước.

## 7. Lỗi parser/CORS và kết quả khắc phục

Trước khi sửa, đã khởi chạy app trên cổng loopback tạm, gửi bốn request tới
`POST /api/auth/register` với Origin đã cấu hình và đóng server sau kiểm tra.
Các request bị chặn ở bước đọc body, không tạo tài khoản hoặc ghi dữ liệu.

| Request thử | HTTP trước sửa | HTTP sau sửa | CORS trước → sau |
| --- | --- | --- | --- |
| JSON sai cú pháp | 400 | 400 | Thiếu → Có |
| JSON lớn hơn giới hạn mặc định 100 KiB | 500 | 413 | Thiếu → Có |
| Content-Type có charset không hỗ trợ | 500 | 415 | Thiếu → Có |
| Content-Encoding không hỗ trợ | 500 | 415 | Thiếu → Có |

Hai lỗi đã xác nhận trong `src/app.ts` trước khi sửa:

1. Error handler chỉ xử lý riêng `entity.parse.failed` 400. Các lỗi parser
   `entity.too.large` 413, `charset.unsupported` 415 và `encoding.unsupported`
   415 bị chuyển thành response 500 chung.
2. `express.json()` chạy trước middleware CORS. Khi đọc body thất bại,
   Express đi thẳng tới error handler, bỏ qua CORS; frontend khác origin
   có thể không đọc được response lỗi dù origin đó đã được cho phép.

Đây là lỗi middleware chung, có thể ảnh hưởng các API nhận JSON khác. Bốn
request chẩn đoán ban đầu không được tính là bốn test trong bộ 24 test.

### Thay đổi đã áp dụng (2026-10-10)

- Đưa CORS lên trước `express.json()` và cookie parser, giữ origin cấu hình
  và credentials. Response lỗi parser có CORS headers; preflight kết thúc 204.
- Error handler kiểm tra cả type và status gốc để trả 400/413/415 cho bốn
  tình huống trên. Response vẫn là `{ success: false, message }`, dùng thông
  báo cố định; không trả hoặc log raw body trong các nhánh này. Lỗi khác
  tiếp tục dùng response 500 chung hiện có.
- Thêm `tests/http-parser.integration.test.ts` và script `npm run test:http`.
  Một test bao gồm bốn request lỗi, preflight, JSON hợp lệ bị validation 400,
  request Class thiếu token 401 và route không tồn tại 404. Mọi response
  được kiểm tra CORS; test không tạo fixture hoặc ghi database.

| Kiểm tra chạy sau sửa | Kết quả thực tế |
| --- | --- |
| `npx --no-install tsc --noEmit` | Đạt, không lỗi trong phạm vi src |
| `npm run test:http` | 1/1 đạt; tám request HTTP ở trên |
| `npm run test:auth` | 3/3 đạt trên PostgreSQL |
| `npm run test:classes` | 2/2 đạt trên PostgreSQL |

Ba script test sau sửa đạt **6/6**, exit code 0, không fail/skipped/cancelled.
Auth/Class vẫn kiểm tra đăng ký, duyệt, login/refresh, CRUD và quyền sở hữu A/B.
Không chạy lại toàn bộ tám script trong lượt sửa này; kết quả 24/24 ở mục 1
là của lượt tổng kiểm tra trước đó.

## 8. Bổ sung test phiên đăng nhập (2026-10-10)

- Thêm `tests/auth.refresh.integration.test.ts` và
  `tests/auth.logout.integration.test.ts`, mỗi file một test ở cấp cao nhất,
  timeout 30 giây. Script `npm run test:auth` bao gồm cả hai file mới.
- Refresh kiểm tra cookie thiếu/rỗng/sai/hết hạn trả 401 không đặt cookie;
  token mới/hash mới trên cùng ID, giữ createdAt, cookie/DB cùng thời hạn;
  replay token cũ bị từ chối mà không mất phiên hiện tại. Hai request song
  song cùng token trả một 200/một 401, cookie thắng tiếp tục sử dụng được.
- Logout kiểm tra hai phiên A và một phiên B: chỉ A1 bị xóa, A2/B giữ nguyên
  và refresh được. Cookie xóa đúng path/HttpOnly/SameSite/Secure theo môi
  trường; gọi lại/thiếu/rỗng/sai cookie vẫn 200 và clear cookie. Access JWT
  còn hạn của A1 vẫn dùng được qua `/me`, theo thiết kế stateless hiện có.
- Fixture có email riêng; chỉ dọn RefreshToken/User theo ID fixture trong
  `finally`, đóng server và ngắt Prisma. Assertions không in token/hash/cookie
  hoặc toàn response chứa dữ liệu nhạy cảm khi thất bại.

| Kiểm tra chạy trong lượt bổ sung test | Kết quả thực tế cuối cùng |
| --- | --- |
| `npx --no-install tsc --noEmit` | Đạt trong phạm vi src |
| Typecheck riêng hai file Auth mới | Đạt với target ES2020, CommonJS, strict, esModuleInterop, skipLibCheck |
| `npm run test:auth` | **5/5 đạt trên PostgreSQL**, exit code 0, không fail/skipped/cancelled |

Lần typecheck riêng đầu tiên phát hiện biến bản ghi có thể undefined trong
closure của test logout. Đã đổi sang helper kiểm tra tồn tại và trả bản ghi
đã xác định kiểu; typecheck và bộ Auth được chạy lại, đều đạt. Runtime Auth
không thay đổi. Lượt này không chạy lại toàn bộ các module hoặc migration.

Giới hạn từ rà soát code: logout dùng hash cookie để tìm phiên. Nếu refresh
đã đổi hash trước logout với cookie cũ, phiên mới không bị thu hồi; luồng hiện
tại chưa quản lý chuỗi token để thu hồi successor. Tình huống này chưa được
chạy thử trong lượt; không đổi chính sách logout/refresh hoặc thu hồi JWT.
Chi tiết cách dùng và giới hạn khác ở [auth-approval.md](auth-approval.md).

## 9. Test HTTP xuyên suốt nghiệp vụ (2026-10-10)

Thêm `tests/workflow.e2e.integration.test.ts` và script `npm run test:e2e`.
Một test ở cấp cao nhất chạy các request HTTP thật qua app Express và
PostgreSQL; các API/runtime hiện có giữ nguyên.

### Luồng và các assertion chính

- Tạo ADMIN fixture riêng trong DB; A/B đăng ký qua API, xác nhận TEACHER/
  PENDING không đăng nhập hoặc nhận token/cookie. ADMIN login qua API,
  xem đăng ký fixture và duyệt cả hai; A/B sau đó login và gọi `/me`.
  TEACHER bị chặn xem/duyệt đăng ký. Không seed hoặc sử dụng ADMIN thật.
- Mỗi giáo viên tạo Class/Student → Enrollment → Schedule → Payment qua
  HTTP. Cùng tên người học nhưng hai hồ sơ riêng. Gửi teacherId/teacher_id
  của tài khoản kia khi tạo không đổi chủ sở hữu; kiểm tra lại trong DB.
- Danh sách riêng Class/Student/Enrollment/Schedule/Payment trả đúng fixture
  của chủ sở hữu; Student lồng trong Enrollment đúng hồ sơ. Hai chiều A/B
  không đọc/sửa/xóa lớp, học sinh, lịch, không ghi danh/nghỉ lớp hoặc tạo/
  sửa/đọc học phí của nhau bằng ID. Bộ lọc Payment ngoài quyền trả mảng rỗng.
  Không ghi danh Student B vào Class A; ADMIN không đọc được Class A.
  Request không đăng nhập tới các danh sách nghiệp vụ trả 401.
- Payment chuẩn hóa kỳ về đầu tháng, mặc định chưa thu và snapshot học phí
  500000.00. Sửa Class thành 600000.00 không đổi khoản cũ. PATCH Class/
  Student kèm teacherId/teacher_id vẫn giữ ownership. Tạo trùng kỳ trả 409.
- Thu một phần 200000.00 → PARTIAL/paidAt null, rồi nhập tổng 500000.00
  → PAID; không cộng thành 700000.00. Phương thức BANK_TRANSFER giữ nguyên,
  paidAt thuộc khoảng thời gian request; lọc đồng thời bốn query trả khoản này.
- Nghỉ lớp chuyển Enrollment sang LEFT, ngày UTC của request, giữ ID/ngày
  vào/thời điểm tạo. Gọi lại giữ nguyên bản ghi; ghi danh lại cùng cặp 409.
  Xóa Class/Student có lịch sử trả 409; Enrollment, Schedule và Payment vẫn
  đọc được, khoản đã thu giữ nguyên. Toàn bộ nhánh dữ liệu B không bị đổi.

### Dữ liệu thử và kết quả thực tế

Fixture có ba email UUID riêng. `finally` tìm lại User bằng đúng các email
này, tìm Class/Student theo tài khoản fixture và Enrollment theo ID cha;
không chỉ dựa vào ID đọc được từ response. Nhờ đó vẫn dọn được khi POST đã
ghi DB trước lúc assertion thất bại. Thứ tự dọn: Payment → Enrollment →
Schedule → Class → Student → RefreshToken → User. Test kiểm tra các tài
khoản fixture đã được dọn, đóng server và ngắt Prisma. Không reset database.

Assertions Auth kiểm tra keys và dùng boolean cho dữ liệu nhạy cảm; không
in token/hash/cookie hoặc toàn response Auth khi test thất bại.

| Kiểm tra chạy trong lượt này | Kết quả thực tế |
| --- | --- |
| `npm run test:e2e` | **1/1 đạt trên PostgreSQL**, exit code 0, không fail/skipped/cancelled |
| `npx --no-install tsc --noEmit` | Đạt trong phạm vi src |
| Typecheck riêng file workflow | Đạt với target ES2020, CommonJS, strict, esModuleInterop, skipLibCheck |

Không chạy lại toàn bộ các bộ test trong lượt này. Test xuyên suốt không
bao phủ mọi validation, mọi role/status trên từng endpoint hoặc lỗi mạng/
production; các giới hạn Auth ở mục 6 và 8 vẫn còn.

## 10. Chạy lại toàn bộ bộ test (2026-10-10)

Theo yêu cầu `TESL ALL`, đã chạy lần lượt toàn bộ 10 script test trong
`package.json`. Đối chiếu inventory: 26 file test được tham chiếu đúng một
lần, không có file test hiện có bị bỏ sót.

| Script | Đạt / Tổng |
| --- | --- |
| `npm run test:http` | 1/1 |
| `npm run test:auth` | 5/5 |
| `npm run test:classes` | 2/2 |
| `npm run test:students` | 5/5 |
| `npm run test:enrollments` | 3/3 |
| `npm run test:schedules` | 5/5 |
| `npm run test:payments` | 4/4 |
| `npm run test:schedules:schema` | 1/1 |
| `npm run test:payments:schema` | 1/1 |
| `npm run test:e2e` | 1/1 |
| **Tổng** | **28/28** |

Tổng kết được cộng từ kết quả cuối của từng test runner: 28 pass, 0 fail,
0 skipped, 0 cancelled; cả 10 script đều trả exit code 0. Đây là 28 test
ở cấp cao nhất trong 26 file, mỗi test chứa nhiều request và assertion.
Các test API/schema có dùng DB được chạy trên PostgreSQL; test HTTP parser
không ghi database. Các script chạy tuần tự, các file trong từng script
tiếp tục dùng cách chạy hiện có của Node test runner.

| Kiểm tra bổ sung trong cùng lượt | Kết quả thực tế |
| --- | --- |
| `npx --no-install tsc --noEmit` | Đạt, không lỗi trong phạm vi `src/**/*` |
| `npx --no-install prisma validate --config prisma7.config.ts` | Schema hợp lệ |
| `npx --no-install prisma migrate status --config prisma7.config.ts` | 10 migration; database đã cập nhật |

Lượt này chỉ chạy kiểm tra và cập nhật báo cáo/tiến độ; không đổi source,
test hoặc script. Không reset database, chạy migration, seed ADMIN thật,
commit hoặc push. Test tiếp tục tạo/dọn fixture theo cách đã mô tả ở trên;
test schema dùng rollback. Kết quả đạt áp dụng cho các tình huống hiện có,
không bổ sung các case Auth còn thiếu ở mục 6 hoặc xác nhận mọi schema drift.

## 11. Kết luận và bước sau

Các API cơ bản của Auth, Class, Student, Enrollment, Schedule và Payment đã
có theo phạm vi trên. Lượt tổng kiểm tra đạt TypeScript, Prisma và 24/24 test
ban đầu. Hai lỗi parser/CORS phát hiện thêm đã được sửa và kiểm tra hồi quy
theo mục 7: TypeScript đạt, test HTTP/Auth/Class đạt 6/6. Lượt bổ sung test
phiên đăng nhập ở mục 8 đạt TypeScript cho src/hai file test mới và Auth 5/5.
Test xuyên suốt ở mục 9 đạt 1/1 và TypeScript src/file test mới đều đạt.
Các kết quả từng lượt được giữ riêng; lượt chạy lại toàn bộ sau khi thêm test
ở mục 10 đạt **28/28**, TypeScript/Prisma đạt và migration đã cập nhật.
Các giới hạn coverage ở mục 6 vẫn còn.

Đã chốt kết quả cho toàn bộ bộ test hiện có. Bước phát triển hoặc bổ sung
coverage tiếp theo do người dùng chọn. Nếu chuyển sang tính năng mới, cần
thống nhất từng API và tiếp tục kiểm tra ownership cho các chức năng danh
sách/tổng hợp.

Lượt tổng kiểm tra tạo báo cáo này; các lượt tiếp theo sửa middleware chung,
thêm test hồi quy, test phiên đăng nhập và test xuyên suốt, cập nhật tài liệu.
Tiến độ được ghi ở system-design.md.
Không triển khai endpoint mới, sửa schema hoặc đổi luồng authentication.
