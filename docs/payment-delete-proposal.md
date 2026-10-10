# DELETE Payment — quyết định giữ bản ghi

Ngày: 2026-10-10. Trạng thái: **người dùng đã chọn phương án A**.

Quyết định hiện tại: giữ mọi Payment, tạm chưa mở API DELETE. Khi nhập sai,
dùng PATCH hiện có để điều chỉnh. Phương án B dưới đây chỉ lưu để tham khảo,
chưa được duyệt và không thuộc phạm vi triển khai hiện tại.

## 1. Hiện trạng đã đối chiếu

- Payment đã có POST, GET danh sách, GET chi tiết và PATCH.
- Một bản ghi lưu nghĩa vụ học phí của một Enrollment trong một tháng,
  với đúng 10 trường theo thiết kế. Chưa có trạng thái hủy, deletedAt hoặc
  bảng lưu từng lần thu/chỉnh sửa.
- PATCH đã duyệt cho phép giảm `amountPaid` về 0, tự xóa `paidAt` khi chưa
  thanh toán đủ và cho xóa phương thức khi tổng đã thu bằng 0.
- Vì vậy `amountPaid = 0` và `paidAt = null` chỉ mô tả dữ liệu hiện tại,
  không chứng minh khoản đó chưa từng thu tiền. Method, note và timestamps
  cũng không đủ để kết luận lịch sử thu tiền.
- Khoản 0/0 có status PAID tính được nhưng không có tiền thu. Không thể dùng
  riêng status PAID/UNPAID để quyết định có được xóa hay không.
- FK RESTRICT bảo vệ Payment khi xóa Enrollment; không ngăn xóa trực tiếp
  chính Payment. Class/Student có Enrollment vẫn bị chặn xóa với 409.

Theo AGENTS.md và mục 26–27 trong backend-implementation-instructions.md,
phải bảo vệ lịch sử tài chính và thống nhất chiến lược xóa trước khi triển khai.

## 2. Phương án A — giữ mọi Payment (đã duyệt)

- Tạm chưa mở API DELETE Payment. Các khoản đã tạo tiếp tục được lưu để
  giữ bản ghi học phí theo tháng, kể cả khoản hiện chưa thu.
- Dùng PATCH hiện có để sửa sai số phải thu, tổng đã thu, phương thức hoặc
  ghi chú. Đây vẫn là bản tổng hợp hiện tại, chưa có lịch sử từng lần sửa.
- Không tạo endpoint luôn trả 409 chỉ để đủ CRUD.
- Nếu cần hủy khoản mà vẫn giữ bản ghi hoặc lưu từng lần thu/sửa, phải duyệt
  thiết kế bổ sung riêng. Không tự thêm trường/bảng vào model hiện tại.

Phương án này giữ các bản ghi Payment, nhưng không bổ sung lịch sử giao dịch
hoặc khôi phục các giá trị đã bị PATCH ghi đè.

## 3. Phương án B — tham khảo, chưa được duyệt

Thêm `DELETE /api/payments/:id` để xóa hẳn một khoản tạo nhầm, với điều kiện
**tại thời điểm xóa**: `amountPaid = 0` và `paidAt = null`.

### Quy tắc nghiệp vụ

- Khoản đang có số đã thu dương hoặc paidAt khác null trả 409, giữ nguyên.
- Khoản 0/0 vẫn có thể xóa nếu thỏa điều kiện trên. Không dựa vào status.
- Method khác null khi tổng bằng 0 không tự cấm xóa: PATCH hiện tại cho
  giữ/chọn phương thức dù chưa thu tiền; đây không phải bằng chứng lịch sử.
- Có thể xóa khoản trong Enrollment ACTIVE hoặc LEFT, lớp/học sinh không
  ACTIVE khi thuộc tài khoản. Không xóa Enrollment/Class/Student/khoản khác.
- Xóa làm mất bản ghi nghĩa vụ học phí đó và giải phóng unique theo tháng;
  POST sau đó có thể tạo lại cùng kỳ với ID mới. Khi không gửi amountDue,
  khoản tạo lại lấy mức học phí Class được đọc trong request tạo mới.
- **Giới hạn phải được duyệt:** khoản từng có tiền thu nhưng đã được PATCH
  về 0/null cũng thỏa điều kiện xóa. Backend không thể phân biệt với khoản
  chưa từng thu bằng model hiện tại. Phương án này không bảo đảm giữ mọi
  khoản từng thanh toán.

