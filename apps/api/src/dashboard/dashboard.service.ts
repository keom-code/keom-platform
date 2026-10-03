import { Injectable, NotFoundException } from "@nestjs/common";
import { Customer, NextBestAction, Opportunity, RiskLevel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminReasonText,
  MessageTimes,
  replyStatusText,
  requiredActionText,
  RISK_ORDER,
  splitName,
  summaryText,
  whatsappUrl,
} from "./presentation";

/** Bounded for the pilot; pagination comes when a company has more open opportunities. */
const MAX_OPPORTUNITIES = 500;

interface OpportunityRow {
  opportunity: Opportunity;
  customer: Customer;
  action: NextBestAction | null;
  times: MessageTimes;
}

/**
 * Phase 11 read models for apps/web, shaped exactly like @keom/contracts (SellerAlert,
 * AdminAlertRow, AdminAlertDetail, CustomerRisk). Every query is scoped by the companyId of
 * the authenticated caller; nothing here takes a companyId from request input.
 *
 * - An **alert** is an active opportunity whose latest M2A next action is not WAIT. Alert id
 *   = opportunity id. Sellers see their whole company's alerts (no assignment yet, so the
 *   admin view shows "Sin asignar").
 * - A **customer risk** is the customer's most recent active opportunity. `riskScore` is
 *   M2A's 0-100 commercial score (the contract's name says "risk"; see docs/PHASE-11-API.md).
 * - `opportunityValue` and `treatment` are omitted: KEOM has no data for them yet.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async listSellerAlerts(companyId: string, now = new Date()) {
    const rows = (await this.loadActive(companyId)).filter((row) => isAlert(row) && row.opportunity.alertStatus !== "COMPLETED");
    rows.sort(
      (a, b) =>
        RISK_ORDER[a.opportunity.priority] - RISK_ORDER[b.opportunity.priority] ||
        RISK_ORDER[a.opportunity.risk] - RISK_ORDER[b.opportunity.risk] ||
        b.opportunity.createdAt.getTime() - a.opportunity.createdAt.getTime(),
    );
    return rows.map((row) => toSellerAlert(row, now));
  }

  async listAdminAlerts(companyId: string) {
    const rows = (await this.loadActive(companyId)).filter(isAlert);
    rows.sort((a, b) => b.opportunity.createdAt.getTime() - a.opportunity.createdAt.getTime());
    return rows.map(toAdminAlertRow);
  }

  async getAdminAlert(companyId: string, alertId: string, now = new Date()) {
    const [row] = await this.load({ companyId, id: alertId, isActive: true });
    if (!row || !isAlert(row)) throw new NotFoundException("Alert not found");
    return { ...toAdminAlertRow(row), summary: toSellerAlert(row, now).summary };
  }

  /** PENDING -> ACKNOWLEDGED. Idempotent: an already acknowledged/completed alert is left as is. */
  async acknowledge(companyId: string, alertId: string, now = new Date()): Promise<void> {
    const { count } = await this.prisma.opportunity.updateMany({
      where: { id: alertId, companyId, isActive: true, alertStatus: "PENDING" },
      data: { alertStatus: "ACKNOWLEDGED", acknowledgedAt: now },
    });
    if (count > 0) return;
    const exists = await this.prisma.opportunity.count({ where: { id: alertId, companyId, isActive: true } });
    if (!exists) throw new NotFoundException("Alert not found");
  }

  async listCustomerRisks(companyId: string, filters: { search?: string; level?: RiskLevel }, now = new Date()) {
    const latestPerCustomer = new Map<string, OpportunityRow>();
    for (const row of await this.loadActive(companyId)) {
      const current = latestPerCustomer.get(row.customer.id);
      if (!current || row.opportunity.updatedAt > current.opportunity.updatedAt) latestPerCustomer.set(row.customer.id, row);
    }

    const search = filters.search ? fold(filters.search) : null;
    return [...latestPerCustomer.values()]
      .filter((row) => !filters.level || row.opportunity.risk === filters.level)
      .filter((row) => !search || fold(`${row.customer.name ?? ""} ${row.customer.phone ?? row.customer.externalId}`).includes(search))
      .sort((a, b) => RISK_ORDER[a.opportunity.risk] - RISK_ORDER[b.opportunity.risk] || b.opportunity.score - a.opportunity.score)
      .map((row) => toCustomerRisk(row, now));
  }

  private loadActive(companyId: string) {
    return this.load({ companyId, isActive: true });
  }

  private async load(where: { companyId: string; isActive: boolean; id?: string }): Promise<OpportunityRow[]> {
    const opportunities = await this.prisma.opportunity.findMany({
      where,
      include: { customer: true, actionRecommendations: { orderBy: { createdAt: "desc" }, take: 1, select: { action: true } } },
      orderBy: { updatedAt: "desc" },
      take: MAX_OPPORTUNITIES,
    });
    if (opportunities.length === 0) return [];

    const latest = await this.prisma.message.groupBy({
      by: ["conversationId", "direction"],
      where: { companyId: where.companyId, conversationId: { in: [...new Set(opportunities.map((o) => o.conversationId))] } },
      _max: { sentAt: true },
    });
    const timesByConversation = new Map<string, MessageTimes>();
    for (const entry of latest) {
      const times = timesByConversation.get(entry.conversationId) ?? {};
      if (entry.direction === "INBOUND") times.lastInboundAt = entry._max.sentAt ?? undefined;
      else times.lastOutboundAt = entry._max.sentAt ?? undefined;
      timesByConversation.set(entry.conversationId, times);
    }

    return opportunities.map(({ customer, actionRecommendations, ...opportunity }) => ({
      opportunity,
      customer,
      action: actionRecommendations[0]?.action ?? null,
      times: timesByConversation.get(opportunity.conversationId) ?? {},
    }));
  }
}

