# Báo cáo backend Class Management

Ngày tổng kiểm tra: **2026-10-10**; cập nhật tài khoản name/avatar: **2026-10-13**.
Báo cáo đối chiếu code hiện tại và kết quả chạy
test trong lượt tổng kiểm tra sau khi người dùng chọn giữ mọi Payment và lượt
sửa lỗi parser/CORS, bổ sung test logout/refresh và test luồng nghiệp vụ tiếp theo.
Kết quả chạy lại toàn bộ bộ test sau các thay đổi này ở mục 10.
Lượt thêm Swagger/tài liệu Auth và kiểm tra phù hợp được ghi riêng ở mục 11.
Lượt bổ sung Swagger cho 5 API Class được ghi ở mục 12.
Lượt bổ sung Swagger cho 5 API Student được ghi ở mục 13.
Lượt bổ sung Swagger cho 3 API Enrollment được ghi ở mục 14.
Lượt hoàn tất Swagger cho ClassSchedule và Payment được ghi ở mục 15.
Lượt bổ sung User.name và PATCH hồ sơ được ghi ở mục 16; kết quả kiểm tra
bước này được cập nhật riêng sau khi chạy.
Lượt chuẩn bị schema avatar User được ghi riêng ở mục 17; contract API giữ nguyên.
Lượt upload Cloudinary, ảnh mặc định và contract avatar được ghi ở mục 18.
Lượt gộp tên/avatar vào một API hồ sơ được ghi ở mục 19, thay contract hai API ở mục 18.

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
| `User` | Int tự tăng | id, email, name, avatar (nullable), passwordHash, role, status, createdAt, updatedAt |
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
`User.name` là TEXT NOT NULL, không có SQL default. Migration
`20261012110000_add_user_name` đã được áp dụng với backfill email cho User cũ
được người dùng duyệt; tài khoản mới do register/seed gán name = email.

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

Có **30 cặp phương thức/đường dẫn** được đăng ký trong router hiện tại,
không tính trang tài liệu, OpenAPI JSON, assets Swagger và ảnh mặc định:
8 Auth + 5 Class + 5 Student + 3 Enrollment + 5 Schedule + 4 Payment.
OpenAPI có 17 path; GET/PATCH hồ sơ dùng chung `/auth/me`.

### Authentication — 8 API

| Phương thức | Đường dẫn | Logic/quyền |
| --- | --- | --- |
| POST | `/api/auth/register` | Công khai; email/password hợp lệ tạo TEACHER/PENDING, không cấp token |
| POST | `/api/auth/login` | Kiểm tra mật khẩu và ACTIVE; trả access token, đặt refresh cookie |
| POST | `/api/auth/refresh` | Dùng refresh cookie hợp lệ và tài khoản ACTIVE; đổi refresh token |
| POST | `/api/auth/logout` | Xóa refresh token tương ứng nếu có, clear cookie |
| GET | `/api/auth/me` | Bearer token; trả tài khoản đã xác thực |
| PATCH | `/api/auth/me` | Bearer token, ACTIVE; cập nhật name, avatar hoặc cả hai của chính User; JSON đổi tên hoặc multipart name/file avatar |
| GET | `/api/auth/registrations/pending` | Chỉ ADMIN ACTIVE xem giáo viên chờ duyệt |
| PATCH | `/api/auth/registrations/:id/approve` | Chỉ ADMIN ACTIVE chuyển TEACHER/PENDING sang ACTIVE; duyệt trùng 409 |

Đăng ký không nhận role/status từ client. Password được hash; RefreshToken lưu
hash token. Refresh cookie dùng httpOnly, path `/api/auth`, sameSite lax,
secure trong production. Logout thu hồi refresh token tương ứng; access token
đã cấp tiếp tục theo hạn JWT và điều kiện middleware hiện có.
Public User của register/login/refresh/GET-PATCH `/me` có
id/email/name/avatar/role. Avatar luôn là URL ảnh riêng hoặc ảnh mặc định;
User.avatar trong DB vẫn nullable, không lưu URL mặc định cho từng User.
Pending list thêm status/createdAt, approve thêm status. PATCH hồ sơ không
cấp token hoặc đổi refresh/logout; sai body 400, User mất 401, PENDING 403.

ADMIN được xem/duyệt yêu cầu tài khoản; các API dữ liệu lớp/học sinh/học phí
vẫn giới hạn theo chủ sở hữu. Không có quyền quản trị xuyên dữ liệu giáo viên.
Tạo ADMIN là lệnh seed nội bộ riêng, không phải API đăng ký công khai.

Chi tiết ở [auth-approval.md](auth-approval.md) và
[user-profile-api.md](user-profile-api.md).

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
- Chưa có API xóa avatar/đặt lại ảnh mặc định; upload và ảnh mặc định đã có
  theo mục 18.

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

## 11. Swagger và OpenAPI cho Auth (2026-10-10)

Đã thêm Swagger UI tại `GET /api/docs/` và tài liệu JSON tại
`GET /api/docs/openapi.json`. OpenAPI 3.0.4 mô tả đúng 7 API Auth hiện có:
register, login, refresh, logout, me, danh sách PENDING và duyệt đăng ký.
Tài liệu gồm request/response, ví dụ, mã lỗi, quyền ADMIN/ACTIVE, Bearer token
và cookie refresh. Không thay đổi contract hay logic Auth/nghiệp vụ.

