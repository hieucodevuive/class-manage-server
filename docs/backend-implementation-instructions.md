# CLASS MANAGEMENT BACKEND — DATABASE & API IMPLEMENTATION INSTRUCTIONS

Tôi đang phát triển backend cho project **Class Management**, ứng dụng quản lý lớp học thêm dành cho một giáo viên.

## Current tech stack

Backend hiện tại:

- Node.js
- Express
- TypeScript
- PostgreSQL
- REST API
- JWT Authentication

Frontend:

- Next.js
- TypeScript
- TanStack Query
- TanStack Table

---

# 0. TRẠNG THÁI HIỆN TẠI CỦA PROJECT

Tôi đã hoàn thành:

- Express project setup.
- PostgreSQL connection.
- Authentication.
- JWT Access Token.
- JWT Refresh Token.
- Auth middleware.
- Login flow.
- Basic CRUD cho `Class`.

Vì vậy:

**KHÔNG tạo lại authentication.**

**KHÔNG thay đổi JWT flow nếu không thật sự cần thiết.**

**KHÔNG rewrite toàn bộ architecture hiện tại.**

Trước khi code, hãy đọc cấu trúc project hiện tại và tuân theo:

- folder structure hiện tại
- controller pattern
- service pattern
- route pattern
- repository/database pattern
- validation pattern
- error handling pattern
- naming convention
- response format

Nếu project hiện tại không dùng ORM thì:

**KHÔNG tự ý thêm Prisma / TypeORM / Sequelize.**

Nếu project đã có một database layer thì tiếp tục sử dụng database layer đó.

---

# 1. QUY TẮC LÀM VIỆC CỰC KỲ QUAN TRỌNG

Tôi đang học backend.

Vì vậy **TUYỆT ĐỐI KHÔNG apply một đống code cùng lúc.**

Không được tự động implement toàn bộ:

```text
Class
Student
Enrollment
Schedule
Payment
```

trong một lần.

Phải làm theo từng bước nhỏ.

Sau mỗi bước:

1. Giải thích mục tiêu của bước.
2. Giải thích logic.
3. Cho tôi biết file nào sẽ được sửa/tạo.
4. Apply code cho DUY NHẤT bước đó.
5. Chạy/check TypeScript hoặc test phù hợp nếu project có.
6. Tóm tắt những gì vừa thay đổi.
7. DỪNG LẠI.
8. Chờ tôi xác nhận.

Chỉ khi tôi nói:

```text
continue
```

hoặc:

```text
tiếp
```

hoặc đồng ý rõ ràng thì mới làm bước tiếp theo.

---

# 2. TUYỆT ĐỐI KHÔNG LÀM KIỂU NÀY

Không được:

```text
- tạo Class schema
- tạo Student schema
- tạo Payment schema
- tạo tất cả controllers
- tạo tất cả services
- tạo tất cả routes
```

trong một lần.

Không được tự nghĩ:

> Tôi sẽ implement luôn toàn bộ cho tiện.

Tôi không muốn cách đó.

Tôi muốn học từng phần.

---

# 3. THỨ TỰ IMPLEMENT

Phải thực hiện theo đúng thứ tự:

```text
PHASE 0
Inspect current codebase

PHASE 1
Class

PHASE 2
Student

PHASE 3
ClassStudent / Enrollment

PHASE 4
ClassSchedule

PHASE 5
Payment
```

Trong mỗi phase lại chia thành các bước nhỏ.

Ví dụ Student:

```text
Step 2.1
Create students table / database model

STOP

Step 2.2
POST /students

STOP

Step 2.3
GET /students

STOP

Step 2.4
GET /students/:id

STOP

Step 2.5
PATCH /students/:id

STOP

Step 2.6
DELETE /students/:id

STOP
```

Không tự động chạy từ Step 2.1 → 2.6.

---

# 4. DATABASE MODEL TỔNG THỂ

Database cần được thiết kế theo mô hình:

