-- CreateEnum
CREATE TYPE "opportunity_state" AS ENUM ('NEW', 'ENGAGED', 'HIGH_INTENT', 'AT_RISK');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "interest_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "signal_type" AS ENUM ('PRICING_REQUESTED', 'AVAILABILITY_REQUESTED', 'BOOKING_INTENT', 'PURCHASE_INTENT', 'QUOTE_REQUESTED', 'PAYMENT_QUESTION', 'FOLLOW_UP_REQUESTED', 'OBJECTION', 'NO_LONGER_INTERESTED');

-- CreateEnum
CREATE TYPE "next_best_action" AS ENUM ('RESPOND', 'SEND_INFORMATION', 'ASK_QUESTION', 'OFFER_APPOINTMENT', 'FOLLOW_UP', 'WAIT', 'ESCALATE_TO_HUMAN');

-- CreateTable
CREATE TABLE "opportunity" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "state" "opportunity_state" NOT NULL DEFAULT 'NEW',
    "priority" "priority" NOT NULL DEFAULT 'LOW',
    "risk" "risk_level" NOT NULL DEFAULT 'LOW',
    "interest_level" "interest_level",
    "score" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_evaluated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_signal" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "type" "signal_type" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_state_history" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "previous_state" "opportunity_state",
    "new_state" "opportunity_state" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_state_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_recommendation" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "action" "next_best_action" NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" "priority" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_company_id_idx" ON "opportunity"("company_id");

-- CreateIndex
CREATE INDEX "opportunity_conversation_id_is_active_idx" ON "opportunity"("conversation_id", "is_active");

-- CreateIndex
CREATE INDEX "opportunity_signal_opportunity_id_idx" ON "opportunity_signal"("opportunity_id");

-- CreateIndex
CREATE INDEX "opportunity_state_history_opportunity_id_idx" ON "opportunity_state_history"("opportunity_id");

-- CreateIndex
CREATE INDEX "action_recommendation_opportunity_id_idx" ON "action_recommendation"("opportunity_id");

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_signal" ADD CONSTRAINT "opportunity_signal_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_state_history" ADD CONSTRAINT "opportunity_state_history_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_recommendation" ADD CONSTRAINT "action_recommendation_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