- `src/docs/auth.openapi.ts`: schema và operation Auth đối chiếu Zod,
  controller, service và middleware; giữ cấu trúc JSON thực tế.
- `src/docs/openapi.ts`: thông tin API, server `/api`, security schemes,
  response lỗi chung. Server tương đối dùng đúng host/cổng backend đang mở.
- `src/docs/docs.route.ts` và `src/app.ts`: phục vụ JSON, UI và assets local;
  bật credentials, không lưu Bearer qua reload, tắt validator online.
- `package.json`/lockfile: thêm Swagger UI, typings, validator phục vụ test
  và script `npm run test:docs`.
- `docs/swagger-auth.md`: cách thử API và hướng dẫn FE quản lý access token,
  HttpOnly cookie, CORS, refresh và logout theo hành vi hiện tại.

| Kiểm tra thực sự chạy trong lượt Swagger | Kết quả |
| --- | --- |
| TypeScript `src` và typecheck riêng test docs | Đều đạt |
| `npm run test:docs` | 1/1: OpenAPI/schema/$ref hợp lệ; JSON/UI/assets trả đúng; Auth, CORS, 404 được giữ |
| `npm run test:http` | 1/1 |
| `npm run test:auth` | 5/5 trên PostgreSQL |
| `npm run test:e2e` | 1/1 trên PostgreSQL |
| **Tổng các bộ vừa chạy** | **8/8; 0 fail/skipped/cancelled; exit code đều 0** |

Test docs không ghi DB; Auth/E2E dùng fixture và cleanup hiện có. Không chạy
lại toàn bộ 28 test trong lượt này; kết quả toàn bộ trước đó ở mục 10.
Chưa kiểm tra render/Try it out bằng trình duyệt: quyền mở địa chỉ preview
bị từ chối, nên không có kết luận kiểm chứng cookie từ trình duyệt thật.
Server preview riêng đã dừng. Sau lượt này Swagger chỉ bao phủ Auth; phần
Class được bổ sung trong lượt tiếp theo ở mục 12.

## 12. Bổ sung Swagger cho Class (2026-10-10)

Theo yêu cầu `Next`, đã thêm nhóm **Classes** cho đúng 5 API CRUD hiện có:
POST/GET `/api/classes` và GET/PATCH/DELETE `/api/classes/:id`.
Swagger tại `/api/docs/` và JSON `/api/docs/openapi.json` vào cuối lượt này có 12 operation
(7 Auth + 5 Class), trên 9 path. Các API ghi danh/lịch học nằm dưới Class
chưa nằm trong bước tài liệu này.

- `src/docs/class.openapi.ts`: body, schema response, ví dụ, mã lỗi và Bearer
  security; đối chiếu route, Zod, controller, serializer, service/repository,
  middleware và Prisma. ID Int, ownership theo người đăng nhập, ADMIN cũng
  chỉ quản lý lớp của chính mình; ngoài phạm vi trả 404.
- Phân biệt học phí number/string ở input với chuỗi Decimal 2 số lẻ ở
  response; response Class có 12 field và không có teacherId. Ngày học
  YYYY-MM-DD, timestamps ISO UTC; list data.classes không có pagination/count.
- POST có 6 field bắt buộc, status mặc định ACTIVE. PATCH cần ít nhất một
  field hợp lệ sau strip, giữ trường không gửi/status, chỉ endDate/note nhận
  null; ngày sau ghép với DB phải hợp lệ. Payload không đổi được ownership.
- DELETE có Enrollment ACTIVE/LEFT trả 409; lớp chưa có Enrollment được xóa
  hẳn cùng lịch học qua CASCADE. Đổi tuitionFee giữ snapshot Payment đã có.
- `src/docs/openapi.ts` ghép Class paths/schemas/tag vào tài liệu Auth.
  `docs/class-api.md` thêm cách dùng Swagger và sửa ghi chú cũ về response;
  `docs/swagger-auth.md` cập nhật phạm vi hiện có.
- `tests/docs.integration.test.ts` tiếp tục dùng 1 top-level test, mở rộng
  inventory, schema/response/nullable/security và 5 Class request thiếu token
  trả 401, đồng thời giữ kiểm tra Auth, assets local, CORS, 404 và $ref.

| Kiểm tra thực sự chạy trong lượt Class Swagger | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng test docs (ES2020/CommonJS/strict) | Đạt |
| `npm run test:docs` | 1/1; schema/$ref hợp lệ, HTTP JSON/UI/assets và contract Auth/Class đạt |
| `npm run test:classes` | 2/2 trên PostgreSQL; CRUD/validation/quyền A/B, PATCH và bảo vệ ghi danh đạt |
| **Tổng các bộ vừa chạy** | **3/3; 0 fail/skipped/cancelled; exit code đều 0** |

Test docs không ghi database. Test Class dùng tài khoản ACTIVE hiện có và
fixture riêng theo cơ chế cleanup hiện có; không reset database. Lượt này
chỉ bổ sung tài liệu và kiểm tra, không đổi API/runtime/schema/dependencies.
Không chạy lại toàn bộ bộ test; kết quả các lượt trước được giữ riêng.
Chưa kiểm tra render/Try it out trong trình duyệt do quyền mở preview đã bị
từ chối ở lượt trước. Bước Swagger tiếp theo là Student, chờ xác nhận.

