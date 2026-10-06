# Enrollment API

Enrollment là bản ghi trong bảng Prisma `ClassStudent`, liên kết một Student với
một Class. Hiện đã có API tạo ghi danh, danh sách và cho học sinh rời lớp.

## POST /api/classes/:classId/students

Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
`classId` là số nguyên dương không vượt quá 2147483647. Body dùng JSON:

```json
{
  "studentId": "8b3d8666-b8d4-4b44-a15a-cdd3cd750573",
  "joinedAt": "2026-10-06"
}
```

- `studentId`: bắt buộc, UUID của hồ sơ Student đã có.
- `joinedAt`: bắt buộc, ngày tồn tại theo định dạng `YYYY-MM-DD`.
- Chỉ nhận hai trường trên. Các trường khác như `teacherId`, `classId`, `status`,
  `leftAt`, `id` hoặc timestamps trả 400.
- Backend lấy `userId` từ middleware xác thực, kiểm tra cả Class và Student
  thuộc tài khoản này. ADMIN cũng chỉ ghi danh vào dữ liệu của chính mình.
- Khi tạo, backend luôn gán `status = ACTIVE` và `leftAt = null`.
- Một Student có thể tham gia nhiều Class của cùng giáo viên. Mỗi cặp
  Class–Student chỉ có một Enrollment; ghi danh trùng, kể cả bản ghi đã `LEFT`,
  trả 409 và giữ lịch sử cũ.
- Chưa bổ sung quy tắc giới hạn `joinedAt` theo ngày bắt đầu/kết thúc lớp hoặc
  chặn theo trạng thái Class/Student.

Thành công trả HTTP 201:

```json
{
  "success": true,
  "message": "Ghi danh học sinh thành công",
  "data": {
    "enrollment": {
      "id": "cf95e4f6-d5b0-4ed4-8b7e-027502f96ac2",
      "classId": 42,
      "studentId": "8b3d8666-b8d4-4b44-a15a-cdd3cd750573",
      "joinedAt": "2026-10-06",
      "leftAt": null,
      "status": "ACTIVE",
      "createdAt": "2026-10-06T03:00:00.000Z",
      "updatedAt": "2026-10-06T03:00:00.000Z"
    }
  }
}
```

Response không trả thông tin giáo viên hoặc dữ liệu Student/Class lồng nhau.
Ngày là `YYYY-MM-DD`, timestamps là ISO UTC.

| Trường hợp | HTTP |
| --- | --- |
| ID lớp hoặc body sai | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Class/Student không tồn tại hoặc thuộc tài khoản khác | 404 |
| Class/Student bị xóa đồng thời trước khi ghi danh thành công | 404 |
| Cặp Class–Student đã tồn tại | 409 |

Quyền sở hữu còn được kiểm tra trong `connect` khi lưu. Khóa ngoại và unique
constraint bảo vệ dữ liệu khi request chạy đồng thời; ghi danh trùng trả
`{"success":false,"message":"Học sinh đã từng được ghi danh vào lớp này"}`.

## GET /api/classes/:classId/students

Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
Không cần body. `classId` có cùng validation như API POST.

- Chỉ xem lớp thuộc tài khoản đăng nhập; lớp không tồn tại hoặc thuộc tài khoản
  khác đều trả 404 `Không tìm thấy lớp`, kể cả khi người gọi là ADMIN.
- Trả cả Enrollment `ACTIVE` và `LEFT`, sắp xếp theo `createdAt` mới nhất trước,
  rồi `id` giảm dần khi trùng thời gian.
- Response là `data.enrollments`. Mỗi phần tử gồm các trường của Enrollment
  trong response POST và một object `student` theo định dạng ở `student-api.md`.
  Ngày dùng `YYYY-MM-DD`, timestamps dùng ISO UTC.
- Truy vấn lọc cả chủ sở hữu Class lẫn Student lồng nhau. Không trả Enrollment
  nối đến Student của tài khoản khác, kể cả khi có dữ liệu sai quan hệ trong DB.
  Response không trả `teacherId`/`teacher_id`.
