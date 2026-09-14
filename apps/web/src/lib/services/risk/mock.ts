import "server-only";
import { mockCustomerRisks } from "@keom/mocks";
import type { CustomerRisk } from "@keom/contracts";
import type { RiskFilters, RiskService } from "./interface";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockRiskService implements RiskService {
  async listCustomerRisks(filters: RiskFilters = {}): Promise<CustomerRisk[]> {
    await delay(200);
    return mockCustomerRisks.filter((risk) => {
      if (filters.level && risk.riskLevel !== filters.level) return false;
      if (filters.search && !risk.customerName.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }
}