## 13. Bổ sung Swagger cho Student (2026-10-10)

Theo yêu cầu `Next`, đã thêm nhóm **Students** cho 5 API CRUD hiện có:
POST/GET `/api/students` và GET/PATCH/DELETE `/api/students/:id`.
Swagger `/api/docs/` và JSON `/api/docs/openapi.json` vào cuối lượt này mô tả 17 operation
(7 Auth + 5 Class + 5 Student), trên 11 path.

- `src/docs/student.openapi.ts` đối chiếu route, Zod, controller, serializer,
  service/repository, middleware và Prisma. Input có 10 field, POST chỉ bắt
  buộc fullName; status mặc định ACTIVE tại API. Field lạ bị loại bỏ, gồm
  ownership, classId, ID và timestamps. PATCH cần ít nhất một field hợp lệ,
  giữ trường không gửi và không mặc định lại status.
- Tám field nullable: phone, parentName, parentPhone, school, grade,
  dateOfBirth, address, note. Phân biệt null với chuỗi rỗng; phone, parentPhone,
  parentName và school không nhận rỗng, address/note vẫn nhận. Phone có trim,
  giới hạn 7–20 và ít nhất 7 chữ số; grade là JSON integer từ 1 đến 12/null.
- UUID dạng hex 8-4-4-4-12 nhận chữ hoa/thường, không ràng buộc version/variant.
  Response Student có 13 field, không teacherId/classId/quan hệ lồng nhau;
  ngày sinh YYYY-MM-DD/null (hiện chưa chặn tương lai), timestamps ISO UTC.
- Danh sách data.students gồm ACTIVE/INACTIVE, createdAt DESC rồi id DESC;
  không có query/filter/pagination/count. Chi tiết/sửa/xóa kiểm UUID cùng
  ownership, ngoài phạm vi trả 404, kể cả ADMIN. DELETE có Enrollment ACTIVE
  hoặc LEFT trả 409 và giữ hồ sơ/lịch sử, chưa có Enrollment thì xóa hẳn.
- `src/docs/openapi.ts` ghép paths/schemas/tag Students; cập nhật
  `docs/student-api.md`, phạm vi `docs/swagger-auth.md` và test docs.
  Test giữ 1 top-level, mở rộng inventory/contract/schema/Bearer và 5 request
  Student thiếu token trả 401; giữ kiểm tra Auth/Class, assets, CORS, 404, $ref.

| Kiểm tra thực sự chạy trong lượt Student Swagger | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng test docs (ES2020/CommonJS/strict) | Đạt |
| `npm run test:docs` | 1/1; OpenAPI/schema/$ref, HTTP JSON/UI/assets và contract Auth/Class/Student đạt |
| `npm run test:students` | 5/5 trên PostgreSQL; CRUD, validation, UUID, quyền A/B và bảo vệ lịch sử đạt |
| **Tổng các bộ vừa chạy** | **6/6; 0 fail/skipped/cancelled; exit code đều 0** |

Test docs không ghi DB; Student tạo/dọn fixture theo cơ chế hiện có. Không
chạy lại toàn bộ bộ test; không đổi API/runtime/schema/dependencies hoặc
reset database. Chưa kiểm tra render/Try it out trong trình duyệt do quyền
mở preview bị từ chối ở lượt trước. Bước Swagger tiếp theo là Enrollment,
chờ người dùng xác nhận.

## 14. Bổ sung Swagger cho Enrollment (2026-10-10)

Theo yêu cầu `Next`, đã thêm nhóm **Enrollments** cho đúng 3 API hiện có:
POST/GET `/api/classes/:classId/students` và
DELETE `/api/classes/:classId/students/:studentId`.
Swagger `/api/docs/` và JSON `/api/docs/openapi.json` vào cuối lượt này mô tả **20 operation**
(7 Auth + 5 Class + 5 Student + 3 Enrollment), trên **13 path**.

- `src/docs/enrollment.openapi.ts` đối chiếu Zod, controller, serializer,
  service/repository, route/middleware và Prisma. POST chỉ nhận studentId và
  joinedAt, cả hai bắt buộc; field lạ trả 400. Class ID là Int, UUID Student
  nhận hoa/thường, ngày vào lớp YYYY-MM-DD không mặc định và có thể ở tương lai.
  Class/Student phải cùng thuộc người gọi, kể cả ADMIN. Ghi danh trùng ACTIVE
  hoặc LEFT trả 409, giữ lịch sử; response data.enrollment có đúng 8 field.
- GET trả data.enrollments có ACTIVE/LEFT, createdAt DESC rồi id DESC và hồ sơ
  Student 13 field. Lọc chủ sở hữu cả Class/Student, không lộ teacherId hoặc
  quan hệ ngoài phạm vi; lớp rỗng trả mảng rỗng, chưa có search/filter/count.
- DELETE là nghỉ lớp: ACTIVE chuyển LEFT, leftAt lấy ngày server UTC; giữ
  Enrollment/Payment. Body không dùng; LEFT gọi lại giữ leftAt/updatedAt và
  trả 200. ACTIVE có joinedAt tương lai trả 400; ngoài ownership trả 404.
