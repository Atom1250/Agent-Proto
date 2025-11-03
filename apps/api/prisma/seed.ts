import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const templateKey = 'individual_kyc_v1';

  const template = await prisma.onboarding_template.upsert({
    where: { key: templateKey },
    update: {},
    create: {
      key: templateKey,
      name: 'Individual KYC v1',
    },
  });

  const slots = [
    { key: 'full_name', label: 'Full name', order: 1, required: true },
    { key: 'dob', label: 'Date of birth', order: 2, required: true, type: 'date' },
    { key: 'residential_address', label: 'Residential address', order: 3, required: true },
  ];

  for (const s of slots) {
    await prisma.slot.upsert({
      where: {
        templateId_key: {
          templateId: template.id,
          key: s.key,
        },
      },
      update: {
        label: s.label,
        order: s.order,
        required: s.required ?? false,
        type: s.type ?? 'text',
      },
      create: {
        templateId: template.id,
        key: s.key,
        label: s.label,
        order: s.order,
        required: s.required ?? false,
        type: s.type ?? 'text',
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete: template', templateKey);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

