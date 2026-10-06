# ClassSchedule API

Hiện đã triển khai đủ năm API tạo, lấy danh sách, lấy chi tiết, sửa và xóa lịch học theo tuần.
Mỗi bản ghi là một khung giờ trong một ngày của tuần và thuộc một Class.

## POST /api/classes/:classId/schedules

Yêu cầu `Authorization: Bearer <accessToken>` và role `TEACHER` hoặc `ADMIN`.
`classId` là số nguyên dương không vượt quá 2147483647, lấy từ URL.
Trong Postman, chọn Body → raw → JSON:

```json
{
  "dayOfWeek": "MONDAY",
  "startTime": "19:00",
  "endTime": "21:00"
}
```

### Validation và quyền sở hữu

- Cả ba trường đều bắt buộc. `dayOfWeek` nhận `MONDAY`, `TUESDAY`, `WEDNESDAY`,
  `THURSDAY`, `FRIDAY`, `SATURDAY`, `SUNDAY`.
- Giờ là chuỗi `HH:mm` hoặc `HH:mm:ss`, dùng giờ 00–23, phút/giây 00–59 và đủ
  hai chữ số mỗi phần. Ví dụ `19:00` được chuẩn hóa thành `19:00:00`.
- Không nhận số, ngày đầy đủ, múi giờ, phần thập phân hoặc khoảng trắng trong giờ.
  `24:00` không được nhận bởi API.
- `endTime` phải sau `startTime`, trong cùng ngày. Giờ bằng nhau, đảo ngược hoặc
  lịch đi qua nửa đêm trả 400 tại field `endTime`.
- Body chỉ nhận ba trường trên. Các trường khác như `classId`, `teacherId`,
  `teacher_id`, `id`, `status`, `note`, `createdAt`, `updatedAt` trả 400.
- Backend lấy `res.locals.auth.userId`, kiểm tra Class theo cả ID và chủ sở hữu.
  Điều kiện này được kiểm tra lại trong `classRecord.connect` khi insert.
  ADMIN cũng chỉ tạo lịch cho lớp của mình.
- ID lịch học và timestamps do backend tạo. Không lưu `teacherId` trên lịch học.
- Lịch học lưu giờ không kèm múi giờ. Backend dùng mốc Date UTC cố định để Prisma
  lưu TIME; nhập `19:00` thì DB và response vẫn là `19:00:00`, không đổi giờ.
- Chưa đặt quy tắc chống trùng/giao giờ hoặc chặn theo trạng thái Class. Các
  khung giờ trùng nhau vẫn tạo được bản ghi riêng theo schema hiện tại.

### Response

Thành công trả HTTP 201:

```json
{
  "success": true,
  "message": "Tạo lịch học thành công",
  "data": {
    "schedule": {
      "id": "27889435-9dd4-42ab-a5bd-3c085d45538b",
      "classId": 42,
      "dayOfWeek": "MONDAY",
      "startTime": "19:00:00",
      "endTime": "21:00:00",
      "createdAt": "2026-10-06T15:00:00.000Z",
      "updatedAt": "2026-10-06T15:00:00.000Z"
    }
  }
}
```

Chỉ trả bảy trường của lịch học; không trả dữ liệu Class/User lồng nhau.
Giờ luôn là `HH:mm:ss`; timestamps là ISO UTC.

| Trường hợp | HTTP |
| --- | --- |
| ID lớp hoặc body sai | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Lớp không tồn tại hoặc thuộc tài khoản khác | 404 |
| Lớp bị xóa đồng thời trước khi insert thành công | 404 |
| Tạo lịch học thành công | 201 |

Lỗi body có cấu trúc giống các module hiện có:

```json
{
  "success": false,
  "message": "Thông tin lịch học không hợp lệ",
  "errors": [
    {
      "field": "endTime",
      "message": "Giờ kết thúc phải sau giờ bắt đầu"
    }
  ]
}
```

JSON sai cú pháp hoặc bị JSON parser từ chối (ví dụ body `null`) trả HTTP 400
`{"success":false,"message":"Body JSON không hợp lệ"}`. Error handler chung đã
được sửa để giữ đúng lỗi parser 400; các lỗi máy chủ khác vẫn trả 500.

## GET /api/classes/:classId/schedules