function isAlert(row: OpportunityRow): boolean {
  return !!row.action && row.action !== "WAIT";
}

function phoneOf(customer: Customer): string {
  return (customer.phone ?? customer.externalId).replace(/\D/g, "");
}

function toSellerAlert(row: OpportunityRow, now: Date) {
  const phone = phoneOf(row.customer);
  const { firstName, lastName } = splitName(row.customer.name, phone);
  return {
    id: row.opportunity.id,
    customer: { id: row.customer.id, firstName, lastName, phone: `+${phone}` },
    priority: row.opportunity.priority,
    summary: summaryText({ firstName, signals: row.opportunity.currentSignals, state: row.opportunity.state, times: row.times, now }),
    requiredAction: requiredActionText(row.action ?? "RESPOND"),
    createdAt: row.opportunity.createdAt.toISOString(),
    status: row.opportunity.alertStatus,
    whatsappUrl: whatsappUrl(phone),
  };
}

function toAdminAlertRow(row: OpportunityRow) {
  const phone = phoneOf(row.customer);
  const { firstName, lastName } = splitName(row.customer.name, phone);
  return {
    id: row.opportunity.id,
    customerName: `${firstName} ${lastName}`.trim(),
    sellerName: "Sin asignar",
    reason: adminReasonText(row.opportunity.state),
    createdAt: row.opportunity.createdAt.toISOString(),
    ...(row.opportunity.acknowledgedAt && { acknowledgedAt: row.opportunity.acknowledgedAt.toISOString() }),
    ...(row.opportunity.completedAt && { completedAt: row.opportunity.completedAt.toISOString() }),
    status: row.opportunity.alertStatus,
  };
}

function toCustomerRisk(row: OpportunityRow, now: Date) {
  const phone = phoneOf(row.customer);
  const { firstName, lastName } = splitName(row.customer.name, phone);
  const lastActivity = [row.times.lastInboundAt, row.times.lastOutboundAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    customerId: row.customer.id,
    customerName: `${firstName} ${lastName}`.trim(),
    riskLevel: row.opportunity.risk,
    riskScore: row.opportunity.score,
    reason: replyStatusText(row.times, now),
    nextBestAction: requiredActionText(row.action ?? "WAIT"),
    lastActivityAt: (lastActivity ?? row.opportunity.updatedAt).toISOString(),
    whatsappUrl: whatsappUrl(phone),
  };
}

/** Lowercase without accents, so "maria" finds "María". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
