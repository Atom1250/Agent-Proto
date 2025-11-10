import { prisma } from './prisma';

const DEFAULT_TEMPLATE_KEY = 'individual_kyc_v1';

const DEFAULT_TEMPLATE_SLOTS = [
  { key: 'full_name', label: 'Full name', order: 1, required: true, type: 'text' as const },
  { key: 'dob', label: 'Date of birth', order: 2, required: true, type: 'date' as const },
  {
    key: 'residential_address',
    label: 'Residential address',
    order: 3,
    required: true,
    type: 'text' as const,
  },
];

export interface TemplateSummary {
  id: string;
  key: string;
  name: string;
}

export async function ensureDefaultTemplate(): Promise<TemplateSummary> {
  const template = await prisma.onboarding_template.upsert({
    where: { key: DEFAULT_TEMPLATE_KEY },
    update: {},
    create: {
      key: DEFAULT_TEMPLATE_KEY,
      name: 'Individual KYC v1',
    },
  });

  for (const slot of DEFAULT_TEMPLATE_SLOTS) {
    await prisma.slot.upsert({
      where: {
        templateId_key: {
          templateId: template.id,
          key: slot.key,
        },
      },
      update: {
        label: slot.label,
        order: slot.order,
        required: slot.required,
        type: slot.type,
      },
      create: {
        templateId: template.id,
        key: slot.key,
        label: slot.label,
        order: slot.order,
        required: slot.required,
        type: slot.type,
      },
    });
  }

  return { id: template.id, key: template.key, name: template.name };
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const templates = await prisma.onboarding_template.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, key: true, name: true },
  });

  return templates.map((template) => ({
    id: template.id,
    key: template.key,
    name: template.name,
  }));
}
