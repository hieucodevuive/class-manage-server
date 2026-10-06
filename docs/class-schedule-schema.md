# ClassSchedule — schema lịch học

Một Class có nhiều khung giờ học trong tuần. Mỗi bản ghi ClassSchedule lưu một
ngày trong tuần và giờ bắt đầu/kết thúc, không lưu một buổi học có ngày cụ thể.

## Model và quan hệ

Giữ naming convention hiện tại: bảng vật lý `"ClassSchedule"`, cột camelCase.
Tên logic trong thiết kế là `class_schedules`.

| Trường Prisma/DB | Kiểu PostgreSQL | Quy tắc |
| --- | --- | --- |
| `id` | UUID | Khóa chính; Prisma tạo UUID khi insert |
| `classId` | INTEGER | Bắt buộc; FK đến `"Class"."id"` |
| `dayOfWeek` | enum `DayOfWeek` | Bắt buộc, không có default |
| `startTime` | TIME(0) | Bắt buộc; giờ không kèm múi giờ, độ chính xác đến giây |
| `endTime` | TIME(0) | Bắt buộc; phải lớn hơn `startTime` |
| `createdAt` | TIMESTAMPTZ(3) | Bắt buộc; default thời điểm tạo |
| `updatedAt` | TIMESTAMPTZ(3) | Bắt buộc; Prisma tự cập nhật khi ghi |

`DayOfWeek`: `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, `FRIDAY`, `SATURDAY`,
`SUNDAY`.

- Quan hệ Class 1:N ClassSchedule qua `classId`; relation trong Class là
  `schedules`, trong ClassSchedule là `classRecord`.
- Không thêm `teacherId` vào lịch học. Giáo viên được xác định qua
  ClassSchedule → Class → `teacher_id`; API ở bước sau phải kiểm tra lớp cha
  thuộc `res.locals.auth.userId` trên mỗi request.
- Index `ClassSchedule_classId_idx` phục vụ truy vấn lịch theo lớp.
- CHECK `ClassSchedule_times_check` chặn giờ bằng nhau, đảo ngược và khung giờ
  qua nửa đêm. Không thêm unique ngày/giờ hoặc quy tắc chống trùng lịch ở bước này.
- Xóa Class sẽ xóa lịch của chính Class đó (`ON DELETE CASCADE`). Khi Class có
  Enrollment, khóa ngoại `ON DELETE RESTRICT` của Enrollment vẫn chặn xóa Class
  và giữ toàn bộ lịch sử.
- Prisma biểu diễn TIME bằng `DateTime` với `@db.Time(0)`; bảng DB chỉ lưu giờ.
  API tạo lịch nhận `HH:mm` hoặc `HH:mm:ss` và trả `HH:mm:ss`; chi tiết ở
  `docs/class-schedule-api.md`.

## Migration

Migration: `20261006143111_create_class_schedule_model`.

- Chỉ tạo enum, bảng, CHECK, index và FK mới trong transaction.
- Không sửa dữ liệu Class/Student/Enrollment, không cần backfill và không reset DB.
- Áp dụng sau khi kiểm tra các migration trước đã hoàn thành và bảng/enum mới
  chưa tồn tại. Đây là thay đổi thêm bảng, không khiến API hiện tại thiếu trường
  bắt buộc khi insert vào Class/Student/Enrollment.

```text
npx prisma validate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
npx tsc --noEmit
npm run test:schedules:schema
```

Test schema dùng PostgreSQL thật: kiểm tra kiểu cột, enum, CHECK giờ, FK/index,
cascade lịch và việc Enrollment vẫn chặn xóa Class. Toàn bộ fixture nằm trong
transaction và được rollback sau test. Chạy các bộ test database lần lượt.

## Kết quả bước schema (2026-10-06)

- Migration đã áp dụng; database có đủ 9 migration và Prisma Client đã generate.
- Prisma validate, TypeScript và kiểm tra diff đều đạt.
- `test:schedules:schema`: 1/1 đạt, fixture được rollback.
- `test:enrollments`: 3/3 đạt; đã thêm lịch học vào fixture để kiểm tra Prisma
  ghi/đọc TIME và DELETE Class có Enrollment vẫn trả 409, giữ cả lịch học.
- `test:classes`: 2/2 đạt. Test API chỉ tạo/dọn fixture riêng.

Đã có `POST`, `GET /api/classes/:classId/schedules` và
`GET`, `PATCH`, `DELETE /api/classes/:classId/schedules/:scheduleId`. ClassSchedule
CRUD cơ bản đã đủ năm endpoint; xem `docs/class-schedule-api.md`.
