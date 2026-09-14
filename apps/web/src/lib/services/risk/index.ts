import { MockRiskService } from "./mock";
import type { RiskService } from "./interface";

export type { RiskFilters, RiskService } from "./interface";

// No HttpRiskService yet — see docs/ARCHITECTURE.md Section H / Phase 11.
export const riskService: RiskService = new MockRiskService();
