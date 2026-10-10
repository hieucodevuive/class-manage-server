# PATCH Payment — quy tắc đã duyệt

Ngày: 2026-10-10. Trạng thái: **người dùng đã duyệt; API đã triển khai**.

Tài liệu ghi lại phương án người dùng đã duyệt bằng `next` trước khi triển khai
`PATCH /api/payments/:id`. Các API POST và GET giữ quy tắc hiện có.

## 1. Các trường được cập nhật

Body phải có ít nhất một trường và chỉ nhận các trường sau:

| Trường | Quy tắc đã duyệt |
| --- | --- |
| `amountDue` | Điều chỉnh số tiền phải thu riêng của khoản này |
| `amountPaid` | Tổng số tiền đã thu của khoản, thay thế giá trị hiện tại |
| `paymentMethod` | CASH, BANK_TRANSFER, OTHER; có thể null khi tổng đã thu bằng 0 |
| `note` | Chuỗi trim hoặc null |

- Hai trường tiền dùng số hoặc chuỗi thập phân từ 0 đến 9999999999.99, tối đa
  hai chữ số phần lẻ, lưu/tính bằng Decimal. Không nhận null cho tiền.
- Trường không gửi giữ nguyên. Riêng `paidAt` là metadata backend tự tính lại.
- Cho phép sửa giảm `amountPaid` để chỉnh nhập sai; đây là cập nhật tổng tiền.
- Cho phép `amountPaid > amountDue`; trạng thái vẫn là PAID theo GET hiện có.
- Sửa `amountDue` chỉ sửa khoản này, không đọc lại hoặc đồng bộ từ Class.
- Khóa Enrollment và kỳ học phí giữ cố định: không nhận `classStudentId`,
  `billingPeriod`, `id`, `teacherId`, `teacher_id`, `classId`, `studentId`.
  Client cũng không được gửi `status`, `paidAt`, timestamps hoặc trường lạ.

## 2. Tổng đã thu và phương thức

`amountPaid` là **tổng đã thu**, không phải số tiền thu thêm trong request.
Ví dụ đã thu 200000, thu thêm 300000 thì gửi `amountPaid = 500000`.
Gửi lại cùng tổng tiền không làm tăng tiền thêm lần nữa.

Sau khi ghép body với bản ghi đang có:

- Nếu tổng đã thu lớn hơn 0, phải có một `paymentMethod` hợp lệ. Không gửi
  phương thức thì dùng giá trị đang lưu; chưa có thì cần gửi trong request.
- Nếu tổng đã thu bằng 0, phương thức có thể là null. Có thể gửi null để xóa
  phương thức; không gửi thì giữ nguyên giá trị cũ.
- MVP lưu một phương thức trên khoản tháng, chưa lưu từng lần thu riêng.

## 3. Trạng thái và thời điểm thanh toán đủ

Status tiếp tục được tính bằng Decimal, theo cùng quy tắc với hai API GET:
UNPAID khi chưa trả và còn phải thu; PARTIAL khi trả một phần; PAID khi
`amountPaid >= amountDue`, gồm 0/0.

`paidAt` là thời điểm hệ thống ghi nhận khoản đã có tiền thu và thanh toán đủ:

| Dữ liệu sau cập nhật | `paidAt` |
| --- | --- |
| `amountPaid = 0`, gồm khoản 0/0 | null |
| `0 < amountPaid < amountDue` | null |
| `amountPaid > 0` và `amountPaid >= amountDue` | Giữ thời điểm đã có; chưa có thì lấy thời điểm server ghi nhận |

Sửa `amountDue` cũng phải tính lại trạng thái/thời điểm theo bảng trên.
Nếu từ trả đủ chuyển về trả thiếu thì xóa `paidAt`; trả đủ lại thì ghi thời điểm
mới. Từ khoản 0/0 sang đã thu tiền phải ghi thời điểm dù cả hai trạng thái đều PAID.
Chỉ sửa note/phương thức trên khoản vẫn trả đủ sẽ giữ `paidAt` đã có.

## 4. Quyền sở hữu và cập nhật đồng thời

- Dùng auth/role hiện có: tài khoản ACTIVE, TEACHER hoặc ADMIN.
- UUID đúng 36 ký tự, nhận chữ hoa/chữ thường như API chi tiết.
- Đọc và cập nhật đều kiểm tra ID Payment và quyền sở hữu Class/Student qua
  Enrollment theo người đăng nhập. ADMIN chỉ sửa dữ liệu của mình.
- Có thể sửa học phí lịch sử của Enrollment LEFT hoặc lớp/học sinh không ACTIVE.
- Khi ghi, đối chiếu dữ liệu đã đọc để bảo vệ việc tính tiền/phương thức/paidAt.
  Nếu bản ghi thay đổi giữa bước đọc và ghi, trả 409 để tải lại rồi gửi lại;
  không chỉ dựa vào độ chính xác millisecond của updatedAt.

## 5. Response và lỗi

Thành công: HTTP 200, `success: true`, message `Cập nhật học phí thành công`,
`data.payment` dùng cùng 11 trường/serializer với GET chi tiết.

| Trường hợp | HTTP |
| --- | --- |
| ID/body/tiền/phương thức không hợp lệ hoặc body rỗng | 400 |
| Thiếu/sai/hết hạn token | 401 |
| Tài khoản chưa ACTIVE/role không được phép | 403 |
| Không tồn tại hoặc ngoài phạm vi | 404 |
| Bản ghi đã thay đổi giữa lúc đọc và ghi | 409 |

Ví dụ khoản phải thu 500000, cập nhật tổng đã thu thành 500000:

```json
{
  "amountPaid": "500000.00",
  "paymentMethod": "BANK_TRANSFER",
  "note": "Đã thu đủ học phí tháng 10"
}
```

## 6. Phạm vi triển khai

- Cập nhật schema validation, controller, service, repository và route trong
  `src/modules/payments`; dùng serializer hiện có.
- Thêm `tests/payments.update.integration.test.ts`, bổ sung script test Payment
  trong package.json, cập nhật tài liệu API và tiến độ hệ thống.
- Kiểm tra TypeScript và test HTTP với PostgreSQL: quyền A/B/ADMIN, validation,
  giữ trường không gửi, chuyển trạng thái, paidAt/phương thức, Decimal, lịch sử,
  snapshot riêng của khoản và xung đột cập nhật. Chạy lại ba test Payment đang có.
- Model hiện tại đủ cho API này; bước API không cần migration mới.

Request, response và kết quả kiểm tra thực tế được ghi tại `docs/payment-api.md`.
TypeScript đạt; `npm run test:payments` đạt 4/4 trên PostgreSQL, gồm test PATCH
và ba API Payment đã có. Dữ liệu thử riêng đã được dọn.
