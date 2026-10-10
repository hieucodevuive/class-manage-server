# Thiết kế hệ thống quản lý lớp dạy thêm

Yêu cầu được người dùng cung cấp ngày 2026-10-01. Hệ thống phục vụ nhiều giáo viên dùng độc lập. Mỗi tài khoản giáo viên quản lý lớp và hồ sơ học sinh riêng. Không xây Organization, trung tâm, bảng `teachers` hoặc chức năng nhiều giáo viên dạy chung.

Tài liệu này cập nhật giả định một giáo viên ở `backend-implementation-instructions.md`. Các quyết định đã được duyệt về Class hiện tại vẫn giữ nguyên, đặc biệt `Class.id` là `Int` tự tăng. Không tự đổi ID, tên bảng/cột hoặc dữ liệu cũ khi áp dụng thiết kế.

## 1. Quyền sở hữu dữ liệu

- Tài khoản trong bảng users hiện có đại diện cho giáo viên: một giáo viên có nhiều lớp và nhiều hồ sơ học sinh.
- `classes.teacher_id` và `students.teacher_id` bắt buộc tham chiếu `users.id`, cùng kiểu dữ liệu với `users.id`.
- Một học sinh có thể tham gia nhiều lớp **của cùng giáo viên**. Nếu học với hai giáo viên, mỗi giáo viên quản lý một hồ sơ học sinh riêng.
- Chỉ classes và students lưu trực tiếp `teacher_id`. Lịch học, ghi danh và học phí xác định giáo viên thông qua lớp liên quan.
- Không lấy `teacher_id` từ client để quyết định chủ sở hữu và không cho sửa trường này qua CRUD thông thường.

## 2. Bảng và trường nghiệp vụ

| Bảng logic | Danh sách trường |
| --- | --- |
| users | Giữ schema authentication hiện có; dùng `users.id` để xác định giáo viên |
| classes | `id`, `teacher_id`, `name`, `grade`, `school_year`, `subject`, `tuition_fee`, `start_date`, `end_date`, `status`, `note`, `created_at`, `updated_at` |
| students | `id`, `teacher_id`, `full_name`, `phone`, `parent_name`, `parent_phone`, `school`, `grade`, `date_of_birth`, `address`, `status`, `note`, `created_at`, `updated_at` |
| class_schedules | `id`, `class_id`, `day_of_week`, `start_time`, `end_time`, `created_at`, `updated_at` |
| class_students | `id`, `class_id`, `student_id`, `joined_at`, `left_at`, `status`, `created_at`, `updated_at` |
| payments | `id`, `class_student_id`, `billing_period`, `amount_due`, `amount_paid`, `paid_at`, `payment_method`, `note`, `created_at`, `updated_at` |

Không tự thêm hoặc bỏ trường nghiệp vụ trong danh sách này. Tên bảng/trường ở đây là tên logic theo thiết kế; khi triển khai phải đối chiếu cách đặt tên thực tế của Prisma và migration hiện có, không tự rename hàng loạt.

## 3. Quan hệ

- users 1:N classes qua `classes.teacher_id`.
- users 1:N students qua `students.teacher_id`.
- classes 1:N class_schedules qua `class_schedules.class_id`.
- classes N:N students qua `class_students` (Enrollment).
- class_students 1:N payments qua `payments.class_student_id`.

Student là hồ sơ độc lập, không có `class_id`. `class_students` ghi ngày vào lớp, ngày nghỉ và trạng thái ghi danh. Payment gắn với một enrollment, không gắn trực tiếp với `student_id` hoặc `class_id`.

## 4. Kiểu dữ liệu, trạng thái và ràng buộc

- Giữ schema authentication hiện có. `teacher_id` là khóa ngoại bắt buộc, cùng kiểu với `users.id`. Giữ kiểu ID đã có; không tự chuyển hàng loạt ID.
- `tuition_fee` là mức học phí của lớp theo nghiệp vụ hiện tại. `billing_period` là DATE, luôn biểu diễn tháng học phí bằng ngày đầu tháng.
- `amount_due` là snapshot số tiền phải thu cho kỳ học phí; đổi `tuition_fee` của lớp không ghi đè payment cũ. `amount_paid` mặc định 0.
- Các trường tiền của bảng chưa triển khai dùng `NUMERIC(12,2)`, không âm, không dùng floating point. Không lưu payment status tính được từ `amount_due` và `amount_paid` nếu không có lý do được duyệt.
- Ngày dùng `DATE`; giờ lịch học dùng `TIME`; `created_at`, `updated_at`, `paid_at` dùng `TIMESTAMPTZ`. Số điện thoại dùng chuỗi.
- Grade, khi có giá trị, phải từ 1 đến 12. `end_date` không trước `start_date`; `end_time` phải sau `start_time`.
- `class_students` có `UNIQUE(class_id, student_id)`; payments có `UNIQUE(class_student_id, billing_period)`.
- Tạo index cho `teacher_id` và các khóa ngoại phục vụ truy vấn.