- Lớp chưa có ghi danh trả HTTP 200 với mảng rỗng:

```json
{
  "success": true,
  "data": {
    "enrollments": []
  }
}
```

ID lớp sai trả 400; thiếu/sai/hết hạn token trả 401; tài khoản chưa ACTIVE hoặc
role không được phép trả 403. Chưa thêm filter, search, pagination hoặc total.

## DELETE /api/classes/:classId/students/:studentId

Cho học sinh rời lớp và giữ nguyên bản ghi Enrollment để lưu lịch sử.
Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
`classId` là số nguyên dương không vượt quá 2147483647; `studentId` là UUID.
Không cần body; backend không sử dụng dữ liệu body để cập nhật.

- Truy vấn cập nhật kiểm tra đồng thời cặp Class–Student, chủ sở hữu của cả Class
  và Student, trạng thái `ACTIVE` và ngày vào lớp không sau ngày nghỉ.
- Backend chuyển `status` sang `LEFT`, đặt `leftAt` bằng ngày hiện tại theo UTC.
  Ngày được lưu dưới dạng DATE; response dùng `YYYY-MM-DD`.
- Không xóa Enrollment, không sửa `joinedAt`, Class hoặc hồ sơ Student. Các
  Enrollment của học sinh trong lớp khác vẫn giữ nguyên.
- Gọi lại khi đã `LEFT` trả HTTP 200 với bản ghi cũ; giữ nguyên `leftAt` và
  `updatedAt`, kể cả khi request đến đồng thời.
- Ghi danh đang `ACTIVE` nhưng `joinedAt` ở tương lai trả 400, không đổi dữ liệu.
- Không tồn tại Enrollment hoặc không sở hữu cả Class và Student đều trả 404
  `Không tìm thấy ghi danh`. ADMIN cũng chỉ thao tác trên dữ liệu của mình.
- Enrollment `LEFT` vẫn xuất hiện trong GET danh sách; tạo lại cùng cặp bằng
  POST tiếp tục trả 409. DELETE Class/Student có lịch sử ghi danh tiếp tục trả 409.

Ví dụ gọi `DELETE /api/classes/42/students/8b3d8666-b8d4-4b44-a15a-cdd3cd750573`
vào ngày 2026-10-06 (UTC), thành công trả HTTP 200:

```json
{
  "success": true,
  "message": "Học sinh đã rời lớp",
  "data": {
    "enrollment": {
      "id": "cf95e4f6-d5b0-4ed4-8b7e-027502f96ac2",
      "classId": 42,
      "studentId": "8b3d8666-b8d4-4b44-a15a-cdd3cd750573",
      "joinedAt": "2026-09-03",
      "leftAt": "2026-10-06",
      "status": "LEFT",
      "createdAt": "2026-09-03T03:00:00.000Z",
      "updatedAt": "2026-10-06T03:00:00.000Z"
    }
  }
}
```

| Trường hợp | HTTP |
| --- | --- |
| ID lớp/học sinh sai hoặc ngày nghỉ trước ngày vào lớp | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Enrollment không tồn tại hoặc không thuộc phạm vi giáo viên | 404 |
| Rời lớp thành công hoặc đã rời lớp trước đó | 200 |

## Kiểm tra

Chạy `npx tsc --noEmit` và `npm run test:enrollments`. Test cần database đã
migrate, tự tạo hai tài khoản ACTIVE, Class/Student và Enrollment fixture rồi
dọn đúng các fixture đó. Test kiểm tra ownership A/B, validation, access token,
Student tham gia nhiều lớp và hai request ghi danh trùng chạy đồng thời. Test
GET kiểm tra lớp rỗng, thứ tự ACTIVE/LEFT, định dạng response và dữ liệu Student
lồng nhau không vượt phạm vi tài khoản.
Test DELETE kiểm tra ownership, ngày nghỉ, giữ lịch sử, gọi lặp/đồng thời,
ghi danh tương lai, lớp khác không bị ảnh hưởng và không thể ghi đè dữ liệu từ body.

Chạy các bộ integration test lần lượt vì cùng sử dụng database của dự án.