### API và quyền truy cập dự kiến

- UUID/ownership dùng cùng quy tắc với GET/PATCH: UUID 36 ký tự,
  `res.locals.auth.userId`, kiểm tra Class và Student qua Enrollment.
- Yêu cầu tài khoản ACTIVE, role TEACHER hoặc ADMIN; ADMIN chỉ xóa dữ liệu
  của mình. ID không tồn tại hoặc ngoài phạm vi cùng trả 404.
- Request không cần body. Query/body không được dùng để đổi ID mục tiêu,
  điều kiện thanh toán hoặc chủ sở hữu.
- Đọc khoản, kiểm tra điều kiện xóa, rồi dùng truy vấn deleteMany có ID,
  ownership, hai điều kiện thanh toán và toàn bộ snapshot vừa đọc.
- Nếu Payment đổi giữa lúc đọc và xóa, không xóa dữ liệu mới. Đọc lại có
  scope để phân biệt 404 (đã mất/ngoài quyền) và 409 (còn nhưng đã thay đổi).
  Không tự retry. Kiểm tra này bảo vệ khoảng đọc/ghi phía server;
  chưa có version/precondition cho snapshot cũ phía client.
- DELETE đồng thời cùng bản ghi có một 200 và một 404. PATCH đồng thời
  có thể thắng trước DELETE; khi đó DELETE trả 409 và giữ bản ghi đã sửa.
  Nếu DELETE thắng, PATCH không sửa được bản ghi đã xóa và trả 404.

| Trường hợp | HTTP | Response message dự kiến |
| --- | --- | --- |
| UUID sai | 400 | ID học phí phải là UUID hợp lệ |
| Thiếu/sai/hết hạn token | 401 | Theo middleware hiện có |
| Tài khoản PENDING/role không được phép | 403 | Theo middleware hiện có |
| Không tồn tại/ngoài quyền | 404 | Không tìm thấy học phí |
| Có số đã thu dương hoặc paidAt khác null | 409 | Không thể xóa khoản học phí có dữ liệu thanh toán |
| Khoản thay đổi giữa lúc đọc và xóa | 409 | Học phí đã thay đổi, vui lòng tải lại và thử lại |
| Xóa thành công | 200 | Xóa học phí thành công |

Thành công dùng `{ "success": true, "message": "Xóa học phí thành công" }`.
Lỗi nghiệp vụ dùng `{ "success": false, "message": "..." }`, không trả
Payment/Class/Student/Enrollment của tài khoản khác.

### Phạm vi nếu duyệt phương án B

- Sửa route, controller, service và repository trong `src/modules/payments`;
  dùng lại paymentIdSchema, không thêm ORM hoặc migration.
- Thêm `tests/payments.delete.integration.test.ts`, cập nhật package.json
  và tài liệu API/tiến độ.
- Test HTTP với PostgreSQL: auth/PENDING, A/B/ADMIN, UUID/quyền qua cả hai
  quan hệ, chặn khoản có tiền/paidAt, khoản 0/0 và method đang lưu, lịch sử,
  xóa lặp/đồng thời, PATCH đổi snapshot/ownership giữa đọc và xóa, tạo lại
  cùng tháng và giữ nguyên các bản ghi cha/khoản khác.
- Chạy TypeScript và bốn test Payment đã có cùng test DELETE. Chỉ tạo/dọn
  fixture riêng; không reset database.

## 4. Kết quả bước chuẩn bị

Đã đọc schema, middleware, layer Payment, quy tắc xóa Class/Student/Enrollment
và tài liệu thiết kế. Đã đối chiếu kiểu Prisma cho deleteMany hỗ trợ điều kiện
ownership/snapshot. Lượt này chỉ viết đề xuất, chưa thêm route DELETE,
chưa chạy test DELETE và chưa thao tác xóa dữ liệu trong database.

Người dùng đã chọn A. Đã cập nhật quyết định tại `docs/system-design.md`
và `docs/payment-api.md`; phạm vi Payment cơ bản hiện có bốn endpoint POST,
GET danh sách, GET chi tiết và PATCH. Không có bước DELETE chờ triển khai
theo quyết định này. Muốn thay đổi chiến lược cần yêu cầu và quyết định mới.
