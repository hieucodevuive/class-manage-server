BEGIN;

CREATE TYPE "DayOfWeek" AS ENUM (
    'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY',
    'FRIDAY', 'SATURDAY', 'SUNDAY'
);

CREATE TABLE "ClassSchedule" (
    "id" UUID NOT NULL,
    "classId" INTEGER NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClassSchedule_times_check" CHECK ("endTime" > "startTime")
);

CREATE INDEX "ClassSchedule_classId_idx" ON "ClassSchedule"("classId");

ALTER TABLE "ClassSchedule"
ADD CONSTRAINT "ClassSchedule_classId_fkey"
FOREIGN KEY ("classId") REFERENCES "Class"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
