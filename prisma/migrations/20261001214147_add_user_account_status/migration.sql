BEGIN;

CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE');

-- Các tài khoản đã tồn tại có quyền đăng nhập trước migration, nên giữ ACTIVE.
ALTER TABLE "User" ADD COLUMN "status" "AccountStatus";
UPDATE "User" SET "status" = 'ACTIVE';
ALTER TABLE "User" ALTER COLUMN "status" SET NOT NULL;

-- Tài khoản tạo sau migration phải chờ duyệt, trừ khi luồng nội bộ gán ACTIVE rõ ràng.
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'PENDING';

COMMIT;
