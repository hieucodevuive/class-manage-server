# Payment API

## Phạm vi hiện tại

Ngày 2026-10-10, người dùng chọn phương án A: **giữ mọi bản ghi Payment,
tạm chưa mở API DELETE**. Module có POST, GET danh sách, GET chi tiết và PATCH
như tài liệu dưới đây. Sửa sai bằng PATCH hiện có. Quyết định và giới hạn
lịch sử từng lần thu/sửa được ghi tại `docs/payment-delete-proposal.md`.

## POST /api/payments

Tạo một khoản học phí tháng cho một Enrollment. Yêu cầu
`Authorization: Bearer <accessToken>`, tài khoản ACTIVE và role TEACHER hoặc ADMIN.

Trong Postman: chọn Body → raw → JSON. Thay `classStudentId` bằng ID ghi danh
thật của lớp thuộc tài khoản đang đăng nhập:

```json
{
  "classStudentId": "27889435-9dd4-42ab-a5bd-3c085d45538b",
  "billingPeriod": "2026-10-15"
}
```

`classStudentId` là **Enrollment.id**, lấy từ `data.enrollment.id` khi ghi danh
hoặc `data.enrollments[].id` của `GET /api/classes/:classId/students`.
Đây không phải ID Student hay ID Class.

### Body và validation

| Trường | Bắt buộc | Quy tắc |
| --- | --- | --- |
| `classStudentId` | Có | UUID đúng 36 ký tự, định dạng 8-4-4-4-12 hex; nhận chữ hoa/chữ thường |
| `billingPeriod` | Có | Ngày thực tế dạng YYYY-MM-DD, năm 0001–9999; backend chuẩn hóa về đầu tháng |
| `amountDue` | Không | Số hoặc chuỗi thập phân từ 0 đến 9999999999.99, tối đa 2 chữ số phần lẻ |
| `note` | Không | Chuỗi được trim hoặc null; không gửi thì lưu null |

- Ví dụ `2026-10-15` lưu và trả `2026-10-01`. Ngày không tồn tại như
  `2026-02-30`, ngày có múi giờ/timestamp hoặc chuỗi tháng `2026-10` trả 400.
- Không gửi `amountDue` thì lấy `Class.tuitionFee` khi backend đọc Enrollment
  và lưu thành số tiền phải thu riêng của khoản mới. Có thể gửi `0` hoặc giá
  trị khác hợp lệ; `null` không hợp lệ cho trường này.
- Tiền được lưu bằng Prisma Decimal. Chuỗi tiền được trim; không nhận chuỗi
  có dấu phân cách hàng nghìn, dạng số mũ hay phần lẻ quá hai chữ số.
- Khoản mới dùng default `amountPaid = 0`; `paidAt`, `paymentMethod` là null.
  POST tạo nghĩa vụ học phí; PATCH bên dưới ghi nhận tổng tiền đã thanh toán.
- Body chỉ nhận bốn trường trong bảng. Các trường `teacherId`, `teacher_id`,
  `classId`, `studentId`, `id`, `amountPaid`, `paidAt`, `paymentMethod`, `status`,
  timestamps hoặc trường lạ trả 400.

Ví dụ chọn số tiền riêng và ghi chú:

```json
{
  "classStudentId": "27889435-9dd4-42ab-a5bd-3c085d45538b",
  "billingPeriod": "2026-10-01",
  "amountDue": "450000.00",
  "note": "Học phí tháng 10"
}
```

### Quyền sở hữu và nghiệp vụ

- Backend lấy `res.locals.auth.userId`, kiểm tra Enrollment theo ID, giáo viên
  sở hữu lớp và giáo viên sở hữu hồ sơ Student. `enrollment.connect` kiểm tra
  lại các điều kiện này khi ghi Payment.
- Enrollment không tồn tại hoặc không thuộc phạm vi tài khoản đều trả 404
  `Không tìm thấy ghi danh`. ADMIN cũng chỉ tạo học phí cho dữ liệu của mình.
  Không trả dữ liệu Class/Student/User lồng nhau.
