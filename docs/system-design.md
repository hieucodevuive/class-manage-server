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
  ClassSchedule CRUD cơ bản đã có đủ năm endpoint; Payment chưa triển khai.
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
