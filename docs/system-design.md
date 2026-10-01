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
- Tài liệu cũ mô tả khả năng học sinh rời lớp rồi ghi danh lại bằng enrollment mới và gợi ý unique index chỉ cho trạng thái ACTIVE. Yêu cầu mới `UNIQUE(class_id, student_id)` không cho phép hai bản ghi cho cùng một cặp. Cần xác nhận nghiệp vụ ghi danh lại trước bước Enrollment.
- Khi thêm `teacher_id NOT NULL` cho Class, phải kiểm tra dữ liệu Class đã tồn tại và thống nhất cách gán chủ sở hữu trước migration; không tự backfill.
