import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { loginAttemptsPerMinute } from "./auth.config";
import { AuthController, LoginThrottlerGuard } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

/**
 * Phase 11 authentication for the /v1 API. The JWT secret is passed per call (from
 * loadAuthConfig) rather than at module registration, so the API boots without it.
 * Throttler storage is in-memory (single API process); a shared store comes with scaling.
 */
@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({ useFactory: () => ({ throttlers: [{ ttl: 60_000, limit: loginAttemptsPerMinute() }] }) }),
  ],
  providers: [AuthService, AuthGuard, LoginThrottlerGuard],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
