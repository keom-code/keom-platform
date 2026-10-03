import { PrismaClient, Provider } from "@prisma/client";
import { WHATSAPP_DEMO_PHONE_NUMBER_ID, WHATSAPP_DEMO_WABA_ID } from "@keom/mocks";
import { hashPassword } from "../src/auth/password";

const prisma = new PrismaClient();

const DEMO_COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_INTEGRATION_ID = "00000000-0000-4000-8000-000000000002";
/** M3: a second, non-clinic tenant so the knowledge demo can show the same schema serving
 * a different industry and company isolation. No WhatsApp integration — knowledge only. */
const SAAS_DEMO_COMPANY_ID = "00000000-0000-4000-8000-000000000003";

/**
 * Phase 11: dashboard users for Clínica Demo, same DNIs/names/roles as apps/web's mock users
 * (packages/mocks fixtures/users.ts) so switching DATA_SOURCE=http needs no new test data.
 * Local development only: the password comes from SEED_USER_PASSWORD, defaulting to a
 * documented demo value. Never seed real environments with this script.
 */
const DEMO_USERS = [
  { id: "00000000-0000-4000-8000-000000000101", dni: "12345678", name: "Carlos Ramirez", role: "SELLER" as const },
  { id: "00000000-0000-4000-8000-000000000102", dni: "87654321", name: "Andrea Torres", role: "ADMIN" as const },
];
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD || "keom-demo-2026";

async function main() {
  const company = await prisma.company.upsert({
    where: { id: DEMO_COMPANY_ID },
    update: { name: "Clínica Demo" },
    create: { id: DEMO_COMPANY_ID, name: "Clínica Demo" },
  });

  await prisma.integration.upsert({
    where: { phoneNumberId: WHATSAPP_DEMO_PHONE_NUMBER_ID },
    update: { companyId: company.id, status: "ACTIVE" },
    create: {
      id: DEMO_INTEGRATION_ID,
      companyId: company.id,
      provider: Provider.WHATSAPP,
      wabaId: WHATSAPP_DEMO_WABA_ID,
      phoneNumberId: WHATSAPP_DEMO_PHONE_NUMBER_ID,
      status: "ACTIVE",
    },
  });

  const saasCompany = await prisma.company.upsert({
    where: { id: SAAS_DEMO_COMPANY_ID },
    update: { name: "SaaS Demo" },
    create: { id: SAAS_DEMO_COMPANY_ID, name: "SaaS Demo" },
  });

  for (const user of DEMO_USERS) {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await prisma.user.upsert({
      where: { dni: user.dni },
      update: { name: user.name, role: user.role, companyId: company.id, passwordHash },
      create: { ...user, companyId: company.id, passwordHash },
    });
  }

  console.log(`Seeded company "${company.name}" (${company.id}) with WhatsApp integration ${WHATSAPP_DEMO_PHONE_NUMBER_ID}`);
  console.log(`Seeded users ${DEMO_USERS.map((u) => `${u.name} (${u.role})`).join(", ")} for "${company.name}"`);
  console.log(`Seeded company "${saasCompany.name}" (${saasCompany.id}) (no integration, M3 knowledge demo only)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