- Có thể tạo học phí cho Enrollment ACTIVE hoặc LEFT để quản lý khoản học phí
  còn thiếu trong lịch sử. Không tự đặt hạn chế theo trạng thái Class/Student
  hoặc tính tiền theo số buổi/ngày vào lớp/ngày nghỉ.
- Mỗi Enrollment chỉ có một khoản trong cùng tháng. Unique trong DB được kiểm
  tra sau khi chuẩn hóa ngày; tạo lại hoặc tạo đồng thời cùng kỳ trả 409.
  Hai request đồng thời tạo cùng kỳ có một 201 và một 409.
- `amountDue` của khoản cũ giữ nguyên khi sửa học phí lớp. Các khoản mới không
  gửi `amountDue` lấy mức học phí lớp được đọc trong request mới.
- API không sửa Enrollment, Class hoặc Student và không tạo hàng loạt học phí.

### Response

Thành công trả HTTP 201. Ví dụ lớp đang có học phí `500000.00`, request không
gửi `amountDue` hoặc `note`:

```json
{
  "success": true,
  "message": "Tạo học phí thành công",
  "data": {
    "payment": {
      "id": "63ac7467-18f6-4373-84f3-7a5d7666038e",
      "classStudentId": "27889435-9dd4-42ab-a5bd-3c085d45538b",
      "billingPeriod": "2026-10-01",
      "amountDue": "500000.00",
      "amountPaid": "0.00",
      "paidAt": null,
      "paymentMethod": null,
      "note": null,
      "createdAt": "2026-10-10T15:00:00.000Z",
      "updatedAt": "2026-10-10T15:00:00.000Z"
    }
  }
}
```

Chỉ trả đúng 10 trường của Payment. Tiền luôn là chuỗi Decimal với hai chữ số
phần lẻ; kỳ học phí là YYYY-MM-01, timestamps là ISO UTC.

| Trường hợp | HTTP |
| --- | --- |
| Body/UUID/ngày/số tiền không hợp lệ hoặc trường bị cấm | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản PENDING hoặc role không được phép | 403 |
| Enrollment không tồn tại hoặc không thuộc tài khoản | 404 |
| Enrollment không còn tồn tại/không còn đúng quyền lúc connect | 404 |
| Enrollment đã có học phí cùng kỳ | 409 |
| Tạo khoản học phí thành công | 201 |

Lỗi validation dùng format hiện có:

```json
{
  "success": false,
  "message": "Thông tin học phí không hợp lệ",
  "errors": [
    {
      "field": "amountDue",
      "message": "Số tiền phải từ 0 đến 9999999999.99 và có tối đa 2 chữ số thập phân"
    }
  ]
}
```

JSON sai cú pháp hoặc body null bị JSON parser từ chối trả 400
`{"success":false,"message":"Body JSON không hợp lệ"}`.

## GET /api/payments

Lấy danh sách khoản học phí của tài khoản đang đăng nhập. Yêu cầu
`Authorization: Bearer <accessToken>`, tài khoản ACTIVE và role TEACHER hoặc ADMIN.
Trong Postman chọn GET, thêm Bearer Token ở Authorization, không cần body.

Ví dụ lấy học phí tháng 10 chưa thanh toán của lớp có ID 12:

```text
GET http://localhost:5000/api/payments?classId=12&billingPeriod=2026-10-15&status=UNPAID
```

### Query và validation

| Query | Bắt buộc | Quy tắc |
| --- | --- | --- |
| `classId` | Không | Chuỗi chữ số biểu diễn ID Class từ 1 đến 2147483647; không có khoảng trắng |
| `studentId` | Không | UUID đúng 36 ký tự, định dạng 8-4-4-4-12 hex; nhận chữ hoa/chữ thường |
| `billingPeriod` | Không | Ngày thực tế dạng YYYY-MM-DD, năm 0001–9999; chuẩn hóa về đầu tháng để lọc |
| `status` | Không | `UNPAID`, `PARTIAL` hoặc `PAID`, đúng chữ hoa |

