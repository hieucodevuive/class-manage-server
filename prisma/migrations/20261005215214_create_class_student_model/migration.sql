BEGIN;

CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'LEFT');

CREATE TABLE "ClassStudent" (
    "id" UUID NOT NULL,
    "classId" INTEGER NOT NULL,
    "studentId" UUID NOT NULL,
    "joinedAt" DATE NOT NULL,
    "leftAt" DATE,
    "status" "EnrollmentStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassStudent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClassStudent_dates_check" CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt")
);

CREATE UNIQUE INDEX "ClassStudent_classId_studentId_key"
ON "ClassStudent"("classId", "studentId");

-- Unique(classId, studentId) cũng phục vụ truy vấn theo classId.
CREATE INDEX "ClassStudent_studentId_idx" ON "ClassStudent"("studentId");

ALTER TABLE "ClassStudent"
ADD CONSTRAINT "ClassStudent_classId_fkey"
FOREIGN KEY ("classId") REFERENCES "Class"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClassStudent"
ADD CONSTRAINT "ClassStudent_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
