BEGIN;

-- Email hiện có là tên ban đầu theo yêu cầu của chủ hệ thống.
-- Thêm nullable trước để không dùng một default cố định cho mọi tài khoản.
ALTER TABLE "User" ADD COLUMN "name" TEXT;

UPDATE "User" SET "name" = "email" WHERE "name" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "name" IS NULL) THEN
    RAISE EXCEPTION 'User.name còn NULL sau khi backfill từ email';
  END IF;
END;
$$;

ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;

COMMIT;