- Không có query thì trả tất cả khoản học phí trong phạm vi tài khoản.
- Có thể kết hợp cả bốn bộ lọc; mỗi khoản phải thỏa **tất cả** điều kiện.
  `billingPeriod=2026-10-15` lọc kỳ `2026-10-01`, giống cách POST chuẩn hóa ngày.
- Ngày không tồn tại, UUID sai, giá trị rỗng, tham số lặp hoặc dạng mảng/object
  trả 400. Query chỉ nhận bốn tên trong bảng; `teacherId`, `teacher_id`,
  `classStudentId`, `page`, `limit` và các tên khác cũng trả 400.
- Bước này chưa có phân trang, tổng số bản ghi hoặc tìm kiếm theo tên.

### Quyền sở hữu, trạng thái và thứ tự

- Mỗi truy vấn luôn giới hạn Payment qua Enrollment → Class theo
  `res.locals.auth.userId`, đồng thời kiểm tra Student cùng chủ sở hữu.
  Các bộ lọc không thay thế điều kiện quyền sở hữu. ADMIN chỉ xem dữ liệu của mình.
- ID lớp/học sinh hợp lệ nhưng không tồn tại hoặc của giáo viên khác trả
  HTTP 200 với `payments: []`, giống trường hợp không có khoản nào khớp bộ lọc.
- Danh sách bao gồm học phí lịch sử của Enrollment LEFT, Class
  INACTIVE/COMPLETED và Student INACTIVE; không tự ẩn khoản khi học sinh nghỉ.
- `status` được tính từ hai số tiền đã lưu, không phải cột database:

| Trạng thái | Điều kiện |
| --- | --- |
| `PAID` | `amountPaid >= amountDue`, gồm trường hợp cả hai bằng 0 |
| `UNPAID` | `amountPaid = 0` và `amountDue > 0` |
| `PARTIAL` | `0 < amountPaid < amountDue` |

- Theo phương án đã duyệt, khoản học phí 0 xếp `PAID`. GET chỉ đọc dữ liệu,
  không tự ghi `paidAt` hay `paymentMethod` cho khoản này.
- Bộ lọc trạng thái so sánh các cột Decimal ngay trong PostgreSQL; response
  cũng tính trạng thái bằng Decimal, không chuyển tiền sang floating point.
- Sắp xếp `billingPeriod` giảm dần, rồi `createdAt` giảm dần, cuối cùng `id`
  giảm dần để thứ tự ổn định khi kỳ và thời điểm tạo trùng nhau.

### Response

HTTP 200, danh sách ở `data.payments`. Mỗi khoản gồm 10 trường Payment đã có
và thêm `status` tính được. POST vẫn giữ response 10 trường như trước.
Không trả Class/Student/Enrollment/User lồng nhau.

```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "id": "63ac7467-18f6-4373-84f3-7a5d7666038e",
        "classStudentId": "27889435-9dd4-42ab-a5bd-3c085d45538b",
        "billingPeriod": "2026-10-01",
        "amountDue": "500000.00",
        "amountPaid": "0.00",
        "paidAt": null,
        "paymentMethod": null,
        "note": null,
        "createdAt": "2026-10-10T15:00:00.000Z",
        "updatedAt": "2026-10-10T15:00:00.000Z",
        "status": "UNPAID"
      }
    ]
  }
}
```

| Trường hợp | HTTP |
| --- | --- |
| Bộ lọc không hợp lệ hoặc query không được phép | 400 |
| Thiếu/sai/hết hạn access token | 401 |
| Tài khoản PENDING hoặc role không được phép | 403 |
| Danh sách có dữ liệu hoặc mảng rỗng | 200 |

Lỗi query dùng format `{success: false, message: "Bộ lọc học phí không hợp lệ",
errors: [{field, message}]}`. Trường lạ dùng `field: "query"`.

