# Student API

## POST /api/students

Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
Backend lấy `userId` từ token đã xác thực và tự gán `teacher_id`. Client không
thể gán học sinh cho tài khoản khác.

Body tối thiểu:

```json
{
  "fullName": "Nguyễn Văn An"
}
```

- `fullName`: chuỗi không rỗng sau khi trim, tối đa 150 ký tự.
- `phone`, `parentPhone`: tùy chọn hoặc null; chuỗi 7–20 ký tự, ít nhất 7 chữ số,
  cho phép dấu `+` đầu chuỗi, khoảng trắng, dấu chấm, ngoặc và dấu gạch ngang.
- `parentName`: tùy chọn hoặc null, chuỗi không rỗng, tối đa 150 ký tự.
- `school`: tùy chọn hoặc null, chuỗi không rỗng, tối đa 200 ký tự.
- `grade`: tùy chọn hoặc null, số nguyên từ 1 đến 12.
- `dateOfBirth`: tùy chọn hoặc null, ngày tồn tại theo `YYYY-MM-DD`.
- `address`, `note`: tùy chọn hoặc null, chuỗi được trim.
- `status`: `ACTIVE` hoặc `INACTIVE`; không gửi thì mặc định `ACTIVE` tại API.
- Các field ngoài schema, gồm `id`, `teacherId`/`teacher_id`, `classId` và
  timestamps, bị loại bỏ. ID Student là UUID do Prisma tạo.

Thành công: HTTP 201, giữ cấu trúc response hiện có:

```json
{
  "success": true,
  "message": "Tạo học sinh thành công",
  "data": {
    "student": {
      "id": "00000000-0000-0000-0000-000000000000",
      "fullName": "Nguyễn Văn An",
      "phone": null,
      "parentName": null,
      "parentPhone": null,
      "school": null,
      "grade": null,
      "dateOfBirth": null,
      "address": null,
      "status": "ACTIVE",
      "note": null,
      "createdAt": "2026-10-01T00:00:00.000Z",
      "updatedAt": "2026-10-01T00:00:00.000Z"
    }
  }
}
```

Response không trả `teacherId`. `dateOfBirth` là `YYYY-MM-DD`, timestamps là ISO
UTC. Body sai trả 400 với `success`, `message`, `errors` theo field. Thiếu/sai
access token trả 401; role không được phép trả 403 theo middleware hiện có.

## GET /api/students

Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
Danh sách chỉ gồm hồ sơ có `teacher_id` bằng ID tài khoản đã xác thực, sắp xếp
theo `createdAt` mới nhất trước (`id` giảm dần khi trùng thời gian). Mỗi phần tử
dùng cùng định dạng Student như response của POST, không trả `teacherId`.

Thành công: HTTP 200, kể cả khi danh sách rỗng:

```json
{
  "success": true,
  "data": {
    "students": []
  }
}
```

Thiếu hoặc sai access token trả 401 theo middleware hiện có. API này chưa có
search, filter, pagination hoặc total.

## GET /api/students/:id

Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
`id` phải là UUID. Backend tìm học sinh theo cả `id` và `teacher_id` của tài khoản
đã xác thực. Thành công trả HTTP 200 với `data.student` cùng định dạng response
của POST. ID sai định dạng trả 400; ID không tồn tại hoặc thuộc giáo viên khác
đều trả 404 `Không tìm thấy học sinh`. Thiếu/sai access token trả 401.

## PATCH /api/students/:id

Yêu cầu access token và role `TEACHER` hoặc `ADMIN`. Chỉ cập nhật hồ sơ thuộc tài
khoản đang đăng nhập. Body cần ít nhất một trường hợp lệ trong danh sách của POST;
các trường không gửi giữ nguyên. Có thể gửi `null` để xóa các trường nullable.
Không thể sửa `id`, `teacherId`/`teacher_id` hoặc timestamps. `status` không tự
đổi thành `ACTIVE` nếu bỏ qua. Thành công trả HTTP 200 với `message` và
`data.student`. ID sai định dạng hoặc body không hợp lệ trả 400; ID không tồn tại
hoặc thuộc tài khoản khác trả 404.

## DELETE /api/students/:id

Yêu cầu access token và role `TEACHER` hoặc `ADMIN`. Chỉ xóa hồ sơ thuộc tài khoản
đang đăng nhập. Thành công trả HTTP 200:

```json
{
  "success": true,
  "message": "Xóa học sinh thành công"
}
```

ID sai định dạng trả 400; ID không tồn tại hoặc thuộc tài khoản khác trả 404.
Hồ sơ chưa có Enrollment được xóa hẳn. Nếu đã từng có Enrollment, kể cả trạng
thái `LEFT`, trả 409 và giữ nguyên hồ sơ cùng lịch sử:

```json
{ "success": false, "message": "Không thể xóa học sinh đã có lịch sử ghi danh" }
```

Khóa ngoại `RESTRICT` cũng chặn xóa khi Enrollment được tạo đồng thời.
