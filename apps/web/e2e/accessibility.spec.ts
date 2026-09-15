import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs, SELLER_DNI, ADMIN_DNI } from "./helpers";

/**
 * Phase 8 acceptance: zero critical/serious axe violations on /login,
 * /seller/alerts, /admin/reports — see docs/ARCHITECTURE.md Section L.
 */
function seriousOrCritical(violations: { impact?: string | null }[]) {
  return violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

test("login has no critical accessibility violations", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page }).analyze();
  const findings = seriousOrCritical(results.violations);
  expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
});

test("seller alerts has no critical accessibility violations", async ({ page }) => {
  await loginAs(page, SELLER_DNI);
  await page.waitForURL("**/seller/alerts");
  const results = await new AxeBuilder({ page }).analyze();
  const findings = seriousOrCritical(results.violations);
  expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
});

test("admin reports has no critical accessibility violations", async ({ page }) => {
  await loginAs(page, ADMIN_DNI);
  await page.waitForURL("**/admin/reports");
  const results = await new AxeBuilder({ page }).analyze();
  const findings = seriousOrCritical(results.violations);
  expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
});
