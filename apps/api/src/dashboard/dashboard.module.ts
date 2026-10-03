import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminDashboardController, SellerDashboardController } from "./dashboard.controllers";
import { DashboardService } from "./dashboard.service";

/** Phase 11: authenticated read models (+ alert acknowledgement) for apps/web. */
@Module({
  imports: [AuthModule],
  providers: [DashboardService],
  controllers: [SellerDashboardController, AdminDashboardController],
})
export class DashboardModule {}