- `src/docs/openapi.ts` ghép paths/schemas/tag; cập nhật hướng dẫn frontend
  trong `docs/enrollment-api.md` và phạm vi `docs/swagger-auth.md`.
  `tests/docs.integration.test.ts` giữ 1 top-level test, thêm inventory/DTO,
  body strict, schema/security và 3 request Enrollment thiếu token trả 401.
  Các kiểm tra Auth/Class/Student, CORS, assets local, 404 và $ref vẫn được giữ.

| Kiểm tra thực sự chạy trong lượt Enrollment Swagger | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng test docs (ES2020/CommonJS/strict) | Đạt |
| `npm run test:docs` | 1/1; OpenAPI/schema/$ref, JSON/UI/assets và contract 20 operation đạt |
| `npm run test:enrollments` | 3/3 trên PostgreSQL; ghi danh, danh sách, nghỉ lớp, quyền sở hữu, concurrency và lịch sử đạt |
| **Tổng các bộ vừa chạy** | **4/4; 0 fail/skipped/cancelled; exit code đều 0** |

Test docs không ghi database; test Enrollment tạo/dọn fixture theo cơ chế
hiện có. Không chạy lại toàn bộ bộ test; các kết quả trước giữ theo từng lượt.
Bước này chỉ bổ sung tài liệu và kiểm tra, không đổi API nghiệp vụ/schema/
dependencies, không reset database. Chưa kiểm tra render/Try it out trong
trình duyệt do quyền mở preview bị từ chối ở lượt trước.
Bước Swagger tiếp theo là ClassSchedule; dừng và chờ người dùng xác nhận.

## 15. Hoàn tất Swagger cho ClassSchedule và Payment (2026-10-10)

Người dùng cho phép bổ sung toàn bộ phần Swagger còn lại trong cùng một lượt.
Đã thêm Swagger cho 5 API ClassSchedule và 4 API Payment, đối chiếu source
hiện có. Swagger `/api/docs/` và JSON `/api/docs/openapi.json` hiện mô tả
**toàn bộ 29 operation trên 17 path**: 7 Auth, 5 Class, 5 Student,
3 Enrollment, 5 ClassSchedule và 4 Payment.

- `src/docs/schedule.openapi.ts`: POST/GET danh sách, GET chi tiết, PATCH và
  DELETE lịch trong Class; body strict gồm dayOfWeek/startTime/endTime. Giờ
  nhận HH:mm hoặc HH:mm:ss, trả HH:mm:ss. PATCH ghép với giờ trong DB rồi
  kiểm endTime > startTime; response lịch có 7 field. Danh sách theo thứ,
  startTime/endTime/id tăng dần. Quyền qua lớp cha, ngoài phạm vi/khác lớp
  trả 404 kể cả ADMIN. DELETE chỉ xóa lịch, giữ Class/Student/Enrollment.
- `src/docs/payment.openapi.ts`: POST, GET danh sách, GET chi tiết và PATCH.
  Body strict, tiền nhận number/string không âm và trả chuỗi hai số lẻ.
  POST nhận Enrollment.id, chuẩn hóa ngày về đầu tháng, snapshot amountDue
  từ học phí Class nếu không gửi và trả 10 field. GET/PATCH có 11 field gồm
  status tính bằng Decimal; 0/0 thuộc PAID nhưng paidAt null.
- Payment list chỉ nhận 4 bộ lọc AND: classId/studentId/billingPeriod/status;
  tên lạ hoặc query lặp sai trả 400, ID ngoài phạm vi trả mảng rỗng. Ownership
  qua Enrollment → Class cùng Student; học phí lịch sử vẫn đọc/sửa được.
  PATCH thay thế tổng amountPaid, giữ field không gửi, kiểm phương thức sau
  ghép, tính paidAt trên server và trả 409 khi snapshot đổi giữa đọc/ghi.
  Giữ quyết định không mở DELETE Payment.
- Ghép paths/schemas/tags vào `src/docs/openapi.ts`; mở rộng test docs và
  hướng dẫn trong `docs/class-schedule-api.md`, `docs/payment-api.md`,
  `docs/swagger-auth.md`. Test docs giữ 1 top-level test và coverage các module
  trước, thêm contract Schedule/Payment và 9 request thiếu token trả 401.

| Kiểm tra thực sự chạy trong lượt hoàn tất Swagger | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng test docs (ES2020/CommonJS/strict) | Đạt |
| `npm run test:docs` | 1/1; OpenAPI/schema/$ref, JSON/UI/assets, CORS/404/auth và contract 29 operation đạt |
| `npm run test:schedules` | 5/5 trên PostgreSQL; CRUD, validation/giờ, quyền sở hữu, concurrency và giữ dữ liệu cha đạt |
| `npm run test:payments` | 4/4 trên PostgreSQL; snapshot, Decimal, bốn bộ lọc, ownership, tổng đã thu/paidAt và xung đột đạt |
| **Tổng các bộ vừa chạy** | **10/10; 0 fail/skipped/cancelled; exit code đều 0** |