Lấy toàn bộ lịch học của một lớp. Yêu cầu access token của tài khoản ACTIVE,
role `TEACHER` hoặc `ADMIN`; không cần body. `classId` dùng cùng validation với POST.

### Logic và quyền sở hữu

- Backend lấy `res.locals.auth.userId` và truy vấn Class theo cả `id`, `teacherId`,
  rồi lấy quan hệ `schedules` của lớp đó. Không dùng `teacherId` từ client.
- Lớp không tồn tại hoặc thuộc giáo viên khác đều trả 404 với cùng thông báo
  `Không tìm thấy lớp`. ADMIN cũng chỉ xem lịch của lớp mình.
- Lớp thuộc người đăng nhập nhưng chưa có lịch trả 200 với `schedules: []`.
- Sắp từ MONDAY đến SUNDAY, rồi `startTime`, `endTime`, `id` tăng dần để có thứ tự
  ổn định khi các khung giờ giống nhau. Không lọc theo trạng thái Class.
- Trả đúng bảy trường của mỗi lịch, dùng chung serializer với POST. Giờ là
  `HH:mm:ss`, timestamps là ISO UTC; không có Class/User lồng nhau.
- Chưa có search, filter, pagination hoặc total/count cho API này.

### Response

Thành công trả HTTP 200:

```json
{
  "success": true,
  "data": {
    "schedules": [
      {
        "id": "27889435-9dd4-42ab-a5bd-3c085d45538b",
        "classId": 42,
        "dayOfWeek": "MONDAY",
        "startTime": "19:00:00",
        "endTime": "21:00:00",
        "createdAt": "2026-10-06T15:00:00.000Z",
        "updatedAt": "2026-10-06T15:00:00.000Z"
      }
    ]
  }
}
```

| Trường hợp | HTTP |
| --- | --- |
| ID lớp sai | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Lớp không tồn tại hoặc thuộc tài khoản khác | 404 |
| Lấy danh sách thành công, kể cả chưa có lịch | 200 |

## GET /api/classes/:classId/schedules/:scheduleId

Lấy chi tiết một lịch học. Yêu cầu `Authorization: Bearer <accessToken>`, tài khoản
ACTIVE và role `TEACHER` hoặc `ADMIN`; không cần body.

### Validation và quyền sở hữu

- `classId` là số nguyên dương không vượt quá 2147483647, dùng validation hiện có.
- `scheduleId` là UUID có định dạng `8-4-4-4-12` ký tự hex, nhận cả chữ hoa/chữ thường.
  UUID sai trả 400 với thông báo `ID lịch học phải là UUID hợp lệ`.
- Backend truy vấn lịch theo đồng thời `id = scheduleId`, `classId` trong URL và
  `classRecord.teacherId = res.locals.auth.userId`. Không dùng giá trị từ query
  hoặc body để quyết định quyền sở hữu.
- Lịch không tồn tại, không thuộc lớp trong URL hoặc lớp thuộc tài khoản khác
  đều trả 404 với cùng thông báo `Không tìm thấy lịch học`. Điều này áp dụng cả
  khi hai lớp cùng thuộc một giáo viên và khi người gọi là ADMIN.
- Trả đúng bảy trường, dùng cùng serializer với POST/GET danh sách. Giờ là
  `HH:mm:ss`, timestamps là ISO UTC. Không lọc theo trạng thái Class.

### Response

Thành công trả HTTP 200:

```json
{
  "success": true,
  "data": {
    "schedule": {
      "id": "27889435-9dd4-42ab-a5bd-3c085d45538b",
      "classId": 42,
      "dayOfWeek": "MONDAY",
      "startTime": "19:00:00",
      "endTime": "21:00:00",
      "createdAt": "2026-10-06T15:00:00.000Z",
      "updatedAt": "2026-10-06T15:00:00.000Z"
    }
  }
}
```

| Trường hợp | HTTP |
| --- | --- |
| ID lớp hoặc UUID lịch học sai | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Không tìm thấy lịch trong lớp thuộc tài khoản đang đăng nhập | 404 |
| Lấy chi tiết thành công | 200 |

## PATCH /api/classes/:classId/schedules/:scheduleId

Cập nhật một hoặc nhiều trường của lịch học. Yêu cầu access token, tài khoản
ACTIVE và role `TEACHER` hoặc `ADMIN`. `classId` và `scheduleId` dùng cùng
validation với GET chi tiết.