```text
                  ┌────────────────────┐
                  │      classes       │
                  └─────────┬──────────┘
                            │
                            │ 1:N
                            ▼
                 ┌──────────────────────┐
                 │   class_schedules    │
                 └──────────────────────┘


students
   │
   │
   │ N
   ▼
┌───────────────────────┐
│    class_students     │
│     (enrollment)      │
└──────────┬────────────┘
           ▲
           │
           │ N
           │
        classes


class_students
      │
      │ 1:N
      ▼
   payments
```

Quan hệ:

```text
Student N ───── N Class

Student
   │
   ▼
ClassStudent
   ▲
   │
Class
```

`class_students` chính là **Enrollment**.

Payment không nên liên kết trực tiếp độc lập với cả:

```text
studentId
classId
```

Thay vào đó:

```text
Payment
   │
   ▼
ClassStudent
```

Vì `class_students` đã xác định:

> Student nào đang/đã học Class nào.

Điều này tránh dữ liệu sai kiểu:

```text
payment.studentId = Student A

payment.classId = Class B
```

trong khi Student A chưa từng thuộc Class B.

---

# 5. CLASS TABLE

Hiện tại tôi đã có basic Class CRUD.

Việc đầu tiên là kiểm tra Class hiện tại và bổ sung/điều chỉnh schema theo model dưới đây.

Table:

```text
classes
```

Schema logic:

```text
id
name
grade
school_year
subject
tuition_fee
start_date
end_date
status
note
created_at
updated_at
```

---

## id

```text
UUID PRIMARY KEY
```

Nếu project hiện tại đã dùng UUID thì giữ nguyên.

Không tự thay UUID bằng integer.

---

## name

```text
VARCHAR(100) NOT NULL
```

Ví dụ:

```text
Văn 10A1
Văn 11A2
Ôn thi Văn 12
```

Đây là tên hiển thị của lớp.

---

## grade

```text
SMALLINT NOT NULL
```

Ví dụ:

```text
10
11
12
```

Có constraint hợp lý:

```sql
CHECK (grade BETWEEN 1 AND 12)
```

---

## school_year

```text
VARCHAR(20) NOT NULL
```

Ví dụ:

```text
2026-2027
```

Không chỉ lưu:

```text
2026
```

---

## subject

```text
VARCHAR(100) NOT NULL
```

Hiện tại giáo viên chủ yếu dạy:

```text
Ngữ Văn
```

Không tạo `subjects` table ở MVP.

Project hiện tại chưa cần normalize môn học.

---

## tuition_fee

```text
NUMERIC(12,2) NOT NULL
```

Đây là học phí chuẩn của lớp cho một kỳ thanh toán.

Hiện tại có thể hiểu một kỳ là:

```text
1 tháng
```

Ví dụ:

```text
500000
600000
750000
```

Không dùng:

```text
FLOAT
DOUBLE
REAL
```

cho tiền.

---

## start_date

```text
DATE NOT NULL
```

Ngày lớp bắt đầu.

---

## end_date

```text
DATE NULL
```

NULL nghĩa là chưa xác định ngày kết thúc.

Validation:

```text
end_date >= start_date
```

nếu `end_date` tồn tại.

---

## status

Các trạng thái:

```text
ACTIVE
INACTIVE
COMPLETED
```

Ý nghĩa:

```text
ACTIVE
Lớp đang học.

INACTIVE
Lớp đang tạm ngừng.

COMPLETED
Lớp đã kết thúc.
```

Hãy sử dụng cách implement enum/check constraint phù hợp với architecture hiện tại.

Không tự thay đổi toàn bộ enum architecture của project.

---

## note

```text
TEXT NULL
```

---

## timestamps

```text
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Sử dụng convention hiện tại của project.

---

# 6. KHÔNG LƯU STUDENT COUNT TRONG CLASS

Không tạo column:

```text
student_count
```

trong database.

Student count là dữ liệu tính được từ:

```text
class_students
```

API có thể trả:

```json
{
  "id": "...",
  "name": "Văn 12",
  "studentCount": 25
}
```

Nhưng:

```text
studentCount
```

chỉ là response field.

Không phải database field.

---

# 7. CLASS API

Sau khi Class table/model được tôi approve, cập nhật Class API từng endpoint.

Thứ tự:

```text
1. POST /classes

