-- Prepared while "Class" had no rows (2026-10-01). Apply only after the
-- Class create API assigns the authenticated user's ID, with writes paused.
-- If rows appear before application, stop and obtain an approved mapping
-- from every Class.id to its owning User.id before preparing a backfill.
BEGIN;

LOCK TABLE "Class" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Class") THEN
        RAISE EXCEPTION 'Class ownership migration stopped: existing rows require an approved Class.id to User.id mapping';
    END IF;
END $$;

ALTER TABLE "Class" ADD COLUMN "teacher_id" INTEGER NOT NULL;

CREATE INDEX "Class_teacher_id_idx" ON "Class"("teacher_id");

ALTER TABLE "Class"
ADD CONSTRAINT "Class_teacher_id_fkey"
FOREIGN KEY ("teacher_id") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