Test docs không ghi DB. Hai bộ database chạy lần lượt, dọn đúng fixture theo
cơ chế hiện có; không reset database. Chỉ bổ sung tài liệu và kiểm tra,
không đổi runtime nghiệp vụ/schema/dependencies hoặc chiến lược giữ Payment.
Không chạy lại toàn bộ bộ test; các kết quả trước vẫn ghi theo từng lượt.
Chưa kiểm tra render/Try it out trong trình duyệt do quyền mở preview bị
từ chối ở lượt trước. Đã hoàn tất tài liệu cho tất cả API hiện có, dừng theo
phạm vi người dùng yêu cầu.

## 16. User.name và API đổi tên (2026-10-12)

Người dùng duyệt thêm name vào User và API PATCH `/api/auth/me` để giáo viên/
ADMIN ACTIVE tự đổi tên. Phạm vi Auth tăng từ 7 lên 8 operation, tổng backend
từ 29 lên 30; OpenAPI vẫn có 17 path.

- `User.name` dùng TEXT NOT NULL, không SQL default. Migration thêm cột,
  backfill bằng email đang lưu theo quyết định rõ ràng của người dùng rồi
  đặt NOT NULL. Quy tắc backfill không yêu cầu đoán tên thật của User cũ.
- Register tiếp tục strict email/password và gán name bằng email được lưu.
  Seed tạo User mới cũng gán name = email; khi User đã có, giữ tên hiện tại.
  Public response register/login/refresh/GET-PATCH `/me` gồm id/email/name/role;
  pending list thêm status/createdAt, approve thêm status.
- PATCH dùng requireAuth và ID từ `res.locals.auth.userId`, body strict chỉ
  nhận name. Trim rồi nhận 1–150 Unicode code points, tương đương
  `Array.from(name.trim()).length`; không cho sửa
  email/role/status/ID/password/avatar bằng endpoint này.
- Thành công 200 với message `Cập nhật tên thành công`, data.user gồm bốn
  public field. Body/field sai 400 `Thông tin tài khoản không hợp lệ` kèm
  errors; token sai hoặc User mất 401; PENDING 403. Không có nhánh User 404.
- JWT/refresh/logout giữ logic phiên hiện có. Đổi tên không cấp token/cookie;
  GET `/me`, login và refresh trả tên đang lưu. Frontend cập nhật User từ
  response và sinh lại types bằng cơ chế OpenAPI hiện có.
- Avatar chưa triển khai. FE có thể dùng ảnh mặc định chung; Cloudinary là
  gợi ý bước lưu ảnh sau này, chưa có column/upload/API trong bước này.
- Hướng dẫn ở `docs/user-profile-api.md`, cập nhật `docs/auth-approval.md`
  và `docs/swagger-auth.md`. Triển khai cần dừng server, cập nhật bộ code mới,
  chạy migration deploy/generate rồi kiểm tra trước khi khởi động lại.

### Kết quả kiểm tra bước name

`prisma migrate deploy` đã áp dụng migration
`20261012110000_add_user_name`; Prisma Client đã generate. Prisma validate
đạt, migrate status báo đủ 11 migration đã cập nhật. Postflight xác nhận
cột TEXT, NOT NULL, không default; 3 User có sẵn được backfill name = email.

| Kiểm tra đã chạy trong lượt này | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng 6 file Auth, E2E, Docs và hai seed với target ES2022/strict | Đạt |
| `npm run test:auth` | 6/6: đăng ký/duyệt/gate/login/refresh/logout và đổi tên |
| `npm run test:e2e` | 1/1: Auth và luồng Class/Student/Enrollment/Schedule/Payment giữ ownership/lịch sử |
| `npm run test:classes` | 2/2: CRUD và bảo vệ lịch sử |
| `npm run test:schedules:schema` | 1/1: schema/quan hệ, rollback fixture |
| `npm run test:payments:schema` | 1/1: schema/tiền/quan hệ, rollback fixture |
| `npm run test:docs` | 1/1: OpenAPI 30 operation/17 path, name/PATCH/auth/CORS/assets |

Tổng **12/12 đạt**, không fail/skipped/cancelled trong lượt chạy cuối;
exit code đều 0. Lần chạy Auth đầu tiên đạt 5/6: test giả định Zod đếm
UTF-16 đã bị sai với emoji. Đã đối chiếu source/probe Zod đang cài, sửa
tài liệu và test sang Unicode code point; giữ nguyên validation runtime
`z.string().trim().min(1).max(150)` rồi chạy lại Auth thành công.
Đồng thời sửa mô tả độ dài tối thiểu mật khẩu đăng ký trong OpenAPI cũ
từ UTF-16 sang Unicode code point cho đúng Zod đang cài; không đổi validation
hoặc chính sách mật khẩu/phiên đăng nhập.

Test đổi tên kiểm tra A/B/ADMIN chỉ sửa chính mình, PENDING/thiếu/sai token,
body strict/trim/Unicode/boundary, không đổi ID/email/role/status/hash hoặc
tài khoản khác. GET me/login/refresh với phiên đã cấp trước đổi tên đều trả
tên đang lưu. Fixture ORM của các bộ test và hai INSERT User bằng SQL đã
bổ sung name để tương thích cột bắt buộc; test chỉ dọn dữ liệu thử riêng.

