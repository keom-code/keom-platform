import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z, ZodError } from "zod";
import { AuthGuard, CurrentUser, Roles } from "../auth/auth.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { DashboardService } from "./dashboard.service";

/**
 * Phase 11 /v1 endpoints consumed by apps/web's HTTP services (DATA_SOURCE=http). All of
 * them require a Bearer token (AuthGuard) and use only the caller's companyId. Response
 * shapes are @keom/contracts types — test/dashboard.e2e-spec.ts parses every response with
 * the contract's Zod schema. Full reference: docs/PHASE-11-API.md.
 */

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) throw new BadRequestException(message);
    throw err;
  }
}

const IdSchema = z.string().uuid();

@Controller("v1/seller")
@UseGuards(AuthGuard)
@Roles("SELLER")
export class SellerDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** SellerAlert[] — open alerts (PENDING and ACKNOWLEDGED), most urgent first. */
  @Get("alerts")
  listAlerts(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.listSellerAlerts(user.companyId);
  }

  @Post("alerts/:id/acknowledge")
  @HttpCode(204)
  async acknowledge(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.dashboard.acknowledge(user.companyId, parse(IdSchema, id, "Invalid alert id"));
  }

  /** CustomerRisk[] — one row per customer with an active opportunity. */
  @Get("risks")
  listRisks(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    const filters = parse(
      z.object({ search: z.string().trim().max(100).optional(), level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional() }),
      query,
      "Invalid risk filters",
    );
    return this.dashboard.listCustomerRisks(user.companyId, filters);
  }
}

@Controller("v1/admin")
@UseGuards(AuthGuard)
@Roles("ADMIN")
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** AdminAlertRow[] — every alert of the company, newest first, including completed ones. */
  @Get("alerts")
  listAlerts(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.listAdminAlerts(user.companyId);
  }

  /** AdminAlertDetail — 404 when the alert doesn't exist in the caller's company. */
  @Get("alerts/:id")
  getAlert(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.dashboard.getAdminAlert(user.companyId, parse(IdSchema, id, "Invalid alert id"));
  }
}