STOP

2. GET /classes

STOP

3. GET /classes/:id

STOP

4. PATCH /classes/:id

STOP

5. DELETE /classes/:id

STOP
```

Nếu hiện tại API dùng PUT thay vì PATCH:

Hãy giải thích trước, không tự thay API convention.

---

# 8. STUDENTS TABLE

Sau khi Class hoàn tất và tôi đồng ý mới chuyển sang Student.

Table:

```text
students
```

Schema:

```text
id
full_name
phone
parent_name
parent_phone
school
grade
date_of_birth
address
status
note
created_at
updated_at
```

---

## id

```text
UUID PRIMARY KEY
```

---

## full_name

```text
VARCHAR(150) NOT NULL
```

Ví dụ:

```text
Nguyễn Văn An
```

---

## phone

```text
VARCHAR(20) NULL
```

Không sử dụng numeric.

---

## parent_name

```text
VARCHAR(150) NULL
```

---

## parent_phone

```text
VARCHAR(20) NULL
```

Không đặt unique.

Hai học sinh là anh/chị/em có thể dùng chung số điện thoại phụ huynh.

---

## school

```text
VARCHAR(200) NULL
```

Ví dụ:

```text
THPT Chu Văn An
```

---

## grade

```text
SMALLINT NULL
```

Có thể validate:

```text
1 <= grade <= 12
```

Grade ở Student thể hiện **khối hiện tại của học sinh**.

Grade ở Class thể hiện **khối của lớp học**.

Hai field có ý nghĩa khác nhau nên việc tồn tại ở cả hai bảng không phải duplicate không hợp lệ.

---

## date_of_birth

```text
DATE NULL
```

Không lưu:

```text
age
```

vì tuổi có thể tính từ ngày sinh.

---

## address

```text
TEXT NULL
```

---

## status

```text
ACTIVE
INACTIVE
```

`INACTIVE` nghĩa là học sinh không còn hoạt động trong hệ thống.

Không tự xóa student khi học sinh nghỉ nếu student đã có lịch sử học/payment.

---

## note

```text
TEXT NULL
```

---

## timestamps

```text
created_at
updated_at
```

theo convention hiện tại.

---

# 9. STUDENT KHÔNG CÓ CLASS_ID

Không thiết kế:

```text
students.class_id
```

Student và Class là many-to-many.

Một student có thể:

```text
- từng học lớp 10
- sau đó học lớp 11
- học lớp ôn thi
- chuyển lớp
```

Do đó quan hệ phải nằm trong:

```text
class_students
```

---

# 10. STUDENT API

Implement từng API riêng biệt:

```text
POST /students
```

STOP.

Sau khi tôi đồng ý:

```text
GET /students
```

STOP.

Sau khi tôi đồng ý:

```text
GET /students/:id
```

STOP.

Sau khi tôi đồng ý:

```text
PATCH /students/:id
```

STOP.

Sau khi tôi đồng ý:

```text
DELETE /students/:id
```

STOP.

---

# 11. CLASS_STUDENTS / ENROLLMENT TABLE

Sau khi Student CRUD hoàn tất mới làm bảng quan hệ.

Table database:

```text
class_students
```

Trong business logic có thể gọi nó là:

```text
Enrollment
```

Schema:

```text
id
class_id
student_id
joined_at
left_at
status
created_at
updated_at
```

---

## id

```text
UUID PRIMARY KEY
```

---

## class_id

```text
UUID NOT NULL
```

Foreign key:

```text
classes(id)
```

---

## student_id

```text
UUID NOT NULL
```

Foreign key:

```text
students(id)
```

---

## joined_at

```text
DATE NOT NULL
```

Ngày học sinh bắt đầu học lớp.

---

## left_at

```text
DATE NULL
```

Nếu vẫn đang học:

```text
NULL
```

---

## status

```text
ACTIVE
LEFT
```

---

# 12. ENROLLMENT HISTORY

Không nên delete `class_students` khi học sinh nghỉ.

Thay vào đó:

```text
status = LEFT
left_at = ...
```

để giữ lịch sử.

Student có thể rời lớp và sau này tham gia lại.

Nếu phù hợp với PostgreSQL/database layer hiện tại, nên đảm bảo một student không có **hai enrollment ACTIVE cùng lúc trong cùng một class**.

Có thể sử dụng partial unique index:

```sql
UNIQUE active enrollment
(class_id, student_id)
WHERE status = 'ACTIVE'
```

Nếu migration/database abstraction hiện tại không hỗ trợ thuận tiện thì:

- không thêm workaround phức tạp ngay
- validate ở service layer
- giải thích cho tôi trước

---

# 13. ENROLLMENT API

Không cần tạo generic CRUD vô nghĩa cho junction table.

Sử dụng business-oriented API.

Ví dụ:

```text
POST /classes/:classId/students
```

Body:

```json
{
  "studentId": "...",
  "joinedAt": "2026-09-01"
}
```

Ý nghĩa:

```text
Enroll student vào class.
```

Sau đó STOP.

---

Tiếp theo:

```text
GET /classes/:classId/students
```

Danh sách student của class.

STOP.

---

Tiếp theo:

```text
DELETE /classes/:classId/students/:studentId
```

Nhưng endpoint này **không nhất thiết hard delete database record**.

Business logic nên:

```text
status = LEFT
left_at = currentDate
```

Giải thích rõ điều này trước khi implement.

STOP.

---

# 14. CLASS_SCHEDULES TABLE

Không lưu lịch học như string:

```text
"Thứ 2, Thứ 5 - 19h"
```

trong `classes`.

Tạo table:

```text
class_schedules
```

Schema:

```text
id
class_id
day_of_week
start_time
end_time
created_at
updated_at
```

---

## class_id

Foreign key:

```text
classes(id)
```

---

## day_of_week

Các giá trị:

```text
MONDAY
TUESDAY
WEDNESDAY
THURSDAY
FRIDAY
SATURDAY
SUNDAY
```

---

## start_time

```text
TIME NOT NULL
```

---

## end_time

```text
TIME NOT NULL
```

Constraint:

```text
end_time > start_time
```

---

Ví dụ một class học:

```text
Monday    19:00 → 21:00
Thursday  19:00 → 21:00
```

thì database có hai record.

---

# 15. PAYMENT MODEL

Payment là phần cần thiết kế cẩn thận.

Tôi muốn quản lý học phí theo tháng.

Mỗi payment record thể hiện nghĩa vụ học phí của một Enrollment trong một tháng.

Relationship:

```text
Student
   │
   ▼
