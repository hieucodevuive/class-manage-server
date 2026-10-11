# Class API

Mọi endpoint yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc
`ADMIN`. Mỗi tài khoản chỉ thao tác trên lớp của chính mình, kể cả role `ADMIN`.
Backend lấy `userId` từ access token đã xác thực để xác định chủ sở hữu. ID Class
là số nguyên dương tự tăng, không dùng UUID.

Swagger cho 5 API CRUD Class nằm trong nhóm **Classes** tại `/api/docs/`.
OpenAPI JSON ở `/api/docs/openapi.json`. Đăng nhập rồi nhập access token vào
**Authorize → bearerAuth**, không thêm tiền tố `Bearer`; hướng dẫn chung ở
[swagger-auth.md](swagger-auth.md). Ví dụ dùng cổng 5000:
[mở Swagger UI](http://localhost:5000/api/docs/).

Các API ghi danh/lịch học dưới đường dẫn Class sẽ được bổ sung Swagger ở
bước tài liệu của module tương ứng.

## POST /api/classes

Body tối thiểu:

```json
{
  "name": "Văn 12A1",
  "grade": 12,
  "schoolYear": "2026-2027",
  "subject": "Ngữ Văn",
  "tuitionFee": "600000.00",
  "startDate": "2026-09-01"
}
```

- `name` và `subject`: bỏ khoảng trắng hai đầu, không rỗng, tối đa 100 ký tự.
- `grade`: JSON number, số nguyên từ 1 đến 12.
- `schoolYear`: hai năm 4 chữ số liên tiếp, ví dụ `2026-2027`.
- `tuitionFee`: số hoặc chuỗi thập phân từ 0 đến 9999999999.99, tối đa 2 chữ số
  phần lẻ. Ưu tiên gửi chuỗi để giữ chính xác giá trị tiền.
- `startDate`: ngày thực sự tồn tại, định dạng `YYYY-MM-DD`.
- `endDate`: có thể bỏ qua hoặc null; nếu có phải không trước startDate.
- `status`: `ACTIVE`, `INACTIVE`, `COMPLETED`; bỏ qua khi tạo thì mặc định ACTIVE.
- `note`: chuỗi (trim), có thể bỏ qua hoặc null.
- Không nhận id, teacherId/teacher_id, createdAt, updatedAt, studentCount từ
  client; field không thuộc schema bị loại bỏ. `teacher_id` trong database được
  backend tự gán theo tài khoản đã đăng nhập.

Thành công: 201, `{ "success": true, "message": "Tạo lớp thành công", "data": { "class": ... } }`.

## GET /api/classes

Thành công: 200, `{ "success": true, "data": { "classes": [...] } }`.
Không có lớp thì classes là mảng rỗng. Danh sách được sắp xếp theo createdAt giảm
dần, rồi id giảm dần. Chỉ trả lớp thuộc tài khoản đăng nhập. Hiện chưa thêm
search/filter/pagination hoặc total/count.

## GET /api/classes/:id

Thành công: 200, `{ "success": true, "data": { "class": ... } }`.
ID sai: 400. ID hợp lệ nhưng không tồn tại hoặc thuộc tài khoản khác: 404.
ID trên đường dẫn chỉ gồm chữ số, giá trị từ 1 đến 2147483647. Theo validation
hiện có, số 0 ở đầu được chấp nhận (ví dụ `00042` được hiểu là ID 42).

## PATCH /api/classes/:id

Gửi ít nhất một field hợp lệ trong các field của POST; không cần gửi lại toàn bộ.

```json
{
  "tuitionFee": "750000.50",
  "status": "INACTIVE"
}
```

Field không gửi sẽ giữ nguyên. Không gửi status sẽ không reset về ACTIVE.
Gửi `endDate: null` hoặc `note: null` để xóa giá trị tương ứng. Các field bắt buộc
khác không nhận null. Body rỗng hoặc chỉ chứa field không được sửa trả 400.
Không thể đổi `teacher_id`; truy vấn đọc trước và truy vấn cập nhật đều kiểm tra
ID lớp cùng chủ sở hữu.

Khi chỉ gửi startDate hoặc endDate, service so sánh với ngày còn lại trong
database. CHECK constraint cũng bảo vệ thứ tự ngày khi có cập nhật đồng thời.

Thành công: 200, `{ "success": true, "message": "Cập nhật lớp thành công", "data": { "class": ... } }`.
Sai dữ liệu: 400. Không có lớp hoặc lớp thuộc tài khoản khác: 404.

## DELETE /api/classes/:id

Không cần body. Thành công: 200.

```json
{ "success": true, "message": "Xóa lớp thành công" }
```

Truy vấn xóa kiểm tra đồng thời ID lớp và chủ sở hữu. Xóa lớp của tài khoản khác
hoặc xóa lại trả 404. Lớp chưa có Enrollment được xóa hẳn. Nếu đã từng có
Enrollment, kể cả trạng thái `LEFT`, trả 409 và giữ nguyên lớp cùng lịch sử:

```json
{ "success": false, "message": "Không thể xóa lớp đã có học sinh ghi danh" }
```

Khóa ngoại `RESTRICT` cũng chặn xóa khi Enrollment được tạo đồng thời.
Nếu lớp chưa có Enrollment được xóa thành công, lịch học của lớp cũng bị xóa
theo khóa ngoại `CASCADE`. Khi bị chặn 409, lớp, lịch và lịch sử được giữ lại.

## Định dạng Class trong response

POST, GET danh sách, GET chi tiết và PATCH dùng cùng một định dạng:

```json
{
  "id": 42,
  "name": "Văn 12A1",
  "grade": 12,
  "schoolYear": "2026-2027",
  "subject": "Ngữ Văn",
  "tuitionFee": "600000.00",
  "startDate": "2026-09-01",
  "endDate": null,
  "status": "ACTIVE",
  "note": null,
  "createdAt": "2026-09-29T00:00:00.000Z",
  "updatedAt": "2026-09-29T00:00:00.000Z"
}
```

Học phí luôn là chuỗi Decimal với 2 chữ số phần lẻ. Ngày học là YYYY-MM-DD;
timestamps là ISO UTC. Response hiện không trả `teacherId`, studentCount,
schedules hoặc các quan hệ lồng nhau.

## Lỗi và kiểm tra

Thiếu/sai/hết hạn access token: 401. Role không được phép: 403 theo middleware
hiện có; tài khoản PENDING cũng trả 403 khi dùng access token. Input schema
sai: 400 với success/message và errors theo field;
lỗi toàn body dùng field `body`. Không có lớp: 404. Xóa lớp đã có Enrollment: 409.

Chạy `npx tsc --noEmit` và `npm run test:classes`.
Test cần .env, database đã migrate và tài khoản đã seed. Test tự mở server ở
port tạm, tạo thêm một tài khoản TEACHER để kiểm tra cách ly A/B, rồi chỉ xóa
fixture của lượt test; không reset database hoặc sửa/xóa lớp có sẵn.
Chạy `npm run test:docs` để kiểm tra OpenAPI/schema/$ref, assets Swagger và
HTTP thiếu xác thực của từng endpoint đã mô tả.

Tài liệu Swagger của Class ở `src/docs/class.openapi.ts`, được ghép vào
`src/docs/openapi.ts`. Khi đổi contract Class, cập nhật cả Swagger và tài liệu
này theo route, validation, controller/serializer hiện có. Schema dùng cú
pháp [OpenAPI 3.0.4](https://spec.openapis.org/oas/v3.0.4.html).
