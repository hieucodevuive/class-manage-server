BEGIN;

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'OTHER');

CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "classStudentId" UUID NOT NULL,
    "billingPeriod" DATE NOT NULL,
    "amountDue" NUMERIC(12,2) NOT NULL,
    "amountPaid" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMPTZ(3),
    "paymentMethod" "PaymentMethod",
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_billingPeriod_check"
        CHECK (isfinite("billingPeriod") AND EXTRACT(DAY FROM "billingPeriod") = 1),
    CONSTRAINT "Payment_amountDue_check"
        CHECK ("amountDue" >= 0 AND "amountDue" <= 9999999999.99),
    CONSTRAINT "Payment_amountPaid_check"
        CHECK ("amountPaid" >= 0 AND "amountPaid" <= 9999999999.99)
);

CREATE UNIQUE INDEX "Payment_classStudentId_billingPeriod_key"
ON "Payment"("classStudentId", "billingPeriod");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_classStudentId_fkey"
FOREIGN KEY ("classStudentId") REFERENCES "ClassStudent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