ClassStudent
   │
   ▼
Payment
```

Không thiết kế Payment độc lập bằng:

```text
student_id
class_id
```

Payment phải reference:

```text
class_student_id
```

hoặc nếu codebase dùng terminology business:

```text
enrollment_id
```

Database table vẫn có thể là:

```text
class_students
```

---

# 16. PAYMENTS TABLE

Schema:

```text
id
class_student_id
billing_period
amount_due
amount_paid
paid_at
payment_method
note
created_at
updated_at
```

---

## id

```text
UUID PRIMARY KEY
```

---

## class_student_id

```text
UUID NOT NULL
```

Foreign key:

```text
class_students(id)
```

Điều này đảm bảo payment chỉ có thể tồn tại nếu student thực sự thuộc class.

---

# 17. BILLING PERIOD

```text
billing_period DATE NOT NULL
```

Dùng ngày đầu tiên của tháng để đại diện cho tháng học phí.

Ví dụ:

```text
2026-09-01
```

nghĩa là:

```text
September 2026
```

Không lưu:

```text
month = 9
year = 2026
```

thành hai column riêng nếu không cần thiết.

Service phải normalize billing period về ngày đầu tháng.

---

# 18. AMOUNT DUE

```text
amount_due NUMERIC(12,2) NOT NULL
```

Khi tạo monthly payment:

```text
amount_due
```

mặc định có thể copy từ:

```text
classes.tuition_fee
```

Điều này rất quan trọng.

Không query trực tiếp `classes.tuition_fee` để xác định lịch sử học phí cũ.

Ví dụ:

Tháng 9:

```text
tuition_fee = 500000
```

Tháng 10 giáo viên đổi:

```text
tuition_fee = 600000
```

Payment tháng 9 vẫn phải giữ:

```text
amount_due = 500000
```

Do đó `amount_due` là snapshot của học phí tại thời điểm tạo payment.

---

# 19. AMOUNT PAID

```text
amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0
```

Có constraint:

```text
amount_paid >= 0
amount_due >= 0
```

Không dùng floating point.

---

# 20. PAYMENT STATUS

Không nhất thiết lưu `status` trong database.

Có thể derive từ:

```text
amount_paid
amount_due
```

Logic:

```text
amount_paid == 0
→ UNPAID
```

```text
0 < amount_paid < amount_due
→ PARTIAL
```

```text
amount_paid >= amount_due
→ PAID
```

API response có thể trả:

```json
{
  "status": "PAID"
}
```

nhưng đây có thể là computed field.

Lý do:

Nếu lưu cả:

```text
amount_due
amount_paid
status
```

thì có nguy cơ dữ liệu bị lệch.

Ví dụ:

```text
amountDue = 500000
amountPaid = 500000
status = UNPAID
```

Không nên để tồn tại trạng thái mâu thuẫn như vậy.

Nếu codebase hiện tại có lý do kỹ thuật mạnh để persist status thì hãy giải thích trước khi implement.

---

# 21. PAID AT

```text
paid_at TIMESTAMPTZ NULL
```

Nếu chưa thanh toán đủ:

```text
NULL
```

Khi payment đạt trạng thái PAID thì cập nhật thời gian thanh toán phù hợp.

MVP hiện tại chưa cần payment transaction history riêng.

Nếu sau này cần nhiều lần chuyển khoản/thanh toán cho cùng một monthly payment, có thể bổ sung:

```text
payment_transactions
```

Nhưng:

**KHÔNG tạo bảng đó bây giờ.**

Không over-engineer MVP.

---

# 22. PAYMENT METHOD

Có thể nullable:

```text
payment_method
```

Các giá trị ban đầu:

```text
CASH
BANK_TRANSFER
OTHER
```

Không tạo bảng payment methods riêng.

---

# 23. UNIQUE PAYMENT

Một enrollment chỉ có một payment record cho một billing period.

Cần constraint:

```text
UNIQUE(class_student_id, billing_period)
```

Ví dụ không được có:

```text
Student A
Class Văn 12
September 2026
```

hai payment record khác nhau.

---

# 24. PAYMENT API

Implement từng API một.

Ví dụ:

```text
POST /payments
```

STOP.

Sau đó:

```text
GET /payments
```

STOP.

Sau đó:

```text
GET /payments/:id
```

STOP.

Sau đó:

```text
PATCH /payments/:id
```

STOP.

Sau đó:

```text
DELETE /payments/:id
```

STOP.

Không làm tất cả một lúc.

---

# 25. PAYMENT LIST FILTERS

`GET /payments` sau này nên có khả năng filter theo:

```text
classId
studentId
billingPeriod
status
```

Nhưng không implement tất cả ngay nếu chưa đến bước đó.

Khi đến `GET /payments`, hãy đề xuất query design trước rồi chờ tôi đồng ý.

---

# 26. DELETE STRATEGY

Đây là application có historical data.

Không được cascade delete một cách nguy hiểm.

Ví dụ:

Nếu Class đã có:

```text
enrollment
payment history
```

thì không nên:

```text
DELETE class
→ DELETE enrollment
→ DELETE payment
```

và làm mất toàn bộ lịch sử tài chính.

Preferred behavior:

### Class chưa từng được sử dụng

Có thể hard delete.

### Class đã có enrollment/payment

Nên trả lỗi phù hợp hoặc chuyển:

```text
status = INACTIVE
```

---

Tương tự Student.

Nếu Student đã có payment history:

Không nên tự động cascade delete toàn bộ history.

Nếu API hiện tại đang sử dụng hard delete thì:

1. Inspect implementation.
2. Giải thích vấn đề.
3. Đề xuất migration strategy.
4. Chờ tôi approve.
5. Không tự sửa ngay.

---

# 27. FOREIGN KEY STRATEGY

Ưu tiên an toàn dữ liệu.

Ví dụ:

```text
class_schedules.class_id
```

có thể:

```text
ON DELETE CASCADE
```

vì schedule không có ý nghĩa nếu class biến mất.

Nhưng:

```text
payments
```

không được cascade delete vô tình từ Student/Class.

Financial history phải được bảo vệ.

---

# 28. INDEXES

Không over-index database nhỏ.

Chỉ thêm index hợp lý.

Candidates:

```text
classes(status)
classes(school_year)
classes(grade)