Trong Postman, chọn Body → raw → JSON. Ví dụ sửa hai giờ:

```json
{
  "startTime": "18:30",
  "endTime": "20:30"
}
```

Có thể chỉ gửi `{"dayOfWeek":"THURSDAY"}`, `{"startTime":"18:30"}` hoặc
`{"endTime":"21:30"}` nếu khung giờ sau cập nhật vẫn hợp lệ.

### Validation và quyền sở hữu

- Body chỉ nhận `dayOfWeek`, `startTime`, `endTime`; cần ít nhất một trường.
  Trường không gửi giữ nguyên. Không nhận `null` cho ba trường này.
- Dùng cùng enum và quy tắc giờ với POST: `HH:mm` hoặc `HH:mm:ss`, chuẩn hóa
  thành `HH:mm:ss`, giờ 00–23 và phút/giây 00–59.
- Nếu gửi cả hai giờ, validation kiểm tra `endTime > startTime`. Nếu chỉ gửi
  một giờ, service ghép với giờ còn lại đang có trong database rồi kiểm tra.
  Giờ bằng nhau, đảo ngược hoặc lịch qua nửa đêm trả 400 tại field `endTime`.
- Backend kiểm tra lịch theo `scheduleId`, `classId` và giáo viên sở hữu lớp.
  Điều kiện này cũng nằm trong truy vấn cập nhật; ADMIN chỉ sửa lịch của lớp mình.
- Lịch không tồn tại, thuộc lớp khác trong URL (kể cả cùng giáo viên) hoặc thuộc
  giáo viên khác đều trả 404 `Không tìm thấy lịch học`.
- Body có `classId`, `teacherId`, `teacher_id`, `id`, `classRecord`, `createdAt`,
  `updatedAt`, `status`, `note` hoặc trường khác trả 400. ID, lớp liên quan và
  thời điểm tạo giữ nguyên; backend quản lý `updatedAt`.
- Truy vấn chỉ ghi các trường được gửi. Nếu giờ bị thay đổi đồng thời sau lúc
  service đọc, CHECK `ClassSchedule_times_check` vẫn chặn khung giờ sai; backend
  chuyển lỗi constraint này thành 400 với lỗi `endTime`.
- Giữ quy tắc hiện tại về trạng thái Class và cho phép lịch trùng/giao giờ.

### Response

Thành công trả HTTP 200, dùng cùng bảy trường và serializer với POST/GET:

```json
{
  "success": true,
  "message": "Cập nhật lịch học thành công",
  "data": {
    "schedule": {
      "id": "27889435-9dd4-42ab-a5bd-3c085d45538b",
      "classId": 42,
      "dayOfWeek": "MONDAY",
      "startTime": "18:30:00",
      "endTime": "20:30:00",
      "createdAt": "2026-10-06T15:00:00.000Z",
      "updatedAt": "2026-10-06T16:00:00.000Z"
    }
  }
}
```

| Trường hợp | HTTP |
| --- | --- |
| ID sai, body rỗng/sai hoặc khung giờ sau cập nhật không hợp lệ | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Không tìm thấy lịch trong lớp thuộc tài khoản đang đăng nhập | 404 |
| Cập nhật thành công | 200 |

Lỗi validation dùng cấu trúc `Thông tin lịch học không hợp lệ` và `errors`
như POST. Body `null` hoặc JSON sai cú pháp trả 400 `Body JSON không hợp lệ`.

## DELETE /api/classes/:classId/schedules/:scheduleId

Xóa một khung giờ học trong tuần. Yêu cầu `Authorization: Bearer <accessToken>`,
tài khoản ACTIVE và role `TEACHER` hoặc `ADMIN`. Không cần body; trong Postman
chọn Body → none. `classId` và `scheduleId` dùng cùng validation với GET chi tiết.

### Logic và quyền sở hữu

- Xóa hẳn đúng một bản ghi ClassSchedule. Class, Student, Enrollment và các lịch
  khác được giữ nguyên. Lịch học hiện không có quan hệ con lưu lịch sử tài chính.
- Truy vấn xóa kiểm tra đồng thời `id = scheduleId`, `classId` trong URL và
  `classRecord.teacherId = res.locals.auth.userId`. Không dùng body hoặc query
  để quyết định bản ghi cần xóa hay giáo viên sở hữu. ADMIN chỉ xóa lịch của lớp mình.