## GET /api/payments/:id

Lấy chi tiết một khoản học phí. Yêu cầu `Authorization: Bearer <accessToken>`,
tài khoản ACTIVE và role TEACHER hoặc ADMIN. Trong Postman chọn GET và thêm
Bearer Token ở Authorization; không cần body.

```text
GET http://localhost:5000/api/payments/63ac7467-18f6-4373-84f3-7a5d7666038e
```

Thay ID ví dụ bằng **Payment.id** lấy từ `data.payment.id` của POST hoặc
`data.payments[].id` của API danh sách. Đây là ID khoản học phí cần đọc.

### Validation và quyền sở hữu

- `id` phải là UUID đúng 36 ký tự dạng 8-4-4-4-12 hex; nhận chữ hoa/chữ thường.
  ID có khoảng trắng, xuống dòng, thiếu dấu gạch hoặc sai định dạng trả 400.
- Truy vấn kiểm tra đồng thời ID Payment, giáo viên sở hữu Class qua Enrollment
  và giáo viên sở hữu Student trong Enrollment theo `res.locals.auth.userId`.
- Không tồn tại hoặc ngoài phạm vi đều trả cùng lỗi 404. ADMIN chỉ xem khoản
  học phí của mình. Quan hệ Enrollment có Class/Student khác chủ sở hữu cũng
  bị ẩn, không trả dữ liệu cha lồng nhau.
- API chi tiết không dùng bộ lọc query. Các query như `teacherId`, `teacher_id`
  hoặc `status` không thay đổi khoản cần đọc hay điều kiện quyền sở hữu.
- Khoản của Enrollment LEFT, Class INACTIVE/COMPLETED hoặc Student INACTIVE
  vẫn đọc được khi thuộc tài khoản. GET giữ nguyên dữ liệu và snapshot
  `amountDue`, kể cả khi học phí lớp đã thay đổi.

### Response

