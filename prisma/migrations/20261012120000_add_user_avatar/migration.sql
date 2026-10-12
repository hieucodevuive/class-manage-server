-- NULL nghĩa là tài khoản chưa có ảnh riêng và sẽ dùng ảnh mặc định chung.
-- Không backfill URL ảnh hoặc sửa thông tin/hồ sơ đã tồn tại.
ALTER TABLE "User" ADD COLUMN "avatar" TEXT;