- Lịch không tồn tại, không thuộc lớp trong URL (kể cả cùng giáo viên) hoặc thuộc
  tài khoản khác đều trả 404 `Không tìm thấy lịch học`.
- Gọi lại sau khi đã xóa trả 404. Hai request cùng xóa một lịch trả một 200/một 404.
- Cho phép xóa lịch của Class ở các trạng thái hiện có và cả khi lớp có Enrollment.
  Quy tắc chặn xóa Class/Student đã có Enrollment vẫn giữ nguyên.

### Response

Thành công trả HTTP 200 theo convention DELETE hiện có:

```json
{
  "success": true,
  "message": "Xóa lịch học thành công"
}
```

| Trường hợp | HTTP |
| --- | --- |
| ID lớp hoặc UUID lịch học sai | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản chưa ACTIVE hoặc role không được phép | 403 |
| Không tìm thấy lịch trong lớp thuộc tài khoản đang đăng nhập, kể cả đã xóa | 404 |
| Xóa thành công | 200 |

## Kiểm tra

Chạy `npx tsc --noEmit` và `npm run test:schedules`.
Test dùng database thật, tự tạo tài khoản ACTIVE A/B/ADMIN và tài khoản PENDING,
Class và lịch học fixture; chỉ dọn fixture của test, không reset DB.
Kiểm tra quyền sở hữu, đăng nhập, validation, định dạng giờ/response và dữ liệu
đã lưu trong PostgreSQL. Chạy các bộ integration test database lần lượt.

Kết quả bước POST (2026-10-06): TypeScript đạt, `test:schedules` 1/1 đạt,
`test:classes` 2/2 đạt và `test:auth` 3/3 đạt trên database thật. Test POST cũng
kiểm tra body `null` và JSON sai cú pháp trả 400; toàn bộ fixture đã được dọn.

Kết quả bước GET danh sách (2026-10-06): TypeScript đạt, `test:schedules` 2/2 đạt
(POST và GET) trên database thật. Test GET kiểm tra quyền A/B/ADMIN, chặn PENDING,
token/ID sai, lớp rỗng, query giả mạo chủ sở hữu, đúng thứ tự ngày/giờ/ID, định
dạng response và việc đọc không thay đổi dữ liệu. Toàn bộ fixture đã được dọn.

Kết quả bước GET chi tiết (2026-10-06): TypeScript đạt, `test:schedules` 3/3 đạt
(POST, GET danh sách, GET chi tiết) trên database thật. Test chi tiết kiểm tra
quyền A/B/ADMIN, chặn PENDING, ID lớp/UUID sai, UUID chữ hoa, lịch khác lớp kể cả
cùng giáo viên, query giả mạo, bảy trường response và định dạng giờ. Đọc không
thay đổi dữ liệu; toàn bộ fixture đã được dọn.

Kết quả bước PATCH (2026-10-06): TypeScript đạt, `test:schedules` 4/4 đạt
(POST, GET danh sách, GET chi tiết, PATCH) trên database thật. Test PATCH kiểm
tra quyền A/B/ADMIN, chặn PENDING, ID/body sai, trường bị cấm, giờ kết hợp với
dữ liệu cũ, cập nhật từng trường và giữ trường không gửi. Ba lượt gửi hai PATCH
đồng thời đều trả một 200/một 400, giữ khung giờ hợp lệ và chỉ lưu thay đổi của
request thành công. Các bản ghi khác được giữ nguyên; toàn bộ fixture đã được dọn.

Kết quả bước DELETE (2026-10-06): TypeScript đạt, `test:schedules` 5/5 đạt trên
database thật, bao gồm đủ năm endpoint. Test DELETE kiểm tra quyền A/B/ADMIN,
chặn PENDING, ID sai, lịch khác lớp kể cả cùng giáo viên, UUID chữ hoa, body/query
giả mạo, xóa lặp và hai request xóa đồng thời (một 200/một 404). Lớp có Enrollment
LEFT vẫn xóa được lịch, giữ nguyên Class/Student/Enrollment và các lịch còn lại.
Toàn bộ fixture đã được dọn.

ClassSchedule CRUD cơ bản đã có đủ năm endpoint. Payment là phase tiếp theo,
schema/migration và từng API sẽ được thực hiện ở các bước riêng khi người dùng đồng ý.
