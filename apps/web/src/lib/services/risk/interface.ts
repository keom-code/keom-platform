import type { CustomerRisk, RiskLevel } from "@keom/contracts";

export interface RiskFilters {
  search?: string;
  level?: RiskLevel;
}

export interface RiskService {
  listCustomerRisks(filters?: RiskFilters): Promise<CustomerRisk[]>;
}
