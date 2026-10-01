BEGIN;

CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20),
    "parentName" VARCHAR(150),
    "parentPhone" VARCHAR(20),
    "school" VARCHAR(200),
    "grade" SMALLINT,
    "dateOfBirth" DATE,
    "address" TEXT,
    "status" "StudentStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Student_grade_check" CHECK ("grade" IS NULL OR "grade" BETWEEN 1 AND 12)
);

CREATE INDEX "Student_teacher_id_idx" ON "Student"("teacher_id");

ALTER TABLE "Student"
ADD CONSTRAINT "Student_teacher_id_fkey"
FOREIGN KEY ("teacher_id") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