Chưa chạy lại tất cả bộ test module. Typecheck toàn bộ thư mục tests ngoài
tsconfig src còn có lỗi typing ở Classes/EnrollmentList/PaymentUpdate đã
được ghi nhận khi kiểm tra rộng; không mở rộng thay đổi sang các lỗi đó.
Các file Auth/E2E/Docs/seed được kiểm tra riêng như bảng trên. Không kiểm
tra trực tiếp render/Try it out bằng browser; giới hạn quyền preview của
các lượt Swagger trước vẫn được giữ. Không reset DB hoặc chạy seed.

## 17. Schema avatar User (2026-10-12)

Thêm `User.avatar` kiểu PostgreSQL TEXT nullable để lưu URL ảnh riêng;
null biểu diễn tài khoản chưa có ảnh riêng. Migration
`20261012120000_add_user_avatar` chỉ ADD COLUMN, không backfill/default URL,
không đổi ID hoặc các quan hệ. Đã áp dụng bằng migrate deploy trước khi
generate Prisma Client để giữ tương thích với code tạo User đang chạy.

Postflight xác nhận 3 User đều có avatar null; toàn bộ dữ liệu User ngoài
cột mới giữ nguyên theo checksum trước/sau (không in dữ liệu hoặc checksum).
Catalog xác nhận TEXT/nullable/no SQL default. Các kiểm tra đã chạy:

| Kiểm tra bước avatar | Kết quả |
| --- | --- |
| Prisma validate/generate | Đạt với Prisma 7.10.0 |
| Prisma migrate status | 12 migration, database đã cập nhật |
| TypeScript src | Đạt |
| Probe Prisma trong transaction rollback | Đạt: tạo User không truyền avatar nhận null; ghi/đọc URL rồi clear về null; giữ các trường hồ sơ khác; fixture không tồn tại sau rollback |
| `npm run test:auth` | 6/6: luồng Auth/đổi tên giữ contract hiện tại |
| `npm run test:docs` | 1/1: OpenAPI vẫn 30 operation/17 path và giữ public User bốn field |

Tổng hồi quy **7/7 đạt**, không fail/skipped/cancelled; exit code đều 0.
Probe dùng file tạm riêng đã xóa, không thêm test hoặc script lâu dài cho
thay đổi nullable nhỏ. Không chạy lại mọi bộ module hoặc typecheck rộng tests.
Kiểm tra này xác nhận schema/Client, chưa xác nhận upload hoặc ảnh mặc định.

Đây là bước schema: public User/response/PATCH name/OpenAPI giữ nguyên;
backend vẫn có 30 operation trên 17 path. Upload, Cloudinary, ảnh mặc định
và response avatar là bước sau. Không reset database hoặc chạy seed.

## 18. Upload avatar, Cloudinary và ảnh mặc định (2026-10-12)

Theo yêu cầu `next`, thêm đúng một API PATCH `/api/auth/me/avatar` cho
tài khoản ACTIVE đang đăng nhập. TEACHER và ADMIN chỉ cập nhật ảnh của mình,
lấy User ID từ middleware; không nhận ID/URL/public ID từ client. Giữ API
PATCH tên chỉ nhận name và giữ nguyên phiên JWT/refresh/logout.

### Request, xử lý và response

- Request `multipart/form-data` có đúng một file field `avatar`; không có
  field/file khác. Nhận JPEG/PNG/WebP, tối đa 2 MiB và 20 megapixel. Kiểm tra
  định dạng thật khớp MIME bằng Sharp, từ chối file rỗng/hỏng/SVG/GIF.
- Backend xoay EXIF, crop cover thành WebP tĩnh 256×256, quality 80, bỏ
  metadata; ảnh động dùng frame đầu. Cloudinary upload dùng public ID mới
  do server sinh trong namespace của User và `overwrite:false`.
- Chỉ lưu URL ảnh mới sau upload thành công; ghi kiểm tra đồng thời ID,
  trạng thái ACTIVE và avatar cũ. Hai upload cùng snapshot trả 200/409,
  candidate thua được dọn. Đổi name đồng thời không bị ghi đè.
- Sau khi lưu, chỉ xóa ảnh cũ nếu URL xác nhận đúng cloud/namespace/User.
  Lỗi dọn ảnh không làm thất bại bản cập nhật đã lưu. Nếu lỗi DB chưa rõ
  commit, đọc lại để xác nhận; nếu không xác nhận được thì trả 500 và giữ
  ảnh mới để tránh xóa ảnh có thể đã được DB sử dụng.
- Public User dùng đúng năm field id/email/name/avatar/role. Khi avatar DB
  null, trả URL ảnh mặc định chung từ PUBLIC_API_ORIGIN/DEFAULT_AVATAR_URL
  hoặc localhost ở development. Production phải cấu hình origin hoặc URL.
  Asset `GET /api/assets/default-avatar.svg` là public SVG cố định, không
  tính vào 31 operation nghiệp vụ.
- Mã lỗi: 400 dữ liệu/ảnh sai, 401/403 theo auth, 409 xung đột, 413 quá 2 MiB,
  415 Content-Type/MIME không hỗ trợ, 500 lưu DB, 502 upload, 503 thiếu cấu
  hình. Không trả/log lỗi thô Cloudinary hoặc secret.

