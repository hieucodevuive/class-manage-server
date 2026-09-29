# Hướng dẫn làm việc — Class Management Backend

Trước khi bắt đầu một bước database/API, đọc toàn bộ
`docs/backend-implementation-instructions.md`. Đây là bản hướng dẫn do người dùng
cung cấp cho thiết kế và trình tự triển khai mới. Áp dụng cùng yêu cầu hiện tại
của người dùng; nếu có điểm không rõ hoặc mâu thuẫn với code đang chạy, giải thích
và hỏi trước khi thay đổi có ảnh hưởng lớn.

## Cách làm việc

- Giao tiếp bằng tiếng Việt, giải thích dễ hiểu cho người mới học backend.
- Mỗi lượt chỉ làm một bước: kiểm tra code, giải thích mục tiêu/logic, liệt kê
  file sẽ sửa, áp dụng đúng bước đó, chạy kiểm tra phù hợp, tóm tắt và dừng.
- Chờ người dùng nói "tiếp", "continue" hoặc đồng ý rõ ràng trước bước tiếp theo.
- Thứ tự: kiểm tra hiện trạng → Class → Student → Enrollment → ClassSchedule
  → Payment. Không tạo trước model/layer chưa dùng.
- Class model cần được người dùng duyệt trước khi cập nhật API, từng endpoint
  theo thứ tự POST → GET danh sách → GET chi tiết → PATCH → DELETE.

## Giữ nguyên kiến trúc hiện tại

- Express 5, TypeScript/CommonJS, PostgreSQL, Prisma và Zod.
- Module nằm trong `src/modules/<feature>/`; route → controller → service
  → repository → Prisma. Giữ prefix `/api`, response và naming convention hiện có.
- Không rewrite authentication, JWT/refresh token, architecture hoặc thêm ORM.
- Business routes tiếp tục dùng auth/role middleware hiện tại.
- Không sửa file Prisma Client được generate; dùng `npx prisma generate` khi cần.
- Không in/chia sẻ secret trong `.env` hoặc token. Giữ nguyên thay đổi không liên quan.

## Các yêu cầu thiết kế cần nhớ

- Student và Class là nhiều–nhiều qua Enrollment; Student không có `classId`.
- Payment tham chiếu Enrollment, lưu snapshot `amountDue`; tiền dùng Decimal,
  không dùng floating point. Billing period là ngày đầu tháng.
- Không lưu `studentCount`, tuổi hay payment status tính được làm column nếu
  không có lý do được người dùng duyệt.
- Bảo vệ lịch sử Enrollment/Payment; không cascade delete lịch sử tài chính.
  Nếu phải thay đổi hard delete đang có, đề xuất và chờ duyệt trước.
- Không tự đổi ID, rename bảng/cột, reset database hoặc giả định giá trị backfill
  cho dữ liệu cũ. Trình bày migration strategy và xin quyết định khi cần.

## Hiện trạng và quyết định mới nhất (2026-09-29)

- Auth và CRUD Class cơ bản đã có. Model Class đã mở rộng với grade, schoolYear,
  subject, tuitionFee, startDate, endDate, status và note; migration
  `20260929151529_expand_class_model` đã được áp dụng và client đã generate.
- Người dùng đã quyết định giữ Class ID là `Int @id @default(autoincrement())`
  (2026-09-29), không chuyển UUID. Quyết định này thay thế yêu cầu UUID cho Class
  trong tài liệu gốc; khóa ngoại Enrollment trỏ tới Class cũng phải dùng Int.
  Chưa suy rộng quyết định này sang ID của Student hay các model khác.
- Chưa có Student, Enrollment, ClassSchedule hay Payment.
- Bước model/migration đã kiểm tra thành công với PostgreSQL. Bảng Class không có
  dữ liệu cũ khi migration, không dùng giá trị giả để backfill trường bắt buộc.
- POST /api/classes đã cập nhật để validate và lưu đầy đủ model mới; TypeScript
  không còn lỗi thiếu trường tại insertClass. Đã test HTTP với database thật.
- POST yêu cầu name/grade/schoolYear/subject/tuitionFee/startDate; endDate/note
  optional hoặc null, status mặc định ACTIVE. School year gồm hai năm liên tiếp.
  Học phí nhận số hoặc chuỗi thập phân, tối đa 2 chữ số phần lẻ; service dùng
  Prisma.Decimal, response hiện serialize tuitionFee thành chuỗi Decimal.
- Người dùng đã yêu cầu rõ ràng cập nhật đầy đủ API Class trong một lượt
  (2026-09-29); ngoại lệ này chỉ áp dụng cho lượt hoàn thiện Class, không tự
  mở rộng sang Student/Enrollment/Schedule/Payment.
- Cả 5 endpoint Class đã hoàn thiện theo model đầy đủ. POST/GET/PATCH dùng
  serializeClass: tuitionFee là chuỗi Decimal 2 chữ số phần lẻ, ngày học là
  YYYY-MM-DD, timestamps là ISO UTC. Chi tiết ở `docs/class-api.md`.
- PATCH cập nhật một hoặc nhiều field, không reset field không gửi; có thể
  clear endDate/note bằng null. So sánh ngày với dữ liệu DB, xử lý lỗi CHECK
  ngày khi có cập nhật đồng thời qua Prisma PostgreSQL adapter.
- DELETE hiện vẫn hard delete vì chưa có Enrollment/Payment. Phải bổ sung quy
  tắc bảo vệ lịch sử trước khi cho phép xóa lớp có các quan hệ này.
- Bộ test được giữ tại `tests/classes.integration.test.ts`; chạy
  `npm run test:classes`. Chỉ tạo/xóa fixture của lượt test, không reset DB.
- Class CRUD đã xong; bước kế tiếp chỉ sau khi người dùng đồng ý là thiết kế
  model Student. Không tự triển khai Student hay các phase còn lại.
