import { PrismaClient, Provider } from "@prisma/client";
import { WHATSAPP_DEMO_PHONE_NUMBER_ID, WHATSAPP_DEMO_WABA_ID } from "@keom/mocks";

const prisma = new PrismaClient();

const DEMO_COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_INTEGRATION_ID = "00000000-0000-4000-8000-000000000002";
/** M3: a second, non-clinic tenant so the knowledge demo can show the same schema serving
 * a different industry and company isolation. No WhatsApp integration — knowledge only. */
const SAAS_DEMO_COMPANY_ID = "00000000-0000-4000-8000-000000000003";

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

  console.log(`Seeded company "${company.name}" (${company.id}) with WhatsApp integration ${WHATSAPP_DEMO_PHONE_NUMBER_ID}`);
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