Các file chính: `src/modules/auth/avatar.{upload,image,storage,service}.ts`,
`auth.response.ts`, route/controller/service/repository Auth,
`src/config/{env,cloudinary}.ts`, `src/assets/default-avatar.ts`, `src/app.ts`.
Thêm cloudinary/multer/sharp, cập nhật package lock, Auth OpenAPI và các
test public User; không có migration mới trong lượt upload.
Hướng dẫn Postman/FE/cấu hình ở `docs/user-profile-api.md` và mẫu các biến
mới ở `.env.avatar.example`; không chứa credential thật.

### Kết quả thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng 6 Auth + Avatar + E2E + Docs | Đạt |
| `npm run test:auth` | 6/6: public User năm field, luồng đăng ký/duyệt/login/refresh/logout/đổi tên |
| `npm run test:avatar` | 1/1: HTTP/DB thật, provider mock; validation, A/B/ADMIN/PENDING, CAS/race, dọn ảnh, lỗi provider/DB và reconcile |
| `npm run test:docs` | 1/1: 31 operation/18 path, Auth 9 API, multipart, public SVG và contract |
| `npm run test:e2e` | 1/1: luồng nghiệp vụ giữ public User mới |
| `npm run test:http` | 1/1: parser/CORS vẫn hoạt động |
| Cloudinary thật qua HTTP API | Đạt: hai upload PNG/JPEG, CDN WebP 256×256, thay ảnh có xác nhận xóa ảnh cũ, GET me/PATCH name giữ đúng avatar, B giữ nguyên |
| Dọn fixture thực tế | Đạt: ảnh Cloudinary và hai tài khoản test đã dọn; file probe tạm đã xóa |

Tổng bộ test phù hợp **10/10 đạt**, không fail/skipped/cancelled trong lần
chạy cuối. Smoke Cloudinary thật được ghi riêng, không cộng vào số test
Node ở trên. Lần đầu provider trả 401 do Cloud Name bị nhập thành tên API
Key; đã sửa đúng Cloud Name trong `.env`, ping và smoke sau đó đạt. Không
in credential/token/URL DB hoặc đưa cấu hình thật vào Git.

Test avatar từng lỗi do Node mock không hỗ trợ method trên Prisma Proxy;
đã sửa seam test, typecheck và chạy lại đạt. Test chỉ dọn fixture riêng,
không reset/migrate/seed hoặc sửa tài khoản thật. Test approve dùng ID của
fixture đã tạo/xóa, không còn dùng một ID toàn cục giả định không tồn tại.

Chưa chạy lại mọi bộ module hoặc kiểm tra Swagger trong trình duyệt. Dọn
ảnh là best effort: timeout, process crash hoặc commit DB chưa xác định có
thể để lại ảnh không được dùng; không có transaction phân tán hoặc job dọn
ảnh trong bước này. Chưa mở API xóa/reset avatar. Sau khi đổi credential,
cần khởi động lại dev server để nạp `.env` mới; smoke chạy bằng process mới.

## 19. Gộp tên và avatar vào một API hồ sơ (2026-10-13)

Người dùng yêu cầu một API cập nhật thông tin tài khoản. Contract ở mục 18
đã được thay bằng duy nhất PATCH `/api/auth/me`; endpoint PATCH
`/api/auth/me/avatar` được bỏ và trả 404. OpenAPI còn 30 operation/17 path,
gồm 8 API Auth. Giữ response public User năm field và ảnh mặc định đã có.

### Contract và logic

- JSON giữ request `{ name }` strict của API tên trước đây; name bắt buộc,
  trim và kiểm 1–150 Unicode code points. JSON không nhận URL/avatar hoặc
  field khác.
- Multipart nhận name kiểu Text và avatar kiểu File, mỗi field optional
  nhưng phải có ít nhất một; chỉ gửi tên, chỉ ảnh hoặc cả hai đều được.
  Field không gửi giữ nguyên. File rỗng, text avatar, nhiều file/field lạ
  bị từ chối; name rỗng/sai/không hợp lệ vẫn bị từ chối khi có ảnh.
- Chỉ request có file mới cần Cloudinary. Giữ JPEG/PNG/WebP, 2 MiB/20 MP,
  Sharp WebP 256×256 và namespace ảnh thuộc User như trước.
- Nếu có file, upload thành công trước rồi một Prisma UPDATE lưu các field
  được gửi. Validation/upload/config lỗi không lưu tên trước hoặc sửa avatar.
  Truy vấn có User ID từ auth và ACTIVE; khi đổi ảnh có thêm snapshot avatar
  cũ. Xung đột 409 không ghi cả hai field và dọn candidate.
- Khi chỉ đổi tên, không khóa snapshot avatar; không ghi đè ảnh đang được
  request khác đổi. Khi không gửi tên, không ghi lại tên snapshot.
- DB lỗi chưa rõ commit: đối soát URL mới duy nhất làm marker chứng minh
  UPDATE cả hai field đã commit; tên có thể đã được request khác đổi tiếp.
  Nếu không xác nhận được thì trả 500 và giữ ảnh mới; đọc GET me để kiểm tra.
- Response 200 dùng message `Cập nhật thông tin tài khoản thành công`,
  data.user năm field. Lỗi lưu dùng `Không thể lưu thông tin tài khoản`.
  Giữ auth/JWT/refresh/logout và không thay schema/migration/credential.

