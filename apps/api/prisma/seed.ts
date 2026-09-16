import { PrismaClient, Provider } from "@prisma/client";
import { WHATSAPP_DEMO_PHONE_NUMBER_ID, WHATSAPP_DEMO_WABA_ID } from "@keom/mocks";

const prisma = new PrismaClient();

const DEMO_COMPANY_ID = "demo-company-clinica";
const DEMO_INTEGRATION_ID = "demo-integration-whatsapp";

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

  console.log(`Seeded company "${company.name}" (${company.id}) with WhatsApp integration ${WHATSAPP_DEMO_PHONE_NUMBER_ID}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