students(status)
students(grade)

class_students(class_id)
class_students(student_id)

class_schedules(class_id)

payments(class_student_id)
payments(billing_period)
```

Unique index:

```text
payments(class_student_id, billing_period)
```

Nếu có partial active enrollment:

```text
class_students(class_id, student_id)
WHERE status = 'ACTIVE'
```

Trước khi thêm index, hãy kiểm tra migration conventions hiện tại.

---

# 29. API RESPONSE MODEL

Database model và API response không cần giống 100%.

Ví dụ Class database:

```text
id
name
grade
school_year
...
```

Class API có thể trả thêm:

```text
studentCount
schedules
```

Ví dụ:

```json
{
  "id": "uuid",
  "name": "Văn 12A1",
  "grade": 12,
  "schoolYear": "2026-2027",
  "subject": "Ngữ Văn",
  "tuitionFee": 600000,
  "status": "ACTIVE",
  "studentCount": 28,
  "schedules": [
    {
      "dayOfWeek": "MONDAY",
      "startTime": "19:00",
      "endTime": "21:00"
    },
    {
      "dayOfWeek": "THURSDAY",
      "startTime": "19:00",
      "endTime": "21:00"
    }
  ]
}
```

Nhưng:

```text
studentCount
```

không phải database column.

---

# 30. AUTHENTICATION

Authentication đã hoàn thành.

Mọi API business cần tiếp tục sử dụng JWT middleware hiện tại nếu routes hiện tại đang protected.

Không:

- viết lại JWT
- thay refresh-token architecture
- đổi token storage
- đổi auth middleware

trừ khi tôi yêu cầu riêng.

Hiện tại app chỉ có một giáo viên sử dụng.

Do đó chưa cần thêm:

```text
teacher_id
```

vào:

```text
classes
students
payments
```

Chỉ cần thiết kế sao cho sau này có thể migrate sang multi-user nếu cần.

Không implement multi-tenancy bây giờ.

---

# 31. NAMING

Database có thể sử dụng:

```text
snake_case
```

Ví dụ:

```text
school_year
tuition_fee
created_at
```

TypeScript/API có thể sử dụng:

```text
camelCase
```

Ví dụ:

```text
schoolYear
tuitionFee
createdAt
```

Nhưng phải tuân theo convention project hiện tại.

Không tự đổi naming convention toàn project.

---

# 32. VALIDATION

Mỗi API phải validate input.

Ví dụ Class:

```text
name required
grade valid
schoolYear valid
tuitionFee >= 0
endDate >= startDate
```

Student:

```text
fullName required
grade valid if provided
phone valid enough for application use
```

Payment:

```text
enrollment exists
billingPeriod valid
amountDue >= 0
amountPaid >= 0
duplicate billing period not allowed
```

Không cần tạo validation quá phức tạp.

Follow validation library hiện tại nếu project đã có.

---

# 33. TRANSACTIONS

Chỉ sử dụng database transaction khi operation thực sự gồm nhiều database operations cần atomicity.

Không wrap mọi API trong transaction vô lý.

Ví dụ:

```text
create enrollment
+
related required operation
```

n