File chính: Auth route/controller/schema/service/repository,
`avatar.upload.ts`, `profile.service.ts` (thay `avatar.service.ts`), Auth
OpenAPI, tests profile/avatar/docs và các tài liệu hồ sơ. Hướng dẫn gửi
request ở `docs/user-profile-api.md`. Frontend cần gen lại type và dùng
PATCH `/auth/me` cho cả tên và ảnh; không sửa FE trong lượt này.

### Kiểm tra

Smoke qua API mới và Cloudinary thật đã đạt: multipart gửi name và avatar
cùng request, DB/response/GET me có cả hai giá trị mới, CDN WebP 256×256;
JSON đổi tên giữ ảnh, endpoint cũ trả 404, tài khoản B không bị sửa.
Ảnh Cloudinary/tài khoản fixture và file probe đã được dọn. Kết quả bộ test
hồi quy của lượt gộp đã chạy:

| Kiểm tra | Kết quả |
| --- | --- |
| TypeScript src | Đạt |
| Typecheck riêng tests profile/avatar/docs | Đạt |
| `npm run test:auth` | 6/6: phiên Auth/đổi tên/public User giữ nguyên, response PATCH dùng message chung |
| `npm run test:avatar` | 1/1: JSON/multipart/at-least-one, name-only không cần Cloud, cả hai field trong một UPDATE, validation/provider/CAS lỗi giữ dữ liệu và reconcile commit |
| `npm run test:docs` | 1/1: 30 operation/17 path, JSON + multipart cùng PATCH, public SVG, auth/CORS và route cũ 404 |
| Smoke API gộp + Cloudinary thật | Đạt theo các tình huống mô tả ở trên, đã dọn ảnh/User fixture |

Tổng hồi quy phù hợp **8/8 đạt**, exit code 0, không fail/skipped/cancelled.
Smoke Cloudinary thật ghi riêng, không cộng vào số test Node. Test có DB
chạy lần lượt, chỉ dọn fixture của mình. Chưa chạy lại các bộ module/E2E
hoặc mở Swagger trong trình duyệt; giới hạn best-effort cleanup ở mục 18
vẫn giữ nguyên. Không migrate/reset/seed/commit/push hoặc sửa frontend.

## 20. Kết luận và bước sau

Các API cơ bản của Auth, Class, Student, Enrollment, Schedule và Payment đã
có theo phạm vi trên. Lượt tổng kiểm tra đạt TypeScript, Prisma và 24/24 test
ban đầu. Hai lỗi parser/CORS phát hiện thêm đã được sửa và kiểm tra hồi quy
theo mục 7: TypeScript đạt, test HTTP/Auth/Class đạt 6/6. Lượt bổ sung test
phiên đăng nhập ở mục 8 đạt TypeScript cho src/hai file test mới và Auth 5/5.
Test xuyên suốt ở mục 9 đạt 1/1 và TypeScript src/file test mới đều đạt.
Các kết quả từng lượt được giữ riêng; lượt chạy lại toàn bộ sau khi thêm test
ở mục 10 đạt **28/28**, TypeScript/Prisma đạt và migration đã cập nhật.
Các giới hạn coverage ở mục 6 vẫn còn.

Swagger Auth đã được thêm theo mục 11 (8/8 kiểm tra phù hợp), Class bổ sung
theo mục 12 (3/3), Student theo mục 13 (6/6), Enrollment theo mục 14 (4/4);
TypeScript đạt trong mỗi lượt. Người dùng cho phép hoàn tất ClassSchedule
và Payment cùng lượt ở mục 15 (10/10 kiểm tra phù hợp). Lượt đó có đủ 29 API;
bổ sung User.name/PATCH hồ sơ ở mục 16 nâng inventory lên 30 API, đạt 12/12
kiểm tra phù hợp và TypeScript trong phạm vi đã nêu. Giới hạn kiểm tra trình
duyệt của các lượt Swagger trước được ghi riêng.

Các kết quả test lịch sử được giữ riêng theo lượt. Bước phát triển hoặc bổ
sung coverage tiếp theo do người dùng chọn. Nếu chuyển sang tính năng mới, cần
thống nhất từng API và tiếp tục kiểm tra ownership cho các chức năng danh
sách/tổng hợp.

Lượt tổng kiểm tra tạo báo cáo này; các lượt tiếp theo sửa middleware chung,
thêm test hồi quy, test phiên đăng nhập và test xuyên suốt, cập nhật tài liệu;
các lượt tiếp theo hoàn tất Swagger/OpenAPI Auth, Class, Student, Enrollment,
ClassSchedule, Payment; bước mới bổ sung User.name và API đổi tên tài khoản.
Tiến độ được ghi ở system-design.md.
Schema avatar đã hoàn tất theo mục 17 (Auth/Docs 7/7 và probe Prisma đạt).
Upload Cloudinary/ảnh mặc định đã hoàn tất theo mục 18 (10/10 test phù hợp
và smoke thật). Mục 19 gộp tên/ảnh vào PATCH hồ sơ; inventory hiện có 30 API.
Frontend cần sinh lại type từ OpenAPI và gửi FormData tới PATCH `/auth/me`
khi đổi avatar. Bước tiếp theo do người dùng chọn; dừng sau API hồ sơ.