Thành công trả HTTP 200, đối tượng ở `data.payment`. Dùng cùng 11 trường và
serializer với mỗi phần tử của API danh sách: 10 trường Payment và `status`
tính bằng Decimal. Khoản 0/0 thuộc PAID; đọc dữ liệu không tự ghi `paidAt`.

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "63ac7467-18f6-4373-84f3-7a5d7666038e",
      "classStudentId": "27889435-9dd4-42ab-a5bd-3c085d45538b",
      "billingPeriod": "2026-10-01",
      "amountDue": "500000.00",
      "amountPaid": "0.00",
      "paidAt": null,
      "paymentMethod": null,
      "note": null,
      "createdAt": "2026-10-10T15:00:00.000Z",
      "updatedAt": "2026-10-10T15:00:00.000Z",
      "status": "UNPAID"
    }
  }
}
```

| Trường hợp | HTTP | Message |
| --- | --- | --- |
| ID không hợp lệ | 400 | `ID học phí phải là UUID hợp lệ` |
| Thiếu/sai/hết hạn access token | 401 | Theo middleware auth hiện có |
| Tài khoản PENDING hoặc role không được phép | 403 | Theo middleware auth/role hiện có |
| Không tồn tại hoặc không thuộc tài khoản | 404 | `Không tìm thấy học phí` |
| Đọc thành công | 200 | Response ở `data.payment` |

Lỗi ID/không tìm thấy trả `{success: false, message}` như các API chi tiết hiện có.

## PATCH /api/payments/:id

Cập nhật một khoản học phí thuộc tài khoản đang đăng nhập. Yêu cầu Bearer
Token, tài khoản ACTIVE và role TEACHER hoặc ADMIN. Trong Postman chọn PATCH,
Body → raw → JSON; ID trong URL là **Payment.id** từ POST hoặc GET.

```text
PATCH http://localhost:5000/api/payments/63ac7467-18f6-4373-84f3-7a5d7666038e
```

Ví dụ khoản phải thu 500000, cập nhật tổng đã thu thành 500000:

```json
{
  "amountPaid": "500000.00",
  "paymentMethod": "BANK_TRANSFER",
  "note": "Đã thu đủ học phí tháng 10"
}
```

### Body và cách ghi nhận tiền

Body phải có ít nhất một trường, chỉ nhận bốn tên dưới đây:

| Trường | Quy tắc |
| --- | --- |
| `amountDue` | Số hoặc chuỗi Decimal không âm, tối đa 9999999999.99 và hai chữ số phần lẻ; không nhận null |
| `amountPaid` | Cùng validation với `amountDue`; là **tổng tiền đã thu**, thay thế giá trị cũ |
| `paymentMethod` | CASH, BANK_TRANSFER, OTHER hoặc null; tổng đã thu dương phải có phương thức |
| `note` | Chuỗi được trim hoặc null |

- Trường không gửi giữ nguyên. Hai trường tiền lưu và so sánh bằng Decimal.
- Đã thu 200000 rồi thu thêm 300000 thì gửi `amountPaid: "500000.00"`.
  Gửi lại tổng 500000 vẫn lưu 500000. Cho phép giảm tổng để sửa nhập sai và
  cho phép tổng đã thu lớn hơn số phải thu; trả thừa thuộc PAID.
- Không gửi phương thức thì dùng phương thức đang lưu. Sau khi ghép dữ liệu,
  tổng đã thu lớn hơn 0 mà phương thức null trả 400. Tổng bằng 0 có thể gửi
  null để xóa phương thức; nếu bỏ qua trường này thì vẫn giữ phương thức cũ.
- `amountDue` chỉ điều chỉnh nghĩa vụ của khoản này. Không đọc lại mức học phí
  Class hoặc sửa các khoản khác. Sửa học phí Class cũng không ghi đè khoản cũ.
- Không nhận `classStudentId`, `billingPeriod`, `id`, `teacherId`, `teacher_id`,
  `classId`, `studentId`, `status`, `paidAt`, timestamps hoặc trường lạ.
  Body rỗng, sai kiểu/enum/Decimal, tiền âm, tiền null hoặc quá hai chữ số lẻ
  trả 400. ID có cùng validation UUID như GET chi tiết.

### Trạng thái và `paidAt`

Status dùng cùng cách tính với GET: PAID khi `amountPaid >= amountDue`, UNPAID
khi chưa thu và còn phải thu, PARTIAL khi đã thu một phần. `paidAt` do backend
tính sau khi ghép các trường gửi với dữ liệu đang lưu:

| Dữ liệu sau cập nhật | `paidAt` |
| --- | --- |
| `amountPaid = 0`, gồm khoản 0/0 thuộc PAID | null |
| `0 < amountPaid < amountDue` | null |
| `amountPaid > 0` và `amountPaid >= amountDue` | Giữ thời điểm đã có; nếu chưa có thì dùng thời điểm server |

Sửa `amountDue` cũng tính lại theo bảng này. Trả đủ rồi sửa về trả thiếu xóa
`paidAt`; khi trả đủ lại ghi thời điểm mới. Chỉ sửa note/phương thức trên khoản
vẫn trả đủ giữ thời điểm cũ. Từ 0/0 sang có thu tiền ghi thời điểm dù status
trước và sau đều PAID. Không lưu thêm cột status hay từng lần thu riêng.

### Quyền sở hữu và cập nhật đồng thời

- Đọc và cập nhật đều kiểm tra ID Payment, chủ sở hữu Class và Student qua
  Enrollment theo `res.locals.auth.userId`. ADMIN chỉ sửa dữ liệu của mình.
  Không tồn tại hoặc ngoài phạm vi trả cùng 404; không trả dữ liệu cha lồng nhau.
- Cho phép sửa học phí lịch sử của Enrollment LEFT, Class INACTIVE/COMPLETED
  hoặc Student INACTIVE khi vẫn thuộc tài khoản. Không sửa dữ liệu cha.
- Backend chỉ ghi khi toàn bộ bản ghi Payment vẫn khớp dữ liệu đã đọc, gồm
  Decimal, null và timestamps, đồng thời kiểm tra lại ownership. Nếu khoản đã
  thay đổi, trả 409 để tải lại rồi gửi lại; không tự retry. Nếu bản ghi đã mất
  hoặc ngoài quyền truy cập thì trả 404.
- Kiểm tra xung đột bảo vệ khoảng giữa lúc server đọc và ghi. API chưa nhận
  version/precondition từ client để phát hiện dữ liệu cũ từ lần tải trước.

### Response và lỗi

HTTP 200, giữ cùng 11 trường/định dạng Decimal/date/ISO với GET chi tiết:

```json
{
  "success": true,
  "message": "Cập nhật học phí thành công",
  "data": {
    "payment": {
      "id": "63ac7467-18f6-4373-84f3-7a5d7666038e",
      "classStudentId": "27889435-9dd4-42ab-a5bd-3c085d45538b",
      "billingPeriod": "2026-10-01",
      "amountDue": "500000.00",
      "amountPaid": "500000.00",
      "paidAt": "2026-10-10T15:30:00.000Z",
      "paymentMethod": "BANK_TRANSFER",
      "note": "Đã thu đủ học phí tháng 10",
      "createdAt": "2026-10-10T15:00:00.000Z",
      "updatedAt": "2026-10-10T15:30:00.000Z",
      "status": "PAID"
    }
  }
}
```

| Trường hợp | HTTP | Message |
| --- | --- | --- |
| ID không hợp lệ | 400 | `ID học phí phải là UUID hợp lệ` |
| Body không hợp lệ | 400 | `Thông tin học phí không hợp lệ`, kèm `errors` như POST |
| Tổng đã thu dương nhưng phương thức sau ghép là null | 400 | `Cần có phương thức thanh toán khi đã thu tiền` |
| Thiếu/sai/hết hạn token | 401 | Theo middleware auth hiện có |
| Tài khoản PENDING/role không được phép | 403 | Theo middleware auth/role hiện có |
| Không tồn tại hoặc ngoài phạm vi | 404 | `Không tìm thấy học phí` |
| Khoản đã đổi giữa lúc đọc và ghi | 409 | `Học phí đã thay đổi, vui lòng tải lại và thử lại` |

Lỗi nghiệp vụ trả `{success: false, message}`. JSON sai cú pháp/body null dùng
lỗi JSON parser 400 hiện có. Quy tắc đã duyệt ở `docs/payment-update-proposal.md`.

## Kiểm tra

```text
npx tsc --noEmit
npm run test:payments
```

Test HTTP dùng PostgreSQL thật, tạo tài khoản/lớp/học sinh/Enrollment thử riêng.
Kiểm tra đăng nhập, quyền A/B/ADMIN, validation, dữ liệu/response Decimal/ngày,
snapshot khi sửa học phí Class và trùng kỳ khi request đồng thời. Test chỉ dọn
dữ liệu thử của chính mình; không reset database. Chạy các bộ test DB lần lượt.
Test GET nằm ở `tests/payments.list.integration.test.ts`, kiểm tra auth,
quyền A/B/ADMIN, các bộ lọc riêng/kết hợp, trạng thái Decimal, thứ tự và lịch sử.
Test chi tiết nằm ở `tests/payments.detail.integration.test.ts`, kiểm tra ID,
ownership, response/trạng thái, học phí lịch sử và dữ liệu không đổi sau GET.
Test PATCH nằm ở `tests/payments.update.integration.test.ts`, kiểm tra quyền,
validation, tổng tiền thay thế, phương thức sau ghép, các chuyển đổi paidAt,
snapshot riêng, lịch sử và xung đột cập nhật bằng PostgreSQL thật.

Kết quả bước POST (2026-10-10): TypeScript đạt, `test:payments` 1/1 đạt trên
PostgreSQL. Test kiểm tra A/B/ADMIN, chặn PENDING/token sai, Enrollment không
tồn tại/khác giáo viên và quan hệ Class–Student khác chủ sở hữu. Đã kiểm tra
body bị cấm, UUID có chữ hoa/xuống dòng, JSON sai, ngày nhuận/năm 0001–9999,
Decimal/default/override và đúng 10 trường response. Hai request cùng tháng
trả một 201/một 409; PATCH học phí Class giữ các khoản cũ và khoản tháng mới
lấy giá mới. Toàn bộ dữ liệu thử đã được dọn.

Kết quả bước GET danh sách (2026-10-10): TypeScript đạt, `test:payments` 2/2
đạt trên PostgreSQL, gồm test POST và GET. GET kiểm tra A/B/ADMIN/PENDING,
tài khoản chưa có dữ liệu, hai quan hệ Class–Student khác chủ sở hữu,
bốn bộ lọc riêng và kết hợp AND. Đã kiểm tra Decimal ở các mức 0, 0.01,
9999999999.99, trả đủ/thừa/thiếu 0.01; khoản 0/0 thuộc PAID, không thuộc UNPAID.
Ngày nhuận/năm 0001–9999 được chuẩn hóa, query sai/lặp/tên lạ trả 400;
response đúng 11 trường và thứ tự kỳ/thời điểm tạo/UUID ổn định. Các khoản
LEFT/INACTIVE/COMPLETED vẫn xuất hiện trong phạm vi phù hợp. Payment và
các bản ghi cha không bị thay đổi; toàn bộ dữ liệu thử đã được dọn.

Kết quả bước GET chi tiết (2026-10-10): TypeScript đạt, `test:payments` 3/3
đạt trên PostgreSQL, gồm POST, GET danh sách và GET chi tiết. Test mới kiểm tra
auth/PENDING, quyền A/B/ADMIN, hai quan hệ chéo, ID không tồn tại và UUID có
chữ hoa/khoảng trắng/xuống dòng. Response đúng 11 trường, Decimal/date/ISO/null
và ba trạng thái, gồm 0/0, trả đủ/thừa và thiếu 0.01 ở giới hạn NUMERIC(12,2).
Query giả không thay quyền hoặc ID được đọc; học phí LEFT/INACTIVE/COMPLETED
vẫn đọc được trong phạm vi. GET không đổi Payment/Enrollment/Class/Student,
snapshot Payment vẫn giữ nguyên sau đổi học phí lớp. Dữ liệu thử đã được dọn.

Kết quả bước PATCH (2026-10-10): TypeScript đạt, `test:payments` 4/4 đạt trên
PostgreSQL, gồm POST, hai GET và PATCH. Test mới kiểm tra A/B/ADMIN/PENDING,
UUID chữ hoa/ID sai, hai quan hệ chéo, JSON/body/trường cấm và Decimal ở mức
0, 0.01, 9999999999.99. Đã kiểm tra tổng tiền thay thế khi gửi lại, sửa giảm,
trả thừa, giữ trường không gửi, method/null sau ghép, trim/clear note và
paidAt khi trả một phần/đủ/thiếu lại/0 đồng/có thu tiền từ 0 đồng. Sửa số phải
thu chỉ đổi khoản đó; các khoản khác và Class/Student/Enrollment giữ nguyên,
kể cả lịch sử LEFT/INACTIVE/COMPLETED. Hai request đọc cùng snapshot trả một
200/một 409 bằng truy vấn cập nhật thật. Thay note mà giữ cùng updatedAt vẫn
trả 409; đổi ownership Student giữa đọc và ghi trả 404 và không sửa Payment.
GET chi tiết đọc được kết quả vừa cập nhật. Dữ liệu thử đã được dọn.

Theo phương án A đã duyệt, phạm vi Payment cơ bản dừng ở bốn endpoint trên.
DELETE không phải bước chờ triển khai; chiến lược này chỉ thay đổi khi có
yêu cầu và quyết định mới của người dùng.
