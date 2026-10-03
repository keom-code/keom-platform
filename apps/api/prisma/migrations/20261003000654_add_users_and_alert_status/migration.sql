-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'COMPLETED');

-- AlterTable
ALTER TABLE "opportunity" ADD COLUMN     "acknowledged_at" TIMESTAMP(3),
ADD COLUMN     "alert_status" "alert_status" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "completed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "dni" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_dni_key" ON "user"("dni");

-- CreateIndex
CREATE INDEX "user_company_id_idx" ON "user"("company_id");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
