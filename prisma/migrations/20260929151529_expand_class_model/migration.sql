/*
  Warnings:

  - You are about to alter the column `name` on the `Class` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(100)`.
  - Added the required column `grade` to the `Class` table without a default value. This is not possible if the table is not empty.
  - Added the required column `schoolYear` to the `Class` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `Class` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subject` to the `Class` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tuitionFee` to the `Class` table without a default value. This is not possible if the table is not empty.

*/
BEGIN;

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED');

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "endDate" DATE,
ADD COLUMN     "grade" SMALLINT NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "schoolYear" VARCHAR(20) NOT NULL,
ADD COLUMN     "startDate" DATE NOT NULL,
ADD COLUMN     "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "subject" VARCHAR(100) NOT NULL,
ADD COLUMN     "tuitionFee" DECIMAL(12,2) NOT NULL,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Business constraints are kept in SQL because Prisma schema does not express CHECK constraints.
ALTER TABLE "Class"
ADD CONSTRAINT "Class_grade_check" CHECK ("grade" BETWEEN 1 AND 12),
ADD CONSTRAINT "Class_tuitionFee_check" CHECK ("tuitionFee" >= 0),
ADD CONSTRAINT "Class_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

COMMIT;