Giá trị trạng thái và danh mục:

| Trường | Giá trị |
| --- | --- |
| `classes.status` | `ACTIVE`, `INACTIVE`, `COMPLETED` |
| `students.status` | `ACTIVE`, `INACTIVE` |
| `class_students.status` | `ACTIVE`, `LEFT` |
| `payment_method` | `CASH`, `BANK_TRANSFER`, `OTHER` |
| `day_of_week` | `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, `FRIDAY`, `SATURDAY`, `SUNDAY` |

Các trường có thể để trống:

| Bảng | Trường nullable |
| --- | --- |
| classes | `end_date`, `note` |
| students | `phone`, `parent_name`, `parent_phone`, `school`, `grade`, `date_of_birth`, `address`, `note` |
| class_students | `left_at` |
| payments | `paid_at`, `payment_method` khi chưa thanh toán, `note` |

Không lưu `studentCount` hoặc tuổi làm cột dữ liệu nếu không có lý do được duyệt. Bảo vệ lịch sử Enrollment/Payment; không cascade delete lịch sử tài chính. Nếu cần đổi hành vi hard delete hiện có, đề xuất và chờ duyệt trước.

## 5. Authentication và authorization

Giữ luồng login, access token, refresh token và logout. Backend lấy ID giáo viên từ dữ liệu middleware xác thực cung cấp, rồi tự gán `teacher_id` khi tạo Class hoặc Student.

Mọi request nghiệp vụ phải giới hạn theo giáo viên đang đăng nhập, kể cả khi client biết ID tài nguyên của người khác. Giới hạn cả danh sách, chi tiết, sửa, xóa, tìm kiếm, tổng số bản ghi, dashboard, export và dữ liệu lồng nhau.

- Class/Student: kiểm tra đồng thời ID bản ghi và `teacher_id`.
- Schedule: kiểm tra lớp cha thuộc giáo viên.
- Enrollment: kiểm tra cả lớp và học sinh thuộc cùng giáo viên đang đăng nhập.
- Payment: kiểm tra ownership qua payment → class_students → classes.

Business routes tiếp tục dùng middleware auth/role hiện có. Vai trò `ADMIN` hiện có trong code không tự động cho phép đọc dữ liệu của giáo viên khác; cần quyết định riêng nếu muốn có quyền quản trị xuyên tài khoản.

## 6. Quy trình triển khai

1. Đọc code và toàn bộ `backend-implementation-instructions.md` trước bước database/API. Giữ kiến trúc Express 5, TypeScript/CommonJS, PostgreSQL, Prisma, Zod và route → controller → service → repository → Prisma.
2. Chỉ thực hiện module, API hoặc bước người dùng chỉ định. Mỗi lượt làm một API; schema/migration là bước chuẩn bị riêng. Không tạo trước model/layer chưa dùng.
3. Khi cập nhật Class hiện có, giữ validation và nghiệp vụ đã triển khai; chỉ đổi phần cần cho `teacher_id` và quyền sở hữu.
4. Giải thích ngắn mục tiêu, logic và file liên quan; áp dụng đúng bước, chạy kiểm tra phù hợp, báo kết quả và dừng. Chỉ chuyển bước khi người dùng nói `next`, `tiếp`, `continue` hoặc đồng ý rõ ràng. Câu hỏi/yêu cầu giải thích không cho phép tự chuyển API.
5. Không tự commit, push, reset database, đổi ID, rename bảng/cột hoặc giả định giá trị backfill cho dữ liệu cũ. Trình bày migration strategy và xin quyết định khi cần.

## 7. Những điểm cần đối chiếu trước bước liên quan

- Prisma hiện dùng tên vật lý `"User"`, `"Class"` và cột camelCase, trong khi tài liệu dùng users/classes và snake_case để diễn đạt mô hình. Cần giữ naming convention hiện có trừ khi người dùng duyệt đổi.
- `Class.id` hiện là `Int` tự tăng; `User.id` cũng là `Int`. Khóa ngoại trỏ đến Class/User phải tương thích. Chưa suy rộng quyết định ID Class sang ID Student hoặc các bảng mới.
- Tài liệu cũ mô tả khả năng học sinh rời lớp rồi ghi danh lại bằng enrollment mới và gợi ý unique index chỉ cho trạng thái ACTIVE. Quyết định hiện tại dùng `UNIQUE(class_id, student_id)`; xem mục 9 về cách xử lý ghi danh lại.
- Khi thêm `teacher_id NOT NULL` cho Class, phải kiểm tra dữ liệu Class đã tồn tại và thống nhất cách gán chủ sở hữu trước migration; không tự backfill.

## 8. Đăng ký và duyệt tài khoản (quyết định 2026-10-01)

- Giáo viên có thể tự đăng ký, nhưng tài khoản mới ở trạng thái `PENDING` và
  chưa được đăng nhập hoặc dùng API nghiệp vụ trước khi được duyệt.
- `User.status` có hai giá trị ban đầu: `PENDING`, `ACTIVE`. Các tài khoản đã có
  trước migration giữ `ACTIVE` để không mất quyền đăng nhập. Tài khoản mới mặc
  định `PENDING`.
- Chỉ tài khoản `ADMIN` riêng được duyệt. Đăng ký công khai luôn tạo role
  `TEACHER`; client không được chọn `ADMIN`, `status` hoặc nhận token khi đăng ký.
- Database hiện chưa có ADMIN. Tạo tài khoản ADMIN bằng lệnh nội bộ với email và
  mật khẩu do chủ hệ thống cung cấp qua biến môi trường; không mở đăng ký ADMIN
  công khai và không tự nâng quyền tài khoản TEACHER hiện có. Sau migration, đặt
  `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD` (ít nhất 12 ký tự) trong môi trường
  riêng rồi chạy `npm run seed:admin`; lệnh không in mật khẩu.
- Đã thêm điều kiện trạng thái ở login/refresh/middleware và API công khai
  `POST /api/auth/register` chỉ tạo TEACHER/PENDING, không cấp token. ADMIN có
  `GET /api/auth/registrations/pending` để xem yêu cầu và
  `PATCH /api/auth/registrations/:id/approve` để kích hoạt giáo viên. Chi tiết
  request/response và cách tự kiểm tra ở `docs/auth-approval.md`.
- Login chỉ cấp token cho `ACTIVE` sau khi mật khẩu đúng. Refresh chỉ cấp token mới
  cho `ACTIVE`; middleware kiểm tra trạng thái hiện tại của tài khoản trước khi
  cho dùng access token ở các API có xác thực. Response user giữ `id`, `email`,
  `role`, không lộ `passwordHash` hoặc `status`.

## 9. Enrollment và bảo vệ lịch sử (quyết định 2026-10-05)

- Mỗi cặp Class–Student chỉ có một bản ghi Enrollment theo
  `UNIQUE(class_id, student_id)`. Khi Enrollment đã `LEFT`, không tạo bản ghi ghi
  danh mới cho cùng cặp và không ghi đè `joined_at`/`left_at` cũ.
- Khi Class hoặc Student đã có Enrollment, API DELETE sẽ trả `409` để giữ lịch
  sử. Có thể dùng API PATCH hiện có để chuyển trạng thái Class/Student sang
  `INACTIVE` khi phù hợp. DELETE Class và DELETE Student đều đã xử lý `409`.
- Migration `20261005215214_create_class_student_model` đã áp dụng. Theo naming
  convention Prisma hiện tại, bảng vật lý là `"ClassStudent"`; `classId` là Int,
  `studentId` là UUID. Hai khóa ngoại dùng `ON DELETE RESTRICT`. Prisma Client đã
  generate.
- `POST /api/classes/:classId/students` đã triển khai ngày 2026-10-06. Backend
  kiểm tra cả Class và Student theo tài khoản đã xác thực, tạo Enrollment
  `ACTIVE` với `leftAt = null`, trả `409` cho cặp đã tồn tại kể cả `LEFT`.
  Request chỉ nhận `studentId` và `joinedAt`; chi tiết ở `docs/enrollment-api.md`.
  `GET /api/classes/:classId/students` đã bổ sung danh sách ACTIVE/LEFT cùng hồ
  sơ Student; truy vấn kiểm tra chủ sở hữu Class và lọc Student cùng giáo viên.
  `DELETE /api/classes/:classId/students/:studentId` cho học sinh rời lớp bằng
  cách chuyển `ACTIVE` sang `LEFT`, lưu ngày hiện tại UTC vào `leftAt` và giữ
  lịch sử. Truy vấn kiểm tra cả chủ sở hữu Class và Student; gọi lại giữ nguyên
  ngày nghỉ đã có. Ghi danh có ngày vào lớp trong tương lai trả 400.

## 10. ClassSchedule (2026-10-06)

- Model `ClassSchedule` có đúng các trường lịch học trong thiết kế. `id` là UUID,
  `classId` là Int tham chiếu Class; không thêm `teacherId`. Giáo viên sở hữu lịch
  được xác định qua lớp cha.
- `DayOfWeek` gồm MONDAY đến SUNDAY; giờ dùng TIME(0), timestamps dùng
  TIMESTAMPTZ(3). CHECK yêu cầu `endTime > startTime`; có index `classId`.
- Lịch dùng `ON DELETE CASCADE` vì chỉ có ý nghĩa cùng lớp. Enrollment vẫn dùng
  RESTRICT để chặn xóa Class có lịch sử; không đổi quy tắc DELETE hiện có.
- Migration `20261006143111_create_class_schedule_model` đã áp dụng; Prisma
  Client đã generate. Không cần backfill. Test schema, CRUD Class và Enrollment
  đã đạt trên PostgreSQL. Chi tiết ở `docs/class-schedule-schema.md`.
  Đã có `POST /api/classes/:classId/schedules`: body chỉ nhận `dayOfWeek`,
  `startTime`, `endTime`; kiểm tra lớp thuộc tài khoản đăng nhập và quyền sở hữu
  khi insert. Giờ nhận `HH:mm`/`HH:mm:ss`, trả `HH:mm:ss`; chi tiết ở
  `docs/class-schedule-api.md`.
- Đã có `GET /api/classes/:classId/schedules`: truy vấn lớp theo ID và giáo viên,
  trả lịch từ MONDAY đến SUNDAY rồi theo giờ bắt đầu/kết thúc và ID. Lớp chưa có
  lịch trả mảng rỗng; lớp của người khác trả 404, kể cả khi người gọi là ADMIN.
  Dùng cùng định dạng giờ/response với POST, không trả dữ liệu Class/User lồng
  nhau.
- Đã có `GET /api/classes/:classId/schedules/:scheduleId`: kiểm tra ID lớp, UUID
  lịch học rồi truy vấn theo ID lịch, lớp và giáo viên sở hữu lớp. Lịch khác lớp
  hoặc khác chủ sở hữu trả 404 như lịch không tồn tại; response giữ bảy trường
  và định dạng giờ hiện có.
- Đã có `PATCH /api/classes/:classId/schedules/:scheduleId`: body chỉ nhận một
  hoặc nhiều trường `dayOfWeek`, `startTime`, `endTime`. Trường không gửi giữ
  nguyên; giờ sau khi ghép với dữ liệu DB phải có `endTime > startTime`. Đọc và
  cập nhật đều kiểm tra ID lịch, ID lớp và giáo viên sở hữu lớp. CHECK giờ vẫn
  bảo vệ khi có cập nhật đồng thời và được chuyển thành lỗi 400 phù hợp.
- Đã có `DELETE /api/classes/:classId/schedules/:scheduleId`: xóa hẳn một lịch
  bằng truy vấn kiểm tra ID lịch, ID lớp và giáo viên sở hữu lớp. Lịch khác quyền,
  khác lớp hoặc đã xóa trả 404; thành công trả 200. Class/Student/Enrollment và
  lịch khác được giữ nguyên, kể cả khi lớp đã có lịch sử ghi danh.
  ClassSchedule CRUD cơ bản đã có đủ năm endpoint; tiến độ Payment ở mục 11.
- Test POST, GET danh sách, GET chi tiết, PATCH và DELETE lịch học đã đạt 5/5 trên
  PostgreSQL, TypeScript đạt. Test GET kiểm tra quyền A/B/ADMIN, lớp rỗng, thứ tự
  ngày/giờ/ID, UUID và lịch không thuộc lớp trong URL. Test PATCH kiểm tra cập nhật
  từng trường, giờ kết hợp với DB, quyền sở hữu và ba lượt cập nhật đồng thời
  một 200/một 400. Test DELETE kiểm tra quyền sở hữu, xóa lặp/đồng thời một
  200/một 404 và giữ nguyên lớp/học sinh/lịch sử Enrollment LEFT; chỉ tạo và dọn
  dữ liệu thử riêng.
- Test POST lịch học đã đạt với A/B/ADMIN, kiểm tra validation và giờ lưu trong
  TIME. Test Auth/Class cũng đạt. Error handler chung giữ HTTP 400 cho lỗi JSON
  parser thay vì đổi thành 500.

## 11. Payment (2026-10-10)

- Model `Payment` có đúng 10 trường trong thiết kế; bảng vật lý `"Payment"`,
  cột camelCase theo convention hiện tại. ID và `classStudentId` dùng UUID;
  `classStudentId` tham chiếu `"ClassStudent"."id"`.
- `billingPeriod` dùng DATE với CHECK ngày hữu hạn và ngày đầu tháng. Hai trường
  tiền dùng NUMERIC(12,2), không âm và không nhận NaN; `amountPaid` default 0.
  `paidAt`/timestamps dùng TIMESTAMPTZ(3); `paidAt`, `paymentMethod`, `note` nullable.
  `PaymentMethod` gồm CASH/BANK_TRANSFER/OTHER.
- Unique `(classStudentId, billingPeriod)` đảm bảo một khoản học phí trong mỗi
  kỳ của Enrollment; index này cũng phục vụ truy vấn theo `classStudentId`.
  Payment không lưu `teacherId`, `studentId`, `classId` hoặc payment status.
- `amountDue` được lưu riêng: sửa học phí Class không đổi Payment cũ. Khóa ngoại
  RESTRICT chặn xóa Enrollment đã có Payment. Nghỉ lớp vẫn giữ cả Enrollment
  và Payment; Class/Student có Enrollment vẫn bị API DELETE chặn với 409.
- Migration `20261006154547_create_payment_model` đã áp dụng; Prisma Client đã
  generate. Đây là bảng mới, không cần backfill và không reset database.
  Database có đủ 10 migration; Prisma validate và TypeScript đạt.
- Test schema Payment đạt 1/1 trên PostgreSQL, dữ liệu thử được rollback. Test
  Enrollment đạt 3/3, đã kiểm tra Prisma ghi/đọc Payment và API nghỉ lớp/xóa
  Class/Student giữ lịch sử; dữ liệu thử của API đã được dọn.
- Chi tiết schema, migration và kiểm tra ở `docs/payment-schema.md`.
- Đã có `POST /api/payments`: body chỉ nhận `classStudentId`, `billingPeriod` và
  tùy chọn `amountDue`, `note`. Ngày hợp lệ được chuẩn hóa về đầu tháng. Không
  gửi `amountDue` thì lưu snapshot từ học phí Class được đọc trong request;
  khoản mới có `amountPaid = 0`, `paidAt`/`paymentMethod` null.
- POST kiểm tra Enrollment theo ID, chủ sở hữu Class và Student; kiểm tra lại
  điều kiện quyền sở hữu trong `enrollment.connect` khi ghi. Enrollment không
  tồn tại/ngoài phạm vi trả 404, kể cả ADMIN. Cho phép ACTIVE/LEFT để quản lý
  học phí lịch sử, không thêm quy tắc giới hạn tháng theo ngày học.
- Trùng kỳ sau chuẩn hóa trả 409, gồm cả request đồng thời. Response chỉ trả
  10 trường Payment; tiền là chuỗi Decimal hai chữ số phần lẻ, kỳ học phí là
  YYYY-MM-01 và timestamps ISO UTC. Không trả dữ liệu cha lồng nhau.
- Test POST đạt 1/1 trên PostgreSQL và TypeScript đạt. Đã kiểm tra A/B/ADMIN,
  auth, validation, Decimal/date, snapshot sau đổi học phí lớp và tạo trùng kỳ
  đồng thời một 201/một 409; dữ liệu thử đã được dọn. Chi tiết ở
  `docs/payment-api.md`.
- Sau khi người dùng duyệt query/filter, đã thêm `GET /api/payments` với bốn
  query tùy chọn `classId`, `studentId`, `billingPeriod`, `status`. Query kết
  hợp bằng AND, ngày chuẩn hóa về đầu tháng; query sai/lặp/tên lạ trả 400.
  Danh sách giới hạn qua Enrollment → Class và Student cùng tài khoản;
  ADMIN chỉ đọc dữ liệu của mình, ID bộ lọc ngoài phạm vi trả mảng rỗng.
- GET bao gồm học phí của Enrollment LEFT và Class/Student không còn ACTIVE;
  sắp xếp kỳ giảm dần, thời điểm tạo giảm dần rồi ID giảm dần. Response thêm
  `status` tính bằng Decimal: PAID khi `amountPaid >= amountDue` (gồm 0/0),
  UNPAID khi chưa trả và còn tiền phải thu, PARTIAL khi trả một phần.
  Bộ lọc trạng thái so sánh các cột Decimal trong DB. Không thêm cột status,
  không đổi schema/POST hoặc tự ghi thời gian thanh toán khi đọc.
- Test Payment đạt 2/2 trên PostgreSQL (POST và GET danh sách), TypeScript đạt.
  GET kiểm tra auth, quyền A/B/ADMIN, quan hệ chéo, mảng rỗng, bốn bộ lọc AND,
  Decimal/0 đồng, ngày/UUID/query sai, thứ tự ba tầng và giữ nguyên lịch sử.
  Dữ liệu thử đã được dọn; cách gọi và kết quả ở `docs/payment-api.md`.
- Đã thêm `GET /api/payments/:id`: validate UUID 36 ký tự, kiểm tra ID Payment
  cùng quyền sở hữu Class và Student qua Enrollment ngay trong truy vấn.
  Không tồn tại/khác tài khoản trả cùng 404, kể cả ADMIN. Response dùng cùng
  11 trường/serializer trạng thái với danh sách; giữ nguyên học phí lịch sử,
  snapshot và dữ liệu cha, bao gồm Enrollment LEFT/Class/Student không ACTIVE.
- Test Payment đạt 3/3 trên PostgreSQL (POST, danh sách, chi tiết), TypeScript
  đạt. Chi tiết kiểm tra UUID/auth/quyền A/B/ADMIN/quan hệ chéo, response,
  trạng thái Decimal, học phí lịch sử và snapshot sau đổi học phí lớp.
  GET không thay đổi dữ liệu; fixture riêng đã được dọn.
- Người dùng đã duyệt quy tắc PATCH tại `docs/payment-update-proposal.md`.
  Đã thêm `PATCH /api/payments/:id`, chỉ nhận `amountDue`, `amountPaid`,
  `paymentMethod`, `note`; trường không gửi giữ nguyên. `amountPaid` là tổng
  đã thu thay thế giá trị cũ, cho phép sửa giảm hoặc trả thừa. Tiền dùng Decimal;
  sửa `amountDue` chỉ điều chỉnh khoản này, không đồng bộ lại từ Class.
- Sau khi ghép dữ liệu, tổng đã thu dương phải có phương thức. `paidAt` null
  khi chưa thu hoặc trả thiếu; khi đã thu và trả đủ giữ thời điểm đã có hoặc
  dùng thời điểm server. Khoản 0/0 thuộc PAID nhưng `paidAt` null. Client không
  được sửa ownership, Enrollment, kỳ, status hoặc timestamps.
- PATCH đọc và ghi đều kiểm tra ID Payment và chủ sở hữu Class/Student qua
  Enrollment; vẫn sửa được học phí lịch sử trong phạm vi. Truy vấn ghi đối
  chiếu toàn bộ bản ghi đã đọc, kể cả null/Decimal, tránh ghi đè dữ liệu thay
  đổi giữa lúc đọc và ghi. Xung đột trả 409; bản ghi mất/ngoài phạm vi trả 404.
  Response dùng cùng 11 trường với GET; không đổi schema hoặc API đã có.
- Test Payment đạt 4/4 trên PostgreSQL (POST, danh sách, chi tiết, PATCH),
  TypeScript đạt. PATCH kiểm tra quyền/auth/validation, tổng tiền Decimal,
  phương thức sau ghép, paidAt và các chuyển trạng thái, snapshot riêng của
  khoản và lịch sử. Hai request đọc cùng snapshot trả một 200/một 409;
  đổi dữ liệu nhưng giữ updatedAt vẫn bị phát hiện; đổi ownership Student
  giữa đọc/ghi trả 404 và không sửa khoản. Dữ liệu thử riêng đã được dọn.
- Người dùng đã chọn phương án A trong `docs/payment-delete-proposal.md`:
  giữ mọi Payment, tạm chưa mở API DELETE. Sửa sai bằng PATCH hiện có.
  Model không chứng minh được khoản chưa từng thu sau khi PATCH về 0/null;
  chưa bổ sung lịch sử từng lần thu/sửa hoặc trạng thái hủy.
- Phạm vi Payment cơ bản hiện có bốn endpoint POST, GET danh sách, GET chi
  tiết và PATCH. DELETE không phải bước chờ triển khai theo quyết định này;
  muốn thay đổi chiến lược giữ bản ghi cần yêu cầu và quyết định mới.

## 12. Tổng kiểm tra backend (2026-10-10)

- Đã chạy TypeScript, Prisma validate và migrate status: đều đạt, database
  báo đủ 10 migration đã cập nhật. Không chạy migration/reset/seed trong lượt.
- Chạy lần lượt tám script hiện có: Auth 3/3, Class 2/2, Student 5/5,
  Enrollment 3/3, Schedule 5/5, Payment 4/4, schema Schedule 1/1 và schema
  Payment 1/1. Tổng 24/24 đạt trên PostgreSQL, không fail/skipped/cancelled.
- Code hiện có 29 cặp phương thức/đường dẫn và 7 model ứng dụng. Payment giữ
  bốn endpoint, không DELETE theo phương án A. Test đã kiểm tra quyền A/B,
  snapshot và giữ Payment khi nghỉ lớp/chặn xóa Class/Student có ghi danh.
- Báo cáo chi tiết: `docs/backend-status-report.md`, gồm danh sách API,
  bảng/quan hệ, logic, kết quả thật và giới hạn coverage. Lúc tổng kiểm tra
  chưa có test HTTP xuyên suốt; test này được bổ sung ở mục 15. Một số
  ADMIN/PENDING theo endpoint còn cần bổ sung. Các case logout/refresh
  replay/expiry được thêm ở mục 14.
- Bốn request thử ngoài bộ test xác nhận lỗi middleware chung: body quá lớn
  và charset/encoding không hỗ trợ trả 500 thay vì 413/415; cả bốn response
  lỗi đọc body thiếu CORS headers. Lượt tổng kiểm tra chỉ ghi nhận; các lỗi
  này đã được sửa trong bước tiếp theo ở mục 13.
- Lượt này chỉ tổng kiểm tra và cập nhật tài liệu. Bước tiếp theo do người
  dùng chọn, không tự mở rộng API hoặc chiến lược DELETE Payment.

## 13. Sửa lỗi HTTP parser và CORS (2026-10-10)

- Sau khi người dùng gửi `next`, đã sửa middleware chung trong `src/app.ts`:
  CORS chạy trước JSON/cookie parser, giữ origin cấu hình và credentials.
- Error handler giữ JSON sai cú pháp 400, trả body quá lớn 413 và charset/
  encoding không hỗ trợ 415 bằng thông báo cố định. Kiểm tra cả type/status
  parser; không trả/log raw body trong các nhánh này. Lỗi khác vẫn trả 500.
- Thêm `tests/http-parser.integration.test.ts` và script `npm run test:http`.
  Test kiểm tra bốn lỗi parser cùng CORS, preflight 204, validation 400,
  Class thiếu token 401 và route không tồn tại 404; không ghi database.
- TypeScript đạt; test HTTP 1/1, Auth 3/3 và Class 2/2 đạt (tổng 6/6), không
  fail/skipped/cancelled. Chỉ chạy các bộ phù hợp với thay đổi middleware;
  kết quả tổng kiểm tra 24/24 của lượt trước được giữ riêng ở mục 12.
- Cập nhật kết quả trước/sau và giới hạn kiểm chứng trong
  `docs/backend-status-report.md`. Không đổi schema, endpoint hoặc JWT flow.
  Bước bổ sung test logout/refresh được người dùng duyệt và thực hiện ở mục 14.

## 14. Kiểm tra logout và refresh token (2026-10-10)

- Sau khi người dùng gửi `next`, đã thêm hai test
  `tests/auth.refresh.integration.test.ts` và
  `tests/auth.logout.integration.test.ts` vào script `npm run test:auth`.
- Refresh kiểm tra token thiếu/rỗng/sai/hết hạn, rotation trên cùng bản ghi,
  DB lưu hash, chặn token đã dùng, hai request song song một 200/một 401;
  cookie của request thắng vẫn dùng được và access token gọi `/me` được.
- Logout kiểm tra hai phiên A và một phiên B: thu hồi đúng A1, xóa cookie,
  giữ nguyên A2/B và cả hai vẫn refresh được. Gọi lại/thiếu/rỗng/sai cookie
  vẫn 200; access JWT còn hạn tiếp tục dùng được theo thiết kế hiện tại.
- Bộ Auth đạt 5/5 trên PostgreSQL, không fail/skipped/cancelled. TypeScript
  src và typecheck riêng hai test mới đạt sau khi sửa lỗi kiểu closure trong
  test logout. Fixtures được dọn theo ID riêng; không reset/migrate/seed.
- Runtime Auth giữ nguyên. Coverage chưa gồm ACTIVE chuyển PENDING sau cấp
  token hoặc refresh/logout đồng thời. Logout dùng cookie cũ sau rotation
  không thu hồi token mới theo truy vấn hiện có; chưa đổi chính sách phiên.
- Cập nhật `docs/auth-approval.md` và `docs/backend-status-report.md`.
  Test HTTP xuyên suốt nghiệp vụ được người dùng duyệt và thực hiện ở mục 15.

## 15. Kiểm tra HTTP xuyên suốt nghiệp vụ (2026-10-10)

- Sau khi người dùng gửi `next`, thêm
  `tests/workflow.e2e.integration.test.ts` và script `npm run test:e2e`.
  Một ADMIN fixture riêng được tạo trong DB; hai giáo viên A/B đi qua HTTP
  đăng ký PENDING → ADMIN login/duyệt → login ACTIVE và gọi `/me`.
- Mỗi giáo viên tạo Class/Student, ghi danh, lịch và học phí qua API thật.
  Kiểm tra backend tự gán ownership dù client gửi teacherId/teacher_id của
  tài khoản khác; hai hồ sơ cùng tên vẫn có ID riêng. Các danh sách và hồ sơ
  Student lồng trong Enrollment thuộc đúng tài khoản.
- Hai chiều A/B không truy cập/sửa/xóa hoặc tạo quan hệ trên tài nguyên của
  nhau. Filter học phí ngoài phạm vi trả rỗng; ADMIN cũng không đọc Class A.
  TEACHER không xem/duyệt đăng ký; danh sách nghiệp vụ vẫn yêu cầu đăng nhập.
- Đổi học phí Class 500000.00 → 600000.00 giữ amountDue khoản cũ 500000.00.
  Thu một phần → đủ chuyển UNPAID/PARTIAL/PAID, amountPaid là tổng thay thế,
  phương thức được giữ và paidAt là thời điểm server thu đủ. Tạo trùng kỳ 409.
- Nghỉ lớp giữ Enrollment/Payment/Schedule, ngày nghỉ UTC và idempotence;
  ghi danh lại 409, xóa Class/Student có lịch sử 409. Nhánh dữ liệu B không
  đổi sau các thao tác A; ownership Class/Student được kiểm tra lại trong DB.
- Test E2E đạt 1/1 trên PostgreSQL, không fail/skipped/cancelled. TypeScript
  src và typecheck riêng file test đều đạt. Không chạy lại toàn bộ các bộ
  module trong lượt này; các kết quả trước giữ riêng theo từng bước.
- Dọn theo exact email UUID fixture, tìm quan hệ theo chủ sở hữu/ID cha,
  Payment trước Enrollment rồi Schedule/Class/Student/RefreshToken/User;
  vẫn dọn được khi POST commit trước assertion lỗi. Không in token/cookie,
  không reset/migrate/seed ADMIN thật hoặc thay đổi API/runtime.
- Kết quả và giới hạn ở `docs/backend-status-report.md`. Bước tiếp theo chỉ
  thực hiện khi người dùng chọn; chưa kiểm tra ACTIVE → PENDING sau cấp token.

## 16. Chạy toàn bộ bộ test hiện có (2026-10-10)

- Theo yêu cầu `TESL ALL`, chạy lần lượt toàn bộ 10 script test. Inventory
  gồm 26 file, tất cả được script tham chiếu đúng một lần.
- Kết quả: HTTP 1/1, Auth 5/5, Class 2/2, Student 5/5, Enrollment 3/3,
  Schedule 5/5, Payment 4/4, schema Schedule 1/1, schema Payment 1/1 và
  E2E 1/1. Tổng **28/28 đạt**, không fail/skipped/cancelled; exit code đều 0.
- TypeScript trong phạm vi src đạt, Prisma validate hợp lệ, migrate status
  báo 10 migration và database đã cập nhật. Không reset/chạy migration/seed,
  commit/push hoặc đổi source/test/script trong lượt này.
- Test dùng fixture và cleanup/rollback hiện có. Kết quả chi tiết ở mục 10
  của `docs/backend-status-report.md`; các giới hạn coverage vẫn được giữ.
  Đã chốt bộ test hiện có, dừng và chờ người dùng chọn bước tiếp theo.
