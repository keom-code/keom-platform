import type { Page } from "@playwright/test";

export const SELLER_DNI = "12345678";
export const ADMIN_DNI = "87654321";

export async function loginAs(page: Page, dni: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#dni", dni);
  await page.click("text=Ingresar");
  await page.waitForLoadState("networkidle");
}
