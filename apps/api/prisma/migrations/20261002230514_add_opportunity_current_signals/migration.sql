-- AlterTable
ALTER TABLE "opportunity" ADD COLUMN     "current_signals" "signal_type"[] DEFAULT ARRAY[]::"signal_type"[];
